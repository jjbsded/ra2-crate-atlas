/* Actual browser persistence, exact fast publication and stale-edit guards. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE,toy=process.env.SIM_EDITION==='toy',edition=toy?'toy':'full',qa=path.resolve(process.env.SIM_QA);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log(e.stack);});
 // These checks exercise full-report jobs and the fallback publication path.
 if(!toy)await p.route('**/api/maps/simulation-live/open',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA fallback path"}'}));
 await p.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/simulation-drag-base/result.json')));
 const ready=()=>p.waitForFunction(()=>globalThis.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy&&!CrateMapViewer.simulation.pending&&!CrateMapViewer.simulation.computing,null,{timeout:180000});await ready();
 if(toy){await p.locator('#mapFile').setInputFiles(path.resolve('output/availability-20261104/user.map'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='user.map'&&!CrateMapViewer.state.busy,null,{timeout:180000});}
 await p.locator('#simulationPlaceTab').click();await p.waitForFunction(()=>CrateMapViewer.simulation.model&&CrateMapViewer.simulation.previewReady,null,{timeout:60000});await p.locator('#minimap').uncheck();await p.locator('#map').scrollIntoViewIfNeeded();
 const coords=await p.evaluate(()=>{const v=CrateMapViewer,m=v.simulation.model;const safe=(x,y)=>{for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const c=v.state.lookup.get(`${x+dx},${y+dy}`);if(!c?.primary||c.status!=='crate'||c.level!==0||!m.placement('MTNK',x+dx,y+dy).allowed)return false;}return true;};
  const start=m.source.cells.find(c=>safe(c.x,c.y)&&safe(c.x+10,c.y)&&safe(c.x+20,c.y));if(!start)throw Error('Missing open fixture cells');window.points=[0,10,20].map(dx=>[start.x+dx,start.y]);window.originalTerms=points.map(p=>JSON.stringify(v.state.lookup.get(p.join(',')).terms));
  const middle=v.state.lookup.get(points[1].join(','));v.state.scale=1;v.state.x=v.area.x+v.area.w/2-middle.px;v.state.y=v.area.y+v.area.h/2-middle.py;v.draw();const r=document.getElementById('map').getBoundingClientRect(),k=Math.min(r.width/v.viewport.width,r.height/v.viewport.height);
  return points.map(point=>{const c=v.state.lookup.get(point.join(','));return{x:r.left+(r.width-v.viewport.width*k)/2+(v.state.x+c.px)*k,y:r.top+(r.height-v.viewport.height*k)/2+(v.state.y+c.py)*k};});
 });
 const click=async index=>{await p.locator('#map').scrollIntoViewIfNeeded();const point=await p.evaluate(index=>{const v=CrateMapViewer,c=v.state.lookup.get(points[index].join(',')),r=document.getElementById('map').getBoundingClientRect(),k=Math.min(r.width/v.viewport.width,r.height/v.viewport.height);return{x:r.left+(r.width-v.viewport.width*k)/2+(v.state.x+c.px*v.state.scale)*k,y:r.top+(r.height-v.viewport.height*k)/2+(v.state.y+c.py*v.state.scale)*k};},index);await p.mouse.click(point.x,point.y);};
 const timings=[];
 for(let i=0;i<2;i++){
  const start=Date.now();await click(i);let early=null;
  if(!toy){await p.waitForFunction(n=>CrateMapViewer.simulation.pending&&!CrateMapViewer.state.simulationPending&&CrateMapViewer.state.data.metadata.simulationPlan?.placements.length===n,i+1,{timeout:60000});early=Date.now()-start;
   assert.equal(await p.locator('#stats').evaluate(e=>getComputedStyle(e).visibility),'visible');assert(await p.locator('#mapImageExport').isDisabled());
   await p.evaluate(()=>window.fastProbability=JSON.stringify(CrateMapViewer.state.data.probability));
  }
  await ready();const finished=Date.now()-start;const stats=await p.evaluate(()=>CrateMapViewer.state.data.metadata.incrementalProbability.current);timings.push({earlyMs:early,finishedMs:finished,...stats});console.log(edition,i,timings.at(-1));
  if(!toy)assert(await p.evaluate(()=>fastProbability===JSON.stringify(CrateMapViewer.state.data.probability)));
  if(i===1){assert.equal(stats.searchedOrigins,1);assert.equal(stats.touchedDestinations,9);assert.equal(stats.coefficientsReused,true);assert.equal(stats.evaluatedDestinations,9);}
 }
 if(process.env.SIM_SMOKE){assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,edition+'-installed-smoke.json'),JSON.stringify({status:'PASS',timings},null,2));return;}
 const signature=()=>p.evaluate(()=>JSON.stringify({probability:CrateMapViewer.state.data.probability,cells:CrateMapViewer.state.data.cells.map(c=>[c.x,c.y,c.terms,c.probability])}));
 const incremental=await signature();await p.locator('#recompute').click();await ready();assert.equal(await signature(),incremental,'Forced full calculation must be exact');
 assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.incrementalProbability.current.source),'forced-full');
 await p.locator('#simulationUndo').click();await ready();await p.locator('#simulationRedo').click();await ready();assert.equal(await signature(),incremental,'Undo/redo must preserve exact result');
 if(!toy){let release,requested=false;await p.route('**/probability.json',async route=>{if(requested)return route.continue();requested=true;await new Promise(r=>release=r);await route.continue();});
  await click(2);for(let i=0;i<600&&!requested;i++)await p.waitForTimeout(100);assert(requested);await p.locator('#simulationUndo').click();release();await ready();await p.unroute('**/probability.json');assert.equal(await signature(),incremental,'Stale fast result must be rejected');
 }
 // Baseline was cloned for fast publication, not overwritten by edited cells.
 await p.locator('#simulationConsider').click();await ready();assert(await p.evaluate(()=>points.every((p,i)=>JSON.stringify(CrateMapViewer.state.lookup.get(p.join(',')).terms)===originalTerms[i])));
 if(!toy){for(const name of ['toy/static-codec.js','toy-live/solver.js','toy-live/incremental.js'])await p.addScriptTag({url:new URL(name,base).href});
  const storage=await p.evaluate(async()=>{const I=CrateIncrementalProbability,S=CrateLiveSolver,N=25,grid=new Uint8Array(262144),statuses=new Uint8Array(262144);for(let y=1;y<=N;y++)for(let x=1;x<=N;x++){grid[y*512+x]=5;statuses[y*512+x]=1;}
   const value=new I.Store(N,grid,statuses,S.search(grid,N)),db=await I.open(),key='qa-'+crypto.randomUUID();await I.save(db,key,value,null);const a=await I.restore(db,key),b=await I.restore(db,key);grid[12*512+12]=4;statuses[12*512+12]=0;let delta=a.update(grid,statuses);await I.save(db,key,a,delta.changedRows);
   grid[12*512+12]=5;statuses[12*512+12]=1;grid[15*512+15]=4;statuses[15*512+15]=0;delta=b.update(grid,statuses);await I.save(db,key,b,delta.changedRows);const loaded=await I.restore(db,key);if(JSON.stringify([...loaded.export()])!==JSON.stringify([...b.export()]))throw Error('Concurrent writer corrupted records');
   await new Promise((resolve,reject)=>{const tx=db.transaction('blocks','readwrite'),store=tx.objectStore('blocks'),r=store.get(key+':0');r.onsuccess=()=>{r.result.picks[0]^=1;store.put(r.result);};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});let corrupt=false;try{await I.restore(db,key);}catch{corrupt=true;}db.close();return{reloaded:true,concurrentWriter:true,corruptionRejected:corrupt};
  });assert(storage.corruptionRejected);fs.writeFileSync(path.join(qa,'browser-storage.json'),JSON.stringify({status:'PASS',...storage},null,2));
 }
 assert.deepEqual(errors,[]);const result={status:'PASS',edition,timings,forcedFullEqual:true,undoRedo:true,baselineUnchanged:true,staleFastRejected:!toy};fs.writeFileSync(path.join(qa,edition+'-incremental-ui.json'),JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
