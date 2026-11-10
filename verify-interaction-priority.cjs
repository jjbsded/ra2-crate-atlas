'use strict';
const assert=require('node:assert/strict'),{create}=require('./interaction-priority.js');
let time=0,serial=0;const timers=new Map(),frames=new Map();
const setTimer=(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:time+delay});return id;},clearTimer=id=>timers.delete(id),frame=fn=>{const id=++serial;frames.set(id,fn);return id;},cancelFrame=id=>frames.delete(id);
const advance=ms=>{const until=time+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=until;};
const drawFrame=()=>{const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();};
let touched=0,closed=0,allowed=true;const p=create({now:()=>time,setTimer,clearTimer,frame,cancelFrame,canWarm:()=>allowed,warm:function*(){try{for(let i=0;i<4;i++){touched++;yield;}}finally{closed++;}}});
(async()=>{
 p.leave();advance(500);assert(!p.resume());assert(!p.blocked);assert.equal(touched,0);
 p.leave();advance(1200);assert(p.resume());assert(p.blocked);assert(!p.resume(),'Duplicate focus / visibility events do not restart recovery');drawFrame();assert.equal(touched,1,'A recovery frame only touches one resident source');
 let released=false;const wait=p.wait().then(()=>released=true);assert(p.input());assert.equal(closed,1,'An immediate drag cancels remaining warmup');drawFrame();assert.equal(touched,1);
 for(let i=0;i<5;i++){advance(70);p.move();}assert(!p.blocked,'Long gestures cannot starve background work beyond the bounded first-input window');await wait;assert(released);assert.equal(p.status.protectedInputs,1);
 p.leave();advance(1300);p.resume();for(let i=0;i<5;i++)drawFrame();assert.equal(p.status.warmed,1);assert.equal(touched,5);advance(200);assert(!p.blocked);
 p.leave();advance(1300);p.resume();const earlyWait=p.wait();const early=[...timers][0];time+=179;timers.delete(early[0]);early[1].fn();assert(p.blocked);assert(timers.size,'A browser timer firing before a fractional deadline must re-arm');advance(2);await earlyWait;assert(!p.blocked);assert.equal(p.status.waiting,0);
 p.leave();advance(1500);p.resume();allowed=false;drawFrame();assert(!p.status.warming);advance(200);allowed=true;
 // The real shared raster queue must hold old frame work without dropping
 // jobs or painting stale requests when it resumes.
 const saved={raf:global.requestAnimationFrame,caf:global.cancelAnimationFrame,priority:global.CrateMapPriority};
 global.requestAnimationFrame=frame;global.cancelAnimationFrame=cancelFrame;global.CrateMapPriority=p;
 const R=require('./raster-refinement.js');p.leave();advance(1500);p.resume();let stale=true,painted=0,aborted=0;
 R.enqueue({valid:()=>!stale,abort:()=>aborted++,cost:()=>1,step:()=>painted++,remaining:()=>false,finish(){},fail(e){throw e;}});
 for(let i=0;i<5;i++)R.enqueue({valid:()=>true,abort(){},cost:()=>1,step(){assert(!p.blocked);painted++;},remaining:()=>false,finish(){},fail(e){throw e;}});
 drawFrame();assert.equal(painted,0);assert.equal(p.status.waiting,1,'One shared queue waits once rather than adding a backlog per tile');p.input();advance(400);await Promise.resolve();drawFrame();assert.equal(painted,5);assert.equal(aborted,1);
 global.requestAnimationFrame=saved.raf;global.cancelAnimationFrame=saved.caf;global.CrateMapPriority=saved.priority;
 console.log('PASS deduplicated recovery, one-source warm slices, first-input cancellation, bounded priority, shared raster suspension and stale-job rejection');
})().catch(error=>{console.error(error);process.exitCode=1;});
