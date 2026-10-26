/* Integration tests against a plain static server, including real touch input. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
const {create}=require('./toy/toy-platform.js');
async function adapterChecks(){
 const previousCodec=global.CrateStaticCodec;global.CrateStaticCodec=require('./toy/static-codec.js');
 const catalog={schemaVersion:1,precomputed:true,default:'fixture',maps:[{id:'fixture',variants:{yr:{reports:{ore:'data/map/ore/result.json.gz',clear:'data/map/clear/result.json.gz'}}}}]};
 const json={metadata:{mineralsEnabled:true}},base=new URL('https://example.test/toy/atlas/'),bytes=Buffer.from([0,1,127,255]);let requests=0;
 const fetch=async url=>{requests++;if(url.endsWith('catalog.json'))return Response.json(catalog);return new Response(zlib.gzipSync(url.endsWith('.bin.gz')?bytes:Buffer.from(JSON.stringify(json))));};
 const api=create({base,fetch,Worker:null});
 assert.equal(await api.initial(''),'data/map/ore/result.json.gz');
 assert.equal(await api.minerals('data/map/ore/result.json.gz',false),'data/map/clear/result.json.gz');
 assert.deepEqual(await api.readJSON(await api.initial('')),json);
 assert.deepEqual(Buffer.from(await api.readBinary('search.bin.gz')),bytes);
 await assert.rejects(api.initial('?result=%2Fapi%2Fmaps%2Fhealth'));
 await assert.rejects(api.initial('?result=https%3A%2F%2Fother.test%2Ffile'));
 await assert.rejects(api.official('missing','yr'));
 const abort=new AbortController();abort.abort();assert.throws(()=>api.readJSON('data/map/ore/result.json.gz',{signal:abort.signal}));
 const fallback=create({base,fetch,Worker:class{constructor(){throw Error('CSP');}}});
 assert.deepEqual(await fallback.readJSON('data/map/ore/result.json.gz'),json);
 const previousConfig=global.CrateWebConfig;global.CrateWebConfig={catalogVersion:'new-build'};
 try{
  let requested='';
  const updated=create({base,Worker:null,fetch:async url=>{requested=url;return Response.json(catalog);}});
  await updated.catalog();assert.equal(new URL(requested).searchParams.get('v'),'new-build','Updated Toy builds bypass the old catalog cache');
  await updated.readJSON('data/map/ore/result.json.gz');assert.equal(new URL(requested).searchParams.get('build'),'new-build','Stable report URLs must not reuse an earlier deployment');
 }finally{global.CrateWebConfig=previousConfig;}
 // Exercise the real compact payload through the Worker-blocked path too.
 if(process.env.TOY_CODEC_FIXTURE){
  const fixture=path.resolve(process.env.TOY_CODEC_FIXTURE),fixtureFetch=async url=>new Response(await fs.readFile(path.join(fixture,new URL(url).pathname.split('/').pop())));
  const compact=create({base,fetch:fixtureFetch,Worker:class{constructor(){throw Error('CSP');}}});
  assert.deepEqual(await compact.readJSON('result.json.gz'),JSON.parse(await fs.readFile(path.join(fixture,'original.json'))));
  assert.deepEqual(Buffer.from(await compact.readBinary('search.bin.gz')),await fs.readFile(path.join(fixture,'original.bin')));
 }
 global.CrateStaticCodec=previousCodec;
 console.log('PASS static adapter: catalog whitelist, paired layouts, gzip, binary, cancellation and worker fallback.');
}
async function browserChecks(){
 const {chromium,devices}=require('playwright');
 const browser=await chromium.launch({channel:process.env.TOY_BROWSER||'msedge',headless:true});
 try{
 const base=process.env.TOY_URL||'http://127.0.0.1:8788/toy/crate-atlas/index.html',out=path.resolve(process.env.TOY_QA_DIR||'output/toy-qa');await fs.mkdir(out,{recursive:true});
 const findings={};
 async function ready(page){await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!window.CrateMapViewer.state.busy,{timeout:60000});}
 async function point(page){return page.evaluate(()=>{const v=CrateMapViewer,c=document.getElementById('map'),r=c.getBoundingClientRect(),dpr=c.getContext('2d').getTransform().a;return{x:r.left+r.width*(v.area.x+v.area.w/2)/(c.width/dpr),y:r.top+r.height*(v.area.y+v.area.h/2)/(c.height/dpr)};});}
 for(const mobile of [false,true]){
  const label=mobile?'mobile':'desktop',context=await browser.newContext(mobile?{...devices['iPhone 13'],locale:'zh-CN'}:{viewport:{width:1440,height:1000},locale:'zh-CN'}),page=await context.newPage(),errors=[],apis=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname.includes('/api/'))apis.push(request.url());});
  await page.goto(base);await ready(page);
  await page.waitForFunction(()=>{const k='crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256;return JSON.parse(localStorage.getItem(k)||'null')?.autoHandled;});
  // Auto partition has its own integration suite. Begin these manual-brush
  // checks with an intentional empty saved selection, which must stay empty.
  await page.evaluate(()=>{const k='crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256,d=JSON.parse(localStorage.getItem(k));for(const r of d.regions)r.cells=[];d.autoHandled=true;localStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);
  assert.equal(await page.locator('#error').textContent(),'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No horizontal page overflow');
  assert.equal(await page.locator('#mapFile').isVisible(),false);
  assert.equal(await page.evaluate(()=>CrateMapViewer.state.data.metadata.mineralsEnabled),true);
  const originalTrees=await page.evaluate(()=>CrateMapViewer.state.cells.filter(c=>/^TREE\d+$/.test(c.terrain)).map(c=>`${c.x},${c.y}`));
  assert.ok(originalTrees.length>0,'The test map must exercise trees');
  await page.waitForFunction(()=>CrateMapViewer.state.incoming?.sources.length>0);
  const sources=await page.evaluate(()=>CrateMapViewer.state.incoming.sources.length);
  await page.locator('#map').scrollIntoViewIfNeeded();
  await page.locator('#canvasHost').screenshot({path:path.join(out,label+'-map.png')});
  await page.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.selected));
  await page.waitForFunction(()=>CrateMapViewer.state.incoming?.sources.length>0);
  await page.locator('#canvasHost').screenshot({path:path.join(out,label+'-sources.png')});
  if(mobile){
   assert.equal(await page.locator('#toyDisplaySettings').getAttribute('open'),null,'Mobile settings start collapsed');
   const cdp=await context.newCDPSession(page),r=await page.locator('#map').boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
   const before=await page.evaluate(()=>CrateMapViewer.state.scale);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-35,y,id:1},{x:x+35,y,id:2}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-70,y:y+10,id:1},{x:x+70,y:y+10,id:2}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok(await page.evaluate(()=>CrateMapViewer.state.scale)>before*1.5,'Pinch zoom changes map scale');
  }
  // An ordinary flat, eligible cell keeps brush samples away from cliffs.
  await page.evaluate(()=>{const c=CrateMapViewer.state.cells.find(c=>c.usable&&c.cameraCoverage===1&&c.slope===0&&c.land===0&&c.terms.length);CrateMapViewer.focus(c);});
  await page.locator('#regionToggle').click();
  await page.locator('#map').scrollIntoViewIfNeeded();
  let p=await point(page);
  if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);
  await page.waitForTimeout(450);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)));
  const count=saved.regions[0].cells.length;assert.ok(count>0,'Brush paints cells');
  await page.locator('#regionUndo').click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)).regions[0].cells.length),0);
  await page.locator('#regionRedo').click();await page.waitForTimeout(400);
  await page.locator('#regionRows .region-preview').first().screenshot({path:path.join(out,label+'-region-thumbnails.png')});
  if(mobile){
   await page.locator('#touchMode').click();await page.locator('#map').scrollIntoViewIfNeeded();p=await point(page);
   const xBefore=await page.evaluate(()=>CrateMapViewer.state.x),cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:5}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+40,y:p.y+20,id:5}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok(Math.abs(await page.evaluate(()=>CrateMapViewer.state.x)-xBefore)>20,'One-finger Pan moves map');
   await page.waitForTimeout(400);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)).regions[0].cells.length),count,'Pan does not paint');
   await page.locator('#touchMode').click();
   await page.locator('#map').scrollIntoViewIfNeeded();p=await point(page);
   // A second finger must roll back the in-progress brush before navigating.
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x-30,y:p.y,id:7}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x-30,y:p.y,id:7},{x:p.x+30,y:p.y,id:8}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x-45,y:p.y,id:7},{x:p.x+45,y:p.y,id:8}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(400);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)).regions[0].cells.length),count,'Pinch cancels unfinished brush without persisting it');
  }
  await page.locator('#mineralToggle').click();await page.waitForFunction(()=>CrateMapViewer.state.data.metadata.mineralsEnabled===false&&!CrateMapViewer.state.busy);
  assert.equal(await page.locator('#mineralToggle').textContent(),'矿石/树木:关');
  assert.equal(await page.evaluate(()=>CrateMapViewer.state.data.metadata.treesEnabled),false);
  assert.equal(await page.evaluate(()=>CrateMapViewer.state.cells.filter(c=>/^TREE\d+$/.test(c.terrain)).length),0);
  assert.ok(await page.evaluate(keys=>keys.some(k=>CrateMapViewer.state.lookup.get(k).probability>0),originalTrees),'Cleared tree cells can now receive crates');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)).regions[0].cells.length),count,'Ore switch retains regions');
  await page.locator('#mineralToggle').click();await page.waitForFunction(()=>CrateMapViewer.state.data.metadata.mineralsEnabled!==false&&!CrateMapViewer.state.busy);
  assert.deepEqual(await page.evaluate(()=>CrateMapViewer.state.cells.filter(c=>/^TREE\d+$/.test(c.terrain)).map(c=>`${c.x},${c.y}`)),originalTrees);
  await page.locator('#regionToggle').click();
  await page.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.lookup.get('99,105')));
  await page.waitForFunction(()=>CrateMapViewer.state.incoming?.sources.length>0);
  await page.reload();await ready(page);await page.locator('#regionToggle').click();
  assert.equal(await page.locator('#regionActiveText').textContent().then(s=>s.includes(String(count))),true,'Reload restores selection');
  await page.locator('#regionSort').selectOption('all.average');
  await page.locator('#map').scrollIntoViewIfNeeded();await page.locator('#canvasHost').screenshot({path:path.join(out,label+'-regions.png')});
  await page.locator('#screenshot').scrollIntoViewIfNeeded();
  const pngDownload=page.waitForEvent('download');await page.locator('#screenshot').click();const png=await pngDownload;await png.saveAs(path.join(out,label+'-view.png'));
  const jpegDownload=page.waitForEvent('download',{timeout:60000});await page.locator('#mapImageExport').click();const jpeg=await jpegDownload;await jpeg.saveAs(path.join(out,label+'-full.jpg'));
  assert.ok((await fs.stat(path.join(out,label+'-full.jpg'))).size>10000);
  assert.match(await page.locator('#mapImageStatus').textContent(),/已导出/);
  if(!await page.locator('#minimap').isChecked())await page.locator('#webNavigator').click();
  await page.locator('#minimapClose').waitFor({state:'visible'});
  await page.locator('#map').scrollIntoViewIfNeeded();await page.locator('#minimapClose').click();
  assert.equal(await page.locator('#webNavigator').getAttribute('aria-pressed'),'false');
  await page.locator('#loadHeck').click();
  const scope=await page.evaluate(async()=>{const c=await CrateMapPlatform.catalog();return {complete:c.scope?.completeModes,entries:c.maps.length};});
  if(scope.complete){
   assert.equal(scope.entries,131);
   assert.deepEqual(await page.locator('#officialMapMode option').evaluateAll(options=>options.map(option=>option.value)),['all','standard','teamgame']);
   await page.locator('#officialMapMode').selectOption('teamgame');assert.equal(await page.locator('.official-map-row').count(),25);
   await page.locator('#officialMapMode').selectOption('standard');assert.equal(await page.locator('.official-map-row').count(),106);
   findings.officialCatalog={battle:106,teamAlliance:25,otherModesExcluded:true};
  }
  await page.locator('#officialMapMode').selectOption('standard');await page.locator('#officialMapSearch').fill('沙丘巡礼');
  await page.locator('.official-map-row').click();await page.locator('#officialMapAnalyze').click();
  await page.waitForFunction(()=>CrateMapViewer.state.data.metadata.officialMap.id==='74d05e725c561b9d186e'&&!CrateMapViewer.state.busy);
  await page.goto(new URL('demo.html',base).href);await page.waitForFunction(()=>window.crateDemo?.trace);
  assert.equal(await page.locator('#exportAll').isVisible(),false);
  await page.locator('#next').click();
  const demoDownload=page.waitForEvent('download');await page.locator('#snapshot').click();await (await demoDownload).saveAs(path.join(out,label+'-demo.png'));
  // The static edition saves language locally, then reloads without POST.
  await page.locator('.language-select select,select[aria-label="界面语言"],#languageSelect').first().count().then(async count=>{
   if(!count){const selector=page.locator('nav.page-links select');await selector.selectOption('en');}
   else await page.locator('.language-select select,select[aria-label="界面语言"],#languageSelect').first().selectOption('en');
  });
  await page.waitForFunction(()=>document.documentElement.lang==='en');
  await page.goto(base);await ready(page);
  assert.match(await page.locator('h1').textContent(),/Official map/);
  if(mobile){
   await page.locator('#fit').click();
   const portrait=await page.evaluate(()=>({scale:CrateMapViewer.state.scale,width:document.getElementById('map').getBoundingClientRect().width}));
   await page.setViewportSize({width:844,height:390});
   await page.waitForFunction(()=>CrateMapViewer.area.w>700);
   const landscape=await page.evaluate(()=>{const v=CrateMapViewer,r=document.getElementById('map').getBoundingClientRect();return {scale:v.state.scale,fit:Math.min(v.area.w/v.state.data.rendering.width,v.area.h/v.state.data.rendering.height),width:r.width,height:r.height,viewport:innerHeight};});
   assert.ok(landscape.width>portrait.width*1.8,'Landscape uses the wider viewport');
   assert.ok(landscape.height>landscape.viewport*.85,'Landscape map occupies available height');
   assert.ok(Math.abs(landscape.scale/landscape.fit-1)<1e-5,'Fitted overview follows the new viewport');
   assert.ok(landscape.scale>portrait.scale*1.3,'Map artwork grows rather than retaining portrait size');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Landscape has no page overflow');
   await page.locator('#map').scrollIntoViewIfNeeded();await page.locator('#canvasHost').screenshot({path:path.join(out,'mobile-landscape.png')});
   await page.setViewportSize({width:390,height:664});await page.waitForFunction(()=>CrateMapViewer.area.w<500);
   await page.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.lookup.get('99,105')));
   const centered=await page.evaluate(()=>{const v=CrateMapViewer;return {scale:v.state.scale,x:(v.area.x+v.area.w/2-v.state.x)/v.state.scale,y:(v.area.y+v.area.h/2-v.state.y)/v.state.scale};});
   await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>CrateMapViewer.area.w>700);
   const rotated=await page.evaluate(()=>{const v=CrateMapViewer;return {scale:v.state.scale,x:(v.area.x+v.area.w/2-v.state.x)/v.state.scale,y:(v.area.y+v.area.h/2-v.state.y)/v.state.scale};});
   assert.deepEqual(rotated,centered,'Rotation preserves deliberate zoom and selected center');
   await page.locator('#fullscreen').click();
   await page.waitForFunction(()=>{const r=document.getElementById('map').getBoundingClientRect();return r.width>=innerWidth-4&&r.height>=innerHeight-4;});
   await page.locator('#exitFullscreen').click();
   findings.landscape={fitScaleRatio:landscape.scale/portrait.scale,viewportHeight:landscape.viewport,mapHeight:landscape.height,zoomPreserved:true,fullScreenFillsViewport:true};
  }
  assert.deepEqual(apis,[],'No local or remote analysis API requests');assert.deepEqual(errors,[],'No browser exceptions');
  findings[label]={sourceOrigins:sources,paintedCells:count,persistence:true,oreSwitch:true,PNG:true,JPEG:true,bilingual:true,noAnalysisAPI:true};
  await context.close();console.log('PASS '+label+' browser workflow.');
 }
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(findings,null,2));
 }finally{await browser.close();}
}
(async()=>{await adapterChecks();if(!process.argv.includes('--unit-only'))await browserChecks();})().catch(error=>{console.error(error);process.exitCode=1;});
