'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{chromium,devices}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
 try{for(const [name,url,mobile]of [
  ['desktop','http://127.0.0.1:8767/maps.html?result=/output/map-8b9caa6619a1/result.json',false],
  ['toy','http://127.0.0.1:8788/toy/crate-atlas/index.html',false],
  ['touch','http://127.0.0.1:8788/toy/crate-atlas/index.html',true]
 ]){
  const context=await browser.newContext(mobile?{...devices['iPhone 13'],locale:'zh-CN'}:{viewport:{width:1440,height:1000},locale:'zh-CN'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const ready=async()=>{await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});};
  await page.goto(url);await ready();await page.waitForFunction(()=>{const d=JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)||'null');return d?.autoHandled;},null,{timeout:120000});
  const sample=await page.evaluate(()=>{
   const R=CrateRegionStatistics,s=CrateMapViewer.state,valid=c=>c&&R.canSelect(c,s.data.rendering)&&c.surfaceVisibility===1&&c.cameraCoverage===1&&c.slope===0&&c.land===0;
   const a=s.cells.find(c=>valid(c)&&valid(s.lookup.get(`${c.x+1},${c.y}`))),b=s.lookup.get(`${a.x+1},${a.y}`),far=s.cells.find(c=>valid(c)&&Math.abs(c.x-a.x)+Math.abs(c.y-a.y)>20),d=R.defaults();
   d.autoHandled=true;d.active='r2';d.regions[0].cells=new Set([R.key(a),R.key(b),R.key(far)]);localStorage.setItem('crate-atlas.regions.v1.'+s.data.metadata.sourceSha256,R.encode(d));return {x:a.x,y:a.y,keys:[R.key(a),R.key(b)],far:R.key(far)};
  });
  await page.reload();await ready();await page.locator('#regionToggle').click();await page.locator('#regionTool').selectOption('fill');
  const labels=await page.locator('#regionTool option').allTextContents();assert.equal(labels.length,8);assert.ok(labels.every(s=>/^[▭▱▣◆○⬭▨⌾]/.test(s)));
  await page.evaluate(({x,y})=>{document.getElementById('minimap').checked=false;CrateMapViewer.focus(CrateMapViewer.state.lookup.get(`${x},${y}`));},sample);
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point=await page.evaluate(()=>{const v=CrateMapViewer,s=v.state,cv=document.getElementById('map'),r=cv.getBoundingClientRect(),dpr=cv.getContext('2d').getTransform().a;return{x:r.left+(s.x+s.selected.px*s.scale)*r.width/(cv.width/dpr),y:r.top+(s.y+s.selected.py*s.scale)*r.height/(cv.height/dpr)};});
  if(mobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>document.getElementById('regionActionStatus').textContent.includes('并入'));await page.waitForTimeout(450);
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)));
  const after=await read();assert.deepEqual(after.regions[1].cells.sort((a,b)=>a-b),sample.keys.sort((a,b)=>a-b));assert.deepEqual(after.regions[0].cells,[sample.far]);
  await page.locator('#regionUndo').click();await page.waitForTimeout(450);assert.equal((await read()).regions[1].cells.length,0);
  await page.locator('#regionRedo').click();await page.waitForTimeout(450);assert.equal((await read()).regions[1].cells.length,2);
  assert.deepEqual(errors,[]);results.push({name,connectedCells:2,isolatedCellPreserved:true,undoRedo:true,icons:labels.length});await context.close();
 }}finally{await browser.close();}
 await fs.mkdir('output/tile-art-qa',{recursive:true});await fs.writeFile('output/tile-art-qa/fill-ui.json',JSON.stringify(results,null,2));console.log('PASS',results);
})().catch(e=>{console.error(e);process.exitCode=1;});
