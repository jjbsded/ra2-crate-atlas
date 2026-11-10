/* Errors in one object must not lock risk display, 3D, editors or Buff work. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||(toy?'http://127.0.0.1:8789/toy/crate-atlas/':'http://127.0.0.1:8791/'),out=path.resolve('output/error-isolation-qa');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 if(process.env.SIM_FAIL_IMAGES==='1')await p.route('**/output/**',route=>/\.(png|webp|jpe?g)(\?|$)/i.test(route.request().url())?route.abort():route.continue());
 if(process.env.SIM_FAIL_ATLAS==='1')await p.route('**/original-artwork.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+"\nCrateToyOriginal.create=async()=>{throw Error('QA missing atlas');};"});});
 if(process.env.SIM_LEGACY_PREVIEW==='1'){
  let first=true;await p.route('**/output/error-isolation-missing-building/result.json',async route=>{if(new URL(route.request().url()).pathname!=='/output/error-isolation-missing-building/result.json')return route.continue();const response=await route.fetch();if(!first)return route.fulfill({response});first=false;const value=await response.json();value.metadata.previewOnly=true;delete value.metadata.riskPredictionVersion;value.probability=null;const headers=response.headers();delete headers['content-encoding'];delete headers['content-length'];await route.fulfill({status:200,headers,body:JSON.stringify(value)});});
 }
 await p.route('**/map-renderer.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+"\n{const create=CrateMapRenderer.createViewCache;CrateMapRenderer.createViewCache=(...args)=>{const cache=create(...args),render=cache.render;cache.render=(...args)=>{window.errorIsolationOptions=args[4];return render(...args);};return cache;};}"});});
 const importFull=!toy&&process.env.SIM_IMPORT==='1';
 await p.goto(base+(toy||importFull?'maps.html':'maps.html?result=/output/error-isolation-missing-building/result.json'));
 const ready=()=>p.waitForFunction(()=>{const v=window.CrateMapViewer,s=v?.state;return v?.simulation.model&&!s.busy&&!s.simulationPending&&!s.simulationWaiting&&!s.regionPending&&!s.unitBuffPending&&!v.simulation.computing;},null,{timeout:120000});
 if(!importFull)await ready();
 if(toy||importFull){await p.locator('#version').selectOption('yr');await p.locator('#mapFile').setInputFiles(path.join(out,'missing-building/source.map'));await p.waitForFunction(()=>window.CrateMapViewer?.state.data.metadata.filename==='source.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();}
 assert(await p.evaluate(()=>CrateMapViewer.state.data.metadata.approximate));assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.markers.length),4);
 await p.locator('#viewMode').click();assert(await p.locator('#riskLists').isVisible());assert(await p.locator('#rockDownload').isVisible());assert(await p.locator('#potentialDownload').isVisible());
 for(const id of ['regionToggle','simulationPlaceTab','probabilityToggle','regionAutoQuick','unitBuffRadius','heatmap'])assert(!(await p.locator('#'+id).isDisabled()),id+' should be usable');
 await p.evaluate(()=>CrateMapViewer.draw());assert.equal(await p.evaluate(()=>errorIsolationOptions.markers),true);
 await p.evaluate(()=>{const v=CrateMapViewer,[x,y]=v.state.data.markers[0];v.focus(v.state.lookup.get(x+','+y));});
 await p.locator('#terrain3dOpen').click();await p.waitForFunction(()=>!document.getElementById('terrain3dStage').classList.contains('is-loading'),null,{timeout:30000});
 assert.equal(await p.locator('#terrain3dError').textContent(),'');assert(!(await p.locator('#terrain3dCrate').isDisabled()));assert(!(await p.locator('#terrain3dMarkers').isDisabled()));
 await p.locator('#terrain3dCrate').click();assert.equal(await p.locator('#terrain3dCrate').getAttribute('aria-pressed'),'true');await p.locator('#terrain3dClose').click();
 const download=p.waitForEvent('download');await p.locator('#rockDownload').click();const csv=await download;await csv.saveAs(path.join(out,(toy?'toy':'full')+'-risks.csv'));assert(fs.readFileSync(path.join(out,(toy?'toy':'full')+'-risks.csv'),'utf8').includes('riskKnown'));
 await p.locator('#simulationPlaceTab').click();await p.locator('#minimap').uncheck();await p.locator('#simulationPlaceShape').selectOption('brush',{force:true});
 const point=await p.evaluate(()=>{const v=CrateMapViewer,m=v.simulation.model,c=v.state.cells.find(c=>c.usable&&c.riskKnown!==false&&!c.marked&&m.placement('MTNK',c.x,c.y).allowed);if(!c)throw Error('No placement point');v.state.scale=1;v.state.x=v.area.x+v.area.w/2-c.px;v.state.y=v.area.y+v.area.h/2-c.py;v.draw();return {x:c.x,y:c.y};});
 await p.locator('#map').scrollIntoViewIfNeeded();const xy=await p.evaluate(point=>{const v=CrateMapViewer,r=document.getElementById('map').getBoundingClientRect(),c=v.state.lookup.get(point.x+','+point.y),k=r.width/v.viewport.width;return[r.x+(v.state.x+c.px*v.state.scale)*k,r.y+(v.state.y+c.py*v.state.scale)*k];},point);
 await p.mouse.click(...xy);assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),1);await ready();
 assert(await p.evaluate(point=>CrateMapViewer.state.lookup.get(point.x+','+point.y).occupied,point));
 await p.locator('#simulationUndo').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),0);assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.markers.length),4);
 await p.locator('#regionToggle').click();await ready();assert(await p.locator('#regionSummary').isVisible());assert(await p.evaluate(()=>CrateMapViewer.regionsActive));
 await p.locator('#viewMode').click();while(await p.locator('#probabilityToggle').getAttribute('data-mode')!=='buff')await p.locator('#probabilityToggle').click();
 await p.evaluate(()=>CrateMapViewer.buffExpectation.ready());assert((await p.evaluate(()=>CrateMapViewer.buffExpectation.status.cells))>0);
 await p.locator('#mapAside').scrollIntoViewIfNeeded();await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+'-aside.png')});
 assert.deepEqual(errors,[]);const result=await p.evaluate(()=>({approximate:CrateMapViewer.state.data.metadata.approximate,risks:CrateMapViewer.state.data.markers.length,buffCells:CrateMapViewer.buffExpectation.status.cells}));fs.writeFileSync(path.join(out,(toy?'toy':'full')+'-ui.json'),JSON.stringify(result,null,2));
 console.log('PASS',toy?'Toy':'Full','local unknown building: risk overlay/CSV, 3D prediction, placement/undo, regions and Buff',JSON.stringify(result));
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
