/* Coordinate tabs stay independent of map selection and overlay preferences. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',english=process.env.SIM_LANGUAGE==='en',base=process.env.SIM_BASE||(toy?'http://127.0.0.1:8789/toy/crate-atlas/':'http://127.0.0.1:8792/'),out=path.resolve('output/sidebar-tabs-qa');
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.route('**/language-settings.js*',route=>route.fulfill({contentType:'application/javascript',body:'globalThis.CrateLanguageSettings={saved:'+JSON.stringify(english?'en':'zh-CN')+'};'}));
 await p.addInitScript(lang=>localStorage.setItem('crate-atlas.language.v1',lang),english?'en':'zh-CN');
 await p.route('**/map-details.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n{const create=CrateMapDetails.create;CrateMapDetails.create=(...args)=>window.sidebarDetails=create(...args);}'});});
 await p.goto(base+(toy?'maps.html':'maps.html?result=/output/selection-contacts-map/result.json'));
 const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();
 if(toy){await p.locator('#version').selectOption('yr');await p.locator('#mapFile').setInputFiles(path.resolve('output/selection-contacts-qa/source.yrm'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='source.yrm'&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();}
 assert.equal(await p.locator('#seaLandToggle').getAttribute('type'),'checkbox');
 assert(await p.locator('#seaLandToggle').evaluate(e=>e.closest('label').previousElementSibling.contains(document.getElementById('markers'))));
 assert.equal(await p.locator('.map-header #seaLandToggle').count(),0);
 for(const [copy,source,tab]of [['blockedCellsOverlay','markers','blockedCellsTab'],['seaLandOverlay','seaLandToggle','seaLandCellsTab']]){
  assert(await p.locator('#'+copy).evaluate((input,id)=>{const frame=input.closest('.region-aside-layer-tab'),button=document.getElementById(id),a=input.getBoundingClientRect(),b=frame.getBoundingClientRect(),title=button.getBoundingClientRect();return frame.contains(button)&&!button.contains(input)&&a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom&&a.left>=title.right;},tab),'The checkbox is visually inside the tab frame, after its title');
  const before=await p.locator('#'+source).isChecked(),selected=await p.locator('[role=tab][aria-selected=true]').getAttribute('id');
  await p.locator('#'+copy).setChecked(!before);assert.equal(await p.locator('#'+source).isChecked(),!before);assert.equal(await p.locator('[role=tab][aria-selected=true]').getAttribute('id'),selected,'A checkbox click does not select its tab');
  await p.locator('#'+source).setChecked(before);assert.equal(await p.locator('#'+copy).isChecked(),before);
  await p.locator('#'+source).setChecked(!before);assert.equal(await p.locator('#'+copy).isChecked(),!before);
  await p.locator('#'+copy).setChecked(before);assert.equal(await p.locator('#'+source).isChecked(),before);
 }
 for(const mode of ['viewMode','simulationPlaceTab','regionToggle']){
  await p.locator('#'+mode).click();await p.locator('#blockedCellsTab').click();assert(await p.locator('#riskLists').isVisible());assert(await p.locator('#cellAside').isHidden());assert(await p.locator('#seaLandLists').isHidden());
  await p.locator('#regionDetailsTab').click();assert(await p.locator(mode==='viewMode'?'#cellAside':mode==='simulationPlaceTab'?'#placementRegionDetails':'#regionEditor').isVisible());
 }
 await p.locator('#viewMode').click();await p.locator('#minimap').uncheck();await p.locator('#seaLandToggle').uncheck();await p.locator('#seaLandCellsTab').click();
 await p.waitForFunction(()=>CrateMapViewer.seaLand.result&&!CrateMapViewer.seaLand.status.pending);assert(!(await p.locator('#seaLandToggle').isChecked()),'Inspecting coordinates does not enable their overlay');assert.equal(await p.evaluate(()=>CrateMapViewer.seaLand.enabled),false);
 const contact=await p.evaluate(()=>CrateMapViewer.seaLand.result.land[0]);assert(contact,'Fixture has land–water contacts');assert(await p.locator('#seaLandList button').count());
 await p.locator('#blockedCellsTab').click();await p.locator('#markers').uncheck();
 await p.locator('#map').scrollIntoViewIfNeeded();const point=await p.evaluate(([x,y])=>{const v=CrateMapViewer,s=v.state,c=s.lookup.get(x+','+y),a=v.area;s.scale=1.4;s.x=a.x+a.w/2-c.px*s.scale;s.y=a.y+a.h/2-c.py*s.scale;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return[b.x+(a.x+a.w/2)*k,b.y+(a.y+a.h/2)*k];},contact);await p.mouse.click(...point);
 assert.equal(await p.locator('#blockedCellsTab').getAttribute('aria-selected'),'true');assert(!(await p.locator('#seaLandToggle').isChecked()));assert(!(await p.locator('#markers').isChecked()),'Selecting on the map leaves tabs and layers alone');
 await p.locator('#seaLandCellsTab').click();await p.waitForFunction(()=>CrateMapViewer.seaLand.result&&!CrateMapViewer.seaLand.status.pending);await p.locator('#seaLandList button').first().click();assert(await p.locator('#seaLandToggle').isChecked());assert(await p.locator('#seaLandOverlay').isChecked());assert.equal(await p.locator('#seaLandCellsTab').getAttribute('aria-selected'),'true');
 const selected=await p.locator('#seaLandList button.selected').getAttribute('data-key');assert.equal(await p.evaluate(()=>CrateMapViewer.state.selected.x+','+CrateMapViewer.state.selected.y),selected);
 await p.locator('#seaLandToggle').uncheck();assert(await p.locator('#seaLandList button').count(),'Turning the layer off retains the visible list');
 await p.locator('#blockedCellsTab').click();await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,data={...s.data,markers:s.cells.slice(0,500).map(c=>[c.x,c.y]),potentialMarkers:s.cells.slice(500,1000).map(c=>[c.x,c.y])};sidebarDetails.report({...s.prepared,data},v.display,{lookup:s.lookup,onFocus:v.focus});});
 for(const list of ['markerList','potentialList']){await p.locator('#markers').uncheck();await p.locator('#'+list+' button').first().click();assert(await p.locator('#markers').isChecked(),list+' enables the shared blocked-cell overlay');assert(await p.locator('#blockedCellsOverlay').isChecked());assert.equal(await p.locator('#blockedCellsTab').getAttribute('aria-selected'),'true');}
 await p.locator('#regionDetailsTab').click();assert(await p.locator('#cellAside').isVisible());assert(await p.locator('#riskLists').isHidden());assert(await p.locator('#seaLandLists').isHidden());
 // Roving tab keys stay within the sidebar and do not move the selected cell.
 const key=await p.evaluate(()=>CrateMapViewer.state.selected.x+','+CrateMapViewer.state.selected.y);await p.locator('#regionDetailsTab').focus();await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#blockedCellsTab').getAttribute('aria-selected'),'true');assert.equal(await p.evaluate(()=>CrateMapViewer.state.selected.x+','+CrateMapViewer.state.selected.y),key);
 await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+(english?'-en':'-zh')+'.png')});
 await p.setViewportSize({width:440,height:850});await p.locator('#mapAside').scrollIntoViewIfNeeded();await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(100);
 assert(await p.locator('#mapAside').evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert(await p.locator('#regionAsideTabs').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+(english?'-en':'-zh')+'-mobile.png')});assert.deepEqual(errors,[]);
 console.log('PASS',toy?'Toy':'Full',english?'English':'Chinese','three-mode coordinate tabs, independent overlay checkbox, list-only auto-enable, map selection isolation, keyboard and mobile layout');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
