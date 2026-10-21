'use strict';
const assert=require('node:assert/strict'),{createReader,createLoader}=require('./map-results.js');
const API=require('./local-api.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function main(){
 const calls=[],images=[];
 class Picture{decode(){const d=deferred();images.push({...d,src:this.src});return d.promise;}}
 const data={metadata:{},cells:[],rendering:{image:'ground.png',objectImage:'objects.png',version:10}};
 const read=createReader({Image:Picture,fetch:async url=>{
  calls.push(url);return {ok:true,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(4)};
 },createSources:(_data,buffer)=>({bytes:buffer.byteLength})});
 const prepared=read('/output/a/result.json');await settle();
 assert.equal(images.length,2,'ground and object artwork should decode concurrently');
 images[0].resolve();images[1].resolve();const entry=await prepared;
 const one=entry.getSources(),two=entry.getSources();assert.equal(one,two);
 assert.deepEqual(await one,{bytes:4});await entry.getSources();assert.equal(calls.length,2);
 console.log('PASS: parallel image decoding and per-layout source-index reuse.');

 const pending=[];
 const loader=createLoader((url,{signal})=>{const d=deferred();pending.push({...d,url,signal});return d.promise;});
 const old=loader.request('old'),newer=loader.request('new');
 assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve({url:'new'});assert.equal((await newer.ready).url,'new');assert.equal(newer.current(),true);
 pending[0].resolve({url:'old'});await old.ready;assert.equal(old.current(),false,'late completed work must not replace the new map');
 loader.invalidate();assert.equal(newer.current(),false);
 const cached=loader.request(entry.url,entry);assert.equal(await cached.ready,entry);assert.equal(cached.current(),true);
 console.log('PASS: stale completion guard, abort on replacement, and cached result activation.');

 let attempts=0;
 const retryReader=createReader({Image:class{decode(){return Promise.resolve();}},fetch:async url=>{
  if(url.endsWith('search.bin')&&++attempts===1)throw Error('interrupted');
  return {ok:true,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0)};
 },createSources:()=>({})});
 const retryEntry=await retryReader('/output/b/result.json');
 await assert.rejects(retryEntry.getSources(),/interrupted/);await retryEntry.getSources();assert.equal(attempts,2);

 let reads=0;const progress=[],statuses=[{done:false,progress:20},{done:true,url:'/done'}];
 const url=await API.waitForMapJob({id:'job'},{request:async()=>{reads++;return statuses.shift();},wait:async()=>{},onProgress:s=>progress.push(s.progress)});
 assert.equal(url,'/done');assert.equal(reads,2);assert.equal(progress[0],20);
 await assert.rejects(API.waitForMapJob({id:'job'},{request:async()=>({done:true})}),/结果记录缺失/);
 await assert.rejects(API.waitForMapJob({id:'job'},{request:async()=>({error:'failed'})}),/failed/);
 const abort=new AbortController();abort.abort();
 await assert.rejects(API.waitForMapJob({id:'job'},{signal:abort.signal}),{name:'AbortError'});
 console.log('PASS: source retry, shared job polling, malformed completion, failure, and cancellation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
