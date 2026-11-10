'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createCanvas}=require('@napi-rs/canvas');
const frames=new Map();let next=1;
const context={performance,console,requestAnimationFrame(fn){const n=next++;frames.set(n,fn);return n;},cancelAnimationFrame(n){frames.delete(n);}};
vm.createContext(context);for(const name of ['raster-refinement.js','map-label-cache.js'])vm.runInContext(fs.readFileSync(name,'utf8'),context);
function step(){const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();}
function drain(){let n=0;while(frames.size){assert(++n<500);step();}}
for(const ratio of [1,1.5,2]){
 const area={x:0,y:0,w:800,h:480},canvas=createCanvas(800*ratio,480*ratio),ctx=canvas.getContext('2d'),view={x:15/ratio,y:24/ratio,scale:1,navigating:false};ctx.setTransform(ratio,0,0,ratio,0,0);
 let paints=0,key='first',valid=true,color='#ffcc55';
 const paint=(target,v)=>{paints++;target.fillStyle=color;target.font='700 12px sans-serif';for(let y=-500;y<1400;y+=31)for(let x=-800;x<1800;x+=61){target.fillText('1.25×',v.x+x*v.scale,v.y+y*v.scale);target.globalAlpha=.5;target.fillRect(v.x+x*v.scale,v.y+(y+5)*v.scale,19*v.scale,3*v.scale);target.globalAlpha=1;}};
 const cache=context.CrateMapLabelCache.create({makeCanvas:()=>createCanvas(1,1),schedule(){},margin:64,maxPixels:3000000});
 function render(){ctx.clearRect(0,0,800,480);cache.render(ctx,view,area,{key,valid:()=>valid,paint});}
 function samePixels(){const expected=createCanvas(canvas.width,canvas.height),t=expected.getContext('2d');t.setTransform(ratio,0,0,ratio,0,0);paint(t,view,area);const a=ctx.getImageData(0,0,canvas.width,canvas.height).data,b=t.getImageData(0,0,canvas.width,canvas.height).data;let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;assert.equal(changed,0,'Cached labels retain pixels and translucent edges');}
 render();assert(cache.status.pending);drain();view.navigating=true;render();samePixels();assert(cache.status.ready);
 const before=paints;for(let i=0;i<60;i++){view.x=(15+i%31)/ratio;render();}assert.equal(paints,before,'Covered pan frames only copy existing pixels');
 view.x+=180;render();assert(!cache.status.pending,'Dragging never allocates or rebuilds a large text image');samePixels();view.navigating=false;render();assert(cache.status.pending);drain();view.navigating=true;render();samePixels();assert(cache.status.reusedParts>0,'Refinement copies overlapping pixels');assert(cache.status.pixels<=3000000);
 view.navigating=false;view.x+=.123;render();samePixels();view.x-=.123;view.navigating=true;
 key='new palette';color='#36caff';view.navigating=false;render();drain();view.navigating=true;render();samePixels();
 key='stale';view.navigating=false;render();step();const builds=cache.status.builds;valid=false;drain();assert.equal(cache.status.builds,builds,'Stale background work never publishes');assert(!cache.status.pending);
 key='current';valid=true;view.scale=1.5;render();drain();render();assert(cache.status.ready);cache.clear();assert.equal(cache.status.pixels,0);assert(!cache.status.pending);
 const small=context.CrateMapLabelCache.create({makeCanvas:()=>createCanvas(1,1),schedule(){},maxPixels:1});const calls=paints;small.render(ctx,view,area,{key,paint});assert.equal(paints,calls+1);assert(!small.status.pending,'Over-budget viewports keep native-resolution direct drawing');
 const warming=context.CrateMapLabelCache.create({makeCanvas:()=>createCanvas(1,1),schedule(){},margin:64,maxPixels:3000000}),alreadyPainted=paints;
 warming.render(ctx,view,area,{key,paint,paintStatic:false,prepare:false});assert.equal(paints,alreadyPainted);assert(!warming.status.pending,'Busy editing does not prepare text images');
 warming.render(ctx,view,area,{key,paint,paintStatic:false});assert.equal(paints,alreadyPainted,'Preparing a directly painted frame never paints translucent ink twice');assert(warming.status.pending);drain();assert(warming.status.ready);warming.clear();
}
console.log('PASS full-DPI labels, alpha seams, pan reuse, exposed strips, palette invalidation, stale jobs and bounded fallback');
