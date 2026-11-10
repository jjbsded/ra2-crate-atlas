'use strict';
importScripts('finite-retry.js?v=3','buff-reference.js?v=5','buff-source.js?v=1','buff-weight-kernel.js?v=3','buff-expectation.js?v=6','buff-kernel-pool.js?v=3','buff-field-cache.js?v=1','model.js?v=3','probability-index.js','probability.js?v=10','probability-display.js?v=16');
let revision=0,model=null,source=null,field=null,paintRevision=0,paintRequest=null,painting=false,kernelPool=null,numericKey=0,numericMapKey='',geometryIndex=null,geometryHeaders=null,geometryPoints=null,background=false;
const fieldCache=CrateBuffFieldCache.create();
const equalBytes=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
let interactionPaused=false;const interactionWaiters=new Set();
const waitForInteraction=async()=>{while(interactionPaused)await new Promise(resolve=>interactionWaiters.add(resolve));};
function releaseInteraction(){for(const resolve of interactionWaiters)resolve();interactionWaiters.clear();}
const tasks=[],channel=new MessageChannel();channel.port1.onmessage=()=>tasks.shift()?.();const turn=async()=>{await waitForInteraction();await new Promise(resolve=>{if(background)setTimeout(resolve,2);else{tasks.push(resolve);channel.port2.postMessage(0);}});await waitForInteraction();};
self.onmessage=async({data:request})=>{
 if(request.interactionPaused!==undefined){interactionPaused=!!request.interactionPaused;if(!interactionPaused)releaseInteraction();return;}
 if(request.foreground){background=false;return;}
 if(request.paint){paintRequest=request;paintRevision++;if(!painting)paintLatest();return;}
 const ticket=++revision;releaseInteraction();if(request.cancel&&kernelPool?.status.active){kernelPool.close();kernelPool=null;}else kernelPool?.cancel();if(request.cancel){paintRevision++;paintRequest=null;return;}const started=performance.now();
 background=!!request.background;
 try{
  await waitForInteraction();if(ticket!==revision)return;
  const next=request.update?CrateBuffSource.apply(source,request.update):request.data;
  if(request.update&&!next){self.postMessage({id:request.id,needSource:true});return;}
  let same=!!model;
  if(next){same=model&&numericMapKey===request.mapKey&&(source.probability.attemptLimit||1000)===(next.probability.attemptLimit||1000)&&equalBytes(source.metadata.size,next.metadata.size)&&(source.packed.grid===next.packed.grid||equalBytes(source.packed.grid,next.packed.grid))&&(source.packed.statuses===next.packed.statuses||equalBytes(source.packed.statuses,next.packed.statuses));source=next;self.postMessage({sourceReady:true,sourceId:source.id});}
  if(source&&!same){model=null;numericKey++;numericMapKey=request.mapKey;fieldCache.clear();kernelPool?.close();kernelPool=null;const iterator=CrateBuffExpectation.prepare(source);let part;do{const at=performance.now();do{part=iterator.next();}while(!part.done&&performance.now()-at<(background?2:4));if(!part.done){await turn();if(ticket!==revision){iterator.return();return;}}}while(!part.done);if(ticket!==revision)return;model=part.value;}
  else if(model)model.data=source;
  if(!model)throw Error('Buff expectation source is not ready');
  if(geometryPoints!==source.geometry.points||geometryHeaders?.length!==source.geometry.headers.length){geometryHeaders=source.geometry.headers;geometryPoints=source.geometry.points;geometryIndex=new Int32Array(262144).fill(-1);for(let i=0;i<geometryHeaders.length;i+=6)geometryIndex[geometryHeaders[i]]=i;}
  const cached=fieldCache.get(request.radius);
  if(cached){const previous=field?.mapKey===request.mapKey?field.bounds:null,b={...cached.bounds};if(previous){b.left=Math.min(b.left,previous.left);b.top=Math.min(b.top,previous.top);b.right=Math.max(b.right,previous.right);b.bottom=Math.max(b.bottom,previous.bottom);}
   field={...cached,id:request.id,mapKey:request.mapKey,geometry:source.geometry,index:geometryIndex,bounds:b};const total=(b.right-b.left+1)*(b.bottom-b.top+1),restoredAt=performance.now();let keys=[],numbers=[],completed=0;
   for(let y=b.top;y<=b.bottom;y++)for(let x=b.left;x<=b.right;x++){const id=y*512+x;keys.push(id);numbers.push(cached.values[id]);completed++;if(keys.length===4096||completed===total){const k=Uint32Array.from(keys),v=Float64Array.from(numbers);self.postMessage({id:request.id,keys:k,numbers:v,maximum:cached.maximum,bounds:b,progress:completed/total,done:completed===total,ms:performance.now()-started,diagnostics:{...model.diagnostics,prepareMs:restoredAt-started,computeMs:performance.now()-restoredAt,fieldCacheHit:true,fieldCache:fieldCache.status,kernelPool:kernelPool?.status}},[k.buffer,v.buffer]);keys=[];numbers=[];await turn();if(ticket!==revision)return;}}
   return;
  }
  const prepareMs=performance.now()-started,computeAt=performance.now(),previous=field,keep=previous?.mapKey===request.mapKey,resultField=field={id:request.id,mapKey:request.mapKey,values:keep?previous.values.slice():new Float64Array(262144),positive:new Set(keep?previous.positive:[]),geometry:source.geometry,index:geometryIndex};
  const r=request.radius,b=CrateBuffExpectation.bounds(model,r),ids=[],priority=request.priority||{},inside=(x,y)=>x>=priority.left&&x<=priority.right&&y>=priority.top&&y<=priority.bottom;
  if(keep&&previous.bounds){b.left=Math.min(b.left,previous.bounds.left);b.right=Math.max(b.right,previous.bounds.right);b.top=Math.min(b.top,previous.bounds.top);b.bottom=Math.max(b.bottom,previous.bounds.bottom);}resultField.bounds=b;
  for(let pass=0;pass<2;pass++)for(let y=b.top;y<=b.bottom;y++)for(let x=b.left;x<=b.right;x++)if(inside(x,y)===(pass===0))ids.push(y*512+x);
  let batch=[],values=[],at=performance.now(),sliceAt=at,maximum=0,completed=0;
  const memoryGiB=navigator.deviceMemory||4,parallel=model.N>=10000&&model.diagnostics.retryCandidates>=2048&&(navigator.hardwareConcurrency||2)>=4&&memoryGiB>=4&&typeof Worker!=='undefined';
  if(!parallel){kernelPool?.close();kernelPool=null;}
  function accept(id,value){resultField.values[id]=value;if(value>0){resultField.positive.add(id);maximum=Math.max(maximum,value);}else resultField.positive.delete(id);batch.push(id);values.push(value);completed++;}
  function publish(done=false){if(!batch.length&&!done)return;const keys=Uint32Array.from(batch),numbers=Float64Array.from(values);self.postMessage({id:request.id,keys,numbers,maximum,bounds:b,progress:completed/ids.length,done,ms:performance.now()-started,diagnostics:{...model.diagnostics,prepareMs,computeMs:performance.now()-computeAt,fieldCacheHit:false,fieldCache:fieldCache.status,kernelPool:kernelPool?.status}},[keys.buffer,numbers.buffer]);batch=[];values=[];at=performance.now();}
  const jobs=new Map();
  for(let i=0;i<ids.length;i++){
   const id=ids[i];if(!parallel)accept(id,CrateBuffExpectation.value(model,id&511,id>>>9,r));else{
    const s=CrateBuffExpectation.scenario(model,id&511,id>>>9,r);
    if(typeof s==='number')accept(id,s);else if(!s.window)accept(id,CrateBuffExpectation.complete(model,s));else{const cached=CrateBuffExpectation.cachedKernel(model,s.sig,s.requested);
     if(cached)accept(id,CrateBuffExpectation.complete(model,s,cached));else{let job=jobs.get(s.sig);if(!job){job={sig:s.sig,delta:s.delta,requested:model.kernels.get(s.sig)?.requested||0,scenarios:[]};jobs.set(s.sig,job);}job.requested|=s.requested;job.scenarios.push([id,s]);}
    }
   }
   if(i%64===0){if(performance.now()-at>=60)publish();if(performance.now()-sliceAt>=4){await turn();if(ticket!==revision)return;sliceAt=performance.now();}}
  }
  if(jobs.size){const finish=result=>{const job=jobs.get(result.key);CrateBuffExpectation.rememberKernel(model,job.sig,result.values,result.requested);for(const[id,s]of job.scenarios)accept(id,CrateBuffExpectation.complete(model,s,result.values));job.done=true;};
   const threads=Math.min(background?2:4,Math.floor(memoryGiB/2),Math.max(1,(navigator.hardwareConcurrency||4)-2));
   if(kernelPool&&kernelPool.status.threads!==threads){kernelPool.close();kernelPool=null;}
   if(!kernelPool)kernelPool=CrateBuffKernelPool.create({threads,wait:waitForInteraction});
   try{await kernelPool.run([...jobs.values()],{terminal:[...model.terminal],N:model.N,limit:model.data.probability.attemptLimit||1000},numericKey,async results=>{if(ticket!==revision)return;for(const result of results)finish(result);if(performance.now()-at>=60)publish();});}
   catch(error){if(ticket!==revision)return;kernelPool.close();kernelPool=null;for(const job of jobs.values())if(!job.done){const values=CrateBuffExpectation.calculateKernel(model,job.delta,job.requested);finish({key:job.sig,values,requested:values.requested});if(performance.now()-at>=60)publish();await turn();if(ticket!==revision)return;}}
  }
  if(ticket===revision){fieldCache.put(request.radius,{values:resultField.values,positive:resultField.positive,bounds:{...b},maximum});publish(true);}
 }catch(error){if(ticket===revision)self.postMessage({id:request.id,error:error.message});}
};
async function paintLatest(){painting=true;
 try{while(paintRequest){await waitForInteraction();const request=paintRequest;if(!request)break;paintRequest=null;const ticket=paintRevision,current=field;if(!current||request.id!==current.id)continue;
  const {plan,options,maximum,origin}=request,opacityAt=CrateProbability.opacityCurve(maximum,options.paletteColors),canvas=new OffscreenCanvas(plan.width,plan.height),ctx=canvas.getContext('2d'),colors=new Map(),ids=options.zeroLayer?Array.from({length:request.coordinateMax**2},(_,i)=>(Math.floor(i/request.coordinateMax)+1)*512+i%request.coordinateMax+1):[...current.positive],numbers=current.values.slice();let cpu=0,at=performance.now();
  ctx.scale(plan.ratio*plan.scale,plan.ratio*plan.scale);ctx.translate(-plan.worldX,-plan.worldY);
  const {headers,points}=current.geometry,left=plan.worldX-40,top=plan.worldY-40,right=plan.worldX+plan.width/plan.ratio/plan.scale+40,bottom=plan.worldY+plan.height/plan.ratio/plan.scale+40;
  for(let i=0;i<ids.length;i++){
   const id=ids[i],value=numbers[id],base=CrateBuffReference.isBaseline(value),index=current.index[id],x=index<0?origin[0]+30*((id&511)-(id>>>9)):headers[index+1],y=index<0?origin[1]+15*((id&511)+(id>>>9)):headers[index+2],land=index<0?-1:headers[index+3];
   if(x>=left&&x<=right&&y>=top&&y<=bottom&&value>=(options.threshold||0)&&(options.filter==='all'||(options.filter==='water'?land===2:land!==2))&&(options.baselineLayer!==false||!base)){
    const token=Math.round(value*10000);if(!colors.has(token))colors.set(token,CrateBuffReference.color(value,options.palette,maximum,options.paletteColors));ctx.fillStyle=colors.get(token);const alpha=Math.max(0,Math.min(1,1-options.opacity/100))*opacityAt(value);ctx.globalAlpha=options.opaqueLayers?1:CrateProbabilityDisplay.alpha(alpha,base,options.paletteColors?.baselineFactor);ctx.beginPath();
    if(index<0){ctx.moveTo(x,y-15);ctx.lineTo(x+30,y);ctx.lineTo(x,y+15);ctx.lineTo(x-30,y);ctx.closePath();}
    else for(let p=headers[index+4];p<headers[index+5];){const n=points[p++];for(let j=0;j<n;j++){const dx=points[p++],dy=points[p++];ctx[j?'lineTo':'moveTo'](x+dx,y+dy);}ctx.closePath();}
    ctx.fill('evenodd');
   }
   if(i%256===0&&performance.now()-at>4){cpu+=performance.now()-at;await turn();if(ticket!==paintRevision||current!==field)break;at=performance.now();}
  }
  cpu+=performance.now()-at;if(ticket!==paintRevision||current!==field)continue;
  const image=canvas.transferToImageBitmap();self.postMessage({paint:true,id:request.id,requestId:request.requestId,stamp:request.stamp,plan,image,ms:cpu},[image]);
 }}catch(error){self.postMessage({paint:true,error:error.message});}finally{painting=false;if(paintRequest)paintLatest();}
}
