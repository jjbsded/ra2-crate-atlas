/* One drawing contract for original images and procedural Toy materials. */
(function(root){
 'use strict';
 async function load(url,{legacyMatte=false,signal}={}){
  signal?.throwIfAborted();
  if(!legacyMatte||!root.Worker||!root.OffscreenCanvas){const image=new Image();image.src=url;await image.decode();signal?.throwIfAborted();return image;}
  return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('map-raster-background.js?v=1',document.baseURI));
   const finish=(error,image)=>{worker.terminate();signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(image);};
   const abort=()=>finish(signal.reason||new DOMException('Aborted','AbortError'));
   signal?.addEventListener('abort',abort,{once:true});worker.onerror=e=>finish(Error(e.message));
   worker.onmessage=({data})=>finish(data.error?Error(data.error):null,data.image);worker.postMessage({url:new URL(url,document.baseURI).href});
  });
 }
 function draw(ctx,source,...args){
  ctx.save();
  const sw=args.length===8?args[2]:(source.naturalWidth||source.width),dw=args.length===8?args[6]:(args[2]??sw);
  const t=ctx.getTransform();ctx.imageSmoothingEnabled=Math.hypot(t.a,t.b)*dw/sw<1;
  if(typeof source?.draw==='function')source.draw(ctx,...args);
  else ctx.drawImage(source,...args);
  ctx.restore();
 }
 function crop(ctx,source,rendering,view,box){
  const sx=(source.naturalWidth||source.width)/rendering.width,sy=(source.naturalHeight||source.height)/rendering.height;
  draw(ctx,source,(box.x-view.x)/view.scale*sx,(box.y-view.y)/view.scale*sy,box.w/view.scale*sx,box.h/view.scale*sy,box.x,box.y,box.w,box.h);
 }
 function scene(ctx,state,rendering,options,box=null){
  if(options.scene&&options.scene!=='all')return;
  // Native images retain one sampling phase under the caller's clip. A
  // fractional source crop can round differently at high zoom. Procedural
  // sources still receive the crop so they only visit the relevant tiles.
  const paint=source=>box&&typeof source?.draw==='function'?crop(ctx,source,rendering,state,box):draw(ctx,source,state.x,state.y,rendering.width*state.scale,rendering.height*state.scale);
  if(!options.objects||!state.objectImage){paint(state.image);return;}
  const opacity=options.objectOpacity??1;if(opacity>=1){paint(state.objectImage);return;}
  paint(state.image);ctx.save();ctx.globalAlpha*=opacity;paint(state.objectImage);ctx.restore();
 }
 function fallback(data){
  const r=data.rendering;if(!(r?.width>0&&r.height>0))return null;
  const width=r.width,height=r.height,[ox,oy]=r.origin||[0,0],buckets=new Map(),size=256;
  const colors=['#737166','#78796d','#365368','#484b4d','#656269','#777661','#8a8468','#6e7165','#a6b1b5','#67635b','#47494c'];
  for(const c of data.cells){
   const x=c.px??ox+30*(c.x-c.y),y=c.py??oy+15*(c.x+c.y-c.level),parts=c.visibleSurface||c.surface||[[[0,-15],[30,0],[0,15],[-30,0]]],points=parts.flat();
   if(!points.length)continue;
   const item={x,y,parts,color:c.terrainError?'#34383c':colors[c.rawLand??c.land]||'#646969'};
   const xs=points.map(p=>x+p[0]),ys=points.map(p=>y+p[1]);
   for(let by=Math.floor(Math.min(...ys)/size);by<=Math.floor(Math.max(...ys)/size);by++)for(let bx=Math.floor(Math.min(...xs)/size);bx<=Math.floor(Math.max(...xs)/size);bx++){const key=bx+','+by;let list=buckets.get(key);if(!list)buckets.set(key,list=[]);list.push(item);}
  }
  const source={width,height,procedural:true,draw(ctx,...args){
   let sx=0,sy=0,sw=width,sh=height,dx=args[0]||0,dy=args[1]||0,dw=args[2]??width,dh=args[3]??height;
   if(args.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=args;
   if(!(sw>0&&sh>0&&dw>0&&dh>0))return;
   ctx.save();ctx.beginPath();ctx.rect(dx,dy,dw,dh);ctx.clip();ctx.translate(dx,dy);ctx.scale(dw/sw,dh/sh);ctx.translate(-sx,-sy);
   const items=new Set();for(let by=Math.floor(sy/size);by<=Math.floor((sy+sh)/size);by++)for(let bx=Math.floor(sx/size);bx<=Math.floor((sx+sw)/size);bx++)for(const item of buckets.get(bx+','+by)||[])items.add(item);
   for(const item of items){ctx.fillStyle=item.color;for(const part of item.parts){ctx.beginPath();part.forEach(([x,y],i)=>i?ctx.lineTo(item.x+x,item.y+y):ctx.moveTo(item.x+x,item.y+y));ctx.closePath();ctx.fill();}}
   ctx.restore();
  },snapshot:()=>source};return source;
 }
 const api={draw,crop,scene,load,fallback};root.CrateMapArtwork=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
