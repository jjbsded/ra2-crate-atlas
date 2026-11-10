/* Transient edit-session identity and revisions. No DOM, transport or math. */
(function(root){
 'use strict';
 const supported=meta=>meta&&['ra2','yr','directory','shikong'].includes(meta.version)&&!meta.previewOnly;
 function create(){
  const state={sourceUrl:'',identity:'',model:null,sourcePromise:null,baseline:null,edited:null,
   consider:true,loading:false,epoch:0,revision:0,applied:0,probabilityApplied:0,
   timer:null,running:null,failed:false,forceQueued:false,live:null,recoverLive:false,
   liveOpening:null,editedView:null,pendingOpens:new Set(),operation:null,
   get pending(){return state.consider&&state.revision!==state.applied;},
   get liveReady(){return state.pending&&state.live?.painted===state.revision&&state.probabilityApplied===state.revision;},
   get waiting(){return state.pending&&!state.failed&&(!state.liveReady||state.running?.revision===state.revision);},
   get probabilityPending(){return state.pending&&!state.failed&&state.revision!==state.probabilityApplied;}
  };
  function cancelTimer(){root.clearTimeout(state.timer);state.timer=null;}
  function invalidate(loading=true){
   state.epoch++;cancelTimer();state.running?.controller.abort();
   state.running=null;state.sourcePromise=null;state.loading=loading;
  }
  function reset(prepared){
   invalidate(false);
   Object.assign(state,{sourceUrl:prepared.url,identity:prepared.data.metadata.sourceSha256+':'+prepared.data.metadata.version,
    model:null,baseline:prepared,edited:null,consider:true,revision:0,applied:0,probabilityApplied:0,
    failed:false,forceQueued:false,recoverLive:false,operation:null,editedView:null});
  }
  function changed(label=null){
   state.editedView=null;state.revision++;state.failed=false;
   state.operation=label?{revision:state.revision,label}:null;
  }
  function force(){state.forceQueued=true;state.revision++;state.failed=false;}
  const current=ticket=>ticket.epoch===state.epoch&&ticket.revision===state.revision;
  const capture=plan=>({epoch:state.epoch,revision:state.revision,plan,controller:new root.AbortController()});
  return Object.assign(state,{cancelTimer,invalidate,reset,changed,force,current,capture});
 }
 function planDelta(before,after){
  const table=items=>Object.fromEntries(items.map(item=>[item.id,item]));
  const delta=(a,b)=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])]
   .filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>[k,b[k]??null]));
  const old=table(before.placements),next=table(after.placements);
  const placements=delta(old,next),result={objects:delta(before.objects,after.objects),overlays:delta(before.overlays,after.overlays),placements};
  const merged=[...Object.keys(old).filter(id=>Object.hasOwn(next,id)),...Object.keys(next).filter(id=>!Object.hasOwn(old,id))];
  const order=after.placements.map(item=>item.id);
  if(merged.some((id,i)=>id!==order[i]))result.order=order;
  return result;
 }
 const api={create,supported,planDelta};root.CrateSimulationSession=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
