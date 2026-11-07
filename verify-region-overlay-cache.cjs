/* Compare resident region rasters against direct, ordered transparent drawing. */
'use strict';
const assert=require('node:assert/strict'),{createCanvas,Path2D}=require('@napi-rs/canvas');
const Cache=require('./region-overlay-cache.js');
const bounds={x:-60,y:-35,w:12060,h:6035},area={x:20,y:30,w:900,h:540};
const shapes=[0,1,2].map(i=>{
 const path=new Path2D();
 for(let y=0;y<70;y++)for(let x=0;x<90;x++){
  if((x+3*y)%5===i)continue;
  const px=x*120+i*90,py=y*75+i*35;
  path.moveTo(px,py-35);path.lineTo(px+60,py);path.lineTo(px,py+35);path.lineTo(px-60,py);path.closePath();
 }
 return path;
});
for(const ratio of [1,1.5,2]){
 const a=createCanvas(960*ratio,600*ratio),b=createCanvas(960*ratio,600*ratio),cache=Cache.create(()=>createCanvas(1,1));
 const view={x:22,y:33,scale:.1,navigating:false};let opacity=.45,color='#da4e77',stamp='initial',calls=0,origin=null,edit=null;
 const paint=(ctx,v)=>{
  calls++;ctx.save();ctx.translate(v.x,v.y);ctx.scale(v.scale,v.scale);
  for(let i=0;i<shapes.length;i++){
   ctx.fillStyle=i===0?color:i===1?'#37c5b0':'#9d7ae5';ctx.globalAlpha=opacity*(i===2?1:.75);ctx.fill(shapes[i],'evenodd');
   ctx.globalAlpha=1;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=(i===2?1.4:.8)/v.scale;ctx.stroke(shapes[i]);
  }
  if(edit){ctx.globalAlpha=.6;ctx.fillStyle='#ffffff';ctx.fillRect(edit.x,edit.y,edit.w,edit.h);}
  ctx.restore();
 };
 function check(label,{parts,rebuilt}={}){
  let result;
  for(const [image,cached]of [[a,true],[b,false]]){
   const ctx=image.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,960,600);
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   if(cached){result=cache.render(ctx,view,area,bounds,stamp,paint);if(result.rebuilt)origin={x:view.x,y:view.y};}
   else paint(ctx,{...view,x:origin.x+Math.round((view.x-origin.x)*ratio)/ratio,y:origin.y+Math.round((view.y-origin.y)*ratio)/ratio});
   ctx.restore();
  }
  if(parts!==undefined)assert.equal(result.parts,parts,label);
  if(rebuilt!==undefined)assert.equal(result.rebuilt,rebuilt,label);
  assert(result.pixels<=8050000,label+': bounded raster memory');
  const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
  let sum=0,large=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);sum+=d;if(d>40)large++;}
  assert(sum/x.length<1.7&&large/x.length<.02,`${label}, DPR ${ratio}: mean ${sum/x.length}, large ${large/x.length}`);
  return result;
 }
 check('whole-layer source',{rebuilt:true});check('unchanged',{parts:0,rebuilt:false});
 view.navigating=true;view.x+=80;view.y-=20;check('whole-layer pan',{parts:0,rebuilt:false});
 view.scale=1;view.x=-3500;view.y=-2000;view.navigating=false;check('viewport source',{rebuilt:true});
 view.navigating=true;
 view.x+=60;view.y+=20;check('within resident margin',{parts:0,rebuilt:false});
 for(const [dx,dy]of [[330,240],[-820,-390],[540,0],[0,440],[-600,-500],[3000,0]]){
  view.x+=dx;view.y+=dy;const result=check('newly exposed strips',{rebuilt:false});assert(result.parts>0);
 }
 view.x+=.23;view.y+=.41;check('fractional navigation');
 view.navigating=false;check('persistent physical-pixel phase',{rebuilt:false});
 view.navigating=true;view.scale*=1.01;
 const target=a.getContext('2d');target.setTransform(ratio,0,0,ratio,0,0);
 const oldCalls=calls,preview=cache.render(target,view,area,bounds,stamp,paint);
 assert(preview.preview);assert.equal(calls,oldCalls,'Zoom preview must not rerasterize paths');
 view.navigating=false;check('settled zoom',{rebuilt:true});
 opacity=.82;stamp='opacity';check('transparency invalidation',{rebuilt:true});
 color='#54a0e7';stamp='region-color';check('color invalidation',{rebuilt:true});
 edit={x:(area.x+area.w/2-view.x)/view.scale,y:(area.y+area.h/2-view.y)/view.scale,w:100,h:80};cache.invalidate([edit]);assert(check('local transparent edit',{rebuilt:false,parts:0}).patched>0);
 const removed=edit;edit=null;cache.invalidate([removed]);assert(check('local deletion',{rebuilt:false,parts:0}).patched>0);
 cache.invalidate([{x:-99999,y:-99999,w:10,h:10}]);check('offscreen edits retain the resident cache',{rebuilt:false,parts:0});
 cache.clear();check('map or plan replacement',{rebuilt:true});
 console.log('PASS ordered region opacity, overlap, pan, edge strips, zoom, invalidation and pixel phase, DPR',ratio);
}
