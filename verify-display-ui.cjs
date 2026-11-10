/* Real browser regression: physical pixels, hit targets, defaults and layers. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const base=process.env.DISPLAY_BASE||'http://127.0.0.1:8793/',result=process.env.DISPLAY_RESULT;
const out=process.env.DISPLAY_QA||'output/display-verification-20261103';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),summary=[];
 try{for(const dpr of [1,1.25,1.5,2]){
  const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:dpr,locale:'zh-CN'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{let api;Object.defineProperty(window,'CrateMapRenderer',{configurable:true,get:()=>api,set(value){api=value;const create=value.createViewCache;value.createViewCache=(...args)=>{const cache=create(...args),render=cache.render;cache.render=function(...a){const result=render.apply(this,a);if(a[0].canvas.id==='map')window.qaMapRender={options:{...a[4]},colored:result.colored};return result;};return cache;};}});});
  await page.goto(base+'maps.html?result='+encodeURIComponent(result));
  await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
  for(const id of ['grid','blocked'])assert.equal(await page.locator('#'+id).isChecked(),false,id);
  assert.equal(await page.locator('#potentialMarkers').count(),0);
  assert.equal(await page.locator('#baselineLayer').isChecked(),false);
  assert.equal(await page.evaluate(()=>document.getElementById('baselineLayer').closest('label').nextElementSibling.contains(document.getElementById('baselineValues'))),true,'1x layer precedes 1x labels');
  await page.locator('#map').scrollIntoViewIfNeeded();
  async function check(label){
   await page.waitForTimeout(150);
   const size=await page.evaluate(()=>{const c=document.getElementById('map'),r=c.getBoundingClientRect(),{width,height}=CrateMapViewer.viewport,scale=Math.min(r.width/width,r.height/height);return{width:c.width,height:c.height,expectedWidth:width*scale*devicePixelRatio,expectedHeight:height*scale*devicePixelRatio};});
   assert.ok(Math.abs(size.width-size.expectedWidth)<=1&&Math.abs(size.height-size.expectedHeight)<=1,JSON.stringify(size));
   const hits=await page.evaluate(()=>['minimapMinimize','minimapClose'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect(),x=r.x+r.width/2;return{id,center:document.elementFromPoint(x,r.y+r.height/2)?.id,below:[2,20,60,100].map(y=>document.elementFromPoint(x,r.bottom+y)?.id)};}));
   for(const h of hits){assert.equal(h.center,h.id);assert.ok(h.below.every(id=>id!==h.id),JSON.stringify(h));}
   summary.push({dpr,label,size,hits});
  }
  await check('window');
  if(dpr===1){
   const before=await page.evaluate(()=>({width:document.getElementById('map').width,view:[CrateMapViewer.state.x,CrateMapViewer.state.y,CrateMapViewer.state.scale]})),cdp=await context.newCDPSession(page);
   for(const next of [2,1.25,1]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:next,mobile:false});
    await page.waitForFunction(({width,next})=>Math.abs(document.getElementById('map').width-width*next)<=1,{width:before.width,next});
    assert.deepEqual(await page.evaluate(()=>[CrateMapViewer.state.x,CrateMapViewer.state.y,CrateMapViewer.state.scale]),before.view,'DPR changes preserve the map view');await check('DPR transition '+next);
   }
  }
  for(const enabled of [false,true]){
   await page.locator('#markers').setChecked(enabled);
   await page.waitForFunction(value=>qaMapRender.options.markers===value&&qaMapRender.options.potentialMarkers===value,enabled);
  }
  await page.locator('#baselineLayer').check();await page.waitForFunction(()=>qaMapRender.options.baselineLayer);
  const withBaseline=await page.evaluate(()=>qaMapRender.colored);
  await page.locator('#baselineLayer').uncheck();await page.waitForFunction(()=>!qaMapRender.options.baselineLayer);
  assert.ok(await page.evaluate(n=>qaMapRender.colored<n,withBaseline),'Actual 1x checkbox hides baseline fills');
  await page.locator('#baselineLayer').check();await page.waitForFunction(()=>qaMapRender.options.baselineLayer);
  await page.locator('#minimapMinimize').click();await page.locator('#navCenter').waitFor({state:'hidden'});
  await page.locator('#minimapMinimize').click();await page.locator('#navCenter').waitFor({state:'visible'});
  await page.locator('#fullscreen').click();await check('fullscreen');
  await page.locator('#minimapClose').click();await page.locator('#minimapMinimize').waitFor({state:'hidden'});
  await page.locator('#minimapToggle').click();await page.locator('#minimapMinimize').waitFor({state:'visible'});
  if(dpr===2)await page.screenshot({path:path.join(out,'fullscreen-dpi200.png')});
  await page.locator('#exitFullscreen').click();
  const layers=await page.evaluate(()=>{
   const v=CrateMapViewer,s={...v.state,selected:null,scale:1,x:0,y:0},c=document.createElement('canvas');c.width=1600;c.height=1050;const ctx=c.getContext('2d'),area={x:0,y:0,w:1600,h:1050};
   const baseline=s.cells.find(c=>v.display.get(c).isBaseline&&CrateMapRenderer.surface(c).length);if(!baseline)throw Error('Missing baseline fixture');s.x=800-baseline.px;s.y=500-baseline.py;
   const cache=CrateMapRenderer.createViewCache(),opts={heatmap:true,baselineLayer:true,filter:'all',palette:'warm',opacity:45};
   const a=cache.render(ctx,s,area,v.display,opts);opts.baselineLayer=false;const b=cache.render(ctx,s,area,v.display,opts);opts.heatmap=false;const off=cache.render(ctx,s,area,v.display,opts);
   return{a,b,off};
  });
  assert.ok(layers.b.colored<layers.a.colored&&layers.b.cacheRebuilt);assert.equal(layers.off.colored,0);
  const pixels=await page.evaluate(()=>{const source=document.createElement('canvas');source.width=source.height=2;const s=source.getContext('2d');s.fillStyle='#000';s.fillRect(0,0,2,2);s.fillStyle='#fff';s.fillRect(0,0,1,1);s.fillRect(1,1,1,1);const target=document.createElement('canvas');target.width=target.height=16;const c=target.getContext('2d');c.scale(2,2);CrateMapArtwork.draw(c,source,0,0,8,8);return [...new Set(c.getImageData(0,0,16,16).data)];});
  assert.deepEqual(pixels.sort((a,b)=>a-b),[0,255],'Magnified art must not invent interpolated colors');
  await page.locator('#baselineLayer').check();await page.locator('#probabilityToggle').click({button:'right'});assert.equal(await page.locator('#heatmap').isChecked(),false);
  assert.equal(await page.locator('#baselineLayer').isChecked(),true,'Master preserves layer preference');
  await page.waitForFunction(()=>!qaMapRender.options.heatmap&&qaMapRender.colored===0);
  assert.deepEqual(errors,[]);await context.close();
 }
 fs.writeFileSync(path.join(out,'ui.json'),JSON.stringify({status:'PASS',summary},null,2));console.log('PASS: four DPI scales, live DPR transitions, fullscreen, exact button hits, defaults, coupled markers and actual baseline/master controls.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
