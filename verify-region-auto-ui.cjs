'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium,devices}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),out=path.resolve('output/region-auto-qa');await fs.mkdir(out,{recursive:true});const results=[];
 try{
 for(const [name,url,mobile]of [
  ['desktop',process.env.DESKTOP_URL||'http://127.0.0.1:8767/maps.html?result=/output/map-8b9caa6619a1/result.json',false],
  ['toy',process.env.TOY_URL||'http://127.0.0.1:8787/toy/crate-atlas/index.html',false],
  ['toy-mobile',process.env.TOY_URL||'http://127.0.0.1:8787/toy/crate-atlas/index.html',true]
 ]){
  const context=await browser.newContext(mobile?{...devices['iPhone 13'],locale:'zh-CN'}:{viewport:{width:1440,height:1000},locale:'zh-CN'}),page=await context.newPage(),errors=[],apis=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))apis.push(r.url());});
  await page.goto(url);await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});
  assert.equal(await page.locator('#regionAutoStraight').inputValue(),'40');
  assert.equal(await page.locator('#regionAutoPath').inputValue(),'70');
  await page.waitForFunction(()=>{const s=CrateMapViewer.state,d=JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+s.data.metadata.sourceSha256)||'null');return d?.autoHandled&&d.regions.some(r=>r.cells.length);},null,{timeout:120000});
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)));
  const initial=await read(),players=await page.evaluate(()=>CratePlayerStarts.positions(CrateMapViewer.state));
  const water=initial.regions.filter(r=>r.generatedName?.kind==='water');
  assert.ok(initial.regions.filter(r=>!r.cells.length&&!r.generatedName).length>=2,'At least two unused regions remain');
  for(const r of water){assert.equal(r.name,'水域'+r.id.slice(1));assert.ok(r.cells.length>35);}
  if(process.env.EXPECT_WATER)assert.ok(water.length>0,'This sea map must allocate standalone water areas');
  assert.equal(initial.autoOptions.maxSea,0);assert.equal(initial.autoOptions.maxStraight,40);assert.equal(initial.autoOptions.maxPath,70);assert.equal(initial.autoOptions.exclusive,true);
  assert.deepEqual(initial.regions.slice(0,players.length).map(r=>r.generatedName?.number),players.map(p=>p.number));
  await page.locator('#regionToggle').click();
  await page.locator('#regionAutoSettings').evaluate(e=>e.open=true);
  assert.equal(await page.locator('#regionShowTotals').isChecked(),true);
  await page.evaluate(()=>{window.__labelOps=[];const original=CanvasRenderingContext2D.prototype.strokeText;CanvasRenderingContext2D.prototype.strokeText=function(text,...args){if(this.canvas.id==='map'&&String(text).endsWith('%'))__labelOps.push({font:this.font,color:this.strokeStyle,width:this.lineWidth,text});return original.call(this,text,...args);};CrateMapViewer.draw();});
  const labels=await page.evaluate(()=>__labelOps.filter(x=>x.color==='#050a0b'));
  assert.ok(labels.length>=players.length,'Region labels render on the main map');
  const ratio=await page.evaluate(()=>{const a=__labelOps.filter(x=>x.color==='#050a0b')[0],scale=CrateMapViewer.state.scale;return {font:parseFloat(a.font.split(' ')[1]),scale};});
  await page.locator('#zoomIn').click();
  await page.evaluate(()=>{__labelOps=[];CrateMapViewer.draw();});
  const zoom=await page.evaluate(()=>({font:parseFloat(__labelOps.find(x=>x.color==='#050a0b').font.split(' ')[1]),scale:CrateMapViewer.state.scale}));
  assert.ok(Math.abs(zoom.font/ratio.font-zoom.scale/ratio.scale)<1e-4,'Label fonts follow map zoom (CSS font serialization rounds decimals)');
  await page.locator('#map').scrollIntoViewIfNeeded();await page.locator('#canvasHost').screenshot({path:path.join(out,name+'-totals.png')});
  await page.locator('#regionAutoExclusive').uncheck();await page.locator('#regionAutoStraight').fill('12');await page.locator('#regionAutoStraight').dispatchEvent('change');await page.locator('#regionAutoPath').fill('20');await page.locator('#regionAutoPath').dispatchEvent('change');
  await page.waitForTimeout(450);const before=await read();
  await page.locator('#regionAutoRun').click();await page.waitForFunction(()=>!document.getElementById('regionAutoFields').disabled&&document.getElementById('regionAutoStatus').textContent.includes('可撤销'),null,{timeout:120000});
  const after=await read();assert.notDeepEqual(after.regions.map(r=>r.cells),before.regions.map(r=>r.cells),'Manual distance limits change memberships');
  assert.ok(after.regions.filter(r=>!r.cells.length&&!r.generatedName).length>=2);
  await page.locator('#regionUndo').click();await page.waitForTimeout(450);assert.deepEqual((await read()).regions,before.regions);
  await page.locator('#regionRedo').click();await page.waitForTimeout(450);assert.deepEqual((await read()).regions,after.regions);
  await page.locator('#mineralToggle').click();await page.waitForFunction(()=>CrateMapViewer.state.data.metadata.mineralsEnabled===false&&!CrateMapViewer.state.busy,null,{timeout:120000});assert.deepEqual((await read()).regions,after.regions,'Ore switching preserves memberships');
  await page.locator('#regionAutoSettings').evaluate(e=>e.open=false);
  const download=page.waitForEvent('download');await page.locator('#mapImageExport').click();await(await download).saveAs(path.join(out,name+'-full.jpg'));
  await page.reload();await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});await page.waitForTimeout(500);assert.deepEqual((await read()).regions,after.regions,'Saved regions are restored, not regenerated');
  if(name!=='desktop'){assert.match(await page.title(),/低清简化版.*非完整版/);assert.match(await page.locator('h1').textContent(),/低清简化版/);assert.match(await page.locator('.app-header p').first().textContent(),/非完整版/);assert.deepEqual(apis,[]);}
  // An intentional empty selection stays empty on the next load.
  await page.evaluate(()=>{const key='crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256,d=JSON.parse(localStorage.getItem(key));for(const r of d.regions)r.cells=[];d.autoHandled=true;localStorage.setItem(key,JSON.stringify(d));});
  await page.reload();await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});await page.waitForTimeout(500);assert.ok((await read()).regions.every(r=>!r.cells.length));
  assert.deepEqual(errors,[]);results.push({name,players:players.length,assigned:initial.regions.reduce((n,r)=>n+r.cells.length,0),automatic:true,manual:true,undoRedo:true,persistence:true,oreSwitch:true,labels:true,export:true});
  await context.close();console.log('PASS',name,'automatic partition / labels / editing / persistence / export');
 }
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

