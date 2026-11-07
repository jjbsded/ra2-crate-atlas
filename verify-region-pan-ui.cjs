/* Real large-map partitions, native drags and cached/direct pixel comparisons. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
const file=process.env.REGION_PAN_MAP||'D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map';
const qa=path.resolve('output/region-wide-qa'),summary=a=>{const s=a.slice().sort((a,b)=>a-b);return Object.fromEntries([['p50',.5],['p95',.95],['max',1]].map(([k,p])=>[k,+s[Math.min(s.length-1,Math.floor(s.length*p))]?.toFixed(2)||0]));};
(async()=>{
 fs.mkdirSync(qa,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1700,height:1200},deviceScaleFactor:1.5}),errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  await page.addInitScript(()=>{window.panQA={record:false,frames:[],caches:[]};localStorage.setItem('crate-atlas.language.v1','zh-CN');});
  await page.route('**/region-overlay-cache.js*',async route=>{
   const response=await route.fetch(),body=await response.text();
   await route.fulfill({response,body:body+`\n{const create=CrateRegionOverlayCache.create;CrateRegionOverlayCache.create=(...args)=>{const cache=create(...args),render=cache.render;cache.render=(...args)=>{const start=performance.now(),value=render(...args);if(panQA.record)panQA.caches.push({...value,ms:performance.now()-start});return value;};return cache;};}`});
  });
  await page.route('**/region-statistics-ui.js*',async route=>{
   const response=await route.fetch(),body=await response.text(),needle='  return {load,beforeLoad:';assert(body.includes(needle));
   await route.fulfill({response,body:body.replace(needle,'  window.panRegions={render,snapshotLayer,selection:()=>R.encode(doc)};\n'+needle)});
  });
  await page.route('**/realmap-ui.js*',async route=>{
   const response=await route.fetch(),body=await response.text(),needle='  window.CrateMapViewer={state';assert(body.includes(needle));
   const hook=`
  const originalPanCrop=CrateMapArtwork.crop;CrateMapArtwork.crop=function(...args){const row=panQA.current;if(!row||panQA.measuringCrop)return originalPanCrop(...args);panQA.measuringCrop=true;const start=performance.now();try{return originalPanCrop(...args);}finally{row.artwork+=performance.now()-start;panQA.measuringCrop=false;}};
  const originalPanDraw=draw;draw=function(...args){if(!panQA.record||panQA.current)return originalPanDraw(...args);const start=performance.now(),row=panQA.current={at:start,artwork:0,x:state.x,y:state.y};try{return originalPanDraw(...args);}finally{row.ms=performance.now()-start;panQA.frames.push(row);panQA.current=null;}};\n`;
   await route.fulfill({response,body:body.replace(needle,hook+needle)});
  });
  await page.goto(base+(toy?'index.html':'maps.html'));
  if(toy)await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
  else await page.locator('#version').selectOption('directory');
  await page.locator('#mapFile').setInputFiles(file);
  await page.waitForFunction(name=>window.CrateMapViewer?.state.data?.metadata.filename===name&&!CrateMapViewer.state.busy,path.basename(file),{timeout:120000});
  await page.locator('#regionToggle').click();
  await page.waitForFunction(()=>document.getElementById('regionAutoStatus').textContent.includes('自动划分完成'),null,{timeout:120000});
  const counts=await page.evaluate(()=>JSON.parse(panRegions.selection()).regions.map(r=>r.cells.length));
  assert(Math.max(...counts)>20000,'Use the actual large partition, not synthetic equal-sized sectors');
  await page.locator('#viewMode').click();
  for(const id of ['regionColorOverlay','regionShowTotals'])if(await page.locator('#'+id).getAttribute('aria-pressed')!=='true')await page.locator('#'+id).click();
  const results=[];
  for(const fraction of [.6,.36]){
   await page.locator('#map').scrollIntoViewIfNeeded();
   const position=await page.evaluate(fraction=>{
    const v=CrateMapViewer,s=v.state,a=v.area,r=s.data.rendering;s.scale=a.w/(r.width*fraction);
    s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;s.selected=null;s.incoming=null;v.draw();
    const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;
    return [b.left+(a.x+a.w/2)*k,b.top+(a.y+a.h/2)*k];
   },fraction);
   await page.waitForTimeout(400);await page.mouse.move(...position);
   await page.evaluate(()=>{panQA.frames=[];panQA.caches=[];panQA.record=true;});
   await page.mouse.down({button:'right'});
   for(let i=1;i<=48;i++){
    await page.mouse.move(position[0]+Math.sin(i*Math.PI/12)*(fraction===.6?170:420),position[1]+Math.sin(i*Math.PI/9)*100);
    await page.waitForTimeout(12);
   }
   await page.mouse.up({button:'right'});await page.waitForTimeout(300);
   const raw=await page.evaluate(()=>{panQA.record=false;return {frames:panQA.frames,caches:panQA.caches};});
   const frames=raw.frames.filter((f,i)=>i&&(f.x!==raw.frames[i-1].x||f.y!==raw.frames[i-1].y));
   const row={fraction,frames:frames.length,draw:summary(frames.map(f=>f.ms)),artwork:summary(frames.map(f=>f.artwork)),remainingDraw:summary(frames.map(f=>f.ms-f.artwork)),region:summary(raw.caches.map(c=>c.ms)),cadence:summary(frames.slice(1).map((f,i)=>f.at-frames[i].at)),
    rasterizations:raw.caches.filter(c=>c.parts).length,wholeRebuilds:raw.caches.filter(c=>c.rebuilt).length};
   assert(frames.length>=40);assert(row.region.p95<20,JSON.stringify(row));
   // Toy synthesizes newly exposed terrain pixels in a separate painter.
   // Record that cost explicitly at higher zoom, where the base is cropped.
   if(toy&&fraction<.6)assert(row.remainingDraw.p95<50,JSON.stringify(row));
   else{assert(row.draw.p95<50,JSON.stringify(row));assert(row.cadence.p95<100,JSON.stringify(row));}
   if(fraction===.6)assert(row.rasterizations<=1,'Steady overview panning must reuse the region raster');
   results.push(row);
  }
  async function pixels(label){
   const delta=await page.evaluate(()=>{
    const v=CrateMapViewer,s=v.state,ratio=v.viewport.pixelRatio,images=[];s.navigating=false;
    for(const draw of [panRegions.render,panRegions.snapshotLayer()]){
     const cv=document.createElement('canvas');cv.width=v.viewport.width*ratio;cv.height=v.viewport.height*ratio;
     const ctx=cv.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);draw(ctx,s);images.push(ctx.getImageData(0,0,cv.width,cv.height).data);
    }
    let sum=0,large=0;for(let i=0;i<images[0].length;i++){const d=Math.abs(images[0][i]-images[1][i]);sum+=d;if(d>40)large++;}
    return {mean:sum/images[0].length,large:large/images[0].length};
   });
   assert(delta.mean<1.5&&delta.large<.02,label+': '+JSON.stringify(delta));return delta;
  }
  const checks={panned:await pixels('after edge-strip panning')};
  {
   await page.locator('#regionToggle').click();await page.locator('#regionTransparency').scrollIntoViewIfNeeded();
   const box=await page.locator('#regionTransparency').boundingBox(),start=Date.now();
   await page.evaluate(()=>{panQA.frames=[];panQA.caches=[];panQA.record=true;});
   await page.mouse.move(box.x+4,box.y+box.height/2);await page.mouse.down();
   for(let i=1;i<=24;i++){await page.mouse.move(box.x+4+(box.width-8)*i/24,box.y+box.height/2);await page.waitForTimeout(12);}
   await page.mouse.up();await page.waitForTimeout(300);
   const slider=await page.evaluate(()=>{panQA.record=false;return {frames:panQA.frames,caches:panQA.caches};});
   const recompositions=slider.caches.filter(c=>c.rebuilt).length;
   assert(recompositions<=2,'Dragging opacity must discard superseded states, not repeatedly rasterize: '+recompositions);
   checks.slider={elapsed:Date.now()-start,recompositions};
   await page.locator('#viewMode').click();
  }
  await page.locator('#regionToggle').click();
  await page.locator('#regionTransparency').evaluate(e=>{e.value='76';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#viewMode').click();checks.opacity=await pixels('transparency');
  const plan=await page.evaluate(()=>JSON.parse(panRegions.selection()));
  await page.locator('#regionToggle').click();await page.locator('#regionClear').click();await page.locator('#viewMode').click();checks.clear=await pixels('clear region');
  await page.locator('#regionToggle').click();await page.locator('#regionUndo').click();await page.locator('#viewMode').click();checks.undo=await pixels('undo region edit');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(panRegions.selection()).regions),plan.regions);
  await page.locator('#regionToggle').click();await page.locator('#regionRedo').click();await page.locator('#viewMode').click();checks.redo=await pixels('redo region edit');
  const region=plan.regions.find(r=>r.cells.length>20000);region.cells=region.cells.slice(0,1000);
  const fixture={mapSha256:await page.evaluate(()=>CrateMapViewer.state.data.metadata.sourceSha256),selection:plan};
  await page.locator('#regionToggle').click();
  await page.locator('#regionRestore').setInputFiles({name:'cache-replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForTimeout(150);await page.locator('#viewMode').click();checks.import=await pixels('replacement with matching revision numbers');
  assert.deepEqual(errors,[]);
  const report={map:path.basename(file),edition:toy?'Toy':'Full',dpr:1.5,counts,results,checks};
  fs.writeFileSync(path.join(qa,toy?'toy-regression.json':'full-regression.json'),JSON.stringify(report,null,2));
  console.log('PASS real large-region pan, transparency, clear, undo/redo, plan replacement and direct-render pixels',JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
