/* Actual raster output, retained Canvas nodes and latest-only queue lifecycle. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas');
const R=require('./region-statistics.js'),Artwork=require('./map-artwork.js');
const context={CrateRegionStatistics:R,CrateMapArtwork:Artwork,devicePixelRatio:1.5};
vm.createContext(context);vm.runInContext(fs.readFileSync('region-thumbnails.js','utf8'),context);
const source=createCanvas(720,400),objects=createCanvas(720,400);
for(const [image,color]of [[source,'#c5aa72'],[objects,'#714cab']]){const c=image.getContext('2d');c.fillStyle=color;c.fillRect(0,0,720,400);c.fillStyle='#58ce91';c.fillRect(100,80,200,120);}
const state={image:source,objectImage:objects,data:{rendering:{width:720,height:400}}};
const first={id:'r1',color:'#ff0000',cells:new Set([1])},second={id:'r2',color:'#0000ff',cells:new Set([2])};
let doc={active:'r1',transparency:80,regions:[first,second]},drawing=false,visible=true,deferred=0,time=0,next=0;
const settings={players:false,objects:false,playerStylesKey:'',size:{width:1,height:1}},tasks=new Map();
const geometry=new Map([[first,{revision:1,bounds:{x:100,y:80,w:100,h:80}}],[second,{revision:1,bounds:{x:200,y:150,w:130,h:100}}]]);
const controller=context.CrateRegionThumbnails.create({getState:()=>state,getDocument:()=>doc,getSettings:()=>settings,getGeometry:r=>geometry.get(r),
 paintRegion(ctx,r,view,alpha){ctx.globalAlpha=alpha;ctx.fillStyle=r.color;ctx.fillRect(view.x+100*view.scale,view.y+80*view.scale,80*view.scale,50*view.scale);ctx.globalAlpha=1;},
 isVisible:()=>visible,isDrawing:()=>drawing,onDeferred:()=>deferred++,makeCanvas(){const c=createCanvas(1,1);c.setAttribute=()=>{};return c;},
 now:()=>time+=6,defer(fn){tasks.set(++next,fn);return next;},cancelDeferred:id=>tasks.delete(id)
});
const button=image=>({children:[image],changes:0,replaceChildren(image){this.children=[image];this.changes++;}});
const targets=new Map();for(const r of doc.regions){const list=[button(controller.render(r,false)),button(controller.render(r,true))];targets.set(r.id,list);controller.setButtons(r.id,list);}
const pixels=c=>Buffer.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
const original=targets.get('r1')[0].children[0],originalPixels=pixels(original);
assert.equal(original.width,324);assert.equal(original.height,183);assert.equal(controller.render(first,false),original);
function step(){const [id,fn]=tasks.entries().next().value;tasks.delete(id);fn({timeRemaining:()=>10});}
function drain(){let n=0;while(tasks.size){assert(++n<100);step();}}
controller.request(true);step();assert(controller.status.pending,'Work is divided across regions');drain();
assert.equal(controller.status.replacements,0);assert.equal(controller.status.unchanged,4);
assert.equal(targets.get('r1')[0].children[0],original,'A refresh retains the Canvas DOM node');assert(pixels(original).equals(originalPixels));

doc.transparency=30;controller.request();step();
const partiallyApplied=targets.get('r1')[0].children[0];assert.notEqual(partiallyApplied,original);assert.equal(controller.render(first,false),partiallyApplied);
const obsolete=tasks.values().next().value;doc.transparency=55;controller.request();const count=controller.status.replacements;obsolete({timeRemaining:()=>10});
assert.equal(controller.status.replacements,count,'An obsolete callback cannot publish');drain();
assert.equal(tasks.size,0);assert(controller.status.cancelledJobs>0);assert.notEqual(targets.get('r1')[0].children[0],partiallyApplied);
assert(pixels(original).equals(originalPixels),'Older displayed/exported canvases are immutable');

drawing=true;doc.transparency=20;controller.request();step();assert.equal(deferred,1);assert.equal(controller.status.pending,false);
drawing=false;controller.request();drain();assert.equal(controller.status.pending,false);
settings.size={width:1.4,height:.8};controller.request(true);drain();
const resized=targets.get('r1')[0].children[0];assert.equal(resized.width,454);assert.equal(resized.height,146);
assert.equal(controller.render(first,false),resized);settings.objects=true;assert.notEqual(controller.render(first,false),resized);
const cached=controller.render(first,false);controller.invalidate();assert.notEqual(controller.render(first,false),cached);

controller.request(true);const late=tasks.values().next().value;doc={...doc,regions:[]};late({timeRemaining:()=>10});assert.equal(controller.status.pending,false,'A different document invalidates pending work');
tasks.clear();controller.reset();controller.request(true);drain();assert.equal(controller.status.pending,false,'An empty list settles without work');
visible=false;controller.request(true);assert.equal(tasks.size,0);
controller.clearButtons();assert.deepEqual(Array.from(controller.buttonsFor('r1')),[]);
console.log('PASS region thumbnails: raster/cache reuse, no-op DOM refresh, partial/latest-only work, cancellation, strokes, resizing, source and map changes');

(async()=>{
 visible=true;doc={active:'r1',transparency:80,regions:[first]};settings.objects=false;
 let resolve,requests=0;source.prepareThumbnail=()=>{requests++;return new Promise(done=>{resolve=done;});};
 controller.invalidate();const pending=controller.render(first,false),before=pixels(pending);
 assert.equal(requests,1);assert.equal(controller.render(first,false),pending);
 resolve(source);await pending.regionReady;assert(!pixels(pending).equals(before),'Background pixels publish asynchronously');
 controller.invalidate();const obsolete=controller.render(first,false),unchanged=pixels(obsolete),completeOld=resolve;
 controller.invalidate();const current=controller.render(first,false),completeNew=resolve;
 completeOld(source);await obsolete.regionReady;assert(pixels(obsolete).equals(unchanged),'Superseded thumbnail cannot publish');
 completeNew(source);await current.regionReady;assert(!pixels(current).equals(unchanged));
 controller.invalidate();const wrongDocument=controller.render(first,false),old=pixels(wrongDocument);
 doc={...doc};resolve(source);await wrongDocument.regionReady;assert(pixels(wrongDocument).equals(old));
 delete source.prepareThumbnail;
 console.log('PASS asynchronous thumbnail publication: retained canvas, deduplicated render, superseded style and map rejection');
})().catch(error=>{console.error(error);process.exitCode=1;});
