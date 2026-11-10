/* Progressive background calculation plus an independent transparent layer.
 * Updating this layer never invalidates the terrain/object raster cache. */
(function(root){
 'use strict';
 const reference=root.CrateBuffReference;
 const sourceCodec=root.CrateBuffSource||(typeof require==='function'?require('./buff-source.js'):null);
 function create({getState,getRadius,isEditing,schedule,onPending,onError,onChange}){
  let worker=null,request=0,sourceNumber=0,desired=null,enabled=false,pending=false,revision=0,maximum=1,values=new Float64Array(262144),cells=new Map(),buckets=new Map(),bounds=null;
  const sources=new Map();let paintMapKey='',heatVisible=false,failed=null,fieldId=0,heat=null,heatKey='',wantedHeatStamp='',heatRequest=0,waiters=[],diagnostics={},ui={maxPublishMs:0,maxHeatMs:0,maxSendMs:0,workerRasterMs:0,fullSourceSends:0,deltaSourceSends:0,superseded:0,started:0};
  let queued=null,queueTimer=null,journal=null,workerSourceId=null,pendingSend=null;
  const batches=[];let publishing=false;
  const labelSprites=new Map();let labelPixels=0;
  const labelRaster=root.CrateMapLabelCache?.create({schedule});
  const labelValues=new Map();let labelStyle='',labelSkip=null,labelSkipRevision=0;
  function labelSprite(text,ratio,ctx,color,size,configuration){ratio=Math.ceil(ratio*Math.max(1,size/12)*2)/2;const outline=Math.ceil(root.CrateProbability.labelStrokeWidth(size,configuration)*12/size*16)/16,key=ratio+'|'+outline+'|'+text+'|'+color;if(labelSprites.has(key)){const item=labelSprites.get(key);labelSprites.delete(key);labelSprites.set(key,item);return item;}
   const padding=Math.ceil(outline/2+2),baseline=padding+12,canvas=document.createElement('canvas');canvas.width=Math.ceil((ctx.measureText(text).width*12/size+2*padding)*ratio);canvas.height=Math.ceil((16+2*padding)*ratio);const target=canvas.getContext('2d');target.setTransform(ratio,0,0,ratio,0,0);target.font='700 12px "Microsoft YaHei",sans-serif';target.textAlign='center';target.strokeStyle='#10212d';target.fillStyle=color;target.lineJoin='round';target.lineWidth=outline;target.strokeText(text,canvas.width/ratio/2,baseline);target.fillText(text,canvas.width/ratio/2,baseline);
   const pixels=canvas.width*canvas.height,item={image:canvas,width:canvas.width/ratio,height:canvas.height/ratio,baseline};labelSprites.set(key,item);labelPixels+=pixels;
   while(labelPixels>4000000||labelSprites.size>2048){const old=labelSprites.keys().next().value,value=labelSprites.get(old);labelPixels-=value.image.width*value.image.height;labelSprites.delete(old);}return item;
  }
  const equal=(a,b)=>a&&b&&a.data===b.data&&a.radius===b.radius;
  const target=()=>({data:getState().data,radius:root.CrateUnitBuff.radius(getRadius())});
  const rasterPending=()=>!!(enabled&&heatVisible&&bounds&&(heat?.revision!==revision||heat?.stamp!==wantedHeatStamp));
  function notifyPending(){const rasterizing=rasterPending();onPending?.(pending||rasterizing,{calculating:pending,rasterizing});}
  function setPending(value){const changed=pending!==value;pending=value;if(value)labelRaster?.cancel();notifyPending();if(!value){for(const done of waiters)done();waiters=[];}if(changed)onChange?.();}
  function resetField(){values=new Float64Array(262144);cells=new Map();buckets=new Map();maximum=1;bounds=null;heat?.image.close();heat=null;heatKey=wantedHeatStamp='';heatRequest++;labelRaster?.clear();revision++;}
  root.CrateMapPriority?.subscribe(paused=>worker?.postMessage({interactionPaused:paused}));
  const defer=async()=>{if(root.CrateMapPriority?.blocked)await root.CrateMapPriority.wait();await (root.scheduler?.postTask?root.scheduler.postTask(()=>{},{priority:'background'}):new Promise(resolve=>setTimeout(resolve,0)));if(root.CrateMapPriority?.blocked)await root.CrateMapPriority.wait();};
  async function source(data,id){if(sources.has(data)){ui.sourcePackMs=0;ui.sourcePackReused=true;return sources.get(data);}const started=performance.now(),change=journal?.data===data?journal:null,number=++sourceNumber;
   async function drain(steps){let part,tick=performance.now();do{part=steps.next();if(!part.done&&performance.now()-tick>=2){await defer();if(id!==request){steps.return();return null;}tick=performance.now();}}while(!part.done);return part.value;}
   let result=change?.base?await drain(sourceCodec.patch(change.base,data,number,change.all?data.cells:change.cells.values())):null;if(id!==request)return null;
   const reused=!!result;if(!result)result=await drain(sourceCodec.pack(data,number));if(id!==request||!result)return null;
   ui.sourcePackMs=performance.now()-started;ui.sourcePackReused=false;ui.geometryReused=reused;ui.patchedCells=reused?(change.all?data.cells.length:change.cells.size):0;sources.set(data,result);while(sources.size>2)sources.delete(sources.keys().next().value);return result;
  }
  function indexCell(id,value){values[id]=value;if(!value){if(cells.has(id)){const old=cells.get(id);buckets.get(Math.floor(old.px/256)+','+Math.floor(old.py/256))?.delete(id);cells.delete(id);}return;}
   const s=getState(),x=id&511,y=id>>>9,old=cells.get(id),current=s.lookup.get(x+','+y);if(old&&(old===current||!current&&old.virtual))return;
   const [ox,oy]=s.data.rendering.origin,cell=current||{x,y,px:30*(x-y)+ox,py:15*(x+y)+oy,land:null,virtual:true,surface:[[[0,-15],[30,0],[0,15],[-30,0]]]};
   if(old)buckets.get(Math.floor(old.px/256)+','+Math.floor(old.py/256))?.delete(id);
   cells.set(id,cell);const key=Math.floor(cell.px/256)+','+Math.floor(cell.py/256);if(!buckets.has(key))buckets.set(key,new Map());buckets.get(key).set(id,cell);
  }
  function sendLatest(full=false){const work=pendingSend;if(!work||work.id!==request)return;const input=work.input,update=!full&&input.update?.baseId===workerSourceId?input.update:null,data=full||workerSourceId!==input.wire.id&&!update?input.wire:null;
   const sendAt=performance.now();ensureWorker().postMessage({...work.message,data,update});ui.maxSendMs=Math.max(ui.maxSendMs,performance.now()-sendAt);if(update)ui.deltaSourceSends++;else if(data)ui.fullSourceSends++;
  }
  async function publishBatches(){if(publishing)return;publishing=true;
   try{while(batches.length){if(root.CrateMapPriority?.blocked)await root.CrateMapPriority.wait();const m=batches.shift();if(!m||m.id!==request)continue;fieldId=m.id;
    const s=getState(),[ox,oy]=s.data.rendering.origin,b=m.bounds;bounds={x:Math.min(0,ox+30*(b.left-b.bottom)-30),y:Math.min(0,oy+15*(b.left+b.top)-15),w:0,h:0};bounds.w=Math.max(s.data.rendering.width,ox+30*(b.right-b.top)+30)-bounds.x;bounds.h=Math.max(s.data.rendering.height,oy+15*(b.right+b.bottom)+15)-bounds.y;
    let slice=performance.now(),cpu=0;
    for(let i=0;i<m.keys.length;i++){indexCell(m.keys[i],m.numbers[i]);if((i&255)===255&&performance.now()-slice>=2){const elapsed=performance.now()-slice;cpu+=elapsed;ui.maxPublishSliceMs=Math.max(ui.maxPublishSliceMs||0,elapsed);await defer();if(m.id!==request)break;slice=performance.now();}}
    if(m.id!==request)continue;const elapsed=performance.now()-slice;cpu+=elapsed;ui.maxPublishSliceMs=Math.max(ui.maxPublishSliceMs||0,elapsed);ui.maxPublishMs=Math.max(ui.maxPublishMs,cpu);
    maximum=Math.max(1,m.maximum);revision++;diagnostics={...m.diagnostics,ms:m.ms,progress:m.progress};if(m.done){setPending(false);pendingSend=null;}else onChange?.();if(enabled)schedule();
   }}catch(error){failed={...desired,error:error.message};setPending(false);onError?.(error);}finally{publishing=false;}
  }
  function ensureWorker(){if(worker)return worker;worker=new Worker(new URL('buff-expectation-worker.js?v=19',document.baseURI));worker.postMessage({interactionPaused:!!root.CrateMapPriority?.blocked});
   worker.onmessage=({data:m})=>{if(m.sourceReady){workerSourceId=m.sourceId;return;}if(m.needSource){if(m.id===request)sendLatest(true);return;}if(m.paint){if(m.error){onPending?.(pending,{calculating:pending,rasterizing:false});onError?.(Error(m.error));return;}if(m.id!==fieldId||m.requestId!==heatRequest){m.image.close();return;}heat?.image.close();heat={image:m.image,plan:m.plan,stamp:m.stamp,revision:JSON.parse(m.stamp)[0]};ui.workerRasterMs=m.ms;notifyPending();if(enabled)schedule();return;}if(m.id!==request)return;if(m.error){failed={...desired,error:m.error};setPending(false);onError?.(Error(m.error));return;}workerSourceId=pendingSend?.input.wire.id??workerSourceId;fieldId=m.id;
    batches.push(m);void publishBatches();
   };worker.onerror=e=>{failed={...desired,error:e.message};setPending(false);onError?.(Error(e.message));};return worker;
  }
  function clearQueued(){clearTimeout(queueTimer);queueTimer=null;queued=null;}
  function flushQueued(force=false){if(queued&&!force&&!enabled&&isEditing?.()){queueTimer=setTimeout(flushQueued,40);return;}const work=queued;clearQueued();if(work)void launch(work);}
  function refresh({delay=0}={}){const t=target();if(!t.data||t.data.metadata.previewOnly){if(desired){request++;clearQueued();journal=null;pendingSend=null;worker?.postMessage({cancel:true});desired=null;failed=null;resetField();setPending(false);}return;}if(equal(t,desired)){if(!delay&&queued)flushQueued();return;}
   if(equal(t,failed))return;failed=null;desired=t;const id=++request,meta=t.data.metadata,r=t.data.rendering,mapKey=[meta.sourceSha256,meta.version,meta.rulesSha256,r.width,r.height,...r.origin].join('|');batches.length=0;worker?.postMessage({cancel:true});if(mapKey!==paintMapKey){journal=null;resetField();paintMapKey=mapKey;}setPending(true);
   if(queued||pendingSend)ui.superseded++;clearQueued();pendingSend=null;queued={t,id,mapKey};queueTimer=setTimeout(flushQueued,delay);
  }
  async function launch({t,id,mapKey}){try{await defer();if(id!==request)return;
    const input=await source(t.data,id);if(!input||id!==request)return;revision++;heatKey='';heatRequest++;
    const s=getState(),a=root.CrateMapViewer?.area,[ox,oy]=s.data.rendering.origin;let priority={};if(a){const points=[[a.x,a.y],[a.x+a.w,a.y],[a.x,a.y+a.h],[a.x+a.w,a.y+a.h]].map(([x,y])=>{const dx=((x-s.x)/s.scale-ox)/30,dy=((y-s.y)/s.scale-oy)/15;return[(dx+dy)/2,(dy-dx)/2];});priority={left:Math.min(...points.map(p=>p[0]))-2,right:Math.max(...points.map(p=>p[0]))+2,top:Math.min(...points.map(p=>p[1]))-2,bottom:Math.max(...points.map(p=>p[1]))+2};}
    pendingSend={id,input,message:{id,mapKey,radius:t.radius,priority,background:!enabled}};ui.started++;sendLatest();if(enabled)schedule();
   }catch(error){if(id===request){failed={...desired,error:error.message};setPending(false);onError?.(error);}}
  }
  function update(previousData,changed,{geometryStable=false}={}){
   const data=getState().data,base=sources.get(previousData),prior=journal?.data===previousData?journal:null;
   const all=geometryStable&&(changed.length>2048||!base&&prior?.all);
   // A global coefficient publication may list the whole map. Defer that scan
   // instead of building a large journal in the crate-publication callback.
   if(all){journal=base||prior?.base?{data,base:base||prior.base,all:true}:null;refresh({delay:enabled?0:160});return;}
   let compatible=base||prior?.base,delta=base?new Map():prior?.cells||new Map();
   for(const[before,after]of changed){if(!before||before.px!==after.px||before.py!==after.py||(before.visibleSurface||before.surface)!==(after.visibleSurface||after.surface))compatible=null;delta.set(after.y*512+after.x,after);}
   journal=compatible?{data,base:base||prior.base,cells:delta}:null;
   refresh({delay:enabled?0:160});
  }
  // Visibility owns raster work, not the numerical job. A warmed field remains
  // available to 3D and subsequent mode switches, including unfinished batches.
  // Keep accepting an already requested raster while hidden: it is still valid
  // on return unless the source, numerical revision or display style changed.
  function setEnabled(value){if(enabled===value){if(value)refresh();return;}enabled=value;if(!value){labelRaster?.cancel();heatVisible=false;notifyPending();}else{worker?.postMessage({foreground:true});refresh();}}
  function zeroVisible(view,area,fn,scope){if(pending&&!scope)return;const data=view.data||getState().data,lookup=view.lookup||getState().lookup,numbers=scope?.values||values,[ox,oy]=data.rendering.origin,max=data.metadata.size[2]+data.metadata.size[3]-1;
   const left=(area.x-view.x)/view.scale-40,right=(area.x+area.w-view.x)/view.scale+40,top=(area.y-view.y)/view.scale-130,bottom=(area.y+area.h-view.y)/view.scale+130;
   for(const c of view.spatialIndex?.query(left,top,right,bottom)||data.cells){if(c.px<left||c.px>right||c.py<top||c.py>bottom)continue;const id=c.y*512+c.x;if(!numbers[id])fn(c,0);}
   const points=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>{const a=(x-ox)/30,b=(y-oy)/15;return[(a+b)/2,(b-a)/2];}),x0=Math.max(1,Math.floor(Math.min(...points.map(p=>p[0])))),x1=Math.min(max,Math.ceil(Math.max(...points.map(p=>p[0])))),y0=Math.max(1,Math.floor(Math.min(...points.map(p=>p[1])))),y1=Math.min(max,Math.ceil(Math.max(...points.map(p=>p[1]))));
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(lookup.has(x+','+y)||numbers[y*512+x])continue;const px=ox+30*(x-y),py=oy+15*(x+y);if(px<left||px>right||py<top||py>bottom)continue;fn({x,y,px,py,land:null,virtual:true,surface:[[[0,-15],[30,0],[0,15],[-30,0]]]},0);}
  }
  function visible(view,area,fn,scope=null,includeZero=false){const pool=scope?.buckets||buckets,numbers=scope?.values||values,left=(area.x-view.x)/view.scale-35,top=(area.y-view.y)/view.scale-35,right=left+area.w/view.scale+70,bottom=top+area.h/view.scale+70;
   for(let y=Math.floor(top/256);y<=Math.floor(bottom/256);y++)for(let x=Math.floor(left/256);x<=Math.floor(right/256);x++)for(const[id,c]of pool.get(x+','+y)||[])if(c.px>=left&&c.px<=right&&c.py>=top&&c.py<=bottom)fn(c,numbers[id]);
   if(includeZero)zeroVisible(view,area,fn,scope);
  }
  function allowed(c,value,options){return (value>0||options.zeroLayer||options.zeroValues)&&value>=(options.threshold||0)&&(options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2));}
  const baseline=reference.isBaseline;
  function paintHeat(ctx,view,area,options,scope=null,ceiling=maximum){const started=performance.now(),colors=new Map(),opacityAt=root.CrateProbability.opacityCurve(ceiling,options.paletteColors);let count=0;visible(view,area,(c,value)=>{if(!allowed(c,value,options)||options.baselineLayer===false&&baseline(value))return;
   const token=Math.round(value*10000);if(!colors.has(token))colors.set(token,reference.color(value,options.palette,ceiling,options.paletteColors));ctx.fillStyle=colors.get(token);ctx.globalAlpha=options.opaqueLayers?1:root.CrateProbabilityDisplay.alpha((1-options.opacity/100)*opacityAt(value),baseline(value),options.paletteColors?.baselineFactor);ctx.beginPath();for(const ring of c.visibleSurface||c.surface||[]){ring.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](view.x+(c.px+x)*view.scale,view.y+(c.py+y)*view.scale));ctx.closePath();}ctx.fill('evenodd');count++;
   },scope,options.zeroLayer);ctx.globalAlpha=1;ui.maxHeatMs=Math.max(ui.maxHeatMs,performance.now()-started);return count;}
  function raster(ctx,view,area,options){const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1,stamp=JSON.stringify([revision,options.opaqueLayers,options.opacity,options.palette,root.CrateProbability.heatStyle(options.paletteColors),options.filter,options.threshold,options.baselineLayer,options.zeroLayer,maximum]),old=heat?.plan,extent=options.zeroLayer?(view.coordinateSpace?.bounds||bounds):bounds;
   wantedHeatStamp=stamp;
   const covers=old&&(old.full||view.x+old.worldX*view.scale<=area.x&&view.y+old.worldY*view.scale<=area.y&&view.x+(old.worldX+old.width/old.ratio/old.scale)*view.scale>=area.x+area.w&&view.y+(old.worldY+old.height/old.ratio/old.scale)*view.scale>=area.y+area.h);
   if(bounds&&(!heat||heat.stamp!==stamp||!covers||old.scale!==view.scale&&!view.navigating||old.ratio!==ratio)){
    const full=(extent.w*view.scale*ratio+8)*(extent.h*view.scale*ratio+8)<=8000000&&extent.w*view.scale*ratio<8190&&extent.h*view.scale*ratio<8190,margin=96;
    const plan={ratio,scale:view.scale,full,worldX:full?extent.x-3/view.scale:(area.x-margin-view.x)/view.scale,worldY:full?extent.y-3/view.scale:(area.y-margin-view.y)/view.scale,width:Math.ceil((full?extent.w*view.scale+6:area.w+2*margin)*ratio),height:Math.ceil((full?extent.h*view.scale+6:area.h+2*margin)*ratio)};
    const key=JSON.stringify([fieldId,stamp,plan]);if(heatKey!==key){heatKey=key;notifyPending();ensureWorker().postMessage({paint:true,id:fieldId,requestId:++heatRequest,stamp,plan,options:{opaqueLayers:options.opaqueLayers,opacity:options.opacity,palette:options.palette,paletteColors:options.paletteColors,filter:options.filter,threshold:options.threshold,baselineLayer:options.baselineLayer,zeroLayer:options.zeroLayer&&!pending},coordinateMax:getState().data.metadata.size[2]+getState().data.metadata.size[3]-1,maximum,origin:getState().data.rendering.origin});}
   }
   if(heat){const p=heat.plan,factor=view.scale/p.scale;ctx.imageSmoothingEnabled=factor<1;ctx.drawImage(heat.image,view.x+p.worldX*view.scale,view.y+p.worldY*view.scale,heat.image.width/p.ratio*factor,heat.image.height/p.ratio*factor);}
  }
  function paintLabels(ctx,view,area,options,scope,ceiling){
   const size=root.CrateProbability.labelSize(view.scale,options.labelSize||12,options.paletteColors),style=JSON.stringify([root.CrateI18n?.language,options.palette,ceiling,options.colorText,options.paletteColors]);
   if(style!==labelStyle){labelStyle=style;labelValues.clear();}
   ctx.font='700 '+size+'px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=root.CrateProbability.labelStrokeWidth(size,options.paletteColors);ctx.strokeStyle='#10212d';ctx.imageSmoothingEnabled=false;
   const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1,skip=options.skipLabels?.size?options.skipLabels:null;
   // A clipped refinement part must include glyphs whose centers lie outside it.
   const padding=Math.max(96,size*4),query={x:area.x-padding,y:area.y-padding,w:area.w+2*padding,h:area.h+2*padding};
   visible(view,query,(c,value)=>{if(!allowed(c,value,options)||!options.baselineValues&&baseline(value)||skip?.has(c.x+','+c.y))return;
    const x=view.x+(c.px+(c.labelOffset?.[0]||0))*view.scale,y=view.y+(c.py+(c.labelOffset?.[1]||0))*view.scale+size/3;
    let entry=labelValues.get(value);if(!entry){entry={text:root.CrateUnitBuff.amount(value),color:reference.textColor(value,options.palette,ceiling,options.colorText,options.paletteColors)};if(labelValues.size>=8192)labelValues.delete(labelValues.keys().next().value);labelValues.set(value,entry);}
    // Canvas clipping alone still submits off-part glyph textures. Reject their
    // conservative ink bounds before creating or touching a sprite.
    const half=entry.text.length*size/2+size;
    if(x+half<area.x||x-half>area.x+area.w||y+size<area.y||y-2*size>area.y+area.h)return;
    if(options.export){ctx.fillStyle=entry.color;ctx.strokeText(entry.text,x,y);ctx.fillText(entry.text,x,y);}else{const sprite=labelSprite(entry.text,ratio,ctx,entry.color,size,options.paletteColors),factor=size/12;ctx.drawImage(sprite.image,x-sprite.width*factor/2,y-sprite.baseline*factor,sprite.width*factor,sprite.height*factor);}
   },scope,options.zeroValues);
  }
  function paint(ctx,view,area,options,scope=null,ceiling=maximum){if(!scope){refresh();if(!options.labelsOnly&&heatVisible!==!!options.heatmap){heatVisible=!!options.heatmap;notifyPending();}}let colored=0,labels=0;ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   if(options.heatmap&&(scope?.bounds||bounds)){if(options.export)paintHeat(ctx,view,area,options,scope,ceiling);else raster(ctx,view,area,options);visible(view,area,(c,value)=>{if(allowed(c,value,options)&&(options.baselineLayer!==false||!baseline(value)))colored++;},scope);}
   if(options.values&&view.scale*30>=26){
    const skip=options.skipLabels?.size?options.skipLabels:null;
    visible(view,area,(c,value)=>{if(allowed(c,value,options)&&(options.baselineValues||!baseline(value))&&!skip?.has(c.x+','+c.y))labels++;},scope,options.zeroValues);
    if(scope||options.export||!labelRaster||pending)paintLabels(ctx,view,area,options,scope,ceiling);
    else{
     if(labelSkip!==options.skipLabels){labelSkip=options.skipLabels;labelSkipRevision++;}
     const sourceRevision=revision,key=JSON.stringify([revision,labelSkipRevision,root.CrateI18n?.language,ceiling,options.palette,options.colorText,options.paletteColors,options.filter,options.threshold,options.baselineValues,options.zeroValues,options.labelSize]);
     labelRaster.render(ctx,view,area,{key,valid:()=>enabled&&revision===sourceRevision&&!getState().navigating,paint:(target,local,part)=>paintLabels(target,local,part,options,null,ceiling)});
    }
   }else if(options.labelsOnly)labelRaster?.cancel();
   if(!scope&&view.selected){const c=view.selected,id=c.y*512+c.x,value=values[id]||0,heatOnly=options.heatmap&&options.baselineLayer===false,labelOnly=options.values&&!options.baselineValues;if(baseline(value)&&(heatOnly||labelOnly)){
    const bin=new Map([[id,c]]),only={values,buckets:new Map([[Math.floor(c.px/256)+','+Math.floor(c.py/256),bin]])},counts=paint(ctx,view,area,{...options,export:true,heatmap:heatOnly,values:labelOnly,baselineLayer:true,baselineValues:true,zeroLayer:false,zeroValues:false},only,ceiling);colored+=counts.colored;labels+=counts.labels;
   }}
   ctx.restore();return {colored,labels};
  }
  function snapshot(options){options={...options,paletteColors:{...(options.paletteColors||reference.paletteSettings())}};const scope={bounds,buckets:new Map([...buckets].map(([k,v])=>[k,new Map(v)])),values:values.slice()},ceiling=maximum;return(ctx,view,area)=>paint(ctx,view,area,{...options,export:true},scope,ceiling);}
  return {*warmup(target){if(enabled&&heat?.image){target.drawImage(heat.image,0,0,64,64);yield;}if(enabled&&labelRaster?.warmup)yield* labelRaster.warmup(target);},paint,snapshot,refresh,update,setEnabled,ready:async()=>{if(queued)flushQueued(true);if(pending)await new Promise(resolve=>waiters.push(resolve));if(equal(target(),failed))throw Error(failed.error);},get maximum(){return maximum;},get status(){return {...diagnostics,...ui,pending,queued:!!queued,revision,cells:cells.size,labelRaster:labelRaster?.status,rasterReady:!heatVisible||!!heat&&heat.revision===revision&&heat.stamp===wantedHeatStamp,rasterPending:rasterPending()};},get:(x,y)=>values[y*512+x]||0};
 }
 root.CrateBuffExpectationUI={create};
})(globalThis);
