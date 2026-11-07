/* Optional overview warmup never competes with a continuous edit stream. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas');
let now=0,next=1,wakes=0;const timers=new Map(),starts=[];
const context={module:{exports:{}},require,console,performance:{now:()=>now},clearTimeout:id=>timers.delete(id),setTimeout(fn,ms){const id=next++;timers.set(id,{fn,at:now+ms});return id;},CrateRasterRefinement:{create(){let active;return {available:true,get pending(){return !!active;},cancel(){active=null;},check(){if(active&&!active.valid())active=null;},start(spec){if(active?.key===spec.key)return;active=spec;starts.push(spec);}};}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('map-renderer.js','utf8'),context);
const c={x:1,y:1,px:300,py:300,level:0,land:0,status:'crate',terms:[],usable:true},image=createCanvas(100,60);
let data={metadata:{},rendering:{width:10000,height:6000,origin:[0,0]},cells:[c],markers:[],potentialMarkers:[],zeroProbabilityRockCandidates:[],probability:{sampleCount:1,denominator:'1',exact:{denominator:'1',baselineNumerator:'1'}}};
const display={maxMultiplier:1,get:()=>({multiplier:1,isBaseline:true}),showLabel:()=>false,meetsThreshold:()=>true};
const state={data,image,objectImage:image,cells:[c],lookup:new Map([['1,1',c]]),x:0,y:0,scale:1,liveEditing:true,artworkRevision:0},area={x:0,y:0,w:800,h:500},opts={objects:true,heatmap:false,filter:'all',threshold:0,opacity:45,palette:'warm'},canvas=createCanvas(800,500),cache=context.module.exports.createViewCache(()=>createCanvas(1,1),()=>wakes++);
const draw=()=>cache.render(canvas.getContext('2d'),state,area,display,opts);
draw();assert.equal(starts.length,1,'A cold focused view can warm its first overview');
assert(starts[0].width>=3150&&starts[0].height>=1890,'The new-terrain preview has twice the old linear resolution');
assert(starts[0].width*starts[0].height<=6100000,'The sharper overview remains bounded');
for(let i=0;i<50;i++){
 now+=16;state.data={...data};state.artworkRevision++;state.overlayDirty=[];draw();
 assert.equal(starts.length,1,'Each new edit replaces the pending warmup rather than starting a canvas job');assert.equal(timers.size,1);
}
now+=250;for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}
assert.equal(wakes,1);draw();assert.equal(starts.length,2,'Only the final stable content warms an overview');
assert(starts[1].valid());state.data={...data};assert(!starts[1].valid(),'A late raster cannot overwrite a newer probability result');
now+=1;draw();assert.equal(timers.size,1);cache.clear();assert.equal(timers.size,0,'Changing maps cancels the delayed wake');
console.log('PASS 50 merged warmups, one idle job, late-result rejection and map-reset cancellation');
