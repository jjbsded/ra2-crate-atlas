/* Only small retry-weight jobs cross this boundary. The map/search arrays stay
 * in the coordinator, and the returned coefficient buffers transfer ownership. */
'use strict';
importScripts('finite-retry.js?v=3','buff-reference.js?v=5','buff-weight-kernel.js?v=3','buff-expectation.js?v=6');
let generation=0,model=null;
const tasks=[],channel=new MessageChannel();channel.port1.onmessage=()=>tasks.shift()?.();const turn=()=>new Promise(resolve=>{tasks.push(resolve);channel.port2.postMessage(0);});
self.onmessage=async({data:request})=>{
 const ticket=++generation;if(request.cancel)return;
 try{
  if(request.source)model={terminal:new Map(request.source.terminal),N:request.source.N,data:{probability:{attemptLimit:request.source.limit}}};
  if(!model)throw Error('Buff kernel source is not ready');
  const started=performance.now(),results=[];let slice=started;
  for(const job of request.jobs){const values=CrateBuffExpectation.calculateKernel(model,new Map(job.delta),job.requested);results.push({key:job.key,values,requested:values.requested});
   if(performance.now()-slice>=4){await turn();if(ticket!==generation)return;slice=performance.now();}
  }
  self.postMessage({id:request.id,results,ms:performance.now()-started},results.map(r=>r.values.buffer));
 }catch(error){if(ticket===generation)self.postMessage({id:request.id,error:error.message});}
};
