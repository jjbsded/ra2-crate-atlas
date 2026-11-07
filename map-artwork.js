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
  // Native images retain one sampling phase under the caller's clip. A
  // fractional source crop can round differently at high zoom. Procedural
  // sources still receive the crop so they only visit the relevant tiles.
  const paint=source=>box&&typeof source?.draw==='function'?crop(ctx,source,rendering,state,box):draw(ctx,source,state.x,state.y,rendering.width*state.scale,rendering.height*state.scale);
  if(!options.objects||!state.objectImage){paint(state.image);return;}
  const opacity=options.objectOpacity??1;if(opacity>=1){paint(state.objectImage);return;}
  paint(state.image);ctx.save();ctx.globalAlpha*=opacity;paint(state.objectImage);ctx.restore();
 }
 const api={draw,crop,scene,load};root.CrateMapArtwork=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
