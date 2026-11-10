/* Use the same pixel compositor as the UI, with an independent scene owner. */
'use strict';
importScripts('mixed-painter.js');
let scene=null,paint=null,buckets=null;
self.onmessage=({data})=>{const{id}=data;try{
 if(data.scene){
  for(const image of scene?.images||[])image?.close();
  scene=data.scene;paint=CrateLivePainter.create(scene);
  buckets=scene.layers.map(sequence=>{
   const result=new Map();
   sequence.forEach((index,i)=>{const c=scene.commands[index],a=scene.data.assets[c.id];
    for(let y=Math.floor(c.y/512);y<=Math.floor((c.y+a[4]-1)/512);y++)for(let x=Math.floor(c.x/512);x<=Math.floor((c.x+a[3]-1)/512);x++){
     const key=x+','+y;if(!result.has(key))result.set(key,[]);result.get(key).push(i);
    }
   });return result;
  });
  self.postMessage({id,ready:true});return;
 }
 if(data.thumbnail){
  const {layer,crop:[sx,sy,sw,sh],size:[w,h]}=data.thumbnail;
  const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
  ctx.scale(w/sw,h/sh);ctx.translate(-sx,-sy);ctx.imageSmoothingEnabled=w/sw<1;
  const left=Math.max(0,sx),top=Math.max(0,sy),right=Math.min(scene.data.size[0],sx+sw),bottom=Math.min(scene.data.size[1],sy+sh);
  const count=(Math.ceil(right/512)-Math.floor(left/512))*(Math.ceil(bottom/512)-Math.floor(top/512));
  if(count>64){
   const ids=new Set();for(let y=Math.floor(top/512);y<Math.ceil(bottom/512);y++)for(let x=Math.floor(left/512);x<Math.ceil(right/512);x++)for(const i of buckets[layer].get(x+','+y)||[])ids.add(i);
   paint(ctx,[...ids].sort((a,b)=>a-b),scene.layers[layer]);
  }else for(let y=Math.floor(top/512);y<Math.ceil(bottom/512);y++)for(let x=Math.floor(left/512);x<Math.ceil(right/512);x++){
   const chunk=new OffscreenCanvas(512,512),part=chunk.getContext('2d');part.translate(-x*512,-y*512);
   paint(part,buckets[layer].get(x+','+y)||[],scene.layers[layer]);ctx.drawImage(chunk,x*512,y*512);
  }
  const image=canvas.transferToImageBitmap();self.postMessage({id,images:[image]},[image]);return;
 }
 if(data.output){
  const {layer,box:[x,y,w,h],view}=data.output,canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
  const scaleX=view.scaleX??view.scale,scaleY=view.scaleY??view.scale;
  ctx.translate(view.x,view.y);ctx.scale(scaleX,scaleY);
  const ids=new Set(),left=Math.max(0,(x-view.x)/scaleX),top=Math.max(0,(y-view.y)/scaleY),right=Math.min(scene.data.size[0],(x+w-view.x)/scaleX),bottom=Math.min(scene.data.size[1],(y+h-view.y)/scaleY);
  for(let by=Math.floor(top/512);by<Math.ceil(bottom/512);by++)for(let bx=Math.floor(left/512);bx<Math.ceil(right/512);bx++)for(const i of buckets[layer].get(bx+','+by)||[])ids.add(i);
  // Transfer the compositor's raw RGBA once. An intermediate transparent
  // bitmap can round premultiplied channels before blending onto the export.
  let pixels=null;paint(ctx,[...ids].sort((a,b)=>a-b),scene.layers[layer],{x,y},image=>{pixels={width:w,height:h,data:image.data};});
  self.postMessage({id,pixels},pixels?[pixels.data.buffer]:[]);return;
 }
 const[x,y,w,h]=data.box,images=[];
 for(let layer=0;layer<2;layer++){
  const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
  if(data.overview){const scale=typeof data.overview==='number'?data.overview:Math.min(w/scene.data.size[0],h/scene.data.size[1]);ctx.scale(scale,scale);}else ctx.translate(-x,-y);
  let indices;
  if(data.overview)indices=scene.layers[layer].keys();
  else{
   const ids=new Set();
   for(let by=Math.floor(y/512);by<Math.ceil((y+h)/512);by++)for(let bx=Math.floor(x/512);bx<Math.ceil((x+w)/512);bx++)for(const i of buckets[layer].get(bx+','+by)||[])ids.add(i);
   indices=[...ids].sort((a,b)=>a-b);
  }
  paint(ctx,indices,scene.layers[layer]);
  images.push(canvas.transferToImageBitmap());
 }
 self.postMessage({id,images},images);
}catch(error){self.postMessage({id,error:error.message});}};
