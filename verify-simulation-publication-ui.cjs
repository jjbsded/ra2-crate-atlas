/* Both editions: native strokes, structure/bridge edits, cache and exact undo. */
'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const toy=process.env.SIM_EDITION==='toy',edition=toy?'toy':'full',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
const map=process.env.SIM_MAP||'D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map';
const importMap=process.env.SIM_IMPORT==='1';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],sessions=[];
 p.on('pageerror',e=>errors.push(e.stack));p.on('response',async response=>{if(response.url().endsWith('/api/maps/simulation-live/open')&&response.ok())try{sessions.push((await response.json()).session);}catch{}});
 const ready=()=>p.waitForFunction(()=>{const v=window.CrateMapViewer,s=v?.state;return v?.simulation.model&&!s.busy&&!s.simulationPending&&!s.simulationWaiting&&!s.regionPending&&!s.unitBuffPending&&!v.simulation.computing;},null,{timeout:120000});
 async function load(){
  await p.goto(base+(toy?'index.html':importMap?'maps.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
  if(toy||importMap){if(toy)await ready();await p.locator('#version').selectOption('yr');await p.locator('#mapFile').setInputFiles(map);await p.waitForFunction(filename=>window.CrateMapViewer?.state.data?.metadata.filename===filename&&!CrateMapViewer.state.busy,path.basename(map),{timeout:120000});}await ready();
 }
 await load();await p.locator('#simulationPlaceTab').click();await p.locator('#minimap').uncheck();await p.locator('#simulationPlaceShape').selectOption('brush',{force:true});
 const row=await p.evaluate(()=>{const m=CrateMapViewer.simulation.model;for(const c of m.source.cells){if(c.level!==0)continue;const points=Array.from({length:20},(_,i)=>({x:c.x+i,y:c.y}));if(points.every(c=>m.placement('MTNK',c.x,c.y).allowed))return points;}throw Error('No clear 20-tank row');});
 async function center(c){await p.evaluate(c=>{const v=CrateMapViewer,p=v.state.lookup.get(c.x+','+c.y);v.state.scale=1;v.state.x=v.area.x+v.area.w/2-p.px;v.state.y=v.area.y+v.area.h/2-p.py;v.draw();},c);await p.locator('#map').scrollIntoViewIfNeeded();}
 const points=coordinates=>p.evaluate(coordinates=>{const v=CrateMapViewer,r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return coordinates.map(c=>{const p=v.state.lookup.get(c.x+','+c.y);return [r.x+(v.state.x+p.px*v.state.scale)*k,r.y+(v.state.y+p.py*v.state.scale)*k];});},coordinates);
 async function signature(at=row[10]){const value=await p.evaluate(c=>{const v=CrateMapViewer,p=v.state.lookup.get(c.x+','+c.y),cv=document.createElement('canvas');cv.width=140;cv.height=120;CrateMapArtwork.draw(cv.getContext('2d'),v.state.objectImage,p.px-70,p.py-85,140,120,0,0,140,120);return {terms:JSON.stringify(v.state.data.cells.map(c=>[c.x,c.y,c.terms,c.status])),exact:JSON.stringify(v.state.data.probability.exact),pixels:cv.toDataURL()};},at);return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,crypto.createHash('sha256').update(v).digest('hex')]));}
 const initial=await signature();await center(row[10]);const xy=await points(row);await p.mouse.move(...xy[0]);await p.mouse.down();for(const point of xy.slice(1))await p.mouse.move(...point);
 assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),20);assert(!(await p.locator('#simulationPlaceTab').isDisabled()));await p.mouse.up();await ready();
 assert(await p.evaluate(row=>row.every(c=>CrateMapViewer.state.lookup.get(c.x+','+c.y).occupied),row));const placed=await signature();
 await p.locator('#simulationUndo').click();await ready();assert.deepEqual(await signature(),initial,'One stroke is one exact undo step');
 await p.locator('#simulationRedo').click();await ready();assert.deepEqual(await signature(),placed);
 for(let i=0;i<2;i++){await p.locator('#simulationConsider').click();await ready();assert.deepEqual(await signature(),initial);await p.locator('#simulationConsider').click();await ready();assert.deepEqual(await signature(),placed);}

 // The raw analysis worker precedes client asset preparation. Reused numeric
 // sources must still receive the prepared tree choice and ore restrictions.
 const tree=await p.evaluate(()=>{const m=CrateMapViewer.simulation.model,t=m.choices.find(c=>c.tree);const c=m.source.cells.find(c=>m.placement(t.type,c.x,c.y).allowed);return {type:t.type,x:c.x,y:c.y};});
 const treeBefore=await signature(tree);await p.locator('#simulationObject').selectOption(tree.type,{force:true});await center(tree);
 await p.mouse.click(...(await points([tree]))[0]);await ready();
 assert.equal(await p.evaluate(c=>CrateMapViewer.state.lookup.get(c.x+','+c.y).terrain,tree),tree.type,'Prepared tree type survives numeric source reuse');
 await p.locator('#simulationUndo').click();await ready();assert.deepEqual(await signature(tree),treeBefore,'Tree undo restores artwork and exact probabilities');
 await p.locator('#simulationObject').selectOption('MTNK',{force:true});

 const building=await p.evaluate(()=>{const m=CrateMapViewer.simulation.model,o=m.current().objects.find(o=>o.category==='STRUCTURES'&&!o.immune&&o.footprint.length>1&&m.current().cells.get(o.x+','+o.y)?.usable);if(!o)throw Error('No destroyable structure');return {id:o.id,x:o.x,y:o.y};});
 const buildingBefore=await signature(building);
 await p.locator('#simulationTool').selectOption('chrono',{force:true});await p.locator('#simulationPaintMethod').selectOption('brush',{force:true});await center(building);await p.mouse.click(...(await points([building]))[0]);await ready();
 assert.equal(await p.evaluate(id=>CrateMapViewer.simulation.model.plan.objects[id],building.id),'remove');assert.notEqual((await signature(building)).pixels,buildingBefore.pixels,'Building artwork changes immediately');await p.locator('#simulationUndo').click();await ready();assert.deepEqual(await signature(building),buildingBefore,'Building undo restores its own exact pixels');assert.deepEqual(await signature(),placed,'Structure undo restores exact probabilities and tank artwork');

 let bridge=await p.evaluate(()=>{const m=CrateMapViewer.simulation.model;for(const segment of m.bridges)for(const key of segment.cells){const c=m.current().cells.get(key);if(c?.usable&&c.bridge)return {x:c.x,y:c.y,kind:segment.kind,cells:segment.cells};}return null;});
 if(bridge){await center(bridge);await p.mouse.click(...(await points([bridge]))[0]);await ready();assert((await p.evaluate(()=>Object.keys(CrateMapViewer.simulation.model.plan.overlays).length))>0);await p.locator('#simulationUndo').click();await ready();assert.deepEqual(await signature(),placed,'Bridge undo restores exact probabilities');}
 await p.locator('#simulationTool').selectOption('place',{force:true});
 await load();assert(await p.locator('#simulationCache').isVisible());await p.locator('#simulationRestoreCache').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),20);assert.deepEqual(await signature(),placed,'A fresh session restores the cached delta exactly');
 // The large user map has no bridges. Exercise an explicit bridge fixture
 // rather than silently treating an absent target as bridge coverage.
 if(!bridge){
  const fixture=path.resolve('output/simulation-20261104/source.map');
  await p.locator('#version').evaluate(e=>e.value='yr');await p.locator('#mapFile').setInputFiles(fixture);
  await p.waitForFunction(filename=>CrateMapViewer.state.data.metadata.filename===filename&&!CrateMapViewer.state.busy,path.basename(fixture),{timeout:120000});await ready();
  bridge=await p.evaluate(()=>{const m=CrateMapViewer.simulation.model;for(const segment of [...m.bridges].sort((a,b)=>Number(a.kind!=='low')-Number(b.kind!=='low')))for(const key of segment.cells){const c=m.current().cells.get(key);if(c?.usable&&c.bridge)return {x:c.x,y:c.y,kind:segment.kind,cells:segment.cells};}return null;});
  assert(bridge,'The dedicated fixture must contain a bridge');const before=await signature(bridge);
  await p.locator('#simulationPlaceTab').click();await p.locator('#simulationTool').selectOption('chrono',{force:true});await p.locator('#simulationPaintMethod').selectOption('brush',{force:true});
  await center(bridge);await p.mouse.click(...(await points([bridge]))[0]);await ready();
  const edits=await p.evaluate(()=>Object.keys(CrateMapViewer.simulation.model.plan.overlays));assert(edits.length>0,'Bridge removal changes its overlays');
  if(bridge.kind==='low')assert(bridge.cells.every(key=>edits.includes(key)),'The complete low-bridge strip is destroyed');
  await p.locator('#simulationUndo').click();await ready();assert.deepEqual(await signature(bridge),before,'Bridge undo restores exact terms, coefficients and artwork');
 }
 assert.deepEqual(errors,[]);await p.close();
 if(!toy){
  assert(sessions.length>=2);const api=await browser.newContext();try{for(const id of new Set(sessions)){let released=false;for(let i=0;i<30;i++){const result=await api.request.post(base+'api/maps/simulation-live/sources',{data:{session:id,revision:-1}});const body=await result.json();if(body.reason==='released-by-client'){released=true;break;}await new Promise(r=>setTimeout(r,100));}assert(released,'Reload/page close releases the owned live session');}}finally{await api.close();}
 }
 const out=path.resolve(process.env.SIM_QA_OUTPUT||'output/simulation-publication-ui-qa');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,edition+'.json'),JSON.stringify({status:'PASS',row:20,atomicUndoRedo:true,layoutToggles:2,structure:true,bridge:bridge?.kind||'not-present',cacheRestore:true,releasedSessions:toy?0:new Set(sessions).size,initial,placed,errors},null,2));
 console.log('PASS',edition,'20-tank native stroke, exact undo/redo, layout toggles, structure/bridge removal, cache restore and owned-session cleanup');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
