/* Real imported layouts: phase timings, main-thread stalls and geometry reuse. */
'use strict';
const{chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||(toy?'http://127.0.0.1:8788/toy/crate-atlas/':'http://127.0.0.1:8767/');
const map=process.env.SIM_MAP,planFile=process.env.SIM_PLAN;
assert(map&&planFile,'Set SIM_MAP and SIM_PLAN to the map and its exported layout');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>{errors.push(e.stack);console.error(e.stack);});
 const profiler=process.env.BULK_CPU==='1'?await p.context().newCDPSession(p):null;
 if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.setSamplingInterval',{interval:1000});}
 await p.addInitScript(()=>{window.bulkQA={stage:null,calls:{},packets:[],long:[],add(name,ms){if(!this.stage)return;const s=this.calls[name]??={n:0,ms:0,max:0};s.n++;s.ms+=ms;s.max=Math.max(s.max,ms);},wrap(name,fn,owner){return function(...args){const at=performance.now();try{return fn.apply(owner||this,args);}finally{bulkQA.add(name,performance.now()-at);}};},factory(api,names,props=[]){const make=api.create;api.create=function(...args){const v=make.apply(this,args);for(const name of names)if(typeof v[name]==='function')v[name]=bulkQA.wrap(name,v[name],v);for(const name of props){const d=Object.getOwnPropertyDescriptor(v,name);if(d?.get)Object.defineProperty(v,name,{...d,get:bulkQA.wrap(name,d.get,v)});}return v;};}};new PerformanceObserver(list=>{if(bulkQA.stage)bulkQA.long.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})));}).observe({type:'longtask',buffered:false});});
 const hooks={
 'map-details.js':`bulkQA.factory(CrateMapDetails,['report','update','cell']);`,
 'map-coordinates.js':`CrateMapCoordinates.create=bulkQA.wrap('coordinates.create',CrateMapCoordinates.create);`,
 'probability-display.js':`for(const name of ['map','reweight'])CrateProbabilityDisplay[name]=bulkQA.wrap('display.'+name,CrateProbabilityDisplay[name]);`,
 'simulation-model.js':`bulkQA.factory(CrateSimulationModel,['current','placement','changesSince','quick','import','reset','undo','redo','appendPlacement'],['plan','count']);`,
 'simulation-visual.js':`bulkQA.factory(CrateSimulationVisual,['installTiles','update']);`,
 'simulation-ui.js':`bulkQA.factory(CrateSimulationUI,['draw','drawScene','sync','refreshColors']);`,
 'region-statistics-ui.js':`bulkQA.factory(CrateRegionStatisticsUI,['load','render','labels','updateBuffs','updateCells','probabilityChanged','renderPlacement']);`,
 'map-renderer.js':`{const make=CrateMapRenderer.createViewCache;CrateMapRenderer.createViewCache=(...a)=>{const v=make(...a);v.render=bulkQA.wrap('renderer.render',v.render,v);return v;};}`,
 'local-api.js':`{const json=CrateLocalAPI.json;CrateLocalAPI.json=async function(url,...args){const stage=bulkQA.stage,at=performance.now(),result=await json.call(this,url,...args);if(stage&&bulkQA.stage===stage&&String(url).includes('simulation-live/'))bulkQA.packets.push({url:String(url).split('/').at(-1),ms:performance.now()-at,timing:result.timing,paintMs:result.paintMs,sceneUpdateMs:result.sceneUpdateMs,encodeMs:result.encodeMs,rasterMs:result.rasterMs,done:result.done,total:result.total,patches:result.patches?.length,cells:result.cells?.length});return result;};}`
 };
 for(const[name,code]of Object.entries(hooks))await p.route('**/'+name+'*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nif(typeof window!=="undefined"){'+code+'}'});});
 await p.route('**/realmap-ui.js*',async route=>{
  const response=await route.fetch();let s=await response.text();
  s=s.replace(' simulation=CrateSimulationUI.create(',` const rawApplyProbability=applyProbability;applyProbability=async(...args)=>{const at=performance.now();try{return await rawApplyProbability(...args);}finally{bulkQA.add('applyProbability',performance.now()-at);}};\n simulation=CrateSimulationUI.create(`);
  s=s.replace('  window.CrateMapViewer={state',`  if(!bulkQA.drawHook){bulkQA.drawHook=true;draw=bulkQA.wrap('draw.frame',draw);}\n  window.CrateMapViewer={state`);await route.fulfill({response,body:s});
 });
 console.log('Starting',base);await p.goto(base+(toy?'index.html':'maps.html'));if(toy)await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:180000});
 await p.locator('#mapFile').setInputFiles(map);await p.waitForFunction(name=>window.CrateMapViewer?.state.data.metadata.filename===name&&!CrateMapViewer.state.busy&&CrateMapViewer.simulation.model,path.basename(map),{timeout:180000});
 const ready=()=>p.waitForFunction(()=>{const v=CrateMapViewer,s=v.state;return !s.busy&&!v.simulation.computing&&!v.simulation.waiting&&!s.regionPending&&!s.unitBuffPending&&!s.regionRecolorPending&&!s.buffExpectationPending&&!v.regionRefresh.thumbnails?.pending;},null,{timeout:180000});await ready();
 const plan=JSON.parse(fs.readFileSync(planFile,'utf8').replace(/^\uFEFF/,'')),placementCount=plan.placements.length;plan.map.version=await p.evaluate(()=>CrateMapViewer.simulation.model.source.version);
 fs.mkdirSync('output/bulk-performance-qa',{recursive:true});fs.writeFileSync('output/bulk-performance-qa/source.json',await p.evaluate(()=>JSON.stringify(CrateMapViewer.simulation.model.source)));
 const rows=[];async function measure(label,fn){if(profiler)await profiler.send('Profiler.start');await p.evaluate(label=>{bulkQA.stage=label;bulkQA.calls={};bulkQA.long=[];bulkQA.packets=[];bulkQA.started=performance.now();},label);await fn();await ready();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const r=await p.evaluate(()=>{const v=CrateMapViewer;bulkQA.stage=null;return{wallMs:performance.now()-bulkQA.started,calls:bulkQA.calls,packets:bulkQA.packets,long:bulkQA.long,live:v.state.liveProbability,art:v.state.liveArtwork,regions:v.regionRefresh,unitBuff:v.unitBuffs.status,placements:v.simulation.model.plan.placements.length};});if(profiler){const result=await profiler.send('Profiler.stop');fs.writeFileSync('output/bulk-performance-qa/'+(toy?'toy':'full')+'-'+label.replaceAll(/[^a-z0-9]/gi,'_')+'.cpuprofile',JSON.stringify(result.profile));}assert.equal(r.regions.rebuiltTiles,0,'Object edits must reuse unchanged region geometry');rows.push({label,...r});console.log(label,JSON.stringify({wallMs:r.wallMs,top:Object.entries(r.calls).sort((a,b)=>b[1].ms-a[1].ms).slice(0,10),long:r.long,live:r.live,art:r.art,regions:r.regions}));fs.writeFileSync('output/bulk-performance-qa/'+(toy?'toy':'full')+'-'+(process.env.BULK_STAGE||'current')+'.json',JSON.stringify(rows,null,2));}
 const importPlan=plan=>p.locator('#simulationImportFile').setInputFiles({name:'qa-layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
 await measure('import layout',async()=>{await importPlan(plan);await p.waitForFunction(n=>CrateMapViewer.state.data.metadata.simulationPlan?.placements.length===n,placementCount,{timeout:180000});});
 const augmented=await p.evaluate(()=>{const v=CrateMapViewer,m=CrateSimulationModel.create(v.simulation.model.source);m.import(v.simulation.model.plan);m.beginPlacement();let n=0;for(const c of m.source.cells)if(m.appendPlacement('MTNK',c.x,c.y,{})){if(++n===500)break;}m.endPlacement();if(n!==500)throw Error('Not enough positions');return m.plan;});
 await measure('import +500 tanks',async()=>{await importPlan(augmented);await p.waitForFunction(n=>CrateMapViewer.state.data.metadata.simulationPlan?.placements.length===n,placementCount+500,{timeout:180000});});
 if(process.env.PROFILE_TWO==='1'){console.log('PASS two imports');return;}
 for(const[id,label]of [['simulationUnits','delete units'],['simulationUndo','undo units'],['simulationChronoBuildings','erase buildings/rubble'],['simulationUndo','undo buildings/rubble'],['simulationReset','reset all']])await measure(label,()=>p.locator('#'+id).click());
 assert.deepEqual(errors,[]);console.log('PASS',toy?'Toy':'Full');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
