/* Physical, common-edge land/water contacts. Objects and overlays cannot
 * obstruct this geography layer. Analysis yields; panning visits spatial bins. */
(function(root){
 'use strict';
 const ramps=[[0,0,0,0],[0,1,1,0],[0,0,1,1],[1,0,0,1],[1,1,0,0],[0,1,0,0],[0,0,0,1],[1,0,0,0],[0,0,1,0],[0,1,1,1],[1,0,1,1],[1,1,0,1],[1,1,1,0],[0,1,2,1],[1,0,1,2],[2,1,0,1],[1,2,1,0],[0,1,0,1],[1,0,1,0],[0,1,0,1],[1,0,1,0]];
 const lands=['CLEAR','ROAD','WATER','ROCK','WALL','TIBERIUM','BEACH','ROUGH','ICE','RAILROAD','TUNNEL'],key=c=>c.x*1024+c.y;
 const defaults=Object.freeze({landColor:'#44fe10',landOpacity:.35,waterColor:'#75adf5',waterOpacity:.35,lineOpacity:.8,lineWidth:3});
 const sides=[[[1,0],[1,2],[0,3]],[[0,1],[2,3],[1,0]],[[-1,0],[0,3],[1,2]],[[0,-1],[1,0],[2,3]]];
 const number=v=>{const text=String(v??0).trim();return Number(text.endsWith('%')?text.slice(0,-1):text);};
 const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
 async function build(data,rules,{signal,yieldControl=turn}={}){
  const started=performance.now(),lookup=new Map(),land=[],water=new Set();let at=started,work=0;
  const pause=async()=>{signal?.throwIfAborted();if(performance.now()-at>=5){await yieldControl();signal?.throwIfAborted();at=performance.now();}};
  for(let i=0;i<data.cells.length;i++){
   const c=data.cells[i],raw=c.rawLand;if(c.terrainError||!Number.isInteger(raw)||raw<0||raw>=lands.length||!ramps[c.slope])continue;
   const cliff=data.metadata.cliffBackImpassability===2&&c.higher?.length&&[0,2,6,8].includes(raw),landType=cliff?3:raw,cost=rules[lands[landType]]||{},wet=landType===2;
   if(wet?number(cost.FLOAT)>0:number(cost.FOOT)>0)lookup.set(key(c),{c,wet,corners:ramps[c.slope]});
   if((i&255)===0)await pause();
  }
  for(const [id,a]of lookup){if(a.wet)continue;let contact=false;
   for(const [[dx,dy],one,two]of sides){const b=lookup.get((a.c.x+dx)*1024+a.c.y+dy);if(!b?.wet)continue;
    if(one.every((corner,i)=>Math.abs(a.c.level+a.corners[corner]-b.c.level-b.corners[two[i]])<1e-8)){contact=true;water.add(key(b.c));}
   }
   if(contact)land.push(id);if((++work&255)===0)await pause();
  }
  const coordinates=ids=>[...ids].sort((a,b)=>a-b).map(id=>[Math.floor(id/1024),id%1024]);
  signal?.throwIfAborted();return {land:coordinates(land),water:coordinates(water),ms:performance.now()-started};
 }
 function create({getState,loadRules,onChange=()=>{},onError=()=>{},schedule=()=>{},settings={...defaults}}){
  let enabled=false,inspecting=false,result=null,index=null,revision=0,controller=null,pending=null,activeKey=null;const cache=new Map(),indices=new WeakMap(),paths=new WeakMap();
  const needed=()=>enabled||inspecting;
  const raster=root.CrateMapLabelCache?.create({schedule,maxPixels:8000000,tileSize:256,margin:192}),styleKey=()=>JSON.stringify([settings.landColor,settings.landOpacity,settings.waterColor,settings.waterOpacity,settings.lineOpacity,settings.lineWidth]);
  async function prepare(value,ticket){let prepared=indices.get(value);if(!prepared){const s=getState(),[ox,oy]=s.data.rendering.origin,bins=new Map();let count=0,at=performance.now();
   for(const [kind,list]of [['land',value.land],['water',value.water]])for(const [x,y]of list){const c=s.lookup.get(x+','+y);if(!c)continue;const entry={x,y,kind,px:30*(x-y)+ox,py:15*(x+y-c.level)+oy},token=Math.floor(entry.px/256)+','+Math.floor(entry.py/256);if(!bins.has(token))bins.set(token,[]);bins.get(token).push(entry);count++;if((count&511)===0&&performance.now()-at>5){await turn();if(ticket!==revision)return;at=performance.now();}}
   prepared={bins,count};indices.set(value,prepared);
   }if(ticket!==revision)return;if(index!==prepared)raster?.clear();index=prepared;result=value;onChange(value);
  }
  async function refresh(){const s=getState(),data=s.data;if(!needed()||!data)return;
   const m=data.metadata,k=m.sourceSha256?[m.sourceSha256,m.version,m.rulesSha256,m.theaterSha256,m.cliffBackImpassability,data.cells.length,...data.rendering.origin,data.rendering.width,data.rendering.height].join('|'):data;
   if(activeKey===k&&(result||pending))return pending;
   activeKey=k;const ticket=++revision;controller?.abort();controller=new AbortController();const signal=controller.signal;result=index=null;
   if(cache.has(k)){pending=prepare(cache.get(k),ticket);await pending;if(ticket===revision)pending=null;return;}
   onChange(null);
   pending=(async()=>{try{const rules=await loadRules();signal.throwIfAborted();const value=await build(data,rules,{signal});if(ticket!==revision||!needed())return;cache.set(k,value);while(cache.size>2)cache.delete(cache.keys().next().value);await prepare(value,ticket);}
    catch(error){if(error.name!=='AbortError'&&ticket===revision)onError(error);}finally{if(ticket===revision)pending=null;}})();return pending;
  }
  function draw(ctx,view,area,index,settings){if(!index)return;const scale=view.scale,left=(area.x-view.x)/scale-70,right=(area.x+area.w-view.x)/scale+70,top=(area.y-view.y)/scale-130,bottom=(area.y+area.h-view.y)/scale+130;
   const batches=root.Path2D?{land:[],water:[]}:null,radius=Math.min(4/scale,3);
   ctx.save();ctx.lineJoin='round';if(batches){ctx.translate(view.x,view.y);ctx.scale(scale,scale);}
   for(let by=Math.floor(top/256);by<=Math.floor(bottom/256);by++)for(let bx=Math.floor(left/256);bx<=Math.floor(right/256);bx++)for(const e of index.bins.get(bx+','+by)||[]){
    if(e.px<left||e.px>right||e.py<top||e.py>bottom)continue;const c=view.lookup.get(e.x+','+e.y);if(!c)continue;
    if(batches){let cached=paths.get(c);if(!cached||cached.radius!==radius){const path=new root.Path2D(),writer={beginPath(){}};for(const method of ['moveTo','lineTo','quadraticCurveTo','closePath'])writer[method]=(...args)=>path[method](...args);root.CrateOccupancyOverlay.path(writer,(c.visibleSurface||c.surface||[[[0,-15],[30,0],[0,15],[-30,0]]]).map(r=>r.map(([dx,dy])=>[c.px+dx,c.py+dy])),radius);cached={radius,path};paths.set(c,cached);}batches[e.kind].push(cached.path);continue;}
    const rings=(c.visibleSurface||c.surface||[[[0,-15],[30,0],[0,15],[-30,0]]]).map(r=>r.map(([dx,dy])=>[view.x+(c.px+dx)*scale,view.y+(c.py+dy)*scale]));
    root.CrateOccupancyOverlay.path(ctx,rings,Math.min(4,3*scale));ctx.fillStyle=settings[e.kind+'Color'];ctx.globalAlpha=Math.max(0,Math.min(1,settings[e.kind+'Opacity']));ctx.fill('evenodd');if(settings.lineWidth>0){ctx.globalAlpha=Math.max(0,Math.min(1,settings.lineOpacity));ctx.strokeStyle=settings[e.kind+'Color'];ctx.lineWidth=settings.lineWidth;ctx.stroke();}
   }if(batches)for(const kind of ['land','water']){ctx.fillStyle=settings[kind+'Color'];ctx.globalAlpha=Math.max(0,Math.min(1,settings[kind+'Opacity']));for(const path of batches[kind])ctx.fill(path,'evenodd');if(settings.lineWidth>0){ctx.globalAlpha=Math.max(0,Math.min(1,settings.lineOpacity));ctx.strokeStyle=settings[kind+'Color'];ctx.lineWidth=settings.lineWidth/scale;for(const path of batches[kind])ctx.stroke(path);}}ctx.restore();
  }
  function paint(ctx,view,area){if(!enabled||!index)return;if(!raster||index.count<128){draw(ctx,view,area,index,settings);return;}const geometry=index,stamp=styleKey(),style={...settings};raster.render(ctx,{...view,navigating:true},area,{key:revision+'|'+stamp,prepare:!getState().busy,prepareWhileMoving:true,valid:()=>enabled&&index===geometry&&styleKey()===stamp,paint:(target,local,part)=>draw(target,{...view,...local},part,geometry,style)});}
  function sync(){if(needed())return refresh();revision++;controller?.abort();raster?.clear();pending=null;activeKey=null;result=index=null;}
  return {settings,paint,snapshot(){const frozen=index,style={...settings};return(ctx,view,area)=>draw(ctx,view,area,frozen,style);},refresh,setEnabled(value){enabled=!!value;return sync();},setInspecting(value){if(inspecting===!!value)return;inspecting=!!value;return sync();},get enabled(){return enabled;},get result(){return result;},get status(){return {pending:!!pending,land:result?.land.length||0,water:result?.water.length||0,indexed:index?.count||0,raster:raster?.status};}};
 }
 const api={defaults,build,create};root.CrateSeaLandConnections=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
