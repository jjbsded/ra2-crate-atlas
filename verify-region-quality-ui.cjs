/* Actual map: synchronized toolbar chooser and retained zoom-out detail. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',dir=path.resolve('output/region-quality-qa');fs.mkdirSync(dir,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:2}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.addInitScript(()=>window.qualityQA={});
 await p.route('**/region-overlay-cache.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body+`\n{const create=CrateRegionOverlayCache.create;CrateRegionOverlayCache.create=(...args)=>{const cache=create(...args),render=cache.render;cache.render=(...args)=>{const result=render(...args);qualityQA.region=result;return result;};return cache;};}`});});
 await p.route('**/realmap-ui.js*',async route=>{const response=await route.fetch(),body=await response.text(),needle='  window.CrateMapViewer={state';assert(body.includes(needle));const hook=`
  qualityQA.capture=()=>{
   const opts={...mapOptions(),navigation:true,values:false,coords:false,players:false},width=Math.round(W*pixelRatio),height=Math.round(H*pixelRatio),images=[];
   const original=CrateRasterRefinement.composite,exactRegion=regions.snapshotLayer();
   const stats={};
   try{for(const layer of ['base','region'])for(const source of ['detail','overview','exact']){
    const image=document.createElement('canvas');image.width=width;image.height=height;const target=image.getContext('2d');target.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    CrateRasterRefinement.composite=source==='overview'?(ctx,a,r,ratio,background)=>{background();return false;}:original;
    if(layer==='base'){target.fillStyle='#101c25';target.fillRect(0,0,W,H);stats[source]=source==='exact'?CrateMapRenderer.render(target,state,area,display,opts):mapViewCache.render(target,state,area,display,opts);}
    else {if(source==='exact')exactRegion(target,state);else {regions.render(target,state);stats['region'+source]=qualityQA.region;}}
    const core={x:area.x+area.w*.3,y:area.y+area.h*.3,w:area.w*.4,h:area.h*.4};
    images.push({layer,source,image,pixels:target.getImageData(Math.round(core.x*pixelRatio),Math.round(core.y*pixelRatio),Math.round(core.w*pixelRatio),Math.round(core.h*pixelRatio)).data});
   }}finally{CrateRasterRefinement.composite=original;}
   const errors={};for(const layer of ['base','region']){const reference=images.find(i=>i.layer===layer&&i.source==='exact').pixels;for(const source of ['detail','overview']){const actual=images.find(i=>i.layer===layer&&i.source===source).pixels;let sum=0;for(let i=0;i<actual.length;i++)sum+=Math.abs(actual[i]-reference[i]);errors[layer+source]=sum/actual.length;}}
   return {errors,stats,previews:images.filter(i=>i.layer==='base'&&i.source!=='exact').map(i=>({source:i.source,png:i.image.toDataURL()}))};
  };
 `;await route.fulfill({response,body:body.replace(needle,hook+needle)});});
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 await p.waitForFunction(()=>document.getElementById('regionAutoStatus').textContent.includes('自动划分完成')&&!CrateMapViewer.state.regionPending,null,{timeout:120000});
 const quick=p.locator('#regionToolbarActive'),menu=p.locator('#regionToolbarOptions');assert(await quick.isVisible());
 await quick.click();assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'region');await p.waitForTimeout(250);assert(await menu.isVisible(),'Entering Region mode must not close the newly opened chooser');
 const options=menu.locator('button'),count=await options.count();assert(count>10);assert.equal(await options.last().innerText(),'新增+');
 assert.equal(await menu.locator('.region-swatch').count(),count-1);await p.locator('#regionToolbar').screenshot({path:path.join(dir,(toy?'toy':'full')+'-menu.png')});
 const previous=await quick.evaluate(e=>e.value);await options.last().click();await p.waitForFunction(n=>document.querySelectorAll('#regionToolbarOptions button').length===n,count+1);const created=await quick.evaluate(e=>e.value);assert.notEqual(created,previous);assert.equal(await p.locator('#regionActive').evaluate(e=>e.value),created);
 await p.locator('#regionUndo').click();await p.waitForFunction(id=>document.getElementById('regionToolbarActive').value===id,previous);await p.locator('#regionRedo').click();await p.waitForFunction(id=>document.getElementById('regionToolbarActive').value===id,created);
 const height=await p.locator('#regionToolbar').evaluate(e=>e.getBoundingClientRect().height);
 const name='这是一个很长的自定义区域名称'.repeat(5);await p.locator('#regionName').fill(name);await p.locator('#regionName').blur();await p.locator('#regionColor').evaluate(e=>{e.value='#18cbbb';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});
 await p.waitForFunction(()=>document.getElementById('regionToolbarActiveSwatch').style.backgroundColor==='rgb(24, 203, 187)');assert.equal(await p.locator('#regionToolbarActiveText').innerText(),name.slice(0,48));assert.equal(await p.locator('#regionToolbar').evaluate(e=>e.getBoundingClientRect().height),height,'Long names must not change toolbar height');
 await quick.click();await menu.locator('[value="empty"]').click();await p.waitForFunction(()=>document.getElementById('regionToolbarActive').value==='empty');assert.equal(await p.locator('#regionToolbarActiveText').innerText(),'消除区域');
 // Keyboard creation and Esc must leave focus on a visible mode control.
 await quick.press('End');assert(await menu.isVisible());assert.equal(await p.evaluate(()=>document.activeElement.textContent),'新增+');await p.keyboard.press('Enter');await p.waitForFunction(n=>document.querySelectorAll('#regionToolbarOptions button').length===n,count+2);
 await quick.press('ArrowDown');await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),null);assert.equal(await p.evaluate(()=>document.activeElement.id),'viewMode');await p.keyboard.press('3');assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'region');
 await p.locator('#viewMode').click();for(const id of ['regionColorOverlay','regionShowTotals'])if(await p.locator('#'+id).getAttribute('aria-pressed')!=='true')await p.locator('#'+id).click();await p.locator('#minimap').uncheck();await p.locator('#map').scrollIntoViewIfNeeded();
 const point=await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,a=v.area,r=s.data.rendering;s.scale=a.w/(r.width*.3);s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;s.selected=s.incoming=null;s.navigating=false;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return[b.x+(a.x+a.w/2)*k,b.y+(a.y+a.h/2)*k];});await p.mouse.move(...point);await p.waitForTimeout(2200);
 for(const fraction of [.34,.38,.43]){const delta=await p.evaluate(f=>{const v=CrateMapViewer;return -Math.log((v.area.w/(v.state.data.rendering.width*f))/v.state.scale)/.0015;},fraction);await p.mouse.wheel(0,delta);await p.waitForTimeout(20);}
 const capture=await p.evaluate(()=>qualityQA.capture());assert(capture.stats.detail.mixedDetail&&capture.stats.regiondetail.mixedDetail,JSON.stringify(capture.stats));assert(capture.errors.basedetail<capture.errors.baseoverview*.9,JSON.stringify(capture.errors));assert(capture.errors.regiondetail<capture.errors.regionoverview*.8,JSON.stringify(capture.errors));
 for(const image of capture.previews)fs.writeFileSync(path.join(dir,(toy?'toy':'full')+'-'+image.source+'.png'),Buffer.from(image.png.split(',')[1],'base64'));delete capture.previews;
 await p.setViewportSize({width:390,height:900});await p.locator('#regionToolbar').scrollIntoViewIfNeeded();await p.locator('#regionToolbar').screenshot({path:path.join(dir,(toy?'toy':'full')+'-mobile.png')});
 await p.evaluate(()=>CrateI18n.setLanguage('en'));await p.locator('#regionToggle').click();await p.locator('#regionAdd').click();await p.waitForFunction(()=>document.querySelector('#regionToolbarOptions button:last-child').textContent==='New+');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,toy?'toy.json':'full.json'),JSON.stringify({status:'PASS',chooser:{newLast:true,synchronized:true,undoRedo:true,stableHeight:true,keyboard:true},quality:capture},null,2));console.log('PASS',toy?'Toy':'Full','toolbar chooser, creation, name/color sync, undo/redo, keyboard/mobile and retained detail',capture.errors);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
