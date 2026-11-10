'use strict';
const assert=require('node:assert/strict'),P=require('./buff-kernel-pool.js');
const workers=[];class Worker{constructor(){this.messages=[];workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.terminated=true;}reply(){const m=this.messages.filter(m=>m.id).at(-1);this.onmessage({data:{id:m.id,results:m.jobs.map(j=>({key:j.key,values:new Float64Array(800),requested:j.requested}))}});}}
const jobs=Array.from({length:40},(_,i)=>({sig:String(i),delta:new Map([[32,1]]),requested:2})),source={terminal:[[32,500]],N:1000,limit:1000};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
(async()=>{const pool=P.create({threads:2,makeWorker:()=>new Worker()}),seen=[];
 const first=pool.run(jobs,source,1,rows=>seen.push(...rows));assert.equal(workers.length,2);workers[0].reply();workers[1].reply();await flush();workers[0].reply();await first;assert.equal(seen.length,40);assert.equal(pool.status.active,0);assert.equal(pool.status.workers,2);assert.equal(pool.status.transferredBytes,40*6400);
 const second=pool.run(jobs,source,1,()=>{});const caught=second.catch(e=>e);pool.cancel();assert((await caught).cancelled);assert.equal(pool.status.active,0);
 const third=pool.run(jobs.slice(0,1),source,2,rows=>seen.push(...rows));assert.equal(workers[0].messages.filter(m=>m.id).at(-1).source,source);workers[0].reply();await third;
 const failed=pool.run(jobs,source,2,()=>{}).catch(e=>e);let prevented=false;workers[0].onerror({message:'test load error',preventDefault:()=>prevented=true});assert.equal((await failed).message,'test load error');assert(prevented);pool.close();assert(workers.every(w=>w.terminated));assert.equal(pool.status.workers,0);
 let paused=true,resume;let gate=new Promise(resolve=>resume=resolve),published=0;
 const held=P.create({threads:1,wait:()=>paused?gate:Promise.resolve(),makeWorker:()=>new Worker()}),last=()=>workers.at(-1);
 const discarded=held.run(jobs.slice(0,1),source,3,()=>published++).catch(e=>e);await flush();assert.equal(held.status.active,0,'Recovery holds helper dispatch');held.cancel();paused=false;resume();assert((await discarded).cancelled);assert.equal(published,0);
 const deferred=held.run(jobs.slice(0,1),source,3,()=>published++);await flush();paused=true;gate=new Promise(resolve=>resume=resolve);last().reply();await flush();assert.equal(published,0,'Completed helper batches wait until input priority ends');paused=false;resume();await deferred;assert.equal(published,1);held.close();
 console.log('PASS bounded worker dispatch, warm-source reuse, latest-task cancellation, recovery dispatch/publication holds, handled failure and complete teardown');
})().catch(e=>{console.error(e);process.exitCode=1;});
