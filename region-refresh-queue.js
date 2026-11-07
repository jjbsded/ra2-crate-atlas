/* One cooperative refresh in flight, with one replaceable latest target. */
(function(root){
 'use strict';
 function create({same,valid,capture,compute,publish,onPending=()=>{},onError=()=>{},delay=16,budget=2}){
  let desired=null,committed=null,job=null,timer=null,task=null,pending=false,sequence=0,epoch=0;
  const now=()=>root.performance?.now()??Date.now(),stats={requests:0,merged:0,published:0,cancelled:0,slices:0,maxSliceMs:0,maxCaptureMs:0,maxPublishMs:0,lastJobMs:0,lastComputeMs:0,maxTaskGapMs:0};
  function busy(value){if(pending!==value){pending=value;onPending(value);}}
  function defer(fn,wait=0){
   if(wait){timer=root.setTimeout(()=>{timer=null;fn();},wait);return;}
   const token=task={};const run=()=>{if(task!==token)return;task=null;fn();};
   if(root.scheduler?.postTask)root.scheduler.postTask(run,{priority:'user-visible'}).catch(()=>{if(task===token)timer=root.setTimeout(run,0);});
   else timer=root.setTimeout(run,0);
  }
  function stop(){clearTimeout(timer);timer=null;task=null;if(job){job.iterator.return();job=null;stats.cancelled++;}}
  function reset(){epoch++;stop();desired=committed=null;busy(false);}
  function request(target){
   if(same(target,desired))return;
   stats.requests++;if(pending)stats.merged++;desired=target;sequence++;
   if(same(target,committed)&&!job){clearTimeout(timer);timer=null;task=null;busy(false);return;}
   // Keep the first deadline: a continuous pointer stream must still publish.
   busy(true);if(!job&&timer===null&&!task)defer(start,delay);
  }
  function start(){
   timer=null;if(!desired)return;const target=desired,ticket={target,sequence,epoch,iterator:null,started:now(),cpu:0,lastAt:now()};
   try{const at=now(),snapshot=capture(target);stats.maxCaptureMs=Math.max(stats.maxCaptureMs,now()-at);ticket.iterator=compute(snapshot);job=ticket;step(ticket);}catch(error){job=null;busy(false);onError(error);}
  }
  function step(ticket){
   timer=null;if(job!==ticket||ticket.epoch!==epoch)return;
   if(!valid(ticket.target)){job=null;ticket.iterator.return();stats.cancelled++;if(desired&&valid(desired))defer(start);else busy(false);return;}
   const started=now();
   stats.maxTaskGapMs=Math.max(stats.maxTaskGapMs,started-ticket.lastAt);
   try{
    let part;do{part=ticket.iterator.next();if(part.done)break;}while(now()-started<budget);
    const elapsed=now()-started;ticket.cpu+=elapsed;ticket.lastAt=now();stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,elapsed);
    if(!part.done){defer(()=>step(ticket));return;}
    job=null;const publishAt=now();publish(part.value,ticket.target);stats.maxPublishMs=Math.max(stats.maxPublishMs,now()-publishAt);stats.published++;committed=ticket.target;stats.lastJobMs=now()-ticket.started;stats.lastComputeMs=ticket.cpu;
    if(ticket.sequence!==sequence){defer(start);return;}busy(false);
   }catch(error){job=null;busy(false);onError(error);}
  }
  function flush(target=desired){
   if(!target||same(target,committed)&&!job)return;
   epoch++;stop();desired=target;const iterator=compute(capture(target));let part;do{part=iterator.next();}while(!part.done);
   publish(part.value,target);committed=target;stats.published++;busy(false);
  }
  return {request,reset,flush,get status(){return {...stats,pending,working:!!job,queued:pending&&(!job||job.sequence!==sequence)?1:0};}};
 }
 const api={create};root.CrateRegionRefreshQueue=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
