/* Numerical work survives display changes; superseded maps/radii never publish. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const workers=[],radius=value=>Math.max(1,Math.min(32,Number(value)||3)),activity=[];let state,range=3,redraws=0,changes=0,editing=false;
const context={performance,URL,console,setTimeout,clearTimeout,document:{baseURI:'http://localhost/maps.html'},CrateBuffSource:require('./buff-source.js'),CrateProbability:{heatStyle:()=>({})},CrateUnitBuff:{radius},CrateBuffReference:require('./buff-reference.js'),Worker:class{constructor(){this.messages=[];workers.push(this);}postMessage(m){this.messages.push(m);}emit(m){this.onmessage({data:m});}},scheduler:{postTask:async fn=>fn()}};
vm.createContext(context);vm.runInContext(fs.readFileSync('buff-expectation-ui.js','utf8'),context);
const fixture=sha=>{const cells=[{x:5,y:5,px:20,py:20,level:0,land:0,candidate:true,primary:true,track:true,status:'crate',surface:[[[0,-15],[30,0],[0,15],[-30,0]]]}],data={metadata:{sourceSha256:sha,version:'yr',size:[0,0,10,10]},rendering:{origin:[0,0],width:600,height:300},probability:{exact:{}},cells};return {data,lookup:new Map(cells.map(c=>[c.x+','+c.y,c]))};};
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));for(let n=0;n<20;n++)await Promise.resolve();};
(async()=>{state=fixture('first');const field=context.CrateBuffExpectationUI.create({getState:()=>state,getRadius:()=>range,isEditing:()=>editing,schedule:()=>redraws++,onChange:()=>changes++,onPending:(pending,work)=>activity.push({pending,...work})});
 field.refresh();await flush();assert.equal(workers.length,1);const worker=workers[0],jobs=()=>worker.messages.filter(m=>m.radius),first=jobs()[0];assert(first);assert(field.status.pending);assert.equal(redraws,0);
 field.setEnabled(true);field.setEnabled(false);await flush();assert.equal(jobs().length,1);assert.equal(worker.messages.filter(m=>m.cancel).length,0,'Toggling display never cancels numeric work');
 const reply=(job,value,done=true)=>({id:job.id,bounds:{left:1,right:10,top:1,bottom:10},keys:[5*512+5],numbers:[value],maximum:Math.max(1,value),diagnostics:{},ms:10,progress:done?1:.5,done});
 let resolved=false;const ready=field.ready().then(()=>resolved=true);worker.emit(reply(first,2,false));await flush();assert.equal(field.get(5,5),2);assert(!resolved);assert.equal(redraws,0,'Hidden batches do not redraw terrain');worker.emit(reply(first,3));await ready;assert(!field.status.pending);assert(resolved);assert(changes>0);
 field.setEnabled(true);field.setEnabled(false);field.refresh();await flush();assert.equal(jobs().length,1,'Completed fields are reused across visibility changes');
 const ctx={save(){},beginPath(){},rect(){},clip(){},restore(){},getTransform:()=>({a:1,b:0}),drawImage(){}},view={x:0,y:0,scale:1},area={x:0,y:0,w:200,h:100},options={heatmap:true,values:false,filter:'all',opacity:35,palette:'warm',baselineLayer:true};
 field.setEnabled(true);field.paint(ctx,view,area,options);const paints=()=>worker.messages.filter(m=>m.paint),paint=paints().at(-1);assert(paint);assert.equal(activity.at(-1).calculating,false);assert.equal(activity.at(-1).rasterizing,true,'Raster work is distinct from numeric calculation');
 field.setEnabled(false);assert.equal(activity.at(-1).pending,false);let closed=0;worker.emit({...paint,image:{width:paint.plan.width,height:paint.plan.height,close(){closed++;}},ms:4});assert.equal(redraws,0,'Hidden raster completion does not redraw the scene');assert.equal(closed,0,'A hidden, valid raster is retained');
 field.setEnabled(true);field.paint(ctx,view,area,options);assert.equal(paints().length,1,'Returning to a completed hidden raster does not paint it again');assert(!field.status.rasterPending);assert.equal(jobs().length,1);field.setEnabled(false);
 range=4;field.refresh();range=5;field.refresh();await flush();assert.equal(jobs().length,2,'Only the latest queued radius is sent');assert.equal(jobs()[1].radius,5);worker.emit(reply(first,99));assert.equal(field.get(5,5),3,'Stale responses cannot overwrite the current field');
 const old=jobs()[1];state=fixture('second');field.refresh();assert.equal(field.get(5,5),0,'A different map clears previous values before asynchronous packing');await flush();worker.emit(reply(old,99));assert.equal(field.get(5,5),0);const current=jobs().at(-1);worker.emit(reply(current,4));assert.equal(field.get(5,5),4);
 state={...state,data:{...state.data,metadata:{...state.data.metadata,previewOnly:true}}};field.refresh();assert(!field.status.pending);assert.equal(field.get(5,5),0);worker.emit(reply(current,99));assert.equal(field.get(5,5),0);assert.equal(redraws,0);
 // Bursts invalidate old work immediately, accumulate deltas from the last
 // completed source, and start only the last published probability snapshot.
 {state=fixture('burst');field.refresh();await flush();const initial=jobs().at(-1);worker.emit(reply(initial,1));
 const beforeJobs=jobs().length;
 for(let i=0;i<8;i++){const previous=state.data,old=previous.cells[0],cell={...old,candidate:!!(i%2),status:'crate'};state={...state,data:{...previous,cells:[cell]},lookup:new Map([['5,5',cell]])};field.update(previous,[[old,cell]]);}
 assert(field.status.queued);assert.equal(jobs().length,beforeJobs);worker.emit(reply(initial,999));assert.equal(field.get(5,5),1,'Superseded completions are rejected before the debounce expires');
 editing=true;await new Promise(resolve=>setTimeout(resolve,180));await flush();assert.equal(jobs().length,beforeJobs,'Hidden work waits until a continuous brush stroke ends');editing=false;await new Promise(resolve=>setTimeout(resolve,60));await flush();assert.equal(jobs().length,beforeJobs+1);const latest=jobs().at(-1);assert(latest.update);assert.equal(latest.update.baseId,initial.data.id);assert.equal(latest.update.delta.length,0,'Changes that cancel within the burst reuse the numeric input');assert.equal(latest.background,true);assert(field.status.geometryReused);
 worker.emit(reply(latest,2));field.setEnabled(true);await flush();assert.equal(jobs().length,beforeJobs+1,'Switching to a warmed field cannot restart its numerical job');field.setEnabled(false);
 const previous=state.data,old=previous.cells[0],cell={...old,candidate:false};state={...state,data:{...previous,cells:[cell]},lookup:new Map([['5,5',cell]])};field.update(previous,[[old,cell]]);assert(field.status.queued);field.setEnabled(true);await flush();assert.equal(jobs().length,beforeJobs+2,'Visible mode flushes the newest queued update immediately');
 const flushed=jobs().at(-1);worker.emit({id:flushed.id,needSource:true});assert(jobs().at(-1).data,'Worker-base mismatch falls back to a cached complete source without repacking');worker.emit(reply(jobs().at(-1),3));field.setEnabled(false);}
 // Interrupt a large publication at an actual async slice boundary. Its tail
 // must not overwrite a newer generation, nor mark that generation complete.
 {range=6;field.refresh();await flush();const job=jobs().at(-1),gates=[];let clock=0;
 context.performance={now:()=>clock+=3};context.scheduler.postTask=fn=>new Promise(resolve=>gates.push(()=>resolve(fn())));
 const keys=Array.from({length:1024},(_,i)=>20*512+i),message={...reply(job,9),keys,numbers:keys.map(()=>9)};worker.emit(message);assert(gates.length);assert.equal(field.get(0,21),0,'The batch yields before publishing its tail');
 range=7;field.refresh();const resumed=gates.shift();context.scheduler.postTask=async fn=>fn();context.performance=performance;resumed();await flush();assert.equal(field.get(0,21),0,'A superseded publishing tail is discarded');assert(field.status.pending,'Discarding the old tail cannot finish the newer request');
 worker.emit(reply(jobs().at(-1),7));assert.equal(field.get(5,5),7);assert(!field.status.pending);}
 // An input can acquire priority after a background task was scheduled but
 // before it runs. Recheck at the continuation, before packing or publishing.
 {const gates=[];let paused=false,resume;context.CrateMapPriority={get blocked(){return paused;},wait:()=>new Promise(resolve=>resume=resolve)};
 context.scheduler.postTask=fn=>new Promise(resolve=>gates.push(()=>resolve(fn())));range=8;field.refresh();await flush();assert(gates.length);const count=jobs().length;paused=true;gates.shift()();await flush();assert.equal(jobs().length,count,'A queued task must yield to a newly arrived first input');
 context.scheduler.postTask=async fn=>fn();paused=false;resume();await flush();assert.equal(jobs().length,count+1);worker.emit(reply(jobs().at(-1),8));assert(!field.status.pending);delete context.CrateMapPriority;}
 console.log('PASS background precompute, numeric/raster activity, hidden-raster reuse, stroke coalescing, latest source/radius/map, preview cancellation, async stale-batch exclusion and queued-task input priority');
})().catch(e=>{console.error(e);process.exitCode=1;});
