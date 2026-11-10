/* Controlled asynchronous interleavings; no DOM, network or game resources. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(toy=true){
 let next=0,plan={objects:{},overlays:{},placements:[{id:'sim-one',type:'MTNK'}]};
 const timers=new Map(),jobs=[],commits=[],loads=[],probabilities=[],messages=[],requests=[],reads=new Map(),events={};
 const context={console,performance,AbortController,URLSearchParams,Uint8Array,atob,structuredClone,Date,
  setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
  queueMicrotask:fn=>Promise.resolve().then(fn),requestAnimationFrame:fn=>fn(),addEventListener:(name,fn)=>events[name]=fn,
  crypto:{randomUUID:()=>String(++next)},
  CrateSimulationAssets:{prepare:async()=>{}},CrateSimulationModel:{create:source=>({source,current(){}}),empty:()=>({objects:{},overlays:{},placements:[]})}
 };
 const api={json:async(url,options)=>{
  if(options?.body){const payload=JSON.parse(options.body);requests.push({url,payload});}
  if(reads.has(url)){const v=reads.get(url);return v.promise||v;}
  if(url==='/api/maps/simulation'){const token={};return token;}
  return {};
 },waitForMapJob:async(token,options)=>{const work=deferred();jobs.push({...work,progress:options.onProgress,signal:options.signal});return work.promise;}};
 context.CrateLocalAPI=api;
 if(toy)context.CrateMapPlatform={simulate:async(source,p,progress,force)=>{const work=deferred();jobs.push({...work,source,plan:p,progress,force});return work.promise;}};
 vm.createContext(context);for(const name of ['simulation-session.js','simulation-publication.js'])vm.runInContext(fs.readFileSync(name,'utf8'),context);
 const prepared={url:'/base-a',data:{metadata:{sourceSha256:'a',version:'yr'},probabilityRevision:'base-a',cells:[]}},viewer={prepared,data:prepared.data,busy:false};
 const session=context.CrateSimulationSession.create();session.reset(prepared);session.model={count:1,source:{},plan};
 const visuals={progressivePending:false,finished:0,finishPreview(){this.finished++;},reset(){},update(){},clearGrounds(){},groundKeys:()=>[]};
 const publication=context.CrateSimulationPublication.create({session,getState:()=>viewer,getArea:()=>({x:0,y:0,w:100,h:100}),
  async loadResult(url,job,options){if(!options.commitIf())return false;loads.push(url);viewer.prepared=options.prepared||{url,data:{metadata:{simulationPlan:structuredClone(plan)}}};viewer.data=viewer.prepared.data;return true;},
  applyProbability(value,valid=()=>true){const publish=()=>{if(!valid())return false;probabilities.push(value);return !value.probabilityPatch;};return value.deferredApply?value.deferredApply.promise.then(publish):publish();},visuals,getPlan:()=>structuredClone(plan),isDrawing:()=>false,
  sync(){},syncActivity(){},schedule(){},message:(...args)=>messages.push(args),setStatus(){},setBusy:value=>viewer.busy=value,beforeRecompute(){},
  onPrepared(){commits.push('prepared');},onCommitted:p=>commits.push(p),onForced(){},onEdited(){},onLayoutSwitch(){},onRestored(){}
 });
 const runTimer=async()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();await ticks();};
 return {context,session,publication,viewer,visuals,jobs,commits,loads,probabilities,messages,requests,reads,events,timers,runTimer,
  edit(id){plan={...plan,placements:[{id,type:'MTNK'}]};session.model.plan=plan;publication.changed();},
  switchMap(){publication.beforeLoad();publication.resetMap({url:'/base-b',data:{metadata:{sourceSha256:'b',version:'yr'},cells:[]}});session.model={count:1,source:{}};}
 };
}
(async()=>{
 // Region analysis waits for current layout data, not native artwork/report.
 {const f=fixture(false);f.session.loading=true;await f.publication.whenLayoutReady();assert.equal(f.timers.size,0,'Initial region partition must not wait for unused editing assets');}
 {const f=fixture(false),controller=new AbortController();f.session.live={};f.session.revision=2;let ready=false;
  const waiting=f.publication.whenLayoutReady(controller.signal).then(()=>ready=true);await ticks();assert(!ready);f.session.probabilityApplied=2;await f.runTimer();await waiting;
  assert(ready);assert.notEqual(f.session.applied,2,'Native image/report publication may remain pending');}
 {const f=fixture(true);f.session.revision=2;f.session.probabilityApplied=2;let ready=false;
  const waiting=f.publication.whenLayoutReady().then(()=>ready=true);await ticks();assert(!ready,'Fallback/Toy needs the matching complete report');f.session.applied=2;await f.runTimer();await waiting;assert(ready);}
 {const f=fixture(false),controller=new AbortController();f.session.revision=2;
  const waiting=f.publication.whenLayoutReady(controller.signal);controller.abort();await assert.rejects(waiting,e=>e.name==='AbortError');assert.equal(f.timers.size,0,'Cancelled wait removes its timer');}
 {const f=fixture(false);f.session.revision=2;f.session.failed=true;await assert.rejects(f.publication.whenLayoutReady(),/模拟布局更新失败/);}
 // One bounded paint lookahead overlaps decoding, with adaptive cached batches.
 {const f=fixture(false),paint=[],gate=deferred(),installed=[];
  f.viewer.x=f.viewer.y=0;f.viewer.scale=1;f.viewer.liveProbability={};
  f.session.live={id:'native-pipeline',plan:{objects:{},overlays:{},placements:[]},probability:0,painted:0,plans:new Map()};
  f.context.CrateLocalAPI.json=async(url,options)=>{const payload=JSON.parse(options.body);
   if(url.endsWith('/edit'))return {revision:payload.revision,sets:[]};
   if(url.endsWith('/paint')){const work=deferred();paint.push({...work,payload});return work.promise;}return {};};
  f.visuals.installTiles=async(result,valid)=>{installed.push(result.done);if(result.done===8)await gate.promise;return valid();};
  f.edit('pipeline');await ticks();assert.equal(paint.length,1);assert.equal(paint[0].payload.limit,8);
  paint[0].resolve({revision:1,done:8,total:24,patches:Array(8).fill({}),flatTiles:8,paintMs:2});await ticks();
  assert.equal(paint.length,2,'Next batch starts before the previous decode completes');
  assert.equal(paint[1].payload.limit,16);assert.equal(paint[1].payload.offset,8);assert.deepEqual(installed,[8]);
  paint[1].resolve({revision:1,done:24,total:24,patches:Array(16).fill({}),flatTiles:16,paintMs:4});await ticks();
  assert.equal(paint.length,2,'Only one lookahead is allowed');gate.resolve();await ticks();
  assert.deepEqual(installed,[8,24]);assert.equal(f.session.live.painted,1);assert.equal(paint.length,2);
 }
 // Toy numeric work overlaps temporary tiles; a final scene replaces them.
 {const f=fixture();f.visuals.progressivePending=true;f.edit('sim-one');const work=f.publication.compute();await ticks();
  assert.equal(f.jobs.length,1);f.jobs[0].resolve('/parallel-final');await work;
  assert.equal(f.visuals.finished,1);assert.deepEqual(f.loads,['/parallel-final']);}
 // Native fallback tiles still own their existing serialization contract.
 {const f=fixture(false);f.visuals.progressivePending=true;f.edit('sim-one');await f.publication.compute();await ticks();
  assert.equal(f.jobs.length,0);assert(f.timers.size>0);}
 // A real Toy worker can be replaced immediately instead of finishing stale work.
 {const f=fixture();let cancelled=0;f.context.CrateLivePlatform={cancel(){cancelled++;f.jobs.at(-1).reject(new DOMException('Superseded','AbortError'));}};
  f.edit('sim-first');const first=f.publication.compute();await ticks();f.edit('sim-new');const latest=f.publication.compute();await ticks();
  assert.equal(cancelled,1);assert.equal(f.jobs.length,2);f.jobs[1].resolve('/latest');await Promise.all([first,latest]);
  assert.deepEqual(f.loads,['/latest']);assert.equal(f.visuals.finished,1);assert(!f.session.failed);}
 // Toy serializes expensive worker work, retaining only the current revision.
 {const f=fixture();f.edit('sim-first');const first=f.publication.compute();await ticks();assert.equal(f.jobs.length,1);
  f.edit('sim-latest');const duplicate=f.publication.compute();await ticks();assert.equal(f.jobs.length,1);
  f.jobs[0].resolve('/stale');await first;await duplicate;assert.equal(f.loads.length,0);await f.runTimer();assert.equal(f.jobs.length,2);
  const latest=f.session.running.promise;f.jobs[1].resolve('/latest');await latest;assert.deepEqual(f.loads,['/latest']);assert.equal(f.session.applied,f.session.revision);assert.equal(f.commits[0].placements[0].id,'sim-latest');}
 // Old finalizers cannot clear a new map's running task, even at equal revision.
 {const f=fixture();f.edit('sim-a');const old=f.publication.compute();await ticks();f.switchMap();f.edit('sim-b');const current=f.publication.compute();await ticks();const owner=f.session.running;
  f.jobs[0].resolve('/old-map');await old;assert.equal(f.session.running,owner);assert.equal(f.loads.length,0);
  f.jobs[1].resolve('/new-map');await current;assert.deepEqual(f.loads,['/new-map']);}
 // Changing to the default layout while a worker is running suppresses it.
 {const f=fixture();f.edit('sim-one');const work=f.publication.compute();await ticks();await f.publication.toggleConsider();f.jobs[0].resolve('/hidden');await work;
  assert.deepEqual(f.loads,['/base-a']);assert.equal(f.commits.length,0);assert(!f.session.pending);assert.equal(f.session.model.count,1);}
 // A failure preserves edits, restores the last frame and waits for explicit retry.
 {const f=fixture();f.edit('sim-one');const work=f.publication.compute();await ticks();f.jobs[0].reject(Error('test failure'));await work;
  assert(f.session.failed&&f.session.pending);assert.equal(f.session.model.plan.placements.length,1);assert.deepEqual(f.loads,['/base-a']);assert.equal(f.timers.size,0);
  const retry=f.publication.compute(true);await ticks();assert(f.jobs[1].force);f.jobs[1].resolve('/recovered');await retry;assert(!f.session.failed&&!f.session.pending);}
 // Full preview patches can fall back to the same revision's complete snapshot.
 {const f=fixture(false);f.edit('sim-one');const work=f.publication.compute();await ticks();f.reads.set('/preview',{probabilityPatch:true,probabilityRevision:'r1'});f.reads.set('/api/maps/probability/r1',{complete:true});
  await f.jobs[0].progress({probabilityReady:true,probabilityUrl:'/preview'});assert.equal(f.probabilities.length,2);assert.equal(f.session.probabilityApplied,f.session.revision);
  f.jobs[0].resolve('/final');await work;assert.deepEqual(f.loads,['/final']);}
 // A delayed preview and final report both reject after a newer edit starts.
 {const f=fixture(false);f.edit('sim-first');const old=f.publication.compute();await ticks();const deferredApply=deferred();f.reads.set('/prepare',{deferredApply});
  const preparing=f.jobs[0].progress({probabilityReady:true,probabilityUrl:'/prepare'});await ticks();assert.equal(f.probabilities.length,0);
  f.edit('sim-second');const latest=f.publication.compute();await ticks();deferredApply.resolve();await preparing;
  assert.equal(f.probabilities.length,0,'A cancelled asynchronous preparation must not publish');
  f.jobs[0].resolve('/old');await old;f.jobs[1].resolve('/new');await latest;assert.deepEqual(f.loads,['/new']);}
 {const f=fixture(false);f.edit('sim-first');const old=f.publication.compute();await ticks();const delayed=deferred();f.reads.set('/slow-preview',delayed);
  const preview=f.jobs[0].progress({probabilityReady:true,probabilityUrl:'/slow-preview'});f.edit('sim-second');const latest=f.publication.compute();await ticks();assert(f.jobs[0].signal.aborted);
  delayed.resolve({complete:true});await preview;assert.equal(f.probabilities.length,0);f.jobs[0].resolve('/old');await old;assert.equal(f.loads.length,0);
  f.jobs[1].resolve('/new');await latest;assert.deepEqual(f.loads,['/new']);}
 // Warmups are shared, and a late source/open response is released on map change.
 {const f=fixture(false);f.session.model=null;const open=deferred();f.reads.set('/api/maps/simulation-live/open',open);
  f.publication.prewarm('/base-a',{metadata:{version:'yr'}});const first=f.publication.ensure().catch(e=>e),second=f.publication.ensure().catch(e=>e);await ticks();
  assert.equal(f.requests.filter(r=>r.url.endsWith('/open')).length,1);f.publication.beforeLoad();assert(f.requests.some(r=>r.url.endsWith('/close')&&r.payload.lease));
  open.resolve({session:'late-session',source:{}});const failures=await Promise.all([first,second]);await ticks();assert(failures.every(e=>e instanceof Error||e?.message));
  assert.equal(f.session.model,null);assert.equal(f.commits.length,0);assert(f.requests.some(r=>r.url.endsWith('/close')&&r.payload.session==='late-session'));}
 console.log('PASS publication races: Toy serialization, map generations, default layout, failure/retry, patch fallback, stale previews and leased warmup cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
