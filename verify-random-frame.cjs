'use strict';
const assert=require('assert/strict'),fs=require('fs'),{performance}=require('perf_hooks');
const M=require('./model'),I=require('./probability-index'),H=require('./probability');
const close=(a,b)=>assert(Math.abs(a-b)<1e-11,`${a} != ${b}`),results=[];
let compared=0;
for(const world of Object.values(M.WORLDS)){
 const d=H.computeRandom(world),P=d.frameDistribution.period,N=d.sampleCount,L=d.limit;
 const expected=Array(N).fill(0n),single=new Uint32Array(N),cells=Object.values(d.cells);
 let failure=0n,sumS=0;
 for(let f=0;f<P;f++){
  const hits=new Uint32Array(N);let S=0;
  for(let i=0;i<N;i++){
   const origin=cells[i].cell,r=M.resolveAttempt(origin,world,f),repeat=M.resolveAttempt(origin,world,f+P);
   assert.deepEqual(r,repeat,'A joint cycle must preserve all selected records and failures');compared++;
   if(r.success){hits[(r.selected[0]-1)*13+r.selected[1]-1]++;S++;}
  }
  assert.equal(d.frameDistribution.frameSummaries[f].successCount,S);sumS+=S;
  const denominator=BigInt(N)**BigInt(L),failed=BigInt(N-S)**BigInt(L),G=S?(denominator-failed)/BigInt(S):0n;
  failure+=failed;
  for(let i=0;i<N;i++){expected[i]+=BigInt(hits[i])*G;single[i]+=hits[i];}
 }
 assert.equal(BigInt(d.exact.denominator),BigInt(P)*BigInt(N)**BigInt(L));
 assert.equal(BigInt(d.exact.failureNumerator),failure);
 assert.equal(expected.reduce((a,n)=>a+n,0n)+failure,BigInt(d.exact.denominator));
 close(d.successCount,sumS/P);
 const once=H.computeRandom(world,1);let wrongModelDifference=0;
 for(let i=0;i<N;i++){
  const c=cells[i];assert.equal(BigInt(c.exactNumerator),expected[i]);assert.equal(c.originFrameHits,single[i]);
  close(c.oneAttemptProbability,single[i]/(P*N));
  const key=M.key(c.cell),p=H.exactFraction(d,key),one=H.exactFraction(once,key);
  assert.equal(BigInt(p.numerator)*BigInt(d.exact.denominator),expected[i]*BigInt(p.denominator));
  assert.equal(BigInt(one.numerator)*BigInt(P*N),BigInt(single[i])*BigInt(one.denominator));
  for(const threshold of [0,1,5,169])assert.equal(H.meetsThreshold(c,threshold),expected[i]*BigInt(N)>=BigInt(threshold)*BigInt(d.exact.denominator));
  const mixedBeforeRetry=single[i]/sumS*(-Math.expm1(L*Math.log1p(-d.successPerAttempt)));
  wrongModelDifference=Math.max(wrongModelDifference,Math.abs(c.probability-mixedBeforeRetry));
 }
 if(['land','coast'].includes(world.id))assert(wrongModelDifference>1e-8,'Averaging success rates before retries is measurably wrong');
 const preset=M.PRESETS.find(p=>(p.world||'land')===world.id).id;
 const a=H.decorate(M.buildTrace({preset,frame:600})),b=H.decorate(M.buildTrace({preset,frame:601}));
 assert.strictEqual(a.probability,b.probability,'Teaching frame must not change the random-frame heatmap');
 assert.notDeepEqual(d.cells,H.compute(world,600).cells,'Random averaging must replace the fixed-600 distribution');
 close(cells.reduce((s,c)=>s+c.probability,0)+d.finalFailure,1);
 const times=[];
 for(let run=0;run<10;run++){H.clearCache();const start=performance.now();H.computeRandom(world);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);
 results.push({world:world.id,period:P,originsPerCycle:P*N,successCountRange:d.successCountRange,maxMultiplier:d.maxMultiplier,wrongModelMaxProbabilityDifference:wrongModelDifference,coldMedianMs:times[5]});
}
const blocked={id:'land',objects:{}};for(let x=1;x<=13;x++)for(let y=1;y<=13;y++)blocked.objects[`${x},${y}`]='building';
const zero=H.computeRandom(blocked);assert.equal(zero.frameDistribution.period,1);assert.equal(zero.finalFailure,1);
assert.equal(zero.exact.failureNumerator,zero.exact.denominator);assert(Object.values(zero.cells).every(c=>c.exactNumerator==='0'));
const json=JSON.parse(JSON.stringify(H.computeRandom(M.WORLDS.coast)));
assert.deepEqual(H.exactFraction(json,'5,6'),H.exactFraction(H.computeRandom(M.WORLDS.coast),'5,6'));
fs.writeFileSync('output/random-frame-verification.json',JSON.stringify({passed:true,comparedOriginFramePairs:compared,checks:['full reference enumeration','joint-period repeat','exact integer mass conservation','finite retries before frame average','limit=1 fractions','exact threshold comparisons','teaching-frame independence','no-solution map','JSON rational round trip'],results},null,2));
console.log(`PASS: ${compared} origin/frame pairs, exact uniform-cycle averages and finite retries; teaching-frame independence.`);
console.table(results);
