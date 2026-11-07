/* Terrain inspection must not wait for simulation artwork or report export. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let release;
 try{
  const page=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],requests=[];
  if(process.env.UI_LANG){
   await page.addInitScript(lang=>localStorage.setItem('crate-atlas.language.v1',lang),process.env.UI_LANG);
   await page.route('**/language-settings.js*',r=>r.fulfill({contentType:'text/javascript',body:'globalThis.CrateLanguageSettings='+JSON.stringify({saved:process.env.UI_LANG})+';'}));
  }
  page.on('pageerror',error=>errors.push(error.stack));
  const ready=()=>page.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
  const held=new Promise(resolve=>{release=resolve;});let paused=false;
  if(!toy){
   await page.route('**/api/maps/simulation-live/open',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"QA report fallback"}'}));
   await page.route('**/api/maps/simulation',async r=>{requests.push(r.request().postData());paused=true;await held;await r.continue();});
   await page.goto(base+'maps.html');assert(await page.locator('#terrain3dOpen').isDisabled());
  }
  await page.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/map-b88b83c9702a/result.json')));await ready();
  if(process.env.UI_LANG)assert.equal(await page.evaluate(()=>CrateI18n.language),process.env.UI_LANG);
  assert(await page.locator('#terrain3dOpen').isEnabled());
  const layouts=[];
  for(const width of [1900,1280,850,420]){
   await page.setViewportSize({width,height:1300});
   await page.waitForFunction(width=>innerWidth===width,width);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const rects=await page.evaluate(()=>['simulationPanel','viewToolbar','regionToolbar'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,w:r.width,h:r.height};}));
   if(width>1000){assert(Math.max(...rects.map(r=>r.h))-Math.min(...rects.map(r=>r.h))<1,JSON.stringify(rects));assert(Math.max(...rects.map(r=>r.y))-Math.min(...rects.map(r=>r.y))<1);}
   else assert(rects[2].y>=rects[1].y+rects[1].h,'Mobile tools should stack at their natural heights');
   layouts.push({width,rects});
  }
  await page.setViewportSize({width:1900,height:1300});
  if(!toy){
   await page.locator('#simulationPlaceTab').click();
   const point=await page.evaluate(()=>{const v=CrateMapViewer,m=v.simulation.model,c=v.state.cells.find(c=>m.placement('MTNK',c.x,c.y).allowed);v.focus(c);v.draw();return [c.x,c.y];});
   await page.locator('#map').scrollIntoViewIfNeeded();
   const pixel=await page.evaluate(([x,y])=>{const v=CrateMapViewer,c=v.state.lookup.get(`${x},${y}`),r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return [r.x+(v.state.x+c.px*v.state.scale)*k,r.y+(v.state.y+c.py*v.state.scale)*k];},point);
   await page.mouse.click(...pixel);await page.waitForFunction(()=>CrateMapViewer.simulation.waiting);
   const deadline=Date.now()+10000;while(!paused&&Date.now()<deadline)await page.waitForTimeout(20);assert(paused,'A real simulation report must be paused for this test');
   assert(await page.locator('#terrain3dOpen').isEnabled(),'Pending rendering must not disable 3D');
   await page.evaluate(([x,y])=>{const v=CrateMapViewer;v.focus(v.state.lookup.get(`${x},${y}`));v.simulation.sync();},point);
   assert(await page.locator('#terrain3dOpen').isEnabled(),'Selection during refresh must keep 3D enabled');
   assert(await page.locator('#mapImageExport').isDisabled(),'Report export still waits for a complete result');
  }
  await page.locator('#terrain3dRadius').evaluate(select=>{select.value='4';});
  await page.locator('#terrain3dOpen').click();
  await page.waitForFunction(()=>document.getElementById('terrain3dDialog').open&&!document.getElementById('terrain3dStage').classList.contains('is-loading'),null,{timeout:90000});
  assert.equal(await page.locator('#terrain3dError').textContent(),'');
  assert(await page.locator('#terrain3dLeft').isEnabled());await page.locator('#terrain3dLeft').click();
  if(!toy){assert.equal(requests.length,1,'Opening 3D must not start or await another full report');assert(await page.evaluate(()=>CrateMapViewer.simulation.waiting));}
  await page.locator('#terrain3dClose').click();
  await page.evaluate(()=>{const v=CrateMapViewer;v.state.busy=true;v.simulation.sync();});
  assert(await page.locator('#terrain3dOpen').isEnabled(),'Other map work must not disable loaded terrain inspection');
  await page.evaluate(()=>{CrateMapViewer.state.busy=false;CrateMapViewer.simulation.sync();});
  const out=path.resolve('output/terrain3d-refresh-qa');fs.mkdirSync(out,{recursive:true});
  await page.locator('#editTools').screenshot({path:path.join(out,toy?'toy.png':'full.png')});
  if(!toy){release();await page.waitForFunction(()=>!CrateMapViewer.simulation.waiting&&!CrateMapViewer.simulation.pending,null,{timeout:120000});assert(await page.locator('#terrain3dOpen').isEnabled());}
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,toy?'toy.json':'full.json'),JSON.stringify({status:'PASS',layouts,reportRequests:requests.length},null,2));
  console.log('PASS',toy?'Toy':'Full','3D access, terrain loading, refresh independence and aligned responsive toolbars');
 }finally{release?.();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
