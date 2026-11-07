'use strict';
const assert=require('node:assert/strict'),{createCanvas,Path2D}=require('@napi-rs/canvas'),C=require('./map-coordinates.js'),N=require('./map-navigation.js'),A=require('./map-artwork.js'),D=require('./probability-display.js');
const cells=[{x:8,y:8,px:480,py:240,level:0},{x:9,y:8,px:510,py:255,level:0}],lookup=new Map(cells.map(c=>[c.x+','+c.y,c])),data={metadata:{size:[0,0,8,8],sourceSha256:'fixture'},rendering:{origin:[480,0]}};
const space=C.create(data,lookup,{makeCanvas:()=>createCanvas(1,1),makePath:()=>new Path2D()});assert.equal(space.max,15);assert.equal(lookup.size,2);assert.equal(space.get(8,8),cells[0]);assert(space.get(1,1).virtual);assert.equal(space.get(0,1),null);assert.equal(space.get(16,1),null);
for(let x=1;x<=15;x++)for(let y=1;y<=15;y++){const c=space.get(x,y);assert.equal(space.point(c.px,c.py),c);}
assert.equal(space.point(-1e6,0,true).x,1);assert.equal(space.point(-1e6,0,true).y,15);
const image=createCanvas(900,450),ctx=image.getContext('2d'),view={x:-space.bounds.x,y:-space.bounds.y,scale:1},area={x:0,y:0,w:900,h:450};space.paint(ctx,view,area);
const alpha=c=>ctx.getImageData(Math.round(c.px+view.x),Math.round(c.py+view.y),1,1).data[3];assert.equal(alpha(space.get(8,8)),0,'Real terrain is a hole in the missing-coordinate layer');assert.equal(alpha(space.get(7,8)),255,'Missing coordinates are visibly hatched');assert.equal(ctx.getImageData(1,1,1,1).data[3],0,'The enclosing rectangle does not invent invalid coordinates');
const frozen=space.snapshot(),before=image.toBuffer('image/png');lookup.clear();ctx.clearRect(0,0,900,450);frozen.paint(ctx,view,area);assert.deepEqual(image.toBuffer('image/png'),before,'Exported coordinate geometry survives map replacement');
const display=D.map({metadata:{},cells:[{terms:[[0,1]]}],probability:{exact:{denominator:'10',coefficients:[{n:1,r:0,numerator:'1'}]}}});assert.equal(display.get(space.get(1,1)).numerator,0n);assert.equal(display.showLabel(space.get(1,1)),false);assert.deepEqual(display.exactFraction(space.get(1,1)),{numerator:'0',denominator:'1'});
for(const a of [{x:24,y:3,w:1552,h:878},{x:8,y:8,w:374,h:700}]){
 const b=space.bounds,min=N.minimum(b,a),low=N.target({x:1e6,y:-1e6,scale:min/100},b,a);assert.equal(low.scale,min);
 for(const scale of [min,1,6]){const v={x:1e6,y:-1e6,scale},target=N.target(v,b,a),limits=N.limits(b,a,target.scale),rubber=N.input(v,b,a);assert(target.x>=limits.x[0]&&target.x<=limits.x[1]);assert(target.y>=limits.y[0]&&target.y<=limits.y[1]);const inputLimits=N.limits(b,a,scale);assert(rubber.x-inputLimits.x[1]<=Math.max(24,a.w*.08)+1e-6);assert(inputLimits.y[0]-rubber.y<=Math.max(24,a.h*.08)+1e-6);
  const left=target.x+b.x*target.scale,right=left+b.w*target.scale,top=target.y+b.y*target.scale,bottom=top+b.h*target.scale;
  for(const [blank,dimension]of [[left-a.x,b.w],[a.x+a.w-right,b.w],[top-a.y,b.h],[a.y+a.h-bottom,b.h]])assert(blank<=dimension*target.scale*.1+1e-6,'Every edge obeys the 10% limit, including portrait viewports');
 }
 let time=0,id=0,frames=new Map(),changes=0;const v={x:1e5,y:-1e5,scale:min*.9},nav=N.create({getView:()=>v,getBounds:()=>b,getArea:()=>a,now:()=>time,request:fn=>{frames.set(++id,fn);return id;},cancel:id=>frames.delete(id),onChange:()=>changes++});nav.settle();assert(nav.active);
 for(let n=0;frames.size&&n<120;n++){time+=16;const todo=[...frames.values()];frames.clear();for(const fn of todo)fn();}assert(!nav.active&&changes>1);const final=N.target(v,b,a);assert(Math.abs(v.x-final.x)<1e-9);assert(Math.abs(v.y-final.y)<1e-9);assert(Math.abs(v.scale-final.scale)<1e-9);
 nav.settle();assert.equal(frames.size,0,'In-range cameras do not start a return animation');v.x+=1e4;nav.settle();assert(frames.size);nav.drag(v);assert(!frames.size,'New input cancels the old return path');
}
const ground=createCanvas(40,30),objects=createCanvas(40,30),out=createCanvas(40,30);ground.getContext('2d').fillStyle='#204060';ground.getContext('2d').fillRect(0,0,40,30);objects.getContext('2d').drawImage(ground,0,0);objects.getContext('2d').fillStyle='#e08020';objects.getContext('2d').fillRect(10,5,20,20);
A.scene(out.getContext('2d'),{x:0,y:0,scale:1,image:ground,objectImage:objects},{width:40,height:30},{objects:true,objectOpacity:.5});assert.deepEqual([...out.getContext('2d').getImageData(1,1,1,1).data],[32,64,96,255]);assert.deepEqual([...out.getContext('2d').getImageData(15,10,1,1).data],[128,96,64,255]);
console.log('PASS valid origin coordinates, terrain holes, immutable exports, elastic bounds, return cancellation and ground-preserving object transparency');
