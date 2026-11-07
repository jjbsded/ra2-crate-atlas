/* Replacing a coarse source must preserve transparent holes and single alpha. */
'use strict';
const assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas'),R=require('./raster-refinement.js');
for(const ratio of [1,1.5,2]){
 const area={x:0,y:0,w:200,h:140},rect={x:40.13,y:28.57,w:120.34,h:88.19},image=createCanvas(200*ratio,140*ratio),ctx=image.getContext('2d');ctx.scale(ratio,ratio);
 let calls=0;
 const low=()=>{calls++;ctx.fillStyle='rgba(220,80,60,.5)';ctx.fillRect(0,0,200,140);};
 const high=()=>{calls++;ctx.fillStyle='rgba(30,200,220,.5)';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);ctx.clearRect(80,60,30,25);};
 assert(R.composite(ctx,area,rect,ratio,low,high));assert(calls<=5);
 const at=(x,y)=>[...ctx.getImageData(Math.floor(x*ratio),Math.floor(y*ratio),1,1).data];
 assert(at(10,10)[0]>200);assert(at(60,50)[2]>200);assert.equal(at(95,70)[3],0,'Transparent detail must replace the overview, including holes');
 const pixels=ctx.getImageData(0,0,image.width,image.height).data;
 for(let i=3;i<pixels.length;i+=4)assert(pixels[i]<=128,'Sources must never stack their translucent colors at a seam');
 calls=0;assert.equal(R.composite(ctx,area,{x:-400,y:-300,w:20,h:10},ratio,low,high),false);assert.equal(calls,1);
}
console.log('PASS mixed-resolution coverage, transparency, holes, offscreen fallback and bounded bitmap passes at DPR 1/1.5/2');
