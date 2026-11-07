'use strict';
const assert=require('node:assert/strict'),{createCanvas,Path2D}=require('@napi-rs/canvas'),{clearMatte}=require('./map-raster-background.js'),C=require('./map-coordinates.js');
const c=createCanvas(80,60),ctx=c.getContext('2d');ctx.fillStyle='#18232b';ctx.fillRect(0,0,80,60);
ctx.fillStyle='#aaccee';ctx.fillRect(20,20,40,30);ctx.fillRect(5,12,12,6);ctx.fillStyle='#18232b';ctx.fillRect(30,30,6,6);
const image=ctx.getImageData(0,0,80,60);clearMatte(image.data,80,60);
const pixel=(x,y)=>[...image.data.slice((y*80+x)*4,(y*80+x)*4+4)];
assert.equal(pixel(0,0)[3],0);assert.equal(pixel(10,10)[3],0);assert.equal(pixel(79,59)[3],0);
assert.deepEqual(pixel(10,14),[170,204,238,255],'Sprite overhang must survive without clipping to terrain cells');
assert.deepEqual(pixel(32,32),[24,35,43,255],'An interior artwork pixel matching the matte must survive');
const data={metadata:{size:[0,0,2,2]},rendering:{origin:[90,0]}},lookup=new Map(),space=C.create(data,lookup,{makeCanvas:()=>createCanvas(1,1),makePath:()=>new Path2D()});
const out=createCanvas(160,120),target=out.getContext('2d'),view={x:0,y:10,scale:1},area={x:0,y:0,w:160,h:120};space.paint(target,view,area);
const samples=target.getImageData(65,35,40,40).data;let dark=0,solid=0;
for(let i=0;i<samples.length;i+=4)if(samples[i+3]===255){solid++;if(samples[i]<40&&samples[i+1]<40&&samples[i+2]<45)dark++;assert(samples[i]<150,'Hatch highlights stay gray');}
assert(dark/solid>.85,'Thin cell borders leave the solid dark background dominant');
target.clearRect(0,0,160,120);target.save();space.clipTerrain(target,view);target.fillRect(0,0,160,120);target.restore();assert(!target.getImageData(0,0,160,120).data.some((v,i)=>i%4===3&&v),'Camera shading must not cover void or invalid coordinates');
console.log('PASS transparent legacy margins, intact sprite overhang and interior colors, solid dark cells with thin borders, no void camera mask');
