/* Progressive background calculation plus an independent transparent layer.
 * Updating this layer never invalidates the terrain/object raster cache. */
(function(root){
 'use strict';
 const reference=root.CrateBuffReference;
 function create({getState,getRadius,schedule,onPending,onError}){
  let worker=null,request=0,sourceNumber=0,workerSource=null,desired=null,applied=null,enabled=false,pending=false,revision=0,maximum=1,values=new Float64Array(262144),cells=new Map(),buckets=new Map(),bounds=null;
  const sources=new Map();let paintMapKey='',heatVisible=false,failed=null,fieldId=0,heat=null,heatKey='',wantedHeatStamp='',heatRequest=0,waiters=[],diagnostics={},ui={maxPublishMs:0,maxHeatMs:0,maxSendMs:0,workerRasterMs:0};
  const labelSprites=new Map();let labelPixels=0;
  function labelSprite(text,ratio,ctx,color,size,configuration){ratio=Math.ceil(ratio*Math.max(1,size/12)*2)/2;const outline=Math.ceil(root.CrateProbability.labelStrokeWidth(size,configuration)*12/size*16)/16,key=ratio+'|'+outline+'|'+text+'|'+color;if(labelSprites.has(key)){const item=labelSprites.get(key);labelSprites.delete(key);labelSprites.set(key,item);return item;}
   const padding=Math.ceil(outline/2+2),baseline=padding+12,canvas=document.createElement('canvas');canvas.width=Math.ceil((ctx.measureText(text).width*12/size+2*padding)*ratio);canvas.height=Math.ceil((16+2*padding)*ratio);const target=canvas.getContext('2d');target.setTransform(ratio,0,0,ratio,0,0);target.font='700 12px "Microsoft YaHei",sans-serif';target.textAlign='center';target.strokeStyle='#10212d';target.fillStyle=color;target.lineJoin='round';target.lineWidth=outline;target.strokeText(text,canvas.width/ratio/2,baseline);target.fillText(text,canvas.width/ratio/2,baseline);
   const pixels=canvas.width*canvas.height,item={image:canvas,width:canvas.width/ratio,height:canvas.height/ratio,baseline};labelSprites.set(key,item);labelPixels+=pixels;
   while(labelPixels>1000000||labelSprites.size>512){const old=labelSprites.keys().next().value,value=labelSprites.get(old);labelPixels-=value.image.width*value.image.height;labelSprites.delete(old);}return item;
  }
  const equal=(a,b)=>a&&b&&a.data===b.data&&a.radius===b.radius;
  const target=()=>({data:getState().data,radius:root.CrateUnitBuff.radius(getRadius())});
  function setPending(value){pending=value;onPending?.(value||!!(enabled&&heatVisible&&bounds&&heat?.revision!==revision));if(!value){for(const done of waiters)done();waiters=[];}}
  const defer=()=>root.scheduler?.postTask?root.scheduler.postTask(()=>{},{priority:'background'}):new Promise(resolve=>setTimeout(resolve,0));
  async function source(data,id){if(sources.has(data))return sources.get(data);const headers=new Int32Array(data.cells.length*6),points=[],grid=new Uint8Array(262144),statuses=new Uint8Array(262144),result={id:++sourceNumber,metadata:{size:data.metadata.size},probability:{exact:data.probability.exact,attemptLimit:data.probability.attemptLimit},packed:{grid,statuses}};
   for(let i=0;i<data.cells.length;i++){const c=data.cells[i],key=c.y*512+c.x;grid[key]=(c.candidate?(+c.track|(+c.float<<1)):0)|(+c.primary<<2)|(+ (c.land===2)<<3);statuses[key]=c.status==='crate'?1:c.status==='ghost'?2:0;const start=points.length;for(const ring of c.visibleSurface||c.surface||[]){points.push(ring.length);for(const p of ring)points.push(...p);}headers.set([key,c.px,c.py,c.land??-1,start,points.length],i*6);if(i%256===0){await defer();if(id!==request)return null;}}
   result.geometry={headers,points:Float32Array.from(points)};
   sources.set(data,result);while(sources.size>2)sources.delete(sources.keys().next().value);return result;
  }
  function indexCell(id,value){values[id]=value;if(!value){if(cells.has(id)){const old=cells.get(id);buckets.get(Math.floor(old.px/256)+','+Math.floor(old.py/256))?.delete(id);cells.delete(id);}return;}
   if(cells.has(id))return;const s=getState(),x=id&511,y=id>>>9,[ox,oy]=s.data.rendering.origin,cell=s.lookup.get(x+','+y)||{x,y,px:30*(x-y)+ox,py:15*(x+y)+oy,land:null,virtual:true,surface:[[[0,-15],[30,0],[0,15],[-30,0]]]};
   cells.set(id,cell);const key=Math.floor(cell.px/256)+','+Math.floor(cell.py/256);if(!buckets.has(key))buckets.set(key,new Map());buckets.get(key).set(id,cell);
  }
  function ensureWorker(){if(worker)return worker;worker=new Worker(new URL('buff-expectation-worker.js?v=12',document.baseURI));
   worker.onmessage=({data:m})=>{if(m.paint){if(m.error){onPending?.(pending);onError?.(Error(m.error));return;}if(m.id!==fieldId||m.requestId!==heatRequest){m.image.close();return;}heat?.image.close();heat={image:m.image,plan:m.plan,stamp:m.stamp,revision:JSON.parse(m.stamp)[0]};ui.workerRasterMs=m.ms;onPending?.(pending||heatVisible&&heat.revision!==revision);schedule();return;}if(m.id!==request)return;if(m.error){failed={...desired,error:m.error};setPending(false);onError?.(Error(m.error));return;}workerSource=desired.data;fieldId=m.id;
    const started=performance.now(),s=getState(),[ox,oy]=s.data.rendering.origin,b=m.bounds;
    bounds={x:Math.min(0,ox+30*(b.left-b.bottom)-30),y:Math.min(0,oy+15*(b.left+b.top)-15),w:0,h:0};bounds.w=Math.max(s.data.rendering.width,ox+30*(b.right-b.top)+30)-bounds.x;bounds.h=Math.max(s.data.rendering.height,oy+15*(b.right+b.bottom)+15)-bounds.y;
    for(let i=0;i<m.keys.length;i++)indexCell(m.keys[i],m.numbers[i]);maximum=Math.max(1,m.maximum);revision++;diagnostics={...m.diagnostics,ms:m.ms,progress:m.progress};
    if(m.done){applied=desired;setPending(false);}ui.maxPublishMs=Math.max(ui.maxPublishMs,performance.now()-started);schedule();
   };worker.onerror=e=>{failed={...desired,error:e.message};setPending(false);onError?.(Error(e.message));};return worker;
  }
  function refresh(){if(!enabled)return;const t=target();if(!t.data||t.data.metadata.previewOnly)return;if(equal(t,desired))return;
   if(equal(t,failed))return;failed=null;desired=t;const id=++request;worker?.postMessage({cancel:true});setPending(true);
   (async()=>{const input=await source(t.data,id);if(!input||id!==request)return;const meta=t.data.metadata,r=t.data.rendering,mapKey=[meta.sourceSha256,meta.version,meta.rulesSha256,r.width,r.height,...r.origin].join('|');if(mapKey!==paintMapKey){values=new Float64Array(262144);cells=new Map();buckets=new Map();maximum=1;bounds=null;heat?.image.close();heat=null;}paintMapKey=mapKey;revision++;heatKey='';heatRequest++;
    const s=getState(),a=root.CrateMapViewer?.area,[ox,oy]=s.data.rendering.origin;let priority={};if(a){const points=[[a.x,a.y],[a.x+a.w,a.y],[a.x,a.y+a.h],[a.x+a.w,a.y+a.h]].map(([x,y])=>{const dx=((x-s.x)/s.scale-ox)/30,dy=((y-s.y)/s.scale-oy)/15;return[(dx+dy)/2,(dy-dx)/2];});priority={left:Math.min(...points.map(p=>p[0]))-2,right:Math.max(...points.map(p=>p[0]))+2,top:Math.min(...points.map(p=>p[1]))-2,bottom:Math.max(...points.map(p=>p[1]))+2};}
    const sendAt=performance.now();ensureWorker().postMessage({id,data:workerSource===t.data?null:input,mapKey,radius:t.radius,priority});ui.maxSendMs=Math.max(ui.maxSendMs,performance.now()-sendAt);schedule();
   })().catch(error=>{if(id===request){failed={...desired,error:error.message};setPending(false);onError?.(error);}});
  }
  function setEnabled(value){if(enabled===value){if(value)refresh();return;}enabled=value;if(!value){request++;heatRequest++;heatKey='';worker?.postMessage({cancel:true});desired=applied;setPending(false);}else refresh();}
  function visible(view,area,fn,scope=null){const pool=scope?.buckets||buckets,numbers=scope?.values||values,left=(area.x-view.x)/view.scale-35,top=(area.y-view.y)/view.scale-35,right=left+area.w/view.scale+70,bottom=top+area.h/view.scale+70;
   for(let y=Math.floor(top/256);y<=Math.floor(bottom/256);y++)for(let x=Math.floor(left/256);x<=Math.floor(right/256);x++)for(const[id,c]of pool.get(x+','+y)||[])if(c.px>=left&&c.px<=right&&c.py>=top&&c.py<=bottom)fn(c,numbers[id]);
  }
  function allowed(c,value,options){return value>0&&value>=(options.threshold||0)&&(options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2));}
  const baseline=reference.isBaseline;
  function paintHeat(ctx,view,area,options,scope=null,ceiling=maximum){const started=performance.now(),colors=new Map(),opacityAt=root.CrateProbability.opacityCurve(ceiling,options.paletteColors);let count=0;visible(view,area,(c,value)=>{if(!allowed(c,value,options)||options.baselineLayer===false&&baseline(value))return;
   const token=Math.round(value*10000);if(!colors.has(token))colors.set(token,reference.color(value,options.palette,ceiling,options.paletteColors));ctx.fillStyle=colors.get(token);ctx.globalAlpha=root.CrateProbabilityDisplay.alpha((1-options.opacity/100)*opacityAt(value),baseline(value),options.paletteColors?.baselineFactor);ctx.beginPath();for(const ring of c.visibleSurface||c.surface||[]){ring.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](view.x+(c.px+x)*view.scale,view.y+(c.py+y)*view.scale));ctx.closePath();}ctx.fill('evenodd');count++;
  },scope);ctx.globalAlpha=1;ui.maxHeatMs=Math.max(ui.maxHeatMs,performance.now()-started);return count;}
  function raster(ctx,view,area,options){const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1,stamp=JSON.stringify([revision,options.opacity,options.palette,root.CrateProbability.heatStyle(options.paletteColors),options.filter,options.threshold,options.baselineLayer,maximum]),old=heat?.plan;
   wantedHeatStamp=stamp;
   const covers=old&&(old.full||view.x+old.worldX*view.scale<=area.x&&view.y+old.worldY*view.scale<=area.y&&view.x+(old.worldX+old.width/old.ratio/old.scale)*view.scale>=area.x+area.w&&view.y+(old.worldY+old.height/old.ratio/old.scale)*view.scale>=area.y+area.h);
   if(bounds&&(!heat||heat.stamp!==stamp||!covers||old.scale!==view.scale&&!view.navigating||old.ratio!==ratio)){
    const full=(bounds.w*view.scale*ratio+8)*(bounds.h*view.scale*ratio+8)<=8000000&&bounds.w*view.scale*ratio<8190&&bounds.h*view.scale*ratio<8190,margin=96;
    const plan={ratio,scale:view.scale,full,worldX:full?bounds.x-3/view.scale:(area.x-margin-view.x)/view.scale,worldY:full?bounds.y-3/view.scale:(area.y-margin-view.y)/view.scale,width:Math.ceil((full?bounds.w*view.scale+6:area.w+2*margin)*ratio),height:Math.ceil((full?bounds.h*view.scale+6:area.h+2*margin)*ratio)};
    const key=JSON.stringify([fieldId,stamp,plan]);if(heatKey!==key){heatKey=key;onPending?.(true);ensureWorker().postMessage({paint:true,id:fieldId,requestId:++heatRequest,stamp,plan,options:{opacity:options.opacity,palette:options.palette,paletteColors:options.paletteColors,filter:options.filter,threshold:options.threshold,baselineLayer:options.baselineLayer},maximum,origin:getState().data.rendering.origin});}
   }
   if(heat){const p=heat.plan,factor=view.scale/p.scale;ctx.imageSmoothingEnabled=factor<1;ctx.drawImage(heat.image,view.x+p.worldX*view.scale,view.y+p.worldY*view.scale,heat.image.width/p.ratio*factor,heat.image.height/p.ratio*factor);}
  }
  function paint(ctx,view,area,options,scope=null,ceiling=maximum){if(!scope){refresh();if(!options.labelsOnly&&heatVisible!==!!options.heatmap){heatVisible=!!options.heatmap;onPending?.(pending||!!(heatVisible&&bounds&&heat?.revision!==revision));}}let colored=0,labels=0;ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   if(options.heatmap&&(scope?.bounds||bounds)){if(options.export)paintHeat(ctx,view,area,options,scope,ceiling);else raster(ctx,view,area,options);visible(view,area,(c,value)=>{if(allowed(c,value,options)&&(options.baselineLayer!==false||!baseline(value)))colored++;},scope);}
   if(options.values&&view.scale*30>=26){const size=root.CrateProbability.labelSize(view.scale,options.labelSize||12,options.paletteColors);ctx.font='700 '+size+'px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=root.CrateProbability.labelStrokeWidth(size,options.paletteColors);ctx.strokeStyle='#10212d';ctx.imageSmoothingEnabled=false;const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1;visible(view,area,(c,value)=>{if(!allowed(c,value,options)||!options.baselineValues&&baseline(value)||options.skipLabels?.has(c.x+','+c.y))return;const x=view.x+(c.px+(c.labelOffset?.[0]||0))*view.scale,y=view.y+(c.py+(c.labelOffset?.[1]||0))*view.scale+size/3,label=root.CrateUnitBuff.amount(value);const color=reference.textColor(value,options.palette,ceiling,options.colorText,options.paletteColors);if(options.export){ctx.fillStyle=color;ctx.strokeText(label,x,y);ctx.fillText(label,x,y);}else{const sprite=labelSprite(label,ratio,ctx,color,size,options.paletteColors),factor=size/12;ctx.drawImage(sprite.image,x-sprite.width*factor/2,y-sprite.baseline*factor,sprite.width*factor,sprite.height*factor);}labels++;},scope);}
   ctx.restore();return {colored,labels};
  }
  function snapshot(options){options={...options,paletteColors:{...(options.paletteColors||reference.paletteSettings())}};const scope={bounds,buckets:new Map([...buckets].map(([k,v])=>[k,new Map(v)])),values:values.slice()},ceiling=maximum;return(ctx,view,area)=>paint(ctx,view,area,{...options,export:true},scope,ceiling);}
  return {paint,snapshot,refresh,setEnabled,ready:async()=>{if(pending)await new Promise(resolve=>waiters.push(resolve));if(equal(target(),failed))throw Error(failed.error);},get maximum(){return maximum;},get status(){return {...diagnostics,...ui,pending,revision,cells:cells.size,rasterReady:!heatVisible||!!heat&&heat.revision===revision&&heat.stamp===wantedHeatStamp,rasterPending:!!(enabled&&heatVisible&&bounds&&(heat?.revision!==revision||heat?.stamp!==wantedHeatStamp))};},get:(x,y)=>values[y*512+x]||0};
 }
 root.CrateBuffExpectationUI={create};
})(globalThis);
