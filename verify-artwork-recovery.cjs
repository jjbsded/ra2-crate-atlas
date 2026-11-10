'use strict';
const assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas'),A=require('./map-artwork.js');
const data={rendering:{width:256,height:128,origin:[128,0]},cells:[{x:2,y:2,level:0,rawLand:0},{x:3,y:2,level:0,rawLand:2}]};
const image=A.fallback(data),canvas=createCanvas(256,128),ctx=canvas.getContext('2d');
A.draw(ctx,image,0,0,256,128);assert.deepEqual([...ctx.getImageData(128,60,1,1).data],[115,113,102,255]);assert.deepEqual([...ctx.getImageData(158,75,1,1).data],[54,83,104,255]);assert.equal(ctx.getImageData(0,0,1,1).data[3],0);
const crop=createCanvas(32,32),target=crop.getContext('2d');A.draw(target,image,100,40,64,64,0,0,32,32);assert.deepEqual([...target.getImageData(14,10,1,1).data],[115,113,102,255]);assert.equal(target.getTransform().a,1);assert.equal(image.snapshot(),image);
assert.equal(A.fallback({rendering:{},cells:[]}),null);
console.log('PASS missing-artwork fallback: projected terrain/water, transparent voids, source cropping, transforms and immutable snapshot');
