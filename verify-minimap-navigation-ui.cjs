/* Compare minimap and right-button drags along matching camera trajectories. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
const file='D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-130952-917129.yrm';
const summary=values=>{const a=values.slice().sort((a,b)=>a-b);return Object.fromEntries([['p50',.5],['p95',.95],['max',1]].map(([k,p])=>[k,+(a[Math.min(a.length-1,Math.floor(a.length*p))]||0).toFixed(2)]));};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[],report=[];
  p.on('pageerror',e=>errors.push(e.stack));
  await p.addInitScript(()=>window.miniQA={record:false,frames:[],rasters:[]});
  await p.route('**/region-overlay-cache.js*',async route=>{
   const response=await route.fetch(),body=await response.text();
   await route.fulfill({response,body:body+`\n{const create=CrateRegionOverlayCache.create;CrateRegionOverlayCache.create=(...args)=>{const cache=create(...args),render=cache.render;cache.render=(...args)=>{const result=render(...args);if(miniQA.record)miniQA.rasters.push(result);return result;};return cache;};}`});
  });
  await p.route('**/realmap-ui.js*',async route=>{
   const response=await route.fetch(),body=await response.text(),needle='  window.CrateMapViewer={state';assert(body.includes(needle));
   await route.fulfill({response,body:body.replace(needle,`  const miniDraw=draw;draw=function(...args){if(!miniQA.record||miniQA.drawing)return miniDraw(...args);miniQA.drawing=true;const at=performance.now(),row={at,x:state.x,y:state.y,navigating:!!state.navigating,mode:state.drag?.mode};try{return miniDraw(...args);}finally{row.ms=performance.now()-at;miniQA.frames.push(row);miniQA.drawing=false;}};\n`+needle)});
  });
  await p.goto(base+(toy?'index.html':'maps.html'));
  if(toy)await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
  else await p.locator('#version').selectOption('directory');
  await p.locator('#mapFile').setInputFiles(file);
  await p.waitForFunction(name=>window.CrateMapViewer?.state.data?.metadata.filename===name&&!CrateMapViewer.state.busy,path.basename(file),{timeout:120000});
  await p.locator('#simulationPlaceTab').click();await p.waitForFunction(()=>CrateMapViewer.simulation.active&&CrateMapViewer.simulation.model,null,{timeout:60000});
  await p.locator('#viewMode').click();
  for(const id of ['regionColorOverlay','regionShowTotals'])if(await p.locator('#'+id).getAttribute('aria-pressed')!=='true')await p.locator('#'+id).click();
  await p.waitForFunction(()=>document.getElementById('regionAutoStatus').textContent.includes('自动划分完成'),null,{timeout:120000});
  for(const fraction of [.6,.36]){
   await p.locator('#map').scrollIntoViewIfNeeded();
   const start=await p.evaluate(fraction=>{
    const v=CrateMapViewer,s=v.state,a=v.area,r=s.data.rendering;s.scale=a.w/(r.width*fraction);
    s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;s.selected=s.incoming=null;v.draw();
    const mini=CrateMinimap.layout(CrateMinimap.terrainRendering(s),a,{players:document.getElementById('players').checked}),box=document.getElementById('map').getBoundingClientRect(),k=box.width/v.viewport.width;
    return {map:[box.x+(a.x+a.w/2)*k,box.y+(a.y+a.h/2)*k],mini:[box.x+(mini.image.x+mini.image.w/2)*k,box.y+(mini.image.y+mini.image.h/2)*k],k,miniScale:mini.image.scale,scale:s.scale};
   },fraction);
   await p.waitForTimeout(400);
   const camera=[],scenarios=[];
   for(const mode of ['overview','pan']){
    const position=start[mode==='overview'?'mini':'map'];
    if(camera.length)await p.evaluate(value=>{Object.assign(CrateMapViewer.state,value);CrateMapViewer.draw();},camera[0]);
    await p.mouse.move(...position);await p.waitForTimeout(200);
    await p.evaluate(()=>{miniQA.frames=[];miniQA.rasters=[];miniQA.record=true;});
    await p.mouse.down({button:mode==='overview'?'left':'right'});
    if(mode==='overview')camera.push(await p.evaluate(()=>({x:CrateMapViewer.state.x,y:CrateMapViewer.state.y})));
    for(let i=1;i<=32;i++){
     const delta=mode==='overview'?[Math.sin(i*Math.PI/16)*160*start.miniScale/start.scale,Math.sin(i*Math.PI/12)*90*start.miniScale/start.scale]:[camera[i].x-camera[0].x,camera[i].y-camera[0].y];
     await p.mouse.move(position[0]+delta[0]*start.k,position[1]+delta[1]*start.k);await p.waitForTimeout(12);
     if(mode==='overview')camera.push(await p.evaluate(()=>({x:CrateMapViewer.state.x,y:CrateMapViewer.state.y})));
     else{
      const at=await p.evaluate(()=>({x:CrateMapViewer.state.x,y:CrateMapViewer.state.y}));
      assert(Math.hypot(at.x-camera[i].x,at.y-camera[i].y)<3,'Native pointer rounding must keep the camera paths aligned');
     }
    }
    await p.mouse.up({button:mode==='overview'?'left':'right'});await p.waitForTimeout(300);
    const raw=await p.evaluate(()=>{miniQA.record=false;return {frames:miniQA.frames,rasters:miniQA.rasters};});
    const moved=raw.frames.filter((f,i)=>i&&(f.x!==raw.frames[i-1].x||f.y!==raw.frames[i-1].y));
    const row={fraction,mode,frames:moved.length,draw:summary(moved.map(f=>f.ms)),cadence:summary(moved.slice(1).map((f,i)=>f.at-moved[i].at)),
     exactRebuilds:raw.rasters.filter(r=>r.rebuilt).length,navigatingFrames:moved.filter(f=>f.navigating).length};
    scenarios.push(row);console.log(JSON.stringify(row));
    if(!process.env.MINI_PROFILE_ONLY){
     assert(moved.length>=25);assert(moved.every(f=>f.navigating),'Both navigation inputs must use gesture caching');
     assert(row.exactRebuilds<=1,'Only the settled frame may rebuild at an exact pixel phase');
     if(!toy)assert(row.cadence.p95<100,JSON.stringify(row));
    }
   }
   report.push({fraction,scenarios});
  }
  assert.deepEqual(errors,[]);const out=path.resolve('output/minimap-navigation-qa');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,process.env.MINI_REPORT||'after-full.json'),JSON.stringify(report,null,2));
  console.log('PASS matching minimap / right-button camera trajectories');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
