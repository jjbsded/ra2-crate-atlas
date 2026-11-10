/* Aggregate exact crate landing terms for simulated units' square coverage. */
(function(root){
 'use strict';
 const groups={MTNK:'tank',E2:'infantry',HYD:'scorpion',YHVR:'hover'};
 const reference=root.CrateBuffReference||(typeof require==='function'?require('./buff-reference.js'):null);
 const format=new Intl.NumberFormat(root.CrateI18n?.language||'zh-CN',{maximumFractionDigits:2});
 const amount=n=>(n>0&&n<.01?n.toPrecision(2):format.format(n))+'×';
 const {radius,baseline}=reference;
 const key=(x,y)=>x+','+y;
 function create(getState,getDisplay,getRadius,getRegions,{onChange=null,onPending=null,onError=null}={}){
  let entries=[],sums=new Map(),committed=null,desired=null,failed=null,job=null,timer=null,task=null,pending=false,delta=null,unitEntries=new Map();
  let prefixSource=null,prefixDisplay=null,prefixIndex=null,maximum=1;
  const asynchronous=typeof onChange==='function',now=()=>root.performance?.now()??Date.now();
  const diagnostics={completed:0,cancelled:0,indexBuilds:0,lastMs:0,lastCpuMs:0,incremental:0,full:0,reusedUnits:0,updatedUnits:0,changedCells:0};
  const target=()=>{const s=getState();return {s,data:s.data,display:getDisplay(),radius:radius(getRadius()),members:getRegions(),delta};};
  const same=(a,b)=>a&&b&&a.data===b.data&&a.display===b.display&&a.radius===b.radius&&a.members===b.members;
  function setPending(value){if(pending===value)return;pending=value;onPending?.(value);}
  function cancel(){if(timer!==null||task||job){clearTimeout(timer);timer=null;task=null;job?.iterator.return();job=null;diagnostics.cancelled++;}}
  function defer(fn,delay=0){
   if(delay){timer=root.setTimeout(()=>{timer=null;if(root.CrateMapPriority?.blocked)defer(fn);else fn();},delay);return;}
   const token=task={};const run=()=>{if(task!==token)return;if(root.CrateMapPriority?.blocked){root.CrateMapPriority.wait().then(run);return;}task=null;fn();};
   if(root.scheduler?.postTask)root.scheduler.postTask(run,{priority:'user-visible'}).catch(()=>{if(task===token)timer=root.setTimeout(run,0);});
   else timer=root.setTimeout(run,0);
  }
  function* calculate(t){
   const {s,data,display:d,radius:r,members}=t,denominator=(d?.baselineNumerator||0n)*BigInt(baseline(r)),near=new Map(),units=[],result=[],totals=new Map(),index=new Map();
   if(!denominator)return {entries:result,sums:totals,index};
   let work=0;
   function collect(unit,group,n){
    for(const region of members.get(root.CrateRegionStatistics.key(unit))||[]){
     let stats=totals.get(region.id);if(!stats)totals.set(region.id,stats={});
     const total=stats[group]||={count:0,n:0n,denominator};total.count++;total.n+=n;
    }
   }
   if(committed?.data===data&&committed.display===d&&committed.radius===r){
    const previous=entries;for(const entry of previous){collect(entry.unit,entry.group,entry.n);if(++work%128===0)yield;}
    return {entries:previous,sums:totals,index:unitEntries};
   }
   let position=0;
   for(const unit of data?.metadata.simulationPlan?.placements||[]){if(groups[unit.type])units.push({unit,id:unit.id||'@'+position});position++;if(++work%128===0)yield;}
   const patch=t.delta,local=!!(committed&&patch?.fromData===committed.data&&patch.toData===data&&patch.fromDisplay===committed.display&&patch.toDisplay===d&&committed.radius===r&&committed.display.baselineNumerator===d.baselineNumerator);
   const changes=local?[...patch.cells.values()].map(({before,after})=>({x:after.x,y:after.y,n:d.get(after).numerator-(before?committed.display.get(before).numerator:0n)})):[];
   let reused=0,updated=0;
   const newUnits=local?units.reduce((n,{id,unit})=>{const old=unitEntries.get(id);return n+(!old||old.unit.x!==unit.x||old.unit.y!==unit.y||old.unit.type!==unit.type||old.unit.onBridge!==unit.onBridge);},0):units.length;
   // The summed-area index depends on the probability result, not the radius.
   // Reuse it for all subsequent +/- operations on that result.
   let prefix=prefixSource===data&&prefixDisplay===d?prefixIndex:null;
   if(!prefix&&newUnits*(2*r-1)**2>s.cells.length*3){
    const safe=Number.isSafeInteger(2*Number(d._denominator)),zero=safe?0:0n;
    let maxX=0,maxY=0;
    for(const c of s.cells){maxX=Math.max(maxX,c.x);maxY=Math.max(maxY,c.y);if(++work%128===0)yield;}
    const width=maxX+2,height=maxY+2,values=safe?new Float64Array(width*height):Array(width*height).fill(zero);
    prefix={values,width,height};yield;
    for(const c of s.cells){
     const n=d.get(c).numerator;
     values[(c.y+1)*width+c.x+1]=safe?Number(n):n;
     if(++work%128===0)yield;
    }
    for(let y=1;y<height;y++){
     let row=zero;
     for(let x=1;x<width;x++){const i=y*width+x;row+=values[i];values[i]=values[i-width]+row;}
     yield;
    }
    prefixSource=data;prefixDisplay=d;prefixIndex=prefix;diagnostics.indexBuilds++;
   }
   for(const {unit,id} of units){
    const group=groups[unit.type],cell=s.lookup.get(key(unit.x,unit.y));
    if(!group||!cell)continue;
    const k=key(unit.x,unit.y);
    const old=local?unitEntries.get(id):null;
    const existing=old&&old.unit.x===unit.x&&old.unit.y===unit.y&&old.unit.type===unit.type&&old.unit.onBridge===unit.onBridge;
    let n=near.get(k),affected=false;
    if(n===undefined&&existing){
     n=old.n;
     for(const change of changes)if(Math.abs(change.x-unit.x)<r&&Math.abs(change.y-unit.y)<r){n+=change.n;affected=affected||change.n!==0n;}
     if(affected)updated++;else reused++;
    }
    if(n===undefined){
     updated++;
     if(prefix){
      const {values,width,height}=prefix,l=Math.max(0,unit.x-r+1),top=Math.max(0,unit.y-r+1),right=Math.min(width-1,unit.x+r),bottom=Math.min(height-1,unit.y+r);
      n=BigInt(values[bottom*width+right]-values[bottom*width+l]-values[top*width+right]+values[top*width+l]);
     }else{
      n=0n;for(let dx=1-r;dx<r;dx++)for(let dy=1-r;dy<r;dy++){
       const q=s.lookup.get(key(unit.x+dx,unit.y+dy));if(q)n+=d.get(q).numerator;if(++work%128===0)yield;
      }
     }
    }
    near.set(k,n);
    const entry=existing&&old.unit===unit&&old.cell===cell&&old.n===n&&old.denominator===denominator?old:{unit,group,cell,n,denominator,value:existing&&old.n===n&&old.denominator===denominator?old.value:root.CrateProbabilityDisplay.ratio(n,denominator)};
    result.push(entry);index.set(id,entry);
    collect(unit,group,n);
    if(++work%128===0)yield;
   }
   return {entries:result,sums:totals,index,local,reused,updated,changedCells:changes.length};
  }
  function publish(t,value,started,notify=true){
   committed=desired=t;failed=null;entries=value.entries;sums=value.sums;unitEntries=value.index||unitEntries;job=null;timer=null;task=null;if(delta?.toData===t.data)delta=null;
   maximum=1;for(const entry of entries)maximum=Math.max(maximum,entry.value);
   diagnostics.completed++;diagnostics.lastMs=now()-started;if(value.local!==undefined){diagnostics[value.local?'incremental':'full']++;diagnostics.reusedUnits=value.reused;diagnostics.updatedUnits=value.updated;diagnostics.changedCells=value.changedCells;}setPending(false);if(notify)onChange?.();
  }
  function complete(t,notify=true){
   cancel();const started=now(),iterator=calculate(t);let step;do{step=iterator.next();}while(!step.done);publish(t,step.value,started,notify);
  }
  function start(t){
   timer=null;const ticket=job={target:t,iterator:calculate(t),started:now(),cpu:0};
   function step(){
    timer=null;if(job!==ticket)return;
    if(!same(target(),t)){refresh();return;}
    try{
     const started=now();let part;
     do{part=ticket.iterator.next();if(part.done){ticket.cpu+=now()-started;diagnostics.lastCpuMs=ticket.cpu;publish(t,part.value,ticket.started);return;}}while(now()-started<2);
     ticket.cpu+=now()-started;defer(step);
    }catch(error){job=null;failed=t;setPending(false);onError?.(error);}
   }
   step();
  }
  function refresh(delay=0,immediate=false){
   const t=target();
   if(same(t,committed)){cancel();desired=t;setPending(false);return;}
   if(same(t,failed)){cancel();desired=t;setPending(false);return;}
   if(same(t,desired)&&(job||timer!==null||task))return;
   cancel();desired=t;
   if(prefixSource!==t.data||prefixDisplay!==t.display)prefixSource=prefixDisplay=prefixIndex=null;
   if(committed&&committed.data?.metadata.sourceSha256!==t.data?.metadata.sourceSha256){entries=[];sums=new Map();}
   if(!asynchronous){complete(t,false);return;}
   setPending(true);if(immediate)start(t);else defer(()=>start(t),delay);
  }
  function updateCells(changes,{previousData,previousDisplay,compatible}={}){
   const t=target();
   if(!compatible||!committed||committed.radius!==t.radius){delta=null;refresh(0,true);return;}
   let next;
   if(committed.data===previousData&&committed.display===previousDisplay)next={fromData:previousData,fromDisplay:previousDisplay,cells:new Map()};
   else if(delta?.toData===previousData&&delta.fromData===committed.data&&delta.fromDisplay===committed.display)next={...delta,cells:new Map(delta.cells)};
   if(!next){delta=null;refresh(0,true);return;}
   for(const [before,after]of changes){const k=key(after.x,after.y),old=next.cells.get(k);next.cells.set(k,{before:old?old.before:before,after});}
   next.toData=t.data;next.toDisplay=t.display;delta=next;
   cancel();desired=null;refresh(0,true);
  }
  function values(){refresh();return entries;}
  function statistics(){refresh();return sums;}
  function snapshot(options={}){
   // An explicit export must capture the latest radius even during a debounce.
   const t=target();if(!same(t,committed))complete(t);
   const units=entries.slice(),style={...options,paletteColors:{...(options.paletteColors||reference.paletteSettings())},maximum:options.maximum??maximum};return (ctx,view,area)=>paint(ctx,view,area,units,style);
  }
  function paint(ctx,view,area,units=values(),options={}){
   const showLabels=options.values!==false&&view.scale*30>=26,showHeat=!!options.heatmap;
   if(!showLabels&&!showHeat)return {colored:0,labels:0};
   const seen=new Set(),colors=new Map(),heatColors=new Map(),maximumValue=options.maximum??maximum,size=reference.labelSize(view.scale,options.labelSize||12,options.paletteColors),opacityAt=showHeat?(root.CrateProbability||(typeof require==='function'?require('./probability.js'):null)).opacityCurve(maximumValue,options.paletteColors):null;
   let colored=0,labels=0;
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
   ctx.font='700 '+size+'px "Microsoft YaHei",sans-serif';
   for(const {unit,cell,value} of units){
    if(!(value>0)&&!options.zeroLayer&&!options.zeroValues||value<(options.threshold||0)||options.filter&&options.filter!=='all'&&(options.filter==='water'?cell.land!==2:cell.land===2))continue;
    const baseline=reference.isBaseline(value),selected=view.selected?.x===unit.x&&view.selected?.y===unit.y;
    const x=view.x+(cell.px+(cell.labelOffset?.[0]||0))*view.scale;
    const y=view.y+(cell.py+(cell.labelOffset?.[1]||0)-(unit.onBridge?60:0))*view.scale+size/3;
    if(x<area.x-60*view.scale-size||x>area.x+area.w+60*view.scale+size||y<area.y-30*view.scale-size||y>area.y+area.h+30*view.scale+size)continue;
    const k=key(unit.x,unit.y)+':'+unit.onBridge;
    if(seen.has(k))continue;
    seen.add(k);
    if(showHeat&&(value>0||options.zeroLayer)&&(options.baselineLayer!==false||!baseline||selected)){
     if(!heatColors.has(value))heatColors.set(value,reference.color(value,options.palette,maximumValue,options.paletteColors));ctx.fillStyle=heatColors.get(value);ctx.globalAlpha=options.opaqueLayers?1:root.CrateProbabilityDisplay.alpha((1-(options.opacity??0)/100)*opacityAt(value),baseline,options.paletteColors?.baselineFactor);ctx.beginPath();
     for(const ring of cell.visibleSurface||cell.surface||[[[0,-15],[30,0],[0,15],[-30,0]]]){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](view.x+(cell.px+dx)*view.scale,view.y+(cell.py+dy-(unit.onBridge?60:0))*view.scale));ctx.closePath();}ctx.fill('evenodd');ctx.globalAlpha=1;colored++;
    }
    if(!showLabels||!value&&!options.zeroValues||options.baselineValues===false&&baseline&&!selected)continue;
    const label=amount(value);
    ctx.strokeStyle='#10212d';ctx.lineWidth=reference.labelStrokeWidth(size,options.paletteColors);ctx.strokeText(label,x,y);
    if(!colors.has(value))colors.set(value,options.fixedColor||reference.textColor(value,options.palette||'warm',maximumValue,options.colorText,options.paletteColors));ctx.fillStyle=colors.get(value);ctx.fillText(label,x,y);labels++;
   }
   ctx.restore();
   return {colored,labels};
  }
  return {values,statistics,paint,snapshot,refresh,updateCells,get maximum(){return maximum;},get status(){return {...diagnostics,pending,requestedRadius:desired?.radius,appliedRadius:committed?.radius};}};
 }
 root.CrateUnitBuff={create,radius,baseline,amount};
 if(typeof module!=='undefined')module.exports=root.CrateUnitBuff;
})(globalThis);
