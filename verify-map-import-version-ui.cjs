/* A previously opened RA2 map must not select RA2 resources for a YRM upload. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',file=process.env.SIM_MAP;
if(!file)throw Error('Set SIM_MAP to the YRM regression map');
const expected=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),out=path.resolve('output/map-import-version-qa');
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},locale:'zh-CN'}),errors=[];p.on('pageerror',error=>errors.push(error.stack));
 await p.route('**/map-import-version.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n{const create=CrateMapImportVersion.create;CrateMapImportVersion.create=(...args)=>window.importVersionQA=create(...args);}'});});
 if(!toy)await p.route('**/api/resources',async route=>{const response=await route.fetch(),value=await response.json();value.mod={configured:false,ready:false,root:''};await route.fulfill({response,json:value});});
 await p.goto(base+'maps.html?result='+(toy?'data/1557d2f6b8e380c95042-yr/ore/result.json.gz':'/output/map-f554bd7efa5b/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.locator('#loadHeck').click();await p.locator('#officialMapVersion').selectOption('ra2');await p.locator('#officialMapSearch').fill('mp26s6');await p.locator('.official-map-row').first().click();await p.locator('#officialMapAnalyze').click();
 await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.version==='ra2'&&!CrateMapViewer.state.busy,null,{timeout:180000});
 assert.equal(await p.locator('#version').inputValue(),'ra2');assert.equal(await p.evaluate(()=>importVersionQA.choice),'auto');
 const started=Date.now();await p.locator('#mapFile').setInputFiles(file);
 await p.waitForFunction(sha=>{const s=CrateMapViewer.state;return !s.busy&&s.data?.metadata.sourceSha256===sha&&s.data.metadata.version==='yr';},expected,{timeout:180000});
 const result=await p.evaluate(()=>{const s=CrateMapViewer.state,m=s.data.metadata;return {version:m.version,approximate:!!m.approximate,preview:!!m.previewOnly,issues:m.loadIssues,markers:s.data.markers.length,potential:s.data.potentialMarkers.length,markedCells:s.cells.filter(c=>c.marked).length,error:document.getElementById('error').textContent};});
 assert.equal(result.approximate,false);assert.equal(result.preview,false);assert.deepEqual(result.issues,[]);assert.equal(result.error,'');assert(result.markers>0);assert.equal(result.markers,result.markedCells);
 if(process.env.SIM_EXPECT_MARKERS)assert.equal(result.markers,Number(process.env.SIM_EXPECT_MARKERS));
 await p.locator('#viewMode').click();assert(await p.locator('#riskLists').isVisible());assert(await p.locator('#markers').isChecked());assert(await p.locator('#markerList button').count()>0);
 await p.locator('#mapAside').scrollIntoViewIfNeeded();await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+'.png')});
 result.uploadMs=Date.now()-started;assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,(toy?'toy':'full')+'.json'),JSON.stringify(result,null,2));
 console.log('PASS',toy?'Toy':'Full','official RA2 → YRM upload → YR exact analysis and risk list',JSON.stringify(result));
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
