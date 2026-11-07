'use strict';
importScripts('finite-retry.js?v=2','buff-reference.js?v=5','buff-expectation.js?v=3','model.js?v=3','probability-index.js','probability.js?v=10','probability-display.js?v=9');
let revision=0,model=null,source=null,field=null,paintRevision=0,paintRequest=null,painting=false;
const tasks=[],channel=new MessageChannel();channel.port1.onmessage=()=>tasks.shift()?.();const turn=()=>new Promise(resolve=>{tasks.push(resolve);channel.port2.postMessage(0);});
self.onmessage=async({data:request})=>{
 if(request.paint){paintRequest=request;paintRevision++;if(!painting)paintLatest();return;}
 const ticket=++revision;if(request.cancel){paintRevision++;paintRequest=null;return;}const started=performance.now();
 try{
  if(request.data&&(!model||source?.id!==request.data.id)){source=request.data;model=null;const iterator=CrateBuffExpectation.prepare(source);let part;do{const at=performance.now();do{part=iterator.next();}while(!part.done&&performance.now()-at<4);if(!part.done){await turn();if(ticket!==revision){iterator.return();return;}}}while(!part.done);if(ticket!==revision)return;model=part.value;}
  if(!model)throw Error('Buff expectation source is not ready');
  const previous=field,keep=previous?.mapKey===request.mapKey,resultField=field={id:request.id,mapKey:request.mapKey,values:keep?previous.values.slice():new Float64Array(262144),positive:new Set(keep?previous.positive:[]),geometry:source.geometry,index:new Int32Array(262144).fill(-1)};
  for(let i=0;i<source.geometry.headers.length;i+=6)resultField.index[source.geometry.headers[i]]=i;
  const r=request.radius,b=CrateBuffExpectation.bounds(model,r),ids=[],priority=request.priority||{},inside=(x,y)=>x>=priority.left&&x<=priority.right&&y>=priority.top&&y<=priority.bottom;
  if(keep&&previous.bounds){b.left=Math.min(b.left,previous.bounds.left);b.right=Math.max(b.right,previous.bounds.right);b.top=Math.min(b.top,previous.bounds.top);b.bottom=Math.max(b.bottom,previous.bounds.bottom);}resultField.bounds=b;
  for(let pass=0;pass<2;pass++)for(let y=b.top;y<=b.bottom;y++)for(let x=b.left;x<=b.right;x++)if(inside(x,y)===(pass===0))ids.push(y*512+x);
  let batch=[],values=[],at=performance.now(),maximum=0;
  for(let i=0;i<ids.length;i++){
   const id=ids[i],value=CrateBuffExpectation.value(model,id&511,id>>>9,r);resultField.values[id]=value;if(value>0){resultField.positive.add(id);batch.push(id);values.push(value);maximum=Math.max(maximum,value);}else{resultField.positive.delete(id);batch.push(id);values.push(0);}
   if((i%64===0&&performance.now()-at>=60)||i===ids.length-1){
    const keys=Uint32Array.from(batch),numbers=Float64Array.from(values);self.postMessage({id:request.id,keys,numbers,maximum,bounds:b,progress:(i+1)/ids.length,done:i===ids.length-1,ms:performance.now()-started,diagnostics:model.diagnostics},[keys.buffer,numbers.buffer]);batch=[];values=[];at=performance.now();await turn();if(ticket!==revision)return;
   }else if(i%64===0&&performance.now()-at>4){await turn();if(ticket!==revision)return;}
  }
 }catch(error){if(ticket===revision)self.postMessage({id:request.id,error:error.message});}
};
async function paintLatest(){painting=true;
 try{while(paintRequest){const request=paintRequest;paintRequest=null;const ticket=paintRevision,current=field;if(!current||request.id!==current.id)continue;
  const {plan,options,maximum,origin}=request,opacityAt=CrateProbability.opacityCurve(maximum,options.paletteColors),canvas=new OffscreenCanvas(plan.width,plan.height),ctx=canvas.getContext('2d'),colors=new Map(),ids=[...current.positive],numbers=current.values.slice();let cpu=0,at=performance.now();
  ctx.scale(plan.ratio*plan.scale,plan.ratio*plan.scale);ctx.translate(-plan.worldX,-plan.worldY);
  const {headers,points}=current.geometry,left=plan.worldX-40,top=plan.worldY-40,right=plan.worldX+plan.width/plan.ratio/plan.scale+40,bottom=plan.worldY+plan.height/plan.ratio/plan.scale+40;
  for(let i=0;i<ids.length;i++){
   const id=ids[i],value=numbers[id],base=CrateBuffReference.isBaseline(value),index=current.index[id],x=index<0?origin[0]+30*((id&511)-(id>>>9)):headers[index+1],y=index<0?origin[1]+15*((id&511)+(id>>>9)):headers[index+2],land=index<0?-1:headers[index+3];
   if(x>=left&&x<=right&&y>=top&&y<=bottom&&value>=(options.threshold||0)&&(options.filter==='all'||(options.filter==='water'?land===2:land!==2))&&(options.baselineLayer!==false||!base)){
    const token=Math.round(value*10000);if(!colors.has(token))colors.set(token,CrateBuffReference.color(value,options.palette,maximum,options.paletteColors));ctx.fillStyle=colors.get(token);const alpha=Math.max(0,Math.min(1,1-options.opacity/100))*opacityAt(value);ctx.globalAlpha=CrateProbabilityDisplay.alpha(alpha,base,options.paletteColors?.baselineFactor);ctx.beginPath();
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
