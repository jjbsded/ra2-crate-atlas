const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE,toy=process.env.SIM_EDITION==='toy',qa=path.resolve('output/availability-20261104');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1400,height:950}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>globalThis.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:180000});
 const wait=async f=>{await page.waitForFunction(f,null,{timeout:180000});await ready();assert.equal(await page.locator('#error').textContent(),'');};
 const cases=toy?['unknown','stock']:['unknown','stock','directory'];
 if(!toy){await page.goto(base+'maps.html');await page.waitForLoadState('networkidle');assert(await page.locator('#simulationPlaceTab').isDisabled());assert.match(await page.locator('#simulationPlaceTab').getAttribute('title'),/请先加载/);assert.equal(await page.locator('#simulationPlaceTab').evaluate(el=>getComputedStyle(el).cursor),'not-allowed');}
 for(const name of cases){
  const approximate=name!=='stock';
  await page.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/availability-'+name+'-20261104/result.json')));await ready();
  if(toy){await page.locator('#mapFile').setInputFiles(path.join(qa,name==='stock'?'user.map':'unknown.map'));await page.waitForFunction(n=>CrateMapViewer.state.data.metadata.filename===n&&!CrateMapViewer.state.busy,name==='stock'?'user.map':'unknown.map',{timeout:180000});}
  assert.equal(await page.evaluate(()=>!!CrateMapViewer.state.data.metadata.approximate),approximate);
  assert.equal(await page.locator('#simulationPlaceTab').isDisabled(),false);
  assert.equal(await page.locator('#simulationPlaceTab').evaluate(el=>getComputedStyle(el).cursor),'pointer');
  assert.match(await page.locator('#simulationPlaceTab').getAttribute('title'),approximate?/近似/:/模拟放置/);
  if(toy&&name==='stock')assert.deepEqual(await page.evaluate(()=>CrateMapViewer.state.data.rendering.hybrid.missing.filter(s=>/TREE(29|3[0-5])/.test(s))),[]);
  await page.locator('#simulationPlaceTab').click();await page.waitForFunction(()=>CrateMapViewer.simulation.model&&!document.getElementById('simulationPanel').hidden);
  assert.equal(await page.locator('#simulationUndo').evaluate(el=>getComputedStyle(el).cursor),'not-allowed');
  await page.evaluate(()=>{const m=CrateMapViewer.simulation.model,c=m.source.cells.find(c=>m.placement('MTNK',c.x,c.y).allowed);if(!c||!m.place('MTNK',c.x,c.y))throw Error('No valid placement');window.testPoint=[c.x,c.y];});
  await page.locator('#recompute').click();
  assert.equal(await page.locator('#simulationPlaceTab').evaluate(el=>getComputedStyle(el).cursor),'wait');
  assert.match(await page.locator('#simulationPlaceTab').getAttribute('title'),/正在/);
  await wait(()=>CrateMapViewer.state.data.metadata.simulationPlan?.placements.length===1&&!CrateMapViewer.state.busy);
  assert.equal(await page.evaluate(()=>!!CrateMapViewer.state.data.metadata.approximate),approximate);
  assert(await page.evaluate(()=>CrateMapViewer.state.lookup.get(testPoint.join(',')).occupied));
  await page.locator('#simulationConsider').click();await wait(()=>!CrateMapViewer.simulation.considered);
  assert(!(await page.evaluate(()=>CrateMapViewer.state.lookup.get(testPoint.join(',')).occupied)));
  await page.locator('#recompute').click();await ready();assert.equal(await page.evaluate(()=>!!CrateMapViewer.state.data.metadata.approximate),approximate);
  await page.locator('#simulationConsider').click();await wait(()=>CrateMapViewer.simulation.considered&&CrateMapViewer.state.lookup.get(testPoint.join(',')).occupied);
  await page.locator('#simulationUndo').click();await wait(()=>!CrateMapViewer.simulation.model.count&&!CrateMapViewer.state.busy);
  assert.equal(await page.evaluate(()=>!!CrateMapViewer.state.data.metadata.approximate),approximate);
  await page.screenshot({path:path.join(qa,(toy?'toy':'full')+'-'+name+'.png')});
  console.log('PASS',toy?'toy':'full',name,'enabled/cursor/title/place/recompute/toggle/undo');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,(toy?'toy':'full')+'-ui.json'),JSON.stringify({status:'PASS',cases,errors},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
