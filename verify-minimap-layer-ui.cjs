/* Navigator pixels survive glyph thresholds and failures in the map surface. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',out=path.resolve('output/minimap-layer-qa');
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+(toy?'maps.html':'maps.html?result='+(process.env.SIM_RESULT||'/output/map-f554bd7efa5b/result.json')));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});await p.locator('#viewMode').click();await p.locator('#minimap').check();
 const nav=p.locator('#mapNavigationCanvas');await p.locator('#map').scrollIntoViewIfNeeded();
 const signature=()=>nav.evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,Math.min(28,c.height)).data;let ink=0;for(let i=3;i<a.length;i+=4)if(a[i])ink++;return {pixels:Array.from(a),ink};});
 const sameHeader=(a,b,label)=>{assert.equal(a.ink,b.ink,label);assert.equal(a.pixels.length,b.pixels.length);assert(a.pixels.reduce((sum,v,i)=>sum+Math.abs(v-b.pixels[i]),0)/a.pixels.length<1,label+' (GPU/CPU glyph readback rounding)');};
 for(const scale of [.84,.866,.868,.932,.936,1,1.5]){
  await p.evaluate(scale=>{const v=CrateMapViewer,s=v.state,r=s.data.rendering,a=v.area;s.scale=scale;s.x=a.x+a.w/2-r.width*scale/2;s.y=a.y+a.h/2-r.height*scale/2;v.draw();},scale);
  assert(await nav.isVisible());assert((await signature()).ink>1000);
 }
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(150);await p.evaluate(()=>CrateMapViewer.draw());const reference=await signature();
 assert(await p.evaluate(()=>{
  const v=CrateMapViewer,original=CrateProbability.labelSize,n=document.getElementById('mapNavigationCanvas'),c=n.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,n.width,n.height);CrateProbability.labelSize=()=>{throw Error('Navigator QA map failure');};
  try{v.draw();return false;}catch(error){return error.message==='Navigator QA map failure'&&v.state.renderFailures.at(-1).message===error.message;}
  finally{CrateProbability.labelSize=original;}
 }));sameHeader(await signature(),reference,'Map exceptions cannot erase the navigator');
 await p.evaluate(()=>{const v=CrateMapViewer,c=document.getElementById('map').getContext('2d');c.save();c.beginPath();c.rect(0,0,1,1);c.clip();c.globalAlpha=0;try{v.draw();}finally{c.restore();}});
 sameHeader(await signature(),reference,'Map alpha / clipping do not affect the independent navigator');
 await p.evaluate(()=>CrateMapViewer.draw());
 const aligned=await p.locator('#minimapClose').evaluate(e=>{const a=e.getBoundingClientRect(),b=document.getElementById('mapNavigationCanvas').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1&&a.top>=b.top&&a.bottom<=b.bottom+1;});assert(aligned);
 const original=await nav.boundingBox();await p.locator('#minimapMinimize').click();assert((await nav.boundingBox()).height<original.height/3);await p.locator('#minimapMinimize').click();assert(Math.abs((await nav.boundingBox()).height-original.height)<1);
 await p.locator('#minimapClose').click();await nav.waitFor({state:'hidden'});await p.locator('#minimapToggle').click();await nav.waitFor({state:'visible'});
 // The visual canvas never intercepts header drags or the existing buttons.
 const box=await nav.boundingBox();await p.mouse.move(box.x+45,box.y+15);await p.mouse.down();await p.mouse.move(box.x-35,box.y+55,{steps:8});await p.mouse.up();const moved=await nav.boundingBox();assert(moved.x<box.x-30&&moved.y>box.y+20);
 const download=p.waitForEvent('download');await p.locator('#screenshot').click();const file=await download;await file.saveAs(path.join(out,(toy?'toy':'full')+'-viewport.png'));
 assert.deepEqual(errors,[]);await p.screenshot({path:path.join(out,(toy?'toy':'full')+'.png')});
 if(toy){await p.setViewportSize({width:440,height:850});await p.waitForTimeout(100);await p.evaluate(()=>CrateMapViewer.draw());assert(await nav.isVisible());const b=await nav.boundingBox();assert(b.x>=0&&b.x+b.width<=440);}
 console.log('PASS',toy?'Toy':'Full','glyph thresholds, failed / clipped map draw, navigator alignment, minimize/close, drag and viewport PNG');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
