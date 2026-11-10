/* Async simulation publication. The UI supplies view and notification ports.
 * This coordinator writes session state; controls and drawing only read it.
 * The numerical model and layout formats are independent of preview scheduling.
 */
(function(root){
 'use strict';
 const Session=root.CrateSimulationSession||(typeof require==='function'?require('./simulation-session.js'):null);
 const I=root.CrateI18n,_t=I?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s),M=()=>root.CrateSimulationModel;
 function create({session:lifecycle,getState,getArea,loadResult,applyProbability,visuals,getPlan:styledPlan,isDrawing,
  sync,syncActivity,schedule,message,setStatus,setBusy,beforeRecompute,onPrepared,onCommitted,onForced,onEdited,onLayoutSwitch,onRestored}){
  const pending=()=>lifecycle.pending,liveReady=()=>lifecycle.liveReady,deferReport=liveReady;
  let layoutSwitches=0;
  async function whenLayoutReady(signal){
   const epoch=lifecycle.epoch;
   for(;;){
    signal?.throwIfAborted();
    if(lifecycle.epoch!==epoch)throw Object.assign(Error(_t('地图已切换')),{name:'AbortError'});
    const published=lifecycle.live?lifecycle.probabilityApplied:lifecycle.applied;
    if(!layoutSwitches&&(!lifecycle.loading||lifecycle.revision===0)&&!getState().busy&&(!lifecycle.consider||published===lifecycle.revision))return;
    if(lifecycle.failed)throw Error(_t('模拟布局更新失败，请重新计算后重试。'));
    await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=root.setTimeout(done,16),abort=()=>{root.clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});});
   }
  }
  const {planDelta,supported}=Session;
  async function ensure(){if(lifecycle.model)return lifecycle.model;if(lifecycle.sourcePromise)return lifecycle.sourcePromise;lifecycle.loading=true;sync();const expected=lifecycle.epoch,url=lifecycle.sourceUrl;
   lifecycle.sourcePromise=(async()=>{
    const opening=openLive(url);
    const session=opening?await opening:null;
    if(lifecycle.epoch!==expected)throw Error(_t('地图已切换'));
    const source=root.CrateMapPlatform?.simulationSource?await root.CrateMapPlatform.simulationSource(url):session?.source||await CrateLocalAPI.json('/api/maps/simulation-source?'+new URLSearchParams({result:url}));
    if(lifecycle.epoch!==expected)throw Error(_t('地图已切换'));
    await root.CrateSimulationAssets.prepare(source);
    if(lifecycle.epoch!==expected)throw Error(_t('地图已切换'));
    lifecycle.model=M().create(source);lifecycle.model.current();
    if(session?.source)delete session.source; // The model owns its source; don't pin a second DTO in the warmup promise.
    if(session){lifecycle.live={id:session.session,plan:M().empty(source),probability:0,painted:0,plans:new Map()};getState().liveEditing=true;}
    onPrepared(lifecycle.model);return lifecycle.model;
   })().finally(()=>{if(lifecycle.epoch===expected){lifecycle.loading=false;lifecycle.sourcePromise=null;sync();}});return lifecycle.sourcePromise;
  }
  function livePost(action,payload){
   const lease=action==='open'?(root.crypto?.randomUUID?.()||'live-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)):null;
   if(lease){lifecycle.pendingOpens.add(lease);payload={...payload,lease};}
   return CrateLocalAPI.json('/api/maps/simulation-live/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).finally(()=>{if(lease)lifecycle.pendingOpens.delete(lease);});
  }
  function openLive(result){
   if(root.CrateMapPlatform?.simulate)return null;
   if(lifecycle.liveOpening?.result===result)return lifecycle.liveOpening.promise;
   const promise=livePost('open',{result,includeSource:true}).catch(error=>{if(error.code!=='LIVE_OPEN_CANCELLED')console.warn('Live edit warmup:',error.message);return null;});
   lifecycle.liveOpening={result,promise};
   return promise;
  }
  function cancelWarmup(){
   for(const lease of lifecycle.pendingOpens)releaseLive(null,lease);
   lifecycle.liveOpening?.promise.then(value=>{if(value)releaseLive(value.session);});
   lifecycle.liveOpening=null;
  }
  function releaseLive(id,lease=null){
   if(!id&&!lease)return;
   const payload={session:id,...(lease?{lease}:{})},body=JSON.stringify(payload);
   if(root.navigator?.sendBeacon&&root.Blob&&root.navigator.sendBeacon('/api/maps/simulation-live/close',new root.Blob([body],{type:'application/json'})))return;
   livePost('close',payload).catch(()=>{});
  }
  root.addEventListener?.('pagehide',event=>{if(!event.persisted){cancelWarmup();stopLive();}});
  function stopLive(){
   releaseLive(lifecycle.live?.id);
   lifecycle.live=null;
   lifecycle.editedView=null;
   getState().liveEditing=false;
   getState().liveArtworkProgress=null;
  }
  function restartLive(result,base,plan){
   if(root.CrateMapPlatform?.simulate)return;
   const expected=lifecycle.epoch;
   livePost('open',{result,revision:base}).then(value=>{
    if(lifecycle.epoch!==expected||lifecycle.live||lifecycle.revision!==base||!lifecycle.consider||getState().prepared.url!==result){releaseLive(value.session);return;}
    lifecycle.live={id:value.session,plan,probability:base,painted:base,plans:new Map([[base,plan]])};
    getState().liveEditing=true;
    schedule();
   }).catch(error=>{if(error.code!=='LIVE_OPEN_CANCELLED')console.warn('Live edit warmup:',error.message);});
  }
  function liveValid(session){return lifecycle.live===session&&lifecycle.consider&&!getState().busy;}
  async function reconnectLive(session,error){
   if(!liveValid(session)||!(error.code==='LIVE_SESSION_EXPIRED'||/Live edit session expired/.test(error.message)))return false;
   if(session.reconnecting)return session.reconnecting;
   if(session.recoveredRevision===lifecycle.revision)return false;
   session.recoveredRevision=lifecycle.revision;
   const started=performance.now(),paintPlan=session.plans.get(session.painted)||(session.painted===session.probability?session.plan:session.painted===0?lifecycle.baseline.data.metadata.simulationPlan||M().empty(lifecycle.model.source):null);
   if(!paintPlan)return false;
   const progress=getState().liveArtworkProgress,partial=progress&&progress.done<progress.total&&progress.revision>session.painted?{revision:progress.revision,plan:session.plans.get(progress.revision)}:null;
   if(partial&&!partial.plan)return false;
   session.reconnecting=(async()=>{
    try{
     const value=await livePost('open',{result:lifecycle.sourceUrl,resume:{probability:session.probability,painted:session.painted,plan:session.plan,paintPlan,partial}});
     if(!liveValid(session)){releaseLive(value.session);return false;}
     session.id=value.session;delete session.paintFailed;visuals.clearGrounds();
     const s=getState();s.liveRecovery={count:(s.liveRecovery?.count||0)+1,ms:performance.now()-started,revision:session.probability,reason:error.reason||'unknown',timing:value.timing};return true;
    }catch(recoveryError){if(liveValid(session)&&recoveryError.code!=='LIVE_OPEN_CANCELLED')console.warn('Live reconnect:',recoveryError.message);return false;}
    finally{session.reconnecting=null;sync();}
   })();
   syncActivity();return session.reconnecting;
  }
  async function getSources(data){
   const session=lifecycle.live,version=lifecycle.revision;
   if(!session||!liveReady()||data!==getState().data)throw Error('Live source revision changed');
   if(session.sourceData!==data){
    session.sourceData=data;
    session.sources=livePost('sources',{session:session.id,revision:version}).then(packet=>{
     if(!liveValid(session)||packet.revision!==version||data!==getState().data)throw Error('Live source revision changed');
     const binary=Uint8Array.from(atob(packet.search),c=>c.charCodeAt(0));
     return root.CrateTransferOrigins.create(data,binary.buffer);
    }).catch(error=>{if(session.sourceData===data)session.sourceData=session.sources=null;throw error;});
   }
   return session.sources;
  }
  function liveFrame(){
   const session=lifecycle.live;
   if(!session||session.frame||session.editing)return;
   const token=session.frame={};const run=()=>{if(session.frame!==token)return;session.frame=0;updateLive(session);};
   if(root.queueMicrotask)root.queueMicrotask(run);else Promise.resolve().then(run);
  }
  function rememberPlan(session,revision,plan){
   session.plans.set(revision,plan);
   while(session.plans.size>16)session.plans.delete(session.plans.keys().next().value);
  }
  async function updateLive(session){
   if(session.reconnecting)await session.reconnecting;
   if(!liveValid(session)||session.editing||session.probability>=lifecycle.revision)return;
   const next=lifecycle.revision,plan=styledPlan(),s=getState(),started=performance.now(),sessionId=session.id;
   session.editing=true;
   try{
    rememberPlan(session,next,plan);
    const pendingPacket=livePost('edit',{session:session.id,from:session.probability,revision:next,
     baseRevision:s.data.probabilityRevision||s.prepared.url,delta:planDelta(session.plan,plan),planEcho:false,compact:true});
    session.target=next;paintLive(session);
    const packet=await pendingPacket;
    if(!liveValid(session)||session.reconnecting||session.id!==sessionId)return;
    if(packet.revision!==next)throw Error('Live probability base changed');
    if(!packet.sets.some(([path])=>path.join('.')==='metadata.simulationPlan'))packet.sets.push([['metadata','simulationPlan'],plan]);
    const accepted=await applyProbability?.(packet,()=>liveValid(session)&&!session.reconnecting&&session.id===sessionId);
    if(!liveValid(session)||session.reconnecting||session.id!==sessionId)return;
    if(!accepted)throw Error('Live probability base changed');
    session.plan=plan;session.probability=lifecycle.probabilityApplied=next;
    s.liveProbability.elapsedMs=performance.now()-started;
    sync();schedule();paintLive(session);
   }catch(error){
    const recovered=await reconnectLive(session,error);
    if(lifecycle.live===session&&session.id===sessionId&&!recovered){
     console.warn('Live probability:',error.message);
     lifecycle.recoverLive=true;
     stopLive();visuals.update(lifecycle.model,lifecycle.sourceUrl,lifecycle.revision,lifecycle.operation?.revision===lifecycle.revision,styledPlan());queue();
    }
   }finally{
    session.editing=false;
    if(liveValid(session)&&session.probability<lifecycle.revision)updateLive(session);
   }
  }
  async function paintLive(session){
   if(session.reconnecting)await session.reconnecting;
   if(!liveValid(session)||session.painting||session.painted>=session.target)return;
   session.painting=true;
   const s=getState(),started=performance.now();let requestSession=session.id;
   const area=getArea(),focus=[
    Math.round((area.x+area.w/2-s.x)/s.scale),Math.round((area.y+area.h/2-s.y)/s.scale)
   ].map(n=>Math.max(-65536,Math.min(65536,n)));
   function fetchBatch(previous,limit){
    const id=session.id;
    // Keep one next response in flight while this batch decodes/paints. The
    // settled envelope also owns errors if a newer map makes it unnecessary.
    return {id,promise:livePost('paint',{session:id,from:session.painted,target:session.target,
     limit,revision:previous?.revision,offset:previous?.done||0,focus,knownGrounds:visuals.groundKeys(),planEcho:!!session.needPlan})
     .then(result=>({result}),error=>({error}))};
   }
   try{
    let batch=fetchBatch(null,8),previous=null,flatTiles=0,paintMs=0;
    while(liveValid(session)){
     requestSession=batch.id;
     const packet=await batch.promise;if(packet.error)throw packet.error;const result=packet.result;
     const plan=result.plan||session.plans.get(result.revision);
     if(!plan){const error=Error('Missing live artwork plan revision');error.code='ART_PLAN_MISSING';throw error;}
     rememberPlan(session,result.revision,plan);session.needPlan=false;
     const valid=()=>liveValid(session)&&!session.reconnecting&&session.id===requestSession&&result.revision>session.painted;
     if(!valid())return;
     const perTile=result.paintMs/Math.max(1,result.patches.length);
     const limit=Math.max(8,Math.min(16,Math.floor(48/Math.max(.01,perTile))));
     const next=result.done<result.total?fetchBatch(result,limit):null;
     if(!await visuals.installTiles({...result,plan},valid))return;
     if(!previous||result.revision!==previous.revision){flatTiles=0;paintMs=0;}
     flatTiles+=result.flatTiles;paintMs+=result.paintMs;
     s.liveArtworkProgress={revision:result.revision,done:result.done,total:result.total};
     if(result.done===result.total){
      session.painted=result.revision;
      for(const key of session.plans.keys())if(key<result.revision)session.plans.delete(key);
      s.liveArtwork={revision:result.revision,tiles:result.total,flatTiles,paintMs,elapsedMs:performance.now()-started};
      sync();
      return;
     }
     syncActivity();
     previous=result;
     batch=next;
     // Installed tiles still get a frame; the server no longer waits for it.
     await new Promise(requestAnimationFrame);
    }
   }catch(error){
    const recovered=await reconnectLive(session,error);
    if(lifecycle.live===session&&session.id===requestSession&&!recovered){if(error.code==='ART_GROUND_MISSING'){visuals.clearGrounds();}else if(error.code==='ART_PLAN_MISSING'){session.needPlan=true;}else{console.warn('Live artwork:',error.message);session.paintFailed=session.target;queue();}}
   }finally{
    session.painting=false;
    if(liveValid(session)&&session.painted<session.target&&session.paintFailed!==session.target)paintLive(session);
   }
  }
  function queue(delay=lifecycle.live?650:120){
   lifecycle.cancelTimer();
   if(!pending()||lifecycle.failed||deferReport()||isDrawing()||!lifecycle.model)return;
   lifecycle.timer=setTimeout(()=>{lifecycle.timer=null;compute();},delay);
  }
  function changed(label=null,plan=styledPlan()){
   visuals.cancelAppearance?.();
   onEdited(plan);
   lifecycle.changed(label);message('',true);sync();
   if(lifecycle.live)liveFrame();else visuals.update(lifecycle.model,lifecycle.sourceUrl,lifecycle.revision,!!label,plan);
   schedule();
  }
  async function compute(force=false,requested=false){if(!lifecycle.model||!lifecycle.consider||isDrawing()||(!force&&!requested&&deferReport()))return;if(force){lifecycle.force();onForced();}lifecycle.cancelTimer();
   if(force)stopLive();
   if(lifecycle.live&&lifecycle.live.probability<lifecycle.revision){liveFrame();queue();return;}
   if(lifecycle.live?.painting&&lifecycle.live.target===lifecycle.revision&&!liveReady()){queue();return;}
   if(visuals.progressivePending&&!force&&!root.CrateMapPlatform?.simulate){queue();return;}
   if(lifecycle.running){if(lifecycle.running.revision!==lifecycle.revision&&(root.CrateMapPlatform?.simulate&&root.CrateLivePlatform?.cancel||!root.CrateMapPlatform?.simulate&&lifecycle.running.probabilityReady)){root.CrateLivePlatform?.cancel();lifecycle.running.controller.abort();lifecycle.running=null;}else{sync();return lifecycle.running.promise;}}if(!pending())return;
   const fresh=lifecycle.forceQueued;lifecycle.forceQueued=false;const ticket=lifecycle.capture(styledPlan()),valid=()=>lifecycle.current(ticket)&&lifecycle.consider&&!isDrawing()&&!getState().busy;
   lifecycle.running=ticket;sync();
   ticket.promise=(async()=>{try{
    let url,prepared=null;const progress=async value=>{
     if(value.probabilityReady){ticket.probabilityReady=true;if(ticket.epoch===lifecycle.epoch&&ticket.revision!==lifecycle.revision&&!isDrawing())queue(0);}
     if(valid()&&value.probabilityUrl&&!ticket.probabilityLoaded&&lifecycle.probabilityApplied!==ticket.revision){
      try{let snapshot=await CrateLocalAPI.json(value.probabilityUrl,{signal:ticket.controller.signal});if(valid()){let accepted=await applyProbability?.(snapshot,valid);if(!accepted&&snapshot.probabilityPatch&&valid()){snapshot=await CrateLocalAPI.json('/api/maps/probability/'+snapshot.probabilityRevision,{signal:ticket.controller.signal});accepted=valid()&&await applyProbability?.(snapshot,valid);}if(accepted&&valid()){lifecycle.probabilityApplied=ticket.revision;ticket.probabilityLoaded=true;sync();schedule();}}}catch{/* Final report/retry still works when the intermediate response is unavailable. */}
     }
     if(ticket.epoch===lifecycle.epoch&&pending()){
      ticket.message=value.probabilityReady?_t('正在绘制地图…'):_t('正在计算概率…');
      syncActivity();
      setStatus('');
     }
    };
    if(lifecycle.model.count||fresh)url=root.CrateMapPlatform?.simulate?await root.CrateMapPlatform.simulate(lifecycle.sourceUrl,ticket.plan,progress,fresh):await CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/simulation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:lifecycle.sourceUrl,plan:ticket.plan,force:fresh,publishPreview:lifecycle.probabilityApplied!==ticket.revision,baseRevision:getState().data.probabilityRevision||getState().prepared.url})}),{onProgress:progress,signal:ticket.controller.signal,pollInterval:80});
    else {url=lifecycle.baseline.url;prepared=lifecycle.baseline;}
    if(!valid())return;
    // A completed Toy report already owns the entire new scene. Stop the
    // remaining temporary tiles before its overview uses the raster worker.
    if(root.CrateMapPlatform?.simulate)visuals.finishPreview?.();
    const loaded=await loadResult(url,true,{keepSimulation:true,preserveView:true,prepared,commitIf:valid});
    if(loaded===false||!valid())return;
    lifecycle.applied=lifecycle.probabilityApplied=ticket.revision;onCommitted(ticket.plan);lifecycle.edited=getState().prepared;lifecycle.editedView=null;lifecycle.failed=false;message(_t('模拟布局与概率已更新。'));
    if(lifecycle.live)lifecycle.live.painted=ticket.revision;
    else if(fresh||lifecycle.recoverLive){lifecycle.recoverLive=false;restartLive(url,ticket.revision,ticket.plan);}
   }catch(error){
    if(error.name!=='AbortError'&&lifecycle.current(ticket)){
     lifecycle.failed=true;lifecycle.recoverLive=!!lifecycle.live||lifecycle.recoverLive;stopLive();
     const last=lifecycle.edited||lifecycle.baseline;
     if(last){
      try{await loadResult(last.url,true,{keepSimulation:true,preserveView:true,prepared:last,
       commitIf:()=>lifecycle.current(ticket)&&lifecycle.failed&&lifecycle.consider});}catch{}
     }
     if(lifecycle.current(ticket)&&lifecycle.failed){
      lifecycle.probabilityApplied=lifecycle.applied;message(error.message,true);
      message(_t('重算失败，已显示上次完整结果。编辑已保留，可点击“重新计算”重试。'));
     }
    }
   }
   finally{if(lifecycle.running===ticket){lifecycle.running=null;sync();schedule();if(pending()&&!lifecycle.failed)queue();}}})();return ticket.promise;
  }

  function resetMap(prepared){
   stopLive();visuals.reset();lifecycle.reset(prepared);
   if(lifecycle.liveOpening?.result!==prepared.url)cancelWarmup();
  }
  function beforeLoad(){
   cancelWarmup();stopLive();visuals.reset();lifecycle.invalidate();
   root.CrateLivePlatform?.cancel();sync();
  }
  function loadFailed(){cancelWarmup();lifecycle.loading=false;sync();queue();}
  function prewarm(url,data){if(Session.supported(data.metadata))openLive(url);}
  async function toggleConsider(){if(getState().busy||lifecycle.loading)return;const expected=lifecycle.epoch;lifecycle.consider=!lifecycle.consider;
   if(!lifecycle.consider&&lifecycle.revision!==lifecycle.applied&&lifecycle.live){
    if(lifecycle.live?.painted===lifecycle.revision&&lifecycle.probabilityApplied===lifecycle.revision){const s=getState();lifecycle.editedView={revision:lifecycle.revision,prepared:{...s.prepared,data:{...s.data,cells:s.data.cells.slice()},im:s.image.snapshot?.()||s.image,objectImage:s.objectImage?.snapshot?.()||s.objectImage}};}
    else{lifecycle.recoverLive=true;stopLive();}
   }
   getState().liveEditing=!!lifecycle.live&&lifecycle.consider;
   lifecycle.cancelTimer();onLayoutSwitch();sync();
   layoutSwitches++;
   try{if(!lifecycle.consider){await loadResult(lifecycle.baseline.url,true,{keepSimulation:true,preserveView:true,prepared:lifecycle.baseline,commitIf:()=>lifecycle.epoch===expected&&!lifecycle.consider});}
    else {const cached=lifecycle.edited&&lifecycle.revision===lifecycle.applied?lifecycle.edited:lifecycle.live&&lifecycle.editedView?.revision===lifecycle.revision?lifecycle.editedView.prepared:null;if(cached)await loadResult(cached.url,true,{keepSimulation:true,preserveView:true,prepared:cached,commitIf:()=>lifecycle.epoch===expected&&lifecycle.consider});else{lifecycle.applied=-1;queue(0);}onRestored();}sync();schedule();}catch(e){message(e.message,true);}finally{layoutSwitches--;}}
  async function recompute(){
   const meta=getState().data.metadata;
   if(!supported(meta)){
    setBusy(true);
    try{
     const url=await CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/recompute',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:getState().prepared.url})
     }));
     await loadResult(url,true,{keepSimulation:true,preserveView:true});return true;
    }finally{setBusy(false);}
   }
   beforeRecompute();await ensure();
   if(lifecycle.consider){await compute(true);return true;}
   if(lifecycle.running)await lifecycle.running.promise;
   setBusy(true);
   try{
    const progress=()=>message(_t('正在更新地图…'));
    const url=root.CrateMapPlatform?.simulate
     ?await root.CrateMapPlatform.simulate(lifecycle.sourceUrl,M().empty(lifecycle.model.source),progress,true)
     :await CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/recompute',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:lifecycle.sourceUrl})
     }),{onProgress:progress});
    await loadResult(url,true,{keepSimulation:true,preserveView:true});
    lifecycle.baseline=getState().prepared;return true;
   }finally{setBusy(false);}
  }
  return {ensure,queue,compute,changed,getSources,resetMap,beforeLoad,loadFailed,prewarm,toggleConsider,recompute,whenLayoutReady};

 }
 const api={create};root.CrateSimulationPublication=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
