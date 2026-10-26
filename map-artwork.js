/* One drawing contract for original images and procedural Toy materials. */
(function(root){
 'use strict';
 function draw(ctx,source,...args){
  if(typeof source?.draw==='function')source.draw(ctx,...args);
  else ctx.drawImage(source,...args);
 }
 function crop(ctx,source,rendering,view,box){
  const sx=(source.naturalWidth||source.width)/rendering.width,sy=(source.naturalHeight||source.height)/rendering.height;
  draw(ctx,source,(box.x-view.x)/view.scale*sx,(box.y-view.y)/view.scale*sy,box.w/view.scale*sx,box.h/view.scale*sy,box.x,box.y,box.w,box.h);
 }
 const api={draw,crop};root.CrateMapArtwork=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
