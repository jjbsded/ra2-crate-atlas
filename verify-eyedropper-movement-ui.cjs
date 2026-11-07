/* Native pointer preview and click routing, using the real large-map rules. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',edition=toy?'toy':'full',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[],jobs=[];
 p.on('pageerror',e=>errors.push(e.stack));p.on('request',r=>{if(/simulation-(live|patch)|\/api\/maps\/simulation(?:\?|$)/.test(r.url()))jobs.push(r.url());});
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>window.CrateMapViewer?.state.data?.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.locator('#minimap').uncheck();await p.locator('#map').scrollIntoViewIfNeeded();
 const fixture=await p.evaluate(()=>{
  const v=CrateMapViewer,m=v.simulation.model,s=m.current(),c=v.state.cells.find(c=>c.usable&&c.surfaceVisibility===1&&c.cameraCoverage===1&&!s.occupants.has(c.x+','+c.y)&&s.cells.get(c.x+','+c.y)?.overlay===255);
  if(!c)throw Error('No empty visible fixture cell');
  const key=c.x+','+c.y,b=m.choices.find(o=>o.category==='STRUCTURES'),tree=m.choices.find(o=>o.tree),wall=m.choices.find(o=>o.wall),ore=m.choices.find(o=>o.ore);
  window.pickerMovementFixture={key,b,tree,wall,ore};
  v.state.scale=2;v.state.x=v.area.x+v.area.w/2-c.px*2;v.state.y=v.area.y+v.area.h/2-c.py*2;v.draw();
  const r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;
  return {x:r.x+(v.state.x+c.px*v.state.scale)*k,y:r.y+(v.state.y+c.py*v.state.scale)*k,building:b.type,tree:tree.type,wall:wall.type,ore:ore.type};
 });
 const cases=[
  {name:'Land infantry',objects:[['INFANTRY','E2']],target:'MTNK'},
  {name:'Land vehicle',objects:[['UNITS','HTNK']],target:'MTNK'},
  ...['TANY','GHOST','YURIPR','JUMPJET','LUNR'].map(type=>({name:type,objects:[['INFANTRY',type]],target:'YHVR'})),
  {name:'Naval infantry DNOB',objects:[['INFANTRY','DNOB']],target:'HYD'},
  {name:'Ship',objects:[['UNITS','HYD']],target:'HYD'},
  {name:'Amphibious vehicle',objects:[['UNITS','YHVR']],target:'YHVR'},
  {name:'Flying vehicle',objects:[['UNITS','SHAD']],target:'YHVR'},
  {name:'Aircraft',objects:[['AIRCRAFT','ORCA']],target:'YHVR'},
  {name:'Ore',objects:[],overlay:fixture.ore,target:fixture.ore},
  {name:'Tree over ore',objects:[['TERRAIN',fixture.tree]],overlay:fixture.ore,target:fixture.tree},
  {name:'Wall over tree',objects:[['TERRAIN',fixture.tree]],overlay:fixture.wall,target:fixture.wall},
  {name:'Building over wall',objects:[['TERRAIN',fixture.tree],['STRUCTURES',fixture.building]],overlay:fixture.wall,target:fixture.building},
  {name:'Unit over building',objects:[['STRUCTURES',fixture.building],['INFANTRY','E2']],overlay:fixture.wall,target:'MTNK'},
  {name:'Naval over land',objects:[['UNITS','HTNK'],['INFANTRY','DNOB']],target:'HYD'},
  {name:'Amphibious over naval',objects:[['INFANTRY','TANY'],['UNITS','HYD'],['UNITS','HTNK']],target:'YHVR'},
  {name:'Region fallback',objects:[],target:null}
 ];
 const before=await p.evaluate(()=>CrateMapViewer.simulation.model.plan),jobCount=jobs.length;
 for(const test of cases){
  await p.evaluate(test=>{
   const m=CrateMapViewer.simulation.model,s=m.current(),f=pickerMovementFixture,[x,y]=f.key.split(',').map(Number);
   s.occupants.set(f.key,test.objects.map(([category,type])=>({category,type,x,y,footprint:category==='STRUCTURES'?f.b.footprint:[[0,0]],tree:category==='TERRAIN'})));
   const types=Object.entries(m.source.rules.OVERLAYTYPES).sort((a,b)=>+a[0]-b[0]).map(([,name])=>name.toUpperCase());
   s.cells.get(f.key).overlay=test.overlay?types.indexOf(test.overlay):255;
   document.activeElement?.blur();
  },test);
  await p.keyboard.press('Escape');await p.mouse.move(fixture.x+2,fixture.y);await p.mouse.move(fixture.x,fixture.y);await p.keyboard.down('Control');
  await p.waitForFunction(()=>!document.getElementById('simulationCursorMode').hidden);
  assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),test.target?'object':'region',test.name);
  if(test.target){
   await p.waitForFunction(type=>!!document.querySelector('#simulationChoices [data-type="'+type+'"] img'),test.target);
   assert.equal(await p.locator('#simulationCursorMode img').getAttribute('src'),await p.locator('#simulationChoices [data-type="'+test.target+'"] img').getAttribute('src'),test.name+' preview');
  }
  await p.mouse.click(fixture.x,fixture.y);await p.keyboard.up('Control');
  await p.waitForFunction(expected=>CrateMapViewer.state.editMode===expected,test.target?'place':'region');
  if(test.target)assert.equal(await p.locator('#simulationObject').inputValue(),test.target,test.name+' selected');
 }
 // Persistent region-toolbar picker must share the same classification.
 await p.evaluate(()=>{const m=CrateMapViewer.simulation.model,f=pickerMovementFixture,[x,y]=f.key.split(',').map(Number);m.current().occupants.set(f.key,[{category:'INFANTRY',type:'DNOB',x,y,footprint:[[0,0]]}]);});
 await p.locator('#regionEyedropper').click();await p.locator('#map').scrollIntoViewIfNeeded();
 const persistentPoint=await p.evaluate(()=>{const v=CrateMapViewer,c=v.state.lookup.get(pickerMovementFixture.key),r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return{x:r.x+(v.state.x+c.px*v.state.scale)*k,y:r.y+(v.state.y+c.py*v.state.scale)*k};});
 await p.mouse.move(persistentPoint.x+2,persistentPoint.y);await p.mouse.move(persistentPoint.x,persistentPoint.y);
 assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),'object');await p.mouse.click(persistentPoint.x,persistentPoint.y);
 await p.waitForFunction(()=>CrateMapViewer.state.editMode==='place'&&document.getElementById('simulationObject').value==='HYD');
 assert.deepEqual(await p.evaluate(()=>CrateMapViewer.simulation.model.plan),before);assert.equal(jobs.length,jobCount,'Picking must not enqueue simulation work');assert.deepEqual(errors,[]);
 const out=path.resolve('output/eyedropper-movement-qa');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,edition+'.json'),JSON.stringify({status:'PASS',cases:cases.map(c=>({name:c.name,target:c.target})),persistentPicker:true,noEdits:true,noSimulationJobs:true,errors},null,2));
 console.log('PASS',edition,cases.length,'movement/priority pointer previews and native clicks, persistent picker, no edits or probability jobs');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
