/* A bounded kernel-only worker pool. No map clone, polling, or persistent queue.
 * The coordinator groups identical requests before dispatch; replacement jobs
 * reject old waiters immediately and never publish an obsolete layout/radius. */
(function(root){
 'use strict';
 const cancelled=()=>Object.assign(Error('Buff kernel work superseded'),{cancelled:true});
 function create({threads,wait=null,makeWorker=()=>new Worker(new URL('buff-kernel-worker.js?v=2',self.location.href))}){
  let generation=0,sequence=0;const slots=[];const stats={threads,completedBatches:0,transferredBytes:0,maxQueued:0};
  function slot(){const worker=makeWorker(),entry={worker,pending:null,source:null};
   worker.onmessage=({data:m})=>{const pending=entry.pending;if(!pending||pending.id!==m.id)return;entry.pending=null;if(m.error)pending.reject(Error(m.error));else{stats.completedBatches++;stats.transferredBytes+=m.results.reduce((n,r)=>n+r.values.byteLength,0);pending.resolve(m.results);}};
   worker.onerror=error=>{error.preventDefault?.();entry.pending?.reject(Error(error.message));entry.pending=null;};slots.push(entry);return entry;
  }
  function cancel(){generation++;for(const entry of slots){entry.worker.postMessage({cancel:true});entry.pending?.reject(cancelled());entry.pending=null;}}
  function close(){cancel();for(const entry of slots)entry.worker.terminate();slots.length=0;}
  async function run(jobs,source,sourceId,onBatch){cancel();const ticket=generation;let cursor=0;stats.maxQueued=Math.max(stats.maxQueued,jobs.length);
   while(slots.length<Math.min(threads,Math.ceil(jobs.length/16)))slot();
   await Promise.all(slots.map(async entry=>{while(cursor<jobs.length){if(wait)await wait();if(ticket!==generation)throw cancelled();if(cursor>=jobs.length)return;const batch=jobs.slice(cursor,cursor+=16),id=++sequence,config=entry.source===sourceId?null:source;entry.source=sourceId;
    const results=await new Promise((resolve,reject)=>{entry.pending={id,resolve,reject};try{entry.worker.postMessage({id,source:config,jobs:batch.map(j=>({key:j.sig,delta:[...j.delta],requested:j.requested}))});}catch(error){entry.pending=null;reject(error);}});
    if(wait)await wait();if(ticket!==generation)throw cancelled();await onBatch(results);
   }}));
  }
  return {run,cancel,close,get status(){return {...stats,active:slots.filter(s=>s.pending).length,workers:slots.length};}};
 }
 const api={create};root.CrateBuffKernelPool=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
