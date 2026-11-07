/* Browser integration and constrained-mobile measurements for original atlases. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const base=process.env.TOY_BASE||'http://127.0.0.1:8787/toy/crate-atlas/',root=path.resolve(process.env.TOY_ROOT||'output/toy'),out=path.resolve(process.env.TOY_QA_OUT||'output/toy-original-qa');fs.mkdirSync(out,{recursive:true});
const map='036e439c07cbb98efef9-yr',result=state=>`data/${map}/${state}/result.json.gz`;
async function ready(page){await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});}
async function points(page){await page.locator('#map').scrollIntoViewIfNeeded();return page.locator('#map').boundingBox();}
async function track(page,start){
 if(start)await page.evaluate(()=>{window.qaFrames=[];let previous=performance.now();window.qaTracking=true;const tick=t=>{qaFrames.push(t-previous);previous=t;if(qaTracking)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 else return page.evaluate(()=>{qaTracking=false;const a=qaFrames.filter(t=>t>0).sort((a,b)=>a-b);return {frames:a.length,median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:Math.max(...a),fps:a.length*1000/a.reduce((s,x)=>s+x,0)};});
}
(async()=>{
 const zlib=require('node:zlib'),codec=require('./toy/static-codec.js'),{create}=require('./toy/toy-platform.js');
 const file=fs.readdirSync(path.join(root,'art')).find(p=>p.endsWith('.bin.gz')),raw=zlib.gunzipSync(fs.readFileSync(path.join(root,'art',file)));
 global.CrateStaticCodec=codec;
 const fallback=create({base:new URL(base),Worker:null,fetch:async()=>new Response(fs.readFileSync(path.join(root,'art',file)))});
 assert.deepEqual(await fallback.readArtwork('art/'+file),codec.artwork(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)));fallback.dispose();
 const browser=await chromium.launch({channel:'msedge',headless:true}),summary={};try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,locale:mobile?'en-US':'zh-CN',acceptDownloads:true});
  const page=await context.newPage(),errors=[],apis=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{requests.push(r.url());if(new URL(r.url()).pathname.includes('/api/'))apis.push(r.url());});
  const cdp=await context.newCDPSession(page);
  if(mobile){await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1000000,uploadThroughput:500000});}
  const start=Date.now();await page.goto(base+'maps.html?result='+encodeURIComponent(result('ore')));await ready(page);
  const metrics={coldLoadMs:Date.now()-start};assert.ok(await page.evaluate(()=>CrateMapViewer.state.data.rendering.original));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)||'null')?.autoHandled,null,{timeout:120000});
  await page.evaluate(()=>{for(const id of ['heatmap','values','blocked','boundary']){const el=document.getElementById(id);if(el){el.checked=false;el.dispatchEvent(new Event('change'));}}CrateMapViewer.focus(CrateMapViewer.state.cells.find(c=>c.bridge?.kind==='high'));CrateMapViewer.draw();});
  if(!mobile){
   for(const layout of ['ore','clear']){
    await page.evaluate(url=>CrateMapViewer.loadResult(url),result(layout));await ready(page);
    for(const objects of [false,true]){const data=await page.evaluate(objects=>{const s=CrateMapViewer.state,im=objects?s.objectImage:s.image,c=document.createElement('canvas');c.width=im.width;c.height=im.height;im.draw(c.getContext('2d'),0,0);return c.toDataURL('image/png').split(',')[1];},objects);fs.writeFileSync(path.join(out,`${layout}-${objects?'objects':'ground'}.png`),Buffer.from(data,'base64'));}
   }
   await page.evaluate(url=>CrateMapViewer.loadResult(url),result('ore'));await ready(page);
   const download=page.waitForEvent('download');await page.locator('#mapImageExport').click();await(await download).saveAs(path.join(out,'full-map.jpg'));
  }
  const before=await page.evaluate(()=>{CrateMapViewer.focus(CrateMapViewer.state.cells.find(c=>c.bridge?.kind==='high'));return [CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y];});
  let r=await points(page);await track(page,true);
  if(mobile){const x=r.x+r.width*.5,y=r.y+r.height*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-30,y,id:1},{x:x+30,y,id:2}]});for(let i=0;i<45;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-30-i,y:y+Math.sin(i/8)*12,id:1},{x:x+30+i,y:y+Math.sin(i/8)*12,id:2}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.down({button:'right'});for(let i=0;i<60;i++){await page.mouse.move(r.x+r.width*.5+Math.sin(i/12)*100,r.y+r.height*.5+Math.sin(i/17)*45);await page.waitForTimeout(16);}await page.mouse.up({button:'right'});}
  metrics.navigation=await track(page,false);assert.deepEqual(await page.evaluate(()=>[CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y]),before);
  await page.locator('#simulationPlaceTab').click();await page.locator('#regionToggle').click();assert.equal(await page.locator('#regionToolbar').isVisible(),true);
  assert.ok(await page.locator('#regionRows canvas').count()>0,'Region terrain crops and minimap locations are rendered');
  await page.locator('#regionTool').selectOption('brush-ellipse');await page.locator('#viewMode').click();
  assert.equal(await page.locator('#heatmap').isChecked(),true,'Leaving region mode restores probability');
  await page.addScriptTag({url:base+'lib/three-r160.min.js'});
  await page.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.cells.find(c=>c.bridge?.kind==='high')));
  await page.evaluate(()=>{const Renderer=THREE.WebGLRenderer;window.qaRenderers=[];THREE.WebGLRenderer=class extends Renderer{constructor(o){super(o);qaRenderers.push(this);window.qaRenderer=this;}};const patch=CrateToyOriginal3D.patch;CrateToyOriginal3D.patch=async(...args)=>{const p=await patch(...args);window.qaPatch=p;return p;};});
  const time=Date.now();await page.locator('#terrain3dOpen').click();await page.waitForFunction(()=>!document.getElementById('terrain3dStage').classList.contains('is-loading'),null,{timeout:120000});
  assert.equal(await page.locator('#terrain3dError').textContent(),'');metrics.open3DMs=Date.now()-time;
  assert.ok(await page.evaluate(()=>qaPatch.originalArt&&qaPatch.cells.some(c=>c.decorations.some(d=>d.bridge==='high'))));
  metrics.webgl=await page.evaluate(()=>({drawCalls:qaRenderer.info.render.calls,textures:qaRenderer.info.memory.textures,geometries:qaRenderer.info.memory.geometries,cells:qaPatch.cells.length}));
  if(mobile){await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150);const box=await page.locator('#terrain3dCanvas').boundingBox();assert.ok(box.height>=220);}
  r=await page.locator('#terrain3dCanvas').boundingBox();await track(page,true);
  if(mobile){const x=r.x+r.width*.5,y=r.y+r.height*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=0;i<60;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+Math.sin(i/20)*140,y:y+Math.sin(i/14)*60,id:1}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.down();for(let i=0;i<60;i++){await page.mouse.move(r.x+r.width*.5+Math.sin(i/20)*140,r.y+r.height*.5+Math.sin(i/14)*60);await page.waitForTimeout(16);}await page.mouse.up();}metrics.orbit=await track(page,false);
  await page.locator('#terrain3dDialog').screenshot({path:path.join(out,mobile?'mobile-landscape-3d.png':'desktop-3d.png')});
  await page.locator('#terrain3dClose').click();await page.waitForFunction(()=>qaRenderers.every(r=>r.info.memory.geometries<=1&&r.info.memory.textures===0));
  const toggled=Date.now();await page.locator('#mineralToggle').click();await page.waitForFunction(()=>!CrateMapViewer.state.busy&&CrateMapViewer.state.data.metadata.mineralsEnabled===false,null,{timeout:120000});metrics.clearLoadMs=Date.now()-toggled;
  assert.ok(await page.evaluate(()=>!CrateMapViewer.state.cells.some(c=>/^TREE\d+$/.test(c.terrain||''))));
  const artRequests=requests.filter(x=>/atlas-.*\.webp/.test(x)).length;const cached=Date.now();await page.locator('#mineralToggle').click();await page.waitForFunction(()=>!CrateMapViewer.state.busy&&CrateMapViewer.state.data.metadata.mineralsEnabled!==false,null,{timeout:120000});metrics.cachedToggleMs=Date.now()-cached;
  assert.equal(requests.filter(x=>/atlas-.*\.webp/.test(x)).length,artRequests,'Cached layout switch does not fetch atlas pages again');
  await page.locator('#map').screenshot({path:path.join(out,mobile?'mobile-map.png':'desktop-map.png')});
  metrics.art=await page.evaluate(()=>{const s=CrateToyOriginal.get(CrateMapViewer.state.data);return{...CrateToyOriginal.stats(),mapAtlases:s.data.atlases.length,mapTextureBytes:s.data.atlases.reduce((n,a)=>n+a.bytes,0),mapDecodedBytes:s.data.atlases.reduce((n,a)=>n+a.width*a.height*4,0),ground:s.im.stats(),objects:s.objectImage.stats()};});
  assert.deepEqual(errors,[]);assert.deepEqual(apis,[]);summary[mobile?'mobile-4xCPU-8Mbps':'desktop']=metrics;console.log(mobile?'MOBILE':'DESKTOP',JSON.stringify(metrics));await context.close();
 }
}finally{await browser.close();}fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(summary,null,2));})().catch(error=>{console.error(error);process.exitCode=1});
