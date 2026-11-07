'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1850,height:1200},deviceScaleFactor:1.5}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 assert(!(await p.locator('#markers').isDisabled()),'The risk layer remains switchable on an approximate map');await p.locator('#markers').uncheck();await p.locator('#markers').check();
 const result=await p.evaluate(()=>{
  const v=CrateMapViewer,s=v.state,r=s.data.rendering,canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d',{willReadFrequently:true}),area={x:0,y:0,w:32,h:32},expected=document.createElement('canvas');expected.width=expected.height=32;const ec=expected.getContext('2d');
  const points=[];
  search:for(let y=1;y<=s.coordinateSpace.max;y++)for(let x=1;x<=s.coordinateSpace.max;x++){
   const c=s.coordinateSpace.get(x,y);if(!c.virtual||c.px<20||c.py<20||c.px>r.width-20||c.py>r.height-20)continue;
   ctx.clearRect(0,0,32,32);CrateMapArtwork.draw(ctx,s.image,c.px-16,c.py-16,32,32,0,0,32,32);const alpha=ctx.getImageData(16,16,1,1).data[3];if(alpha)continue;
   const view={...s,x:16-c.px,y:16-c.py,scale:1,selected:null};
   ctx.clearRect(0,0,32,32);ec.clearRect(0,0,32,32);for(const t of [ctx,ec]){t.fillStyle='#101c25';t.fillRect(0,0,32,32);}s.coordinateSpace.paint(ec,view,area);
   CrateMapRenderer.render(ctx,view,area,v.display,{coordinateSpace:s.coordinateSpace,objects:true,heatmap:false,blocked:false,markers:false,values:false,grid:false});
   const a=ctx.getImageData(12,12,8,8).data,b=ec.getImageData(12,12,8,8).data;if(a.some((n,i)=>Math.abs(n-b[i])>1))continue;
   points.push([x,y]);if(points.length===4)break search;
  }
  if(!points.length)throw Error('No clean virtual coordinate inside the old opaque image rectangle');
  const c=s.coordinateSpace.get(...points[0]);s.scale=2;s.x=v.area.x+v.area.w*.4-c.px*s.scale;s.y=v.area.y+v.area.h*.4-c.py*s.scale;s.selected=c;v.draw();
  return {status:'PASS',edition:typeof CrateMapPlatform==='undefined'?'Full':'Toy',points,renderVersion:r.version,approximate:s.data.metadata.approximate,source:s.image.constructor.name};
 });
 assert(result.points.length>=4);await p.waitForTimeout(1200);assert.deepEqual(errors,[]);fs.mkdirSync('output/map-background-qa',{recursive:true});await p.locator('#canvasHost').screenshot({path:'output/map-background-qa/'+(toy?'toy':'full')+'.png'});fs.writeFileSync('output/map-background-qa/'+(toy?'toy':'full')+'.json',JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
