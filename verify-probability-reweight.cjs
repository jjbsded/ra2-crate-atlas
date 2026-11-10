'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),D=require('./probability-display.js');
(async()=>{
 const fixtures=JSON.parse(fs.readFileSync('output/finite-retry-qa/fixtures.json'));
 for(const t of fixtures){
  const cells=Object.values(t.result.cells).map(c=>({...c,probability:0,multiplier:0})),original=structuredClone(cells);
  assert.deepEqual(await D.reweightAsync(cells,t.result),D.reweight(cells,t.result));assert.deepEqual(cells,original);
 }
 const p=fixtures[0].result,cell=Object.values(p.cells)[0],many=Array.from({length:20000},(_,i)=>({...cell,x:i,probability:-1}));
 let yields=0,clock=0;
 const value=await D.reweightAsync(many,p,{now:()=>++clock,yieldToUI:async()=>{yields++;}});
 assert(yields>10);assert.deepEqual(value,D.reweight(many,p));
 yields=0;clock=0;
 const cancelled=await D.reweightAsync(many,p,{valid:()=>yields<2,now:()=>++clock,yieldToUI:async()=>{yields++;}});
 assert.equal(cancelled,null);assert.equal(yields,2);assert(many.every(c=>c.probability===-1));
 assert.equal(await D.reweightAsync(many,p,{valid:()=>false}),null);
 const report={cells:many,probability:p},sync=D.map(report),asyncReport={cells:many,probability:p};yields=0;clock=0;
 const asynchronous=await D.mapAsync(asyncReport,{now:()=>++clock,yieldToUI:async()=>{yields++;}});
 assert(yields>10);assert.equal(D.map(asyncReport),asynchronous,'A prepared report is reused at commit');
 for(const c of many)assert.deepEqual(asynchronous.get(c),sync.get(c));
 assert.equal(asynchronous.maxMultiplier,sync.maxMultiplier);assert.deepEqual(asynchronous.metadata,sync.metadata);
 yields=0;clock=0;
 assert.equal(await D.mapAsync({cells:many,probability:p},{valid:()=>yields<2,now:()=>++clock,yieldToUI:async()=>{yields++;}}),null);
 assert.equal(yields,2);
 console.log('PASS cooperative probability reweight: 40 exact fixtures, 20,000 cells, immutable inputs, scheduling yields and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
