/* A direct result URL and browser reload must unlock the persistent toolbars. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy';
const result=process.env.MODE_RESTORE_RESULT||'/output/map-b88b83c9702a/result.json';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  const ready=async()=>{
   await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
   await p.waitForFunction(()=>CrateMapViewer.simulation.model&&!document.getElementById('simulationPlaceTab').disabled,null,{timeout:60000});
  };
  const enabled=async()=>{
   assert.equal(await p.locator('#regionToolbar').evaluate(e=>e.inert),false);
   for(const id of ['regionToggle','simulationPlaceTab'])assert(await p.locator('#'+id).isEnabled(),id);
  };
  if(!toy){
   await p.goto(base+'maps.html');
   assert(await p.locator('#simulationPlaceTab').isDisabled());assert(await p.locator('#regionToggle').isDisabled());
  }
  await p.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent(result)));await ready();await enabled();
  assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),null);
  assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.active),false);
  assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),0);
  assert(await p.locator('#simulationMine').isEnabled());assert((await p.locator('#simulationObject option').count())>0);
  if(toy){
   await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');
   await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});
  }
  for(let i=0;i<2;i++){
   await enabled();await p.locator('#regionToggle').click({timeout:5000});
   assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'region');
   await p.locator('#viewMode').click();
   await p.locator('#simulationPlaceTab').click();
   await p.waitForFunction(()=>CrateMapViewer.simulation.active&&CrateMapViewer.simulation.model,null,{timeout:60000});
   assert(await p.locator('#simulationChoice').isEnabled());assert(await p.locator('#simulationMine').isEnabled());
   assert((await p.locator('#simulationObject option').count())>0);
   await p.locator('#viewMode').click();await enabled();
   await p.reload();await ready();
  }
  await p.evaluate(()=>{window.restorePrepared=CrateMapViewer.state.prepared;});
  await p.evaluate(async()=>{
   const good=restorePrepared,preview={...good,data:{...good.data,metadata:{...good.data.metadata,previewOnly:true}}};
   await CrateMapViewer.loadResult(good.url,false,{prepared:preview});
  });
  assert(await p.locator('#regionToggle').isDisabled());assert(await p.locator('#simulationPlaceTab').isDisabled());
  await p.evaluate(async()=>{await CrateMapViewer.loadResult(restorePrepared.url,false,{prepared:restorePrepared});});await ready();await enabled();
  await p.locator('#regionOperationHint').click({timeout:5000});assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'region');
  assert.deepEqual(errors,[]);
  const qa=path.resolve('output/mode-restore-qa');fs.mkdirSync(qa,{recursive:true});
  await p.locator('#editTools').screenshot({path:path.join(qa,toy?'toy.png':'full.png')});
  console.log('PASS',toy?'Toy':'Full','direct result, reload twice, mode buttons, child controls, preview gating and direct report replacement');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
