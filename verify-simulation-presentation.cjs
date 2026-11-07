/* Real-browser regression: stable toolbar, retained data, local marks and busy lifecycle. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE,toy=process.env.SIM_EDITION==='toy',edition=toy?'toy':'full',qa=path.resolve(process.env.SIM_QA);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 // These checks exercise full-report jobs and the fallback publication path.
 if(!toy)await p.route('**/api/maps/simulation-live/open',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA fallback path"}'}));
 await p.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/simulation-drag-base/result.json')));
 const ready=()=>p.waitForFunction(()=>globalThis.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy&&!CrateMapViewer.simulation.pending&&!CrateMapViewer.simulation.computing,null,{timeout:180000});await ready();
 if(toy){await p.locator('#mapFile').setInputFiles(path.resolve('output/availability-20261104/user.map'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='user.map'&&!CrateMapViewer.state.busy,null,{timeout:180000});}
 assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.probability.model),'finite-retry-v2');
 assert.doesNotMatch(await p.locator('body').innerText(),/重抽|reroll|redraw|retry weight/i);
 const off=await p.locator('#simulationPlaceTab').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(off,'rgb(58, 50, 36)');
 await p.locator('#simulationPlaceTab').click();await p.waitForFunction(()=>CrateMapViewer.simulation.model&&CrateMapViewer.simulation.previewReady,null,{timeout:60000});
 await p.mouse.move(0,0);const on=await p.locator('#simulationPlaceTab').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(on,'rgb(245, 206, 128)');
 const layouts=[];
 for(const width of [2888,1900,1366,1100,1000,760,390]){
  await p.setViewportSize({width,height:1300});
  layouts.push(await p.evaluate(width=>{
   const ids=['simulationProgress','simulationCount'],nodes=ids.map(id=>document.getElementById(id)),original=nodes.map(n=>n.textContent);
   const bounds=()=>['.canvas-tools','#simulationPanel','#canvasHost'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [r.top+scrollY,r.height];});
   const before=bounds();for(const [text,count] of [['','0 格修改'],['保留上次概率 · 正在更新 · 可继续放置 · 100%','28680 格修改'],['Previous probabilities shown · Updating map artwork · You can keep placing','28680 cells edited'],['Calculation failed · Previous probabilities and edits kept; click Recalculate to retry','1 cell edited']]){nodes[0].textContent=text;nodes[1].textContent=count;if(JSON.stringify(bounds())!==JSON.stringify(before))throw Error('Toolbar layout moved at '+width);}
   nodes.forEach((n,i)=>n.textContent=original[i]);return {width,stable:true,overflow:document.documentElement.scrollWidth>innerWidth};
  },width));
 }
 await p.setViewportSize({width:1900,height:1300});await p.locator('#minimap').uncheck();await p.locator('#baselineValues').check();await p.locator('#filter').selectOption('land');await p.locator('#blocked').check();
 // Pause publication, not painting. All stale-result states can be inspected deterministically.
 await p.evaluate(toy=>{const provider=toy?CrateMapPlatform:CrateLocalAPI,name=toy?'simulate':'json',original=provider[name];window.releasePublication=null;window.presentationGate=new Promise(r=>window.releasePublication=r);provider[name]=async function(...args){if(toy||args[0]==='/api/maps/simulation')await presentationGate;return original.apply(this,args);};window.restorePublication=()=>provider[name]=original;},toy);
 await p.locator('#map').scrollIntoViewIfNeeded();
 const point=await p.evaluate(()=>{
  const v=CrateMapViewer,m=v.simulation.model,c=m.source.cells.find(c=>c.level===0&&m.placement('MTNK',c.x,c.y).allowed&&[-2,-1,0,1,2].every(dx=>[-2,-1,0,1,2].every(dy=>v.state.lookup.get(`${c.x+dx},${c.y+dy}`)?.primary)));
  if(!c)throw Error('No safe tank cell');window.editPoint=[c.x,c.y];const tile=v.state.lookup.get(editPoint.join(','));v.state.scale=1;v.state.x=v.area.x+v.area.w/2-tile.px;v.state.y=v.area.y+v.area.h/2-tile.py;v.draw();
  const canvas=document.getElementById('map'),r=canvas.getBoundingClientRect(),k=Math.min(r.width/v.viewport.width,r.height/v.viewport.height);window.previousData=v.state.data;window.previousVisible=v.state.visible;
  window.sampleFrame=()=>{const ctx=canvas.getContext('2d'),ratio=canvas.width/v.viewport.width;return Array.from(ctx.getImageData((v.area.x+50)*ratio,(v.area.y+50)*ratio,100*ratio,100*ratio).data).join(',');};window.previousPixels=sampleFrame();
  return{x:r.left+(r.width-v.viewport.width*k)/2+(v.state.x+tile.px)*k,y:r.top+(r.height-v.viewport.height*k)/2+(v.state.y+tile.py)*k};
 });
 await p.mouse.click(point.x,point.y);await p.waitForFunction(()=>CrateMapViewer.state.simulationPending);
 const pending=await p.evaluate(()=>{const v=CrateMapViewer;v.draw();return{dataSame:v.state.data===previousData,visible:v.state.visible,beforeVisible:previousVisible,pixelsSame:sampleFrame()===previousPixels,dirty:[...v.state.simulationDirtyCells],point:editPoint.join(','),spinner:!document.getElementById('mapBusy').hidden,stats:getComputedStyle(document.getElementById('stats')).visibility,details:getComputedStyle(document.getElementById('cellInfo')).visibility,filter:document.getElementById('filter').value};});
 assert(pending.dataSame&&pending.pixelsSame&&pending.spinner);assert.equal(pending.visible,pending.beforeVisible);assert(pending.visible>0);assert.deepEqual(pending.dirty,[pending.point]);assert.equal(pending.stats,'visible');assert.equal(pending.details,'visible');assert.equal(pending.filter,'land');
 await p.locator('#canvasHost').screenshot({path:path.join(qa,edition+'-pending-map.png')});await p.locator('.canvas-tools').screenshot({path:path.join(qa,edition+'-stable-toolbar.png')});
 await p.evaluate(()=>{releasePublication();restorePublication();});
 if(!toy){await p.waitForFunction(()=>!CrateMapViewer.state.simulationPending&&CrateMapViewer.simulation.pending,null,{timeout:60000});assert(await p.locator('#mapBusy').isVisible());assert.equal(await p.evaluate(()=>CrateMapViewer.state.simulationDirtyCells.size),0);}
 await ready();assert(await p.locator('#mapBusy').isHidden());
 await p.locator('#simulationUndo').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),0);
 await p.locator('#simulationRedo').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),1);
 if(!toy){
  // Resource checks and failed result reloads use the same indicator and settle.
  let release;const gate=new Promise(r=>release=r);await p.route('**/api/resources',async route=>{await gate;await route.continue();});await p.locator('#resourcesOpen').click();await p.waitForFunction(()=>!document.getElementById('mapBusy').hidden);release();await p.waitForFunction(()=>document.getElementById('mapBusy').hidden);await p.locator('#resourceCancel').click();await p.unroute('**/api/resources');
  await p.evaluate(()=>{window.reloadProbe=CrateMapViewer.loadResult('/output/presentation-missing/result.json').catch(()=>{});});await p.evaluate(()=>reloadProbe);assert(await p.locator('#mapBusy').isHidden());
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,edition+'-presentation.json'),JSON.stringify({status:'PASS',off,on,layouts,pending,undoRedo:true,spinnerLifecycle:true},null,2));console.log('PASS',edition,'stable toolbar, retained probability/details, local marks, spinner lifecycle and undo/redo');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
