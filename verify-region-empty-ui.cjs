/* Actual desktop, static Toy and touch input for the Empty erase target. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{chromium,devices}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),out=path.resolve('output/region-empty-qa'),results=[];await fs.mkdir(out,{recursive:true});
 try{for(const [name,url,mobile,locale]of [
  ['desktop','http://127.0.0.1:8767/maps.html?result=/output/map-8b9caa6619a1/result.json',false,'zh-CN'],
  ['toy','http://127.0.0.1:8787/toy/crate-atlas/maps.html?result=data%2Ff1d9bb89e2eb07cdb7af-yr%2Fore%2Fresult.json.gz',false,'en-US'],
  ['toy-mobile','http://127.0.0.1:8787/toy/crate-atlas/maps.html?result=data%2Ff1d9bb89e2eb07cdb7af-yr%2Fore%2Fresult.json.gz',true,'zh-CN']]){
  const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},locale}),page=await context.newPage(),errors=[],apis=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))apis.push(r.url());});
  const ready=()=>page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)));
  const saved=()=>page.waitForTimeout(420);
  const choose=async value=>{await page.locator('#regionActive').click();await page.locator('#regionOptions [value="'+value+'"]').click();await saved();};
  const clickCell=async (cell,ctrl=false)=>{
   await page.evaluate(({x,y})=>{document.getElementById('minimap').checked=false;CrateMapViewer.focus(CrateMapViewer.state.lookup.get(`${x},${y}`));CrateMapViewer.draw();},cell);
   await page.locator('#map').scrollIntoViewIfNeeded();
   const p=await page.evaluate(()=>{const s=CrateMapViewer.state,cv=document.getElementById('map'),r=cv.getBoundingClientRect(),dpr=cv.getContext('2d').getTransform().a;return{x:r.left+(s.x+s.selected.px*s.scale)*r.width/(cv.width/dpr),y:r.top+(s.y+s.selected.py*s.scale)*r.height/(cv.height/dpr)};});
   if(ctrl)await page.keyboard.down('Control');
   try{if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);}finally{if(ctrl)await page.keyboard.up('Control');}
   await saved();
  };
  await page.goto(url);await ready();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)||'null')?.autoHandled,null,{timeout:120000});
  const sample=await page.evaluate(()=>{
   const R=CrateRegionStatistics,s=CrateMapViewer.state,valid=c=>R.canSelect(c,s.data.rendering)&&c.surfaceVisibility===1&&c.cameraCoverage===1&&c.slope===0&&c.land===0&&!c.occupied;
   const a=s.cells.find(valid),b=s.cells.find(c=>valid(c)&&Math.hypot(c.x-a.x,c.y-a.y)>20),d=R.defaults();
   d.autoHandled=true;d.overlap=true;d.regions[0].cells.add(R.key(a));d.regions[2].cells.add(R.key(a));d.regions[1].cells.add(R.key(b));
   localStorage.setItem('crate-atlas.regions.v1.'+s.data.metadata.sourceSha256,R.encode(d));return{a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},ka:R.key(a),kb:R.key(b)};
  });
  await page.reload();await ready();await page.locator('#regionToggle').click();
  await page.locator('#regionTool').selectOption('brush-game');await page.locator('#regionWidth').fill('1');await page.locator('#regionHeight').fill('1');
  await choose('empty');assert.equal((await read()).active,'empty');assert.equal(await page.locator('#regionOptions [role=option]').count(),13);assert.equal(await page.locator('#regionRows tr').count(),12);
  assert.match(await page.locator('#regionActiveText').textContent(),locale==='en-US'?/^Empty/:/^空/);
  for(const id of ['regionName','regionColor','regionDelete','regionClear','regionFocus'])assert.ok(await page.locator('#'+id).isDisabled());
  await page.locator('#regionOperation').selectOption('add');await clickCell(sample.a);
  let erased=await read();assert.ok(erased.regions.every(r=>!r.cells.includes(sample.ka)));assert.ok(erased.regions[1].cells.includes(sample.kb));
  await page.locator('#regionUndo').click();await saved();assert.equal((await read()).regions.filter(r=>r.cells.includes(sample.ka)).length,2);
  await page.locator('#regionRedo').click();await saved();assert.deepEqual((await read()).regions,erased.regions);
  await page.locator('#regionUndo').click();await saved();await page.locator('#regionOperation').selectOption('remove');
  if(!mobile)await page.keyboard.down('Shift');await clickCell(sample.a);if(!mobile)await page.keyboard.up('Shift');
  assert.deepEqual((await read()).regions,erased.regions,'Empty erases all memberships even with Remove + Shift');
  await choose('r2');assert.ok(await page.locator('#regionName').isEnabled());
  if(mobile)await page.locator('#regionEyedropper').click();await clickCell(sample.a,!mobile);
  assert.equal((await read()).active,'empty');assert.equal(await page.locator('#regionTool').inputValue(),'brush-game');assert.deepEqual((await read()).regions,erased.regions,'Picking Empty does not edit memberships');
  await page.locator('#regionEditor').screenshot({path:path.join(out,name+'-empty.png')});
  await page.reload();await ready();assert.equal((await read()).active,'empty');assert.deepEqual((await read()).regions,erased.regions);
  if(name==='toy'){
   await page.locator('#mineralToggle').click();await page.waitForFunction(()=>!CrateMapViewer.state.busy&&CrateMapViewer.state.data.metadata.treesEnabled===false,null,{timeout:120000});
   assert.equal((await read()).active,'empty');assert.deepEqual((await read()).regions,erased.regions);
  }
  if(mobile){await page.locator('#regionToggle').click();await page.setViewportSize({width:844,height:390});await page.locator('#regionEditor').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#regionEditor').screenshot({path:path.join(out,'mobile-landscape-empty.png')});}
  assert.deepEqual(errors,[]);if(name.startsWith('toy'))assert.deepEqual(apis,[]);
  results.push({name,emptyErasesOverlaps:true,pickerRestoresTool:true,persists:true,undoRedo:true});await context.close();console.log('PASS Empty UI',name);
 }}finally{await browser.close();}
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
