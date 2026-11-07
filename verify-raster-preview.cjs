/* Preview quality levels, partial progress, cache reuse and transparent replacement. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createCanvas}=require('@napi-rs/canvas');
const frames=new Map();let next=1,paints=0,scheduled=0;
const context={console,performance,requestAnimationFrame(fn){const n=next++;frames.set(n,fn);return n;},cancelAnimationFrame(n){frames.delete(n);}};
vm.createContext(context);for(const file of ['raster-refinement.js','raster-preview-cache.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
const step=()=>{const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn();};
function drain(){let n=0;while(frames.size){assert(++n<500);step();}}
for(const ratio of [1,1.5,2]){
 const image=createCanvas(800*ratio,480*ratio),ctx=image.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);
 const cache=context.CrateRasterPreviewCache.create({makeCanvas:()=>createCanvas(1,1),schedule(){scheduled++;},maxPixels:1600000});
 const bounds={x:-1024,y:-1024,w:8192,h:8192},area={x:0,y:0,w:800,h:480},view={x:15.25,y:-30.75,scale:.25};let source='first';
 const paint=(contexts,v)=>{paints++;const c=contexts[0];c.save();c.translate(v.x,v.y);c.scale(v.scale,v.scale);c.fillStyle='rgba(40,200,220,.5)';c.fillRect(-1024,-1024,8192,8192);c.clearRect(1400,500,300,250);c.restore();};
 const render=detail=>{ctx.clearRect(0,0,800,480);return cache.render(ctx,view,area,{source,ratio,bounds,layers:1,valid:()=>true,basePhysical:.02,paint,detail,background(){ctx.fillStyle='rgba(220,40,60,.5)';ctx.fillRect(0,0,800,480);}});};
 const before=paints,r=render();assert(r.pendingTiles>0);assert.equal(paints,before,'Initiating a preview must not paint synchronously');assert.equal(r.previewTiles,0);
 step();const partial=render();assert(partial.previewTiles>0,'Finished tiles appear before an entire level is complete');drain();let done=render();drain();done=render();
 assert(done.previewTiles>0);assert(cache.status.levels.length>=2,'Preview keeps multiple resolution levels');assert(cache.status.pixels<=1600000);
 const at=(x,y)=>[...ctx.getImageData(Math.floor(x*ratio),Math.floor(y*ratio),1,1).data];
 assert(at(200,200)[2]>150);assert.equal(at(390,120)[3],0,'Transparent tile holes replace the overview');
 let pixels=ctx.getImageData(0,0,image.width,image.height).data;for(let i=3;i<pixels.length;i+=4)assert(pixels[i]<=128,'Preview layers must not double alpha');
 const count=paints;render();drain();assert.equal(paints,count,'Revisiting a completed view must reuse tiles');
 view.scale=.4;render();drain();render();assert(cache.status.levels.length>=2);view.scale=.25;render();drain();
 const detail={rect:{x:200.13,y:100.17,w:170.3,h:140.7},paint(){ctx.fillStyle='rgba(80,240,20,.5)';ctx.fillRect(200.13,100.17,170.3,140.7);ctx.clearRect(240,130,30,25);}};
 const mixed=render(detail);assert(mixed.mixedDetail);assert.equal(at(250,140)[3],0);assert(at(220,120)[1]>200);
 pixels=ctx.getImageData(0,0,image.width,image.height).data;for(let i=3;i<pixels.length;i+=4)assert(pixels[i]<=128,'Detail and cached preview cannot stack');
 const n=cache.status.tiles;cache.invalidate([{x:0,y:0,w:4000,h:4000}]);assert(cache.status.tiles<n);render();drain();
 source='replacement';const reset=render();assert.equal(reset.previewTiles,0,'New map/style must not display stale tiles');
 cache.clear();drain();assert.equal(cache.status.pixels,0);assert.equal(cache.status.pending,0);
}
assert(scheduled>0);console.log('PASS progressive preview levels/tiles, no synchronous painting, reuse, transparent holes, alpha seams, local invalidation, memory budget and cancellation at DPR 1/1.5/2');
