/* Deterministic background frames, stale-job cancellation and pixel parity. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createCanvas,Path2D}=require('@napi-rs/canvas');
const queue=new Map();let next=1,scheduled=0;const allocated=[];
const context={console,performance,document:{createElement(){return createCanvas(1,1);}},requestAnimationFrame(fn){const id=next++;queue.set(id,fn);return id;},cancelAnimationFrame(id){queue.delete(id);}};
vm.createContext(context);vm.runInContext(fs.readFileSync('raster-refinement.js','utf8'),context);
vm.runInContext(fs.readFileSync('raster-preview-cache.js','utf8'),context);
const Ref=context.CrateRasterRefinement;
function step(){const callbacks=[...queue.values()];queue.clear();for(const callback of callbacks)callback();}
function drain(){let n=0;while(queue.size){assert(++n<500,'Background jobs must finish');step();}return n;}
const makeCanvas=()=>{const image=createCanvas(1,1);allocated.push(image);return image;};
const worker=Ref.create({makeCanvas,schedule(){scheduled++;}});let published=null,valid=true,painted=[];
const spec={key:'first',width:1700,height:1300,ratio:1.5,layers:2,valid:()=>valid,
 paint(contexts,part){painted.push(part);for(const ctx of contexts){ctx.fillStyle='#65c9a4';ctx.fillRect(part.x,part.y,part.w,part.h);}},publish:images=>{published=images;}};
worker.start(spec);assert(worker.pending);assert.equal(allocated[0].width,1,'Allocation must not block the initiating render');
step();assert.equal(allocated[0].width,1700);assert.equal(allocated[1].width,1,'Only one large allocation per background frame');
step();assert.equal(allocated[1].width,1700);assert.equal(painted.length,0);
step();assert.equal(painted.length,1,'Two-layer tiles share the global pixel budget');assert.equal(published,null,'Never publish partial images');
const obsolete=allocated.slice();valid=false;step();assert.equal(worker.pending,false);assert.equal(published,null);assert(obsolete.every(image=>image.width===1));
valid=true;worker.start({...spec,key:'replacement'});const frames=drain();assert(published&&scheduled===1&&frames>3);assert.equal(worker.pending,false);
for(const image of published){const data=image.getContext('2d').getImageData(0,0,image.width,image.height).data;for(let i=0;i<data.length;i+=4)assert.equal(data[i+3],255,'Physical tile boundaries must not leave seams');}
assert.deepEqual(JSON.parse(JSON.stringify(Ref.uncovered({x:0,y:0,w:100,h:80},{x:10,y:20,w:70,h:50}))),[{x:0,y:0,w:100,h:20},{x:0,y:70,w:100,h:10},{x:0,y:20,w:10,h:50},{x:80,y:20,w:20,h:50}]);
global.CrateRasterRefinement=Ref;
global.CrateRasterPreviewCache=context.CrateRasterPreviewCache;
const Region=require('./region-overlay-cache.js'),area={x:15,y:20,w:800,h:460},bounds={x:0,y:0,w:6000,h:3500};
const path=new Path2D();path.rect(100,100,5500,3100);path.rect(1400,900,1300,700);
let stamp='original',color='#aa67d4',calls=0;
const paint=(ctx,v)=>{calls++;ctx.save();ctx.translate(v.x,v.y);ctx.scale(v.scale,v.scale);ctx.fillStyle=color;ctx.globalAlpha=.42;ctx.fill(path,'evenodd');ctx.restore();};
const cache=Region.create(makeCanvas,()=>scheduled++),a=createCanvas(900,540),b=createCanvas(900,540),view={x:-130,y:-150,scale:.25,navigating:false};
function draw(){const ctx=a.getContext('2d');ctx.clearRect(0,0,900,540);ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();const r=cache.render(ctx,view,area,bounds,stamp,paint);ctx.restore();return r;}
function compare(){const ctx=b.getContext('2d');ctx.clearRect(0,0,900,540);ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();paint(ctx,view);ctx.restore();const x=a.getContext('2d').getImageData(0,0,900,540).data,y=ctx.getImageData(0,0,900,540).data;let sum=0;for(let i=0;i<x.length;i++)sum+=Math.abs(x[i]-y[i]);assert(sum/x.length<.3,'Background commit must match exact direct pixels');}
assert(draw().rebuilt);view.scale=.31;view.x-=101;view.y-=73;
const count=calls,r=draw();assert(r.preview&&r.refining&&!r.rebuilt);assert.equal(calls,count,'The render starts work without painting a full replacement');
drain();assert(draw().refined);compare();
view.scale=.4;draw();step();view.scale=.42;draw();stamp='new-color';color='#28b5e2';draw();drain();draw();compare();
view.scale=.5;draw();assert(queue.size);cache.clear();drain();assert.equal(draw().rebuilt,true);compare();
view.scale=2;draw();view.scale=.5;const returned=draw();assert(!returned.rebuilt&&!returned.refining,'Returning to the complete source needs no replacement');
view.scale=2;draw();drain();draw();view.scale=.5;const exposed=draw();assert(exposed.preview&&exposed.refining);drain();draw();compare();
// Zooming out from a focused viewport must not submit exposed map polygons.
for(const cold of [false,true]){
 if(cold)cache.clear();view.scale=2;view.navigating=false;draw();drain();draw();
 view.navigating=true;view.scale=.2;const before=calls,fallback=draw();
 assert(fallback.overview&&!fallback.rebuilt);assert.equal(calls,before,'Overview fallback must eliminate exposed-strip painting, including a focused initial result');
 view.navigating=false;draw();drain();draw();compare();
}
console.log('PASS background allocation/paint budgets, atomic commit, obsolete cancellation, zoom pixels, holes, colors, exposed strips and reset');
(async()=>{
 const {loadImage}=require('@napi-rs/canvas'),path=require('node:path'),M=require('./map-renderer.js'),D=require('./probability-display.js'),R=require('./region-statistics.js');
 const file=process.argv[2]||'output/CrateAtlas-Windows-x64-Simulation-20261104/output/map-b88b83c9702a/result.json.gz';
 const raw=fs.readFileSync(file),data=JSON.parse(file.endsWith('.gz')?require('node:zlib').gunzipSync(raw):raw),dir=path.dirname(file),[ox,oy]=data.rendering.origin;
 const [image,objectImage]=await Promise.all([loadImage(path.join(dir,data.rendering.image)),loadImage(path.join(dir,data.rendering.objectImage))]);
 const cells=data.cells.map(c=>Object.assign(c,{px:30*(c.x-c.y)+ox,py:15*(c.x+c.y-c.level)+oy})).sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x),lookup=new Map(cells.map(c=>[`${c.x},${c.y}`,c]));
 const s={data,image,objectImage,cells,lookup,spatialIndex:R.createSelectionIndex(cells).screen,x:0,y:0,scale:.2},display=D.map(data),ratio=1.5;
 const x=createCanvas(1350,810),y=createCanvas(1350,810),ca=x.getContext('2d'),cb=y.getContext('2d'),viewport={x:0,y:0,w:900,h:540};
 const opts={objects:true,heatmap:true,baselineLayer:true,filter:'all',opacity:45,palette:'warm',threshold:0};
 for(const resident of [false,true]){
  s.liveEditing=resident;s.scale=.2;s.x=450-data.rendering.width*s.scale/2;s.y=270-data.rendering.height*s.scale/2;
  const cache=M.createViewCache(makeCanvas,()=>scheduled++);
  const draw=()=>{ca.setTransform(ratio,0,0,ratio,0,0);ca.fillStyle='#101c25';ca.fillRect(0,0,900,540);return cache.render(ca,s,viewport,display,opts);};
  const compare=label=>{cb.setTransform(ratio,0,0,ratio,0,0);cb.fillStyle='#101c25';cb.fillRect(0,0,900,540);M.render(cb,s,viewport,display,opts);const a=ca.getImageData(0,0,1350,810).data,b=cb.getImageData(0,0,1350,810).data;let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);assert(sum/a.length<3,label+': '+sum/a.length);};
  assert(draw().cacheRebuilt);s.scale=.27;s.x=450-data.rendering.width*s.scale/2;s.y=270-data.rendering.height*s.scale/2;
  const pending=draw();assert(pending.refining&&!pending.cacheRebuilt);drain();const done=draw();assert(done.refined&&!done.cacheRebuilt);compare('refined base');
  s.scale=.32;draw();step();opts.palette=opts.palette==='cool'?'warm':'cool';assert(draw().cacheRebuilt);drain();assert(!draw().refined);compare('palette supersedes unfinished zoom');
  s.scale=.36;draw();step();cache.clear();drain();assert(draw().cacheRebuilt);compare('map reset cancels unfinished zoom');
  s.scale=.18;const wider=draw();assert(wider.preview&&wider.refining&&!wider.cacheRebuilt);drain();draw();compare('zoom out fills exposed strips before exact commit');
  for(const cold of [false,true]){
   if(cold)cache.clear();s.scale=2;s.x=450-data.rendering.width*s.scale/2;s.y=270-data.rendering.height*s.scale/2;draw();drain();draw();
   s.scale=.18;s.x=450-data.rendering.width*s.scale/2;s.y=270-data.rendering.height*s.scale/2;opts.navigation=true;
   const fallback=draw();assert(fallback.overview&&!fallback.cacheRebuilt,'Focused-to-wide zoom must reuse a complete overview');
   opts.navigation=false;draw();drain();draw();compare('overview navigation retains final-resolution pixels');
  }
 }
 console.log('PASS background base artwork/probability, both buffer modes, exact zoom pixels, palette cancellation and map reset');
})().catch(error=>{console.error(error);process.exitCode=1;});
