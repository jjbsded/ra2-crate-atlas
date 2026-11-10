/* Native Ctrl/persistent eyedropper routing on the user's actual large map. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[],requests=[];
 p.on('pageerror',e=>errors.push(e.stack));p.on('request',r=>{if(/simulation-(live|patch)|\/api\/maps\/simulation(?:\?|$)/.test(r.url()))requests.push(r.url());});
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch(),body=await response.text();
  const hook=`
  window.pickerRegions={active:()=>doc.active,sample:sampleRegion,setup(){
   cancelAuto(true);const model=CrateMapViewer.simulation.model,empty=[...eligible.values()].filter(c=>model.sample(c.x,c.y,{fallback:null})===null&&model.placement('MTNK',c.x,c.y).allowed);
   const first=empty[Math.floor(empty.length/3)],second=empty.find(c=>Math.abs(c.x-first.x)+Math.abs(c.y-first.y)>25),unit=empty.find(c=>Math.abs(c.x-first.x)+Math.abs(c.y-first.y)>15&&Math.abs(c.x-second.x)+Math.abs(c.y-second.y)>15);
   const next=R.defaults();next.autoHandled=true;next.overlap=true;next.regions[0].name='测试区域';next.regions[0].color='#18cbbb';next.regions[0].cells=new Set([R.key(first)]);next.regions[1].name='重叠区域';next.regions[1].cells=new Set([R.key(first)]);adoptDocument(next);refresh();
   const fixtures=[{name:'assigned',cell:first},{name:'empty',cell:second},{name:'placed',cell:unit}].map(p=>({...p,cell:{x:p.cell.x,y:p.cell.y}}));
   const found=new Set();for(const c of eligible.values()){const type=model.sample(c.x,c.y,{fallback:null});if(type&&!found.has(type)){found.add(type);fixtures.push({name:type,cell:{x:c.x,y:c.y},type});}}
   return fixtures;
  }};
 `;
  assert(body.includes('  return {load,beforeLoad:'));await route.fulfill({response,body:body.replace('  return {load,beforeLoad:',hook+'  return {load,beforeLoad:')});
 });
 await p.goto(base+(toy?'index.html':'maps.html?result='+(process.env.SIM_RESULT||'/output/map-22309489b5d3/result.json')));
 const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 await p.locator('#minimap').uncheck();await p.locator('#map').scrollIntoViewIfNeeded();
 assert.equal(await p.locator('#regionTitleTuning').count(),0);assert.equal(await p.evaluate(()=>typeof CrateRegionTitleControls),'object');
 assert.deepEqual(await p.evaluate(()=>{const{maxSpeed,acceleration}=CrateRegionLabelLayout.defaults;return{maxSpeed,acceleration};}),{maxSpeed:8000,acceleration:20000});
 const fixtures=await p.evaluate(()=>pickerRegions.setup()),assigned=fixtures.find(f=>f.name==='assigned'),empty=fixtures.find(f=>f.name==='empty'),placed=fixtures.find(f=>f.name==='placed');
 const state=()=>p.evaluate(()=>({mode:CrateMapViewer.state.editMode,active:pickerRegions.active(),type:document.getElementById('simulationObject').value,count:CrateMapViewer.simulation.model.count,plan:CrateMapViewer.simulation.model.plan}));
 const neutral=async()=>p.evaluate(()=>document.activeElement?.blur());
 const mode=async key=>{await neutral();await p.keyboard.press(key);await p.waitForFunction(mode=>CrateMapViewer.state.editMode===mode,key==='1'?'place':key==='3'?'region':null);if(key==='1')await p.waitForFunction(()=>CrateMapViewer.simulation.active);};
 const move=async fixture=>{await p.locator('#map').scrollIntoViewIfNeeded();const point=await p.evaluate(({x,y})=>{const v=CrateMapViewer,c=v.state.lookup.get(x+','+y),a=v.area,s=v.state;s.scale=1.2;s.x=a.x+a.w/2-c.px*s.scale;s.y=a.y+a.h/2-c.py*s.scale;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return [b.x+(a.x+a.w/2)*k,b.y+(a.y+a.h/2)*k];},fixture.cell);await p.mouse.move(...point);return point;};
 for(const [key,id,expected]of [['1','simulationPanel','place'],['2','viewToolbar',null],['3','regionToolbar','region']]){await mode(key);assert.equal((await state()).mode,expected);const mark=p.locator('#'+id+' .mode-shortcut');assert.equal(await mark.innerText(),key);const position=await mark.evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return {right:b.right-a.right,bottom:b.bottom-a.bottom};});assert(position.right<=8&&position.bottom<=5);}
 await mode('2');await p.locator('#gotoX').focus();await p.keyboard.press('1');assert.equal((await state()).mode,null,'Typing a number must not switch modes');await neutral();
 await move(empty);await p.keyboard.down('Control');assert(await p.locator('#simulationCursorMode').isVisible());await p.locator('#gotoX').focus();await p.keyboard.up('Control');assert(await p.locator('#simulationCursorMode').isHidden(),'Releasing Ctrl over an input must end the temporary picker');await neutral();
 const before=await state(),networkBefore=requests.length;
 // A genuine object match has priority in every mode, including View.
 const objects=fixtures.filter(f=>f.type);assert(objects.some(f=>f.type==='MTNK'));assert(objects.length>=4,JSON.stringify(fixtures));
 for(const fixture of objects){await mode('2');await move(fixture);await p.keyboard.down('Control');assert(await p.locator('#map').evaluate(e=>e.classList.contains('simulation-eyedropper')));assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),'object',JSON.stringify(fixture));assert.equal(await p.locator('#simulationCursorMode .simulation-choice-icon').count(),1);await p.mouse.click(...await move(fixture));await p.keyboard.up('Control');await p.waitForFunction(()=>CrateMapViewer.simulation.active);assert.equal((await state()).mode,'place');assert.equal((await state()).type,fixture.type);}
 await mode('1');await move(assigned);await p.keyboard.down('Control');assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),'region');assert((await p.locator('#simulationCursorMode').innerText()).includes('测试区域'));assert.equal(await p.locator('#simulationCursorMode .region-swatch').evaluate(e=>e.style.backgroundColor),'rgb(24, 203, 187)');await p.mouse.click(...await move(assigned));await p.keyboard.up('Control');assert.equal((await state()).mode,'region');assert.equal((await state()).active,'r1','Overlaps prefer the active region');
 await mode('2');await move(empty);await p.keyboard.down('Control');assert((await p.locator('#simulationCursorMode').innerText()).includes('消除区域'));assert.equal(await p.locator('#simulationCursorMode .simulation-choice-icon').count(),0);await p.mouse.click(...await move(empty));await p.keyboard.up('Control');assert.equal((await state()).mode,'region');assert.equal((await state()).active,'empty');
 // The permanent region picker uses the same object preview and routing.
 await p.locator('#regionEyedropper').click();const landUnit=objects.find(f=>f.type==='MTNK');await move(landUnit);assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),'object');await p.mouse.click(...await move(landUnit));await p.waitForFunction(()=>CrateMapViewer.simulation.active);assert.equal((await state()).type,'MTNK');
 await p.keyboard.press('Escape');assert.equal((await state()).mode,null);assert(await p.locator('#simulationCursorMode').isHidden());
 assert.deepEqual((await state()).plan,before.plan,'Sampling must not edit the map or enqueue a probability update');assert.equal(requests.length,networkBefore,'Mode switches and samples must not create simulation jobs');
 // Place a real simulated tank, then sample its footprint from View mode.
 await mode('1');await p.locator('#simulationChoice').click();await p.locator('#simulationChoices [data-type="MTNK"]').click();await p.mouse.click(...await move(placed));await p.waitForFunction(()=>CrateMapViewer.simulation.model.plan.placements.length===1);await mode('2');await move(placed);await p.keyboard.down('Control');assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),'object');await p.mouse.click(...await move(placed));await p.keyboard.up('Control');await p.waitForFunction(()=>CrateMapViewer.simulation.active);assert.equal((await state()).type,'MTNK');assert.equal((await state()).plan.placements.length,1);
 // The default-layout view samples original content rather than hidden edits.
 await p.locator('#simulationConsider').click();await p.waitForFunction(()=>!CrateMapViewer.state.busy&&!CrateMapViewer.simulation.considered);await mode('2');await move(placed);await p.keyboard.down('Control');assert.equal(await p.locator('#simulationCursorMode').getAttribute('data-sample'),'region');await p.keyboard.up('Control');
 await mode('3');await p.locator('#regionEyedropper').click();await p.keyboard.press('Escape');assert.equal((await state()).mode,null);assert.notEqual(await p.locator('#regionTool').inputValue(),'picker');
 // English pointer feedback includes the clear-region label.
 await p.evaluate(()=>CrateI18n.setLanguage('en'));await move(empty);await p.keyboard.down('Control');assert((await p.locator('#simulationCursorMode').innerText()).includes(await p.evaluate(()=>CrateI18n.t('消除区域'))));await p.keyboard.up('Control');
 const out=path.resolve('output/unified-eyedropper-qa');fs.mkdirSync(out,{recursive:true});await p.locator('#editTools').screenshot({path:path.join(out,toy?'toy.png':'full.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,toy?'toy.json':'full.json'),JSON.stringify({status:'PASS',objects:objects.map(f=>f.type),shortcuts:[1,2,3],samplesCreateJobs:false,defaultTitleMotion:{maxSpeed:8000,acceleration:20000}},null,2));console.log('PASS',toy?'Toy':'Full','unified object/region eyedropper, no edit jobs, view Ctrl, Esc, keyboard modes and defaults',objects.map(f=>f.type));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
