'use strict';
const assert=require('node:assert/strict'),{create}=require('./mineral-layouts.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const entry=(url,enabled,source='map-a')=>({url,data:{metadata:{mineralsEnabled:enabled,treesEnabled:enabled,terrainRemovalVersion:1,sourceSha256:source,version:'yr'}},im:{decoded:true}});
function harness(){
 const requests=[],reads=[];
 const cache=create({request:(url,options)=>{const d=deferred();requests.push({...d,url,options});return d.promise;},
  read:url=>{const d=deferred();reads.push({...d,url});return d.promise;},wait:async()=>{}});
 return {cache,requests,reads};
}
async function main(){
 const {cache,requests,reads}=harness(),on=entry('/a/on',true),off=entry('/a/off',false);
 cache.use(on,{reset:true});
 const background=cache.get(false,null,{background:true}),progress=[];
 assert.equal(JSON.parse(requests[0].options.body).background,true);
 const foreground=cache.get(false,v=>progress.push(v.message));
 assert.equal(foreground,background,'clicking during preload must join the same task');
 assert.equal(requests.length,1);
 requests.shift().resolve({id:'job-a'});await settle();
 requests.shift().resolve({done:false,progress:55,message:'计算中'});await settle();
 assert.ok(progress.includes('计算中'));
 requests.shift().resolve({done:true,url:off.url});await settle();
 reads.shift().resolve(off);assert.equal(await foreground,off);
 cache.use(off);
 assert.equal(await cache.get(true),on);assert.equal(await cache.get(false),off);
 assert.equal(requests.length,0);assert.equal(reads.length,0,'cached images and JSON must not be read again');
 assert.equal(cache.pending(false),false);
 console.log('PASS: background/click deduplication, progress, and both decoded layouts reused.');

 cache.use(entry('/b/on',true,'map-b'),{reset:true});
 const failure=cache.get(false),rejection=assert.rejects(failure,/offline/);
 requests.shift().reject(Error('offline'));await rejection;
 assert.equal(cache.has(false),false);assert.equal(cache.pending(false),false);
 const retry=cache.get(false),invalid=assert.rejects(retry,/不匹配/);
 requests.shift().resolve({url:'/wrong'});await settle();
 reads.shift().resolve(off);await invalid;
 assert.equal(cache.has(false),false,'a wrong-map response must not enter the cache');
 const valid=cache.get(false);requests.shift().resolve({url:'/b/off'});await settle();
 const b=entry('/b/off',false,'map-b');reads.shift().resolve(b);assert.equal(await valid,b);
 console.log('PASS: failure clears pending state, explicit retry works, wrong-map data is rejected.');

 cache.use(on,{reset:true});const stale=cache.get(false,null,{background:true});
 requests.shift().resolve({url:off.url});await settle();const oldRead=reads.shift();
 cache.use(entry('/c/on',true,'map-c'),{reset:true});oldRead.resolve(off);await stale;
 assert.equal(cache.has(false),false,'late old-map completion must not populate the new cache');
 const c=cache.get(false);assert.equal(JSON.parse(requests[0].options.body).result,'/c/on');
 requests.shift().resolve({url:'/c/off'});await settle();reads.shift().resolve(entry('/c/off',false,'map-c'));await c;
 assert.equal(cache.has(false),true);
 console.log('PASS: changing map isolates late completions and releases the old layout pair.');
 const legacy=entry('/legacy/off',false);delete legacy.data.metadata.treesEnabled;delete legacy.data.metadata.terrainRemovalVersion;
 cache.use(legacy,{reset:true});assert.equal(cache.has(false),false,'Legacy ore-only results cannot enter the combined cache');
 const upgrade=cache.get(false),legacyRejected=assert.rejects(upgrade,/不匹配/);
 requests.shift().resolve({url:legacy.url});await settle();reads.shift().resolve(legacy);await legacyRejected;
 console.log('PASS: old ore-only OFF results are rejected, including direct legacy links.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
