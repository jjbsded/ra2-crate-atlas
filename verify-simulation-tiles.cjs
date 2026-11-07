/* Real decoded pixels, optional ground references, stale work and recovery. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createCanvas,loadImage}=require('@napi-rs/canvas');
let decoded=0,hold=null;
class TestImage{set src(value){this.source=value;}async decode(){decoded++;if(hold)await hold;const image=await loadImage(this.source),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);return Object.assign(this,{canvas});}}
// The browser accepts HTMLImageElement; this test substitutes a real Canvas
// after decode so the native test rasterizer can inspect the same pixels.
const context={console,clearTimeout,setTimeout,performance,Image:TestImage,CrateMapArtwork:require('./map-artwork.js')};
vm.createContext(context);let source=fs.readFileSync('simulation-visual.js','utf8').replace('diagnostics.decoded++;return image;','diagnostics.decoded++;return image.canvas||image;');vm.runInContext(source,context);
const color=value=>{const c=createCanvas(8,8);c.getContext('2d').fillStyle=value;c.getContext('2d').fillRect(0,0,8,8);return c;},url=value=>color(value).toDataURL('image/png');
let state={image:color('#888'),objectImage:color('#888')},paints=0;
const visual=context.CrateSimulationVisual.create({getState:()=>state,schedule(){},onPaint(){paints++;}}),packet=(key,objects,ground)=>({patches:[{box:[0,0,8,8],groundKey:key,ground,objects}],done:1,total:1,plan:{}});
const pixels=image=>{const c=createCanvas(8,8);context.CrateMapArtwork.draw(c.getContext('2d'),image,0,0,8,8);return Buffer.from(c.getContext('2d').getImageData(0,0,8,8).data);};
(async()=>{
 const ground=url('#c7af8d'),red=url('red'),blue=url('blue');
 assert(await visual.installTiles(packet('g',red,ground),()=>true));assert.equal(decoded,2);
 const frozen=state.objectImage.snapshot(),before=pixels(frozen);
 assert(await visual.installTiles(packet('g',blue),()=>true));assert.equal(decoded,3,'Unchanged ground is not decoded again');
 assert(pixels(state.objectImage).equals(pixels(color('blue'))));assert(pixels(frozen).equals(before),'Previously frozen pixels never change');
 assert.equal(visual.diagnostics.groundHits,1);
 await assert.rejects(()=>visual.installTiles(packet('missing',red),()=>true),{code:'ART_GROUND_MISSING'});
 visual.clearGrounds();assert(await visual.installTiles(packet('missing',red,ground),()=>true));
 const count=paints;let release;hold=new Promise(resolve=>release=resolve);
 const obsolete=visual.installTiles(packet('obsolete',blue,ground),()=>true);visual.reset();release();assert.equal(await obsolete,false);hold=null;
 assert.equal(paints,count);assert.equal(visual.groundKeys().length,0,'Resetting during decode cannot repopulate old checkpoints');
 assert(pixels(frozen).equals(before));
 for(let i=0;i<66;i++)await visual.installTiles(packet('g'+i,red,ground),()=>true);
 assert.equal(visual.groundKeys().length,64);assert(!visual.groundKeys().includes('g0'));
 const n=decoded;assert.equal(await visual.installTiles(packet('stale',blue,ground),()=>false),false);assert.equal(decoded,n);
 console.log('PASS decoded tile pixels, one-layer decode, frozen snapshots, missing-reference recovery, stale/reset safety and 64-entry LRU');
})().catch(error=>{console.error(error);process.exitCode=1;});
