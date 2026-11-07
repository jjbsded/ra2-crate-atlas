/* Native wheel input, configurable viewport bands and focused-to-wide sweeps. */
'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy';
const center=Number(process.env.ZOOM_CENTER)||.6,span=Number(process.env.ZOOM_SPAN)||.1,regionActive=!!process.env.REGION_ACTIVE;
const startFraction=Number(process.env.ZOOM_START)||center;
const summary=values=>{const a=values.slice().sort((a,b)=>a-b);return Object.fromEntries([['p50',.5],['p95',.95],['max',1]].map(([k,p])=>[k,+(a[Math.min(a.length-1,Math.floor(a.length*p))]||0).toFixed(2)]));};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:Number(process.env.ZOOM_DPR)||2}),errors=[],probabilityRequests=[];let recording=false;
  p.on('pageerror',e=>errors.push(e.stack));
  p.on('request',r=>{if(recording&&r.method()==='POST'&&/\/api\/maps\/(recompute|simulation)(?:\?|$)/.test(r.url()))probabilityRequests.push(r.url());});
  await p.addInitScript(()=>window.zoomQA={record:false,rows:[],current:null});
  await p.addInitScript(()=>localStorage.setItem('crate-atlas.language.v1','zh-CN'));await p.route('**/language-settings.js*',r=>r.fulfill({contentType:'application/javascript',body:'globalThis.CrateLanguageSettings={saved:"zh-CN"};'}));
  await p.route('**/region-overlay-cache.js*',async route=>{
   const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body+`\n{const create=CrateRegionOverlayCache.create;CrateRegionOverlayCache.create=(...args)=>{const cache=create(...args),render=cache.render;cache.render=(...args)=>{const start=performance.now(),r=render(...args);if(zoomQA.current)Object.assign(zoomQA.current,{regionMs:performance.now()-start,region:r});return r;};return cache;};}`});
  });
  await p.route('**/realmap-ui.js*',async route=>{
   const response=await route.fetch(),body=await response.text(),needle='  window.CrateMapViewer={state';assert(body.includes(needle));
   const code=`
  if(!zoomQA.hooked){zoomQA.hooked=true;
  const zoomBase=mapViewCache.render;mapViewCache.render=function(...args){const t=performance.now(),r=zoomBase(...args);if(zoomQA.current)Object.assign(zoomQA.current,{baseMs:performance.now()-t,base:r});return r;};
  for(const name of ['labels','render','hoverInfo']){const original=regions[name];regions[name]=function(...args){const t=performance.now();try{return original(...args);}finally{if(zoomQA.current)zoomQA.current[name+'Ms']=(zoomQA.current[name+'Ms']||0)+performance.now()-t;}};}
  const zoomDraw=draw;draw=function(...args){if(!zoomQA.record||zoomQA.current)return zoomDraw(...args);const row=zoomQA.current={at:performance.now(),scale:state.scale,navigating:!!state.navigating};try{return zoomDraw(...args);}finally{row.ms=performance.now()-row.at;zoomQA.rows.push(row);zoomQA.current=null;}};}\n`;
   const pixels=`
  zoomQA.compare=()=>{const images=[];for(const cached of [true,false]){const image=document.createElement('canvas');image.width=Math.round(W*pixelRatio);image.height=Math.round(H*pixelRatio);const target=image.getContext('2d');target.setTransform(pixelRatio,0,0,pixelRatio,0,0);target.fillStyle='#101c25';target.fillRect(0,0,W,H);if(cached)mapViewCache.render(target,state,area,display,mapOptions());else CrateMapRenderer.render(target,state,area,display,mapOptions());images.push(target.getImageData(0,0,image.width,image.height).data);}let sum=0,large=0;for(let i=0;i<images[0].length;i++){const d=Math.abs(images[0][i]-images[1][i]);sum+=d;if(d>40)large++;}return {mean:sum/images[0].length,large:large/images[0].length};};\n`;
   await route.fulfill({response,body:body.replace(needle,code+pixels+needle)});
  });
  await p.goto(base+(toy?'index.html':'maps.html'));
  if(toy)await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});else await p.locator('#version').selectOption('directory');
  await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');
  await p.waitForFunction(()=>window.CrateMapViewer?.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&CrateMapViewer.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
  await p.locator('#regionToggle').click();await p.waitForFunction(()=>document.getElementById('regionAutoStatus').textContent.includes('自动划分完成'),null,{timeout:120000});
  if(!regionActive)await p.locator('#viewMode').click();
  for(const id of ['regionColorOverlay','regionShowTotals'])if(await p.locator('#'+id).getAttribute('aria-pressed')!=='true')await p.locator('#'+id).click();
  await p.locator('#map').scrollIntoViewIfNeeded();
  const position=await p.evaluate(center=>{const v=CrateMapViewer,s=v.state,a=v.area,r=s.data.rendering;s.scale=a.w/(r.width*center);s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;s.selected=s.incoming=null;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return [b.x+(a.x+a.w/2)*k,b.y+(a.y+a.h/2)*k];},startFraction);
  await p.mouse.move(...position);await p.waitForTimeout(1800);
  const results=[];
  recording=true;
  for(const delay of [16,180]){
   await p.evaluate(()=>{zoomQA.rows=[];zoomQA.record=true;});
   for(let i=1;i<=32;i++){
    const fraction=process.env.ZOOM_SWEEP?startFraction+(center+span-startFraction)*i/32:center+span*Math.sin(i*Math.PI/16);
    const dy=await p.evaluate(f=>{const v=CrateMapViewer,target=v.area.w/(v.state.data.rendering.width*f);return -Math.log(target/v.state.scale)/.0015;},fraction);
    await p.mouse.wheel(0,dy);await p.waitForTimeout(delay);
   }
   const released=await p.evaluate(()=>performance.now());await p.waitForTimeout(1500);
   const rows=await p.evaluate(()=>{zoomQA.record=false;return zoomQA.rows;});
   const moving=rows.filter(r=>r.navigating),idle=rows.filter(r=>r.at>=released),changed=rows.filter((r,i)=>!i||r.scale!==rows[i-1].scale);
   const result={delay,frames:rows.length,draw:summary(moving.map(r=>r.ms)),cadence:summary(moving.slice(1).map((r,i)=>r.at-moving[i].at)),base:summary(rows.map(r=>r.baseMs||0)),region:summary(rows.map(r=>r.regionMs||0)),labels:summary(rows.map(r=>r.labelsMs||0)),hover:summary(rows.map(r=>r.hoverInfoMs||0)),
    zoomUpdates:changed.length,zoomCadence:summary(changed.slice(1).map((r,i)=>r.at-changed[i].at)),
    baseRebuilds:rows.filter(r=>r.base?.cacheRebuilt).length,regionRebuilds:rows.filter(r=>r.region?.rebuilt).length,overviewFrames:rows.filter(r=>r.base?.overview&&r.region?.overview).length,idle:idle.map(r=>({ms:r.ms,base:r.base?.cacheRebuilt,region:r.region?.rebuilt})),worst:rows.slice().sort((a,b)=>b.ms-a.ms).slice(0,4)};
   if(!process.env.ZOOM_BASELINE){assert.equal(result.baseRebuilds,0);assert.equal(result.regionRebuilds,0);assert(result.draw.p95<40);if(process.env.ZOOM_SWEEP&&delay===16){assert(result.overviewFrames>0);assert(result.zoomCadence.p95<150,'Native zoom updates include browser rasterization, not only JS draw time');}}
   results.push(result);console.log(JSON.stringify(result));
  }
  await p.evaluate(()=>{zoomQA.rows=[];zoomQA.record=true;});
  const finalDy=await p.evaluate(()=>{const v=CrateMapViewer;return -Math.log((v.area.w/(v.state.data.rendering.width*.53))/v.state.scale)/.0015;});
  await p.mouse.wheel(0,finalDy);
  await p.waitForFunction(()=>zoomQA.rows.some(r=>r.base?.refined)&&zoomQA.rows.some(r=>r.region?.refined),null,{timeout:15000});
  const refinement=await p.evaluate(()=>{zoomQA.record=false;return zoomQA.rows.map(r=>({ms:r.ms,base:r.base,region:r.region}));});
  assert(refinement.every(r=>!r.base?.cacheRebuilt&&!r.region?.rebuilt),'New zoom resolution must commit without synchronous full painting');
  await p.waitForTimeout(200);const pixels=await p.evaluate(()=>zoomQA.compare());assert(pixels.mean<1.5&&pixels.large<.02,JSON.stringify(pixels));
  await p.evaluate(()=>{zoomQA.rows=[];zoomQA.record=true;const v=CrateMapViewer;v.state.navigating=true;v.state.x+=33.25;v.state.y-=11.75;v.draw();v.state.navigating=false;v.draw();});
  const stoppedPan=await p.evaluate(()=>{zoomQA.record=false;return zoomQA.rows;});
  if(!process.env.ZOOM_BASELINE)assert(stoppedPan.every(r=>!r.base?.cacheRebuilt&&!r.region?.rebuilt&&!r.base?.refining&&!r.region?.refining),'Stopping a pan must not create raster work');
  recording=false;assert.deepEqual(probabilityRequests,[]);
  const qa=path.resolve('output/region-zoom-qa');fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,process.env.ZOOM_REPORT||'after-full.json'),JSON.stringify({edition:toy?'Toy':'Full',dpr:Number(process.env.ZOOM_DPR)||2,center,span,startFraction,sweep:!!process.env.ZOOM_SWEEP,regionActive,results,refinement,pixels,stoppedPan,probabilityRequests},null,2));
  assert.deepEqual(errors,[]);console.log('PASS native zoom sampling');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
