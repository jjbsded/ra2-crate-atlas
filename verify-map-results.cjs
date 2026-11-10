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
 let warmed=false;
 const prepared=read('/output/a/result.json',{onMetadata:(url,value)=>{assert.equal(url,'/output/a/result.json');assert.equal(value,data);assert.equal(images.length,0);warmed=true;}});await settle();
 assert(warmed,'Native warmup starts before image decoding');
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

 const upgrades=[],versionReads=[],signal=new AbortController().signal;
 const upgradeReader=createReader({Image:class{decode(){return Promise.resolve();}},fetch:async url=>{
  versionReads.push(url);return {ok:true,json:async()=>({...data,probability:{model:url.includes('/new/')?'finite-retry-v2':'legacy'}})};
 },upgrade:async(url,options)=>{upgrades.push(url);assert.equal(options.signal,signal);return '/new/result.json';}});
 assert.equal((await upgradeReader('/old/result.json',{signal})).url,'/new/result.json');
 assert.deepEqual(upgrades,['/old/result.json']);assert.deepEqual(versionReads,['/old/result.json','/new/result.json']);
 const staleReader=createReader({fetch:async()=>({ok:true,json:async()=>({...data,probability:{model:'legacy'}})}),upgrade:async()=>'/still-old/result.json'});
 await assert.rejects(staleReader('/old/result.json'),/分析结果需要重新计算/);
 const stopped=new AbortController(),cancelReader=createReader({fetch:async()=>({ok:true,json:async()=>({...data,probability:{model:'legacy'}})}),upgrade:async()=>{stopped.abort();return '/new/result.json';}});
 await assert.rejects(cancelReader('/old/result.json',{signal:stopped.signal}),{name:'AbortError'});
 console.log('PASS: old-model upgrade, repeated stale result rejection, and upgrade cancellation.');
 for(const metadata of [{previewOnly:true},{approximate:true}]){
  let count=0;
  const recover=createReader({Image:class{decode(){return Promise.resolve();}},readJSON:async url=>({...data,metadata:url.includes('/new/')?{approximate:true,riskPredictionVersion:1}:metadata}),upgrade:async()=>{count++;return '/new/result.json';}});
  assert.equal((await recover('/old/result.json')).data.metadata.riskPredictionVersion,1);assert.equal(count,1);
  const fallback=createReader({Image:class{decode(){return Promise.resolve();}},readJSON:async()=>({...data,metadata}),upgrade:async()=>{throw Error('source unavailable');}});
  const kept=await fallback('/old/result.json');assert.equal(kept.data.metadata.recoveryError,'source unavailable');assert(kept.data.metadata.loadIssues[0].message.includes('source unavailable'));assert(kept.im);
 }
 console.log('PASS: legacy preview/risk recovery and retaining readable artwork when recovery fails.');
 for(const broken of ['objects','ground','both']){
  const fallback={width:100,height:100,draw(){}},reader=createReader({readJSON:async()=>data,Image:class{decode(){return broken==='both'||this.src.includes(broken)?Promise.reject(Error('missing '+broken)):Promise.resolve();}},fallbackArtwork:()=>fallback});
  const recovered=await reader('/output/art/result.json');assert(recovered.im);assert.equal(recovered.data.metadata.loadIssues.length,broken==='both'?2:1);assert.equal(data.metadata.loadIssues,undefined);
  if(broken==='objects')assert.equal(recovered.objectImage,null);else assert.equal(recovered.im,fallback);
 }
 console.log('PASS: independent ground/object image failures retain readable layers and computation data.');

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
