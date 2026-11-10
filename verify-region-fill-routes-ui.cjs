/* Native browser events exercise fill/history and invalid-cell eyedroppers in both editions. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||(toy?'http://127.0.0.1:8789/toy/crate-atlas/':'http://127.0.0.1:8792/'),out=path.resolve('output/region-fill-routes-qa');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],jobs=[];
 p.on('pageerror',e=>errors.push(e.stack));p.on('request',r=>{if(/simulation-(live|patch)|\/api\/maps\/simulation(?:\?|$)/.test(r.url()))jobs.push(r.url());});
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch(),body=await response.text(),hook=`
  window.fillQA={active:()=>doc.active,read:()=>doc.regions[0].cells.size,keys:()=>[...doc.regions[0].cells],setup(kind){
   cancelAuto(true);cancel();const s=state(),next=R.defaults();next.autoHandled=true;next.active='r1';
   const chain=Array.from({length:5},(_,i)=>lookup.get((18+i)*1024+18));if(chain.some(c=>!c||!eligible.has(R.key(c))))throw Error('Missing fill test chain');
   const masks=kind==='blocked'?[17,5,4,2,17]:[17,5,17,2,17],bits=new Uint8Array(s.data.cells.length);
   chain.forEach((c,i)=>bits[s.data.cells.findIndex(q=>q.x===c.x&&q.y===c.y)]=masks[i]);navigationCache.set(s.data,{version:4,count:s.data.cells.length,flags:bits});
   if(kind==='assigned'||kind==='blocked')next.regions[1].cells=new Set(chain.map(R.key));
   adoptDocument(next);history=[];future=[];editHistory?.clear('regions');refresh();schedule();return chain.map(c=>({x:c.x,y:c.y}));
  },invalid(kind){const s=state();return kind==='top'?s.cells.find(c=>c.visibleBand):s.cells.find(c=>!R.canSelect(c,s.data.rendering));},sample:sampleRegion,async cancelFill(){
   const c=lookup.get(18*1024+18),s=state(),work=fill({point:{x:s.x+c.px*s.scale,y:s.y+c.py*s.scale},remove:false});activate('r2');await work;return {count:doc.regions[0].cells.size,status:$('regionActionStatus').textContent};
  }};
 `;assert(body.includes('  return {load,beforeLoad:'));await route.fulfill({response,body:body.replace('  return {load,beforeLoad:',hook+'  return {load,beforeLoad:')});});
 await p.goto(base+'maps.html'+(toy?'':'?result=/output/selection-contacts-map/result.json'));
 const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();
 if(toy){await p.locator('#version').selectOption('yr');await p.locator('#mapFile').setInputFiles(path.resolve('output/selection-contacts-qa/source.yrm'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='source.yrm'&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();}
 assert(!(await p.locator('#selectionTuning').isVisible()));assert.deepEqual(await p.evaluate(()=>CrateMapViewer.selectionTuning.settings),{badgeOpacity:.85,badgeNearOpacity:0,badgeFadeEnabled:true,badgeFadeRadius:25,badgeGap:20,badgeAvoidance:0});
 await p.locator('#minimap').uncheck();await p.locator('#map').scrollIntoViewIfNeeded();
 const mode=async key=>{await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press(key);};
 const move=async cell=>{await p.locator('#map').scrollIntoViewIfNeeded();const point=await p.evaluate(c=>{
  const v=CrateMapViewer,s=v.state,a=v.area,cell=c&&s.lookup.get(c.x+','+c.y),world=cell||{px:-2000,py:-2000};s.scale=1.4;s.x=a.x+a.w/2-world.px*s.scale;s.y=a.y+a.h/2-world.py*s.scale;v.draw();
  const rect=document.getElementById('map').getBoundingClientRect(),k=rect.width/v.viewport.width;return [rect.x+(a.x+a.w/2)*k,rect.y+(a.y+a.h/2)*k];
 },cell);await p.mouse.move(...point);return point;};
 const result=[];
 for(const [kind,seed,count]of [['land',0,1],['land',1,3],['assigned',0,5],['blocked',0,2],['blocked',2,0]]){
  const chain=await p.evaluate(kind=>fillQA.setup(kind),kind);await mode('3');if(await p.locator('#regionColorOverlay').getAttribute('aria-pressed')!=='true')await p.locator('#regionColorOverlay').click();await p.locator('#regionTool').selectOption('fill');const point=await move(chain[seed]);
  await p.mouse.click(...point);await p.waitForFunction(()=>!document.getElementById('regionActionStatus').textContent.includes('正在填充'),null,{timeout:10000});await p.waitForTimeout(50);
  assert.equal(await p.evaluate(()=>fillQA.read()),count,kind+' seed '+seed);
  if(count){await p.locator('#regionUndo').click();await p.waitForFunction(()=>fillQA.read()===0);await p.locator('#regionRedo').click();await p.waitForFunction(n=>fillQA.read()===n,count);}
  result.push({kind,seed,count});
 }
 await p.evaluate(()=>fillQA.setup('land'));const cancelled=await p.evaluate(()=>fillQA.cancelFill());assert.equal(cancelled.count,0);assert(!cancelled.status.includes('正在填充'),'Cancelled fills cannot leave a stuck pending message');
 // Even a genuine object on an unselectable cell must be ignored by the picker.
 const invalid=await p.evaluate(()=>{const c=fillQA.invalid('top')||fillQA.invalid('camera');if(!c)throw Error('No invalid cell');return {x:c.x,y:c.y};});
 await p.evaluate(({x,y})=>{const model=CrateMapViewer.simulation.model,sample=model.sample;model.sample=function(cx,cy,...args){return cx===x&&cy===y?'MTNK':sample.call(this,cx,cy,...args);};},invalid);
 const before=await p.evaluate(()=>CrateMapViewer.simulation.model.plan),jobCount=jobs.length;
 for(const permanent of [false,true])for(const cell of [invalid,null]){
  await p.evaluate(()=>fillQA.setup('land'));await mode(permanent?'3':'2');if(permanent)await p.locator('#regionEyedropper').click();
  const point=await move(cell);if(!permanent)await p.keyboard.down('Control');
  await p.waitForFunction(()=>document.getElementById('simulationCursorMode').dataset.sample==='region');assert((await p.locator('#simulationCursorMode').innerText()).includes('消除区域'));
  await p.mouse.click(...point);if(!permanent)await p.keyboard.up('Control');
  assert.equal(await p.evaluate(()=>fillQA.active()),'empty');assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'region');
 }
 assert.deepEqual(await p.evaluate(()=>CrateMapViewer.simulation.model.plan),before);assert.equal(jobs.length,jobCount,'Filling and sampling cannot enqueue probability jobs');
 assert.deepEqual(errors,[]);await p.locator('#editTools').screenshot({path:path.join(out,(toy?'toy':'full')+'.png')});
 fs.writeFileSync(path.join(out,(toy?'toy':'full')+'.json'),JSON.stringify({edition:toy?'Toy':'Full',fill:result,invalidAndEmptyPickers:true,badgePanelHidden:true,noSimulationJobs:true},null,2));
 console.log('PASS',toy?'Toy':'Full',JSON.stringify(result),'undo/redo; invalid/empty Ctrl and persistent pickers; screenshot defaults; no probability jobs');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
