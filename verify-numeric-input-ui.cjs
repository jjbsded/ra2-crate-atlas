/* Native typing must preserve drafts and reach the actual renderer uncapped. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body.replace('create({host:document.body,','create({host:document.body,enabled:true,').replace('  return {load,beforeLoad:','  window.numericQA={settings:titleTuning.settings,refreshRegions:refreshNow};\n  return {load,beforeLoad:')});});
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy&&!CrateMapViewer.state.regionPending,null,{timeout:120000});
 const input=p.locator('#regionTitleMaxShrink');await input.fill('');await input.pressSequentially('75.25');assert.equal(await input.inputValue(),'75.25');assert.equal(await p.evaluate(()=>numericQA.settings.maxShrink),.7525);
 await input.fill('');await p.evaluate(()=>numericQA.refreshRegions());assert.equal(await input.inputValue(),'');assert.equal(await p.evaluate(()=>numericQA.settings.maxShrink),.7525);await input.fill('20');
 for(const[id,text,key,value]of [['regionTitleInsetWidth','150','insetWidth',1.5],['regionTitleInsetHeight','0.5','insetHeight',.005],['regionTitleReturnMargin','40','returnMargin',.4],['regionTitleReturnVisible','120','returnVisible',1.2]]){
  const e=p.locator('#'+id);assert.equal(await e.getAttribute('max'),null);await e.fill(text);assert.equal(await e.inputValue(),text);assert.equal(await p.evaluate(key=>numericQA.settings[key],key),value);
 }
 await p.locator('#regionTitleInsetWidth').fill('-1');assert.equal(await p.locator('#regionTitleInsetWidth').inputValue(),'-1');assert.equal(await p.evaluate(()=>numericQA.settings.insetWidth),1.5);await p.locator('#regionTitleInsetWidth').blur();assert.equal(await p.locator('#regionTitleInsetWidth').inputValue(),'150');
 await p.locator('#regionTitleSizeTime').fill('20000.5');assert.equal(await p.evaluate(()=>numericQA.settings.sizeTime),20000.5);assert.equal(await p.locator('#regionTitleSizeTime').inputValue(),'20000.5');
 await p.locator('#regionTitleEdgeBand').fill('125.5');assert.equal(await p.evaluate(()=>numericQA.settings.edgeBand),1.255);assert.equal(await p.locator('#regionTitleEdgeBand').inputValue(),'125.5');
 await p.locator('#regionTitleMotionReset').click();
 assert.equal(await p.locator('#regionTitleSizeTime').inputValue(),'120');
 await p.evaluate(()=>{window.numericInitialData=CrateMapViewer.state.data;CrateMapViewer.paletteTuning.element.hidden=false;CrateMapViewer.displayTuning.element.hidden=false;});
 for(const[key,value]of [['labelMinRatio','200'],['labelStrokeRatio','250'],['opacityMax','150'],['baselineFactor','200'],['labelMix','150']]){const e=p.locator('#paletteTuning'+key);assert.equal(await e.getAttribute('max'),null);await e.fill(value);assert.equal(await e.inputValue(),value);}
 assert.deepEqual(await p.evaluate(()=>{const s=CrateProbability.paletteSettings();return [s.labelMinRatio,s.labelStrokeRatio,s.opacityMax,s.baselineFactor,s.labelMix,CrateProbability.labelSize(1),CrateProbability.labelStrokeWidth(20),CrateProbability.paletteOpacity(100,100)];}),[2,2.5,1.5,2,1.5,60,50,1.5]);
 await p.locator('#mapTuninglineWidth').fill('24');assert.equal(await p.evaluate(()=>CrateMapViewer.displayTuning.settings.lineWidth),24);assert((await p.evaluate(()=>CrateMapViewer.state.coordinateSpace.key)).includes('"lineWidth":24'));
 await p.evaluate(()=>{CrateMapViewer.paletteTuning.element.hidden=true;CrateMapViewer.displayTuning.element.hidden=true;});
 await p.locator('#regionToggle').click();await p.locator('#regionAutoSettings').evaluate(e=>e.open=true);
 await p.locator('#regionAutoSea').fill('123.5');await p.evaluate(()=>numericQA.refreshRegions());assert.equal(await p.locator('#regionAutoSea').inputValue(),'123.5','Background statistics must not replace the active draft');
 const overview=p.locator('#regionOverviewWidth');await overview.fill('');await overview.pressSequentially('150.5');assert.equal(await overview.inputValue(),'150.5','Linked image sizing must not remove decimal input');
 await overview.fill('2');await p.evaluate(()=>numericQA.refreshRegions());assert.equal(await overview.inputValue(),'2','Business ranges must not rewrite an incomplete draft');await overview.blur();assert.equal(await overview.inputValue(),'150.5');
 assert(await p.evaluate(()=>CrateMapViewer.state.data===numericInitialData));assert.deepEqual(errors,[]);
 fs.mkdirSync('output/numeric-input-qa',{recursive:true});fs.writeFileSync('output/numeric-input-qa/'+(toy?'toy':'full')+'.json',JSON.stringify({status:'PASS',drafts:true,rendererValuesUncapped:true,backgroundRefreshPreservesInputs:true},null,2));
 console.log('PASS',toy?'Toy':'Full','native draft/decimal/empty typing, no debug caps through renderer, linked image sizing and background refresh');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
