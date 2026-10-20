'use strict';
const assert=require('assert/strict'),fs=require('fs'),M=require('./model'),I=require('./probability-index'),H=require('./probability');
let compared=0;
function compare(world,frames){
 const index=I.prepare(world);
 for(const frame of frames)for(const actual of index.resolve(frame).origins){
  assert.deepEqual(actual,{origin:actual.origin,...M.resolveAttempt(actual.origin,world,frame)});
  compared++;
 }
}
const frames=Array.from({length:24},(_,i)=>i);
// 0..23 exercises every possible selected index for every count up to 24.
for(const world of Object.values(M.WORLDS))compare(world,frames);
for(let variant=0;variant<8;variant++){
 const world={id:variant%2?'coast':'land',objects:{}};
 for(let x=1;x<=13;x++)for(let y=1;y<=13;y++){
  const k=(x*7+y*11+variant*3)%9;
  if(k<5)world.objects[`${x},${y}`]=['building','unit','terrain','ore','crate'][k];
 }
 compare(world,frames);
}
const blocked={id:'land',objects:{}},overlayOnly={id:'land',objects:{}};
for(let x=1;x<=13;x++)for(let y=1;y<=13;y++){
 blocked.objects[`${x},${y}`]='building';overlayOnly.objects[`${x},${y}`]='ore';
}
compare(blocked,[0,600]);compare(overlayOnly,[0,600]);
assert.equal(H.compute(overlayOnly).successCount,0,'Overlay candidates must be selected before placement fails');

// Synthetic flat geometry tests only; real map-file support is still out of scope.
const original={...M.MAP,local:[...M.MAP.local]};
try{
 Object.assign(M.MAP,{w:20,h:20,local:[0,0,20,18]});
 const capped={id:'land',objects:{}};
 for(let x=17;x<=23;x++)for(let y=17;y<=23;y++)capped.objects[`${x},${y}`]='building';
 const ring=M.scanRing([20,20],4,capped,'Track');
 assert.equal(ring.candidates.length,24);
 assert.equal(M.ring([20,20],4).filter(c=>M.classify(c,capped).ok).length,32);
 const index=I.prepare(capped);
 for(let frame=0;frame<49;frame++){
  const actual=index.resolve(frame).origins.find(c=>c.origin[0]===20&&c.origin[1]===20);
  assert.deepEqual(actual.selected,ring.candidates[frame%24]);compared++;
 }
 Object.assign(M.MAP,{w:40,h:40,local:[0,0,40,38]});
 const loneIsland={id:'island',objects:{},landCells:[[40,40]]},far=I.prepare(loneIsland).resolve(600);
 for(const origin of [[9,9],[8,8]]){
  const actual=far.origins.find(c=>c.origin[0]===origin[0]&&c.origin[1]===origin[1]);
  assert.deepEqual(actual,{origin,...M.resolveAttempt(origin,loneIsland,600)});compared++;
 }
 assert.equal(far.origins.find(c=>M.key(c.origin)==='9,9').radius,31);
 assert.equal(far.origins.find(c=>M.key(c.origin)==='8,8').failure,'no-candidate');
}finally{Object.assign(M.MAP,original);H.clearCache();}

let exactCases=0;
for(const world of [...Object.values(M.WORLDS),blocked,overlayOnly])for(const limit of [1,2,3,7,1000]){
 const d=H.compute(world,600,limit),N=BigInt(d.sampleCount),F=N-BigInt(d.successCount);
 const {denominator,perHitNumerator,failureNumerator}=d.exact,D=BigInt(denominator),G=BigInt(perHitNumerator);
 assert.equal(D,N**BigInt(limit));assert.equal(BigInt(failureNumerator),F**BigInt(limit));
 const mass=Object.values(d.cells).reduce((s,c)=>s+BigInt(c.hits)*G,0n)+BigInt(failureNumerator);
 assert.equal(mass,D,'Exact mass conservation, including underflow-sized final failure');
 // Independent integer recurrence over the retry attempts, including L=1000.
 let recurrence=0n,failure=1n;
 for(let k=0;k<limit;k++){recurrence=recurrence*N+failure;failure*=F;}
 if(d.successCount)assert.equal(G,recurrence);
 for(const [key,c] of Object.entries(d.cells)){
  const fraction=H.exactFraction(d,key),n=BigInt(fraction.numerator),den=BigInt(fraction.denominator);
  assert.equal(n*D,BigInt(c.hits)*G*den);
  const one=H.exactFraction(d,key,'oneAttemptProbability');
  assert.equal(BigInt(one.numerator)*N,BigInt(c.hits)*BigInt(one.denominator));
  if(limit===1){assert.equal(H.meetsThreshold(c,c.hits),true);assert.equal(H.meetsThreshold(c,c.hits+.1),false);}
 }
 assert.doesNotThrow(()=>JSON.stringify(d));exactCases++;
}
const tiny=H.compute(M.WORLDS.land);
assert.equal(tiny.finalFailure,0);assert(BigInt(tiny.exact.failureNumerator)>0n,'The exact failure probability is retained despite floating underflow');
// All successful origins map to one cell, but some origins fail on an Overlay.
// The displayed multiplier rounds to 169; the exact finite-retry value is <169.
const almostCertain={id:'land',objects:{...blocked.objects}};
delete almostCertain.objects['5,6'];almostCertain.objects['9,8']='ore';
const almost=H.compute(almostCertain),peak=almost.cells['5,6'];
assert(almost.successCount>0&&almost.successCount<169);
assert.equal(peak.multiplier,169);
assert.equal(H.meetsThreshold(peak,169),false);assert.equal(H.meetsThreshold(peak,168.9),true);
const island=H.compute(M.WORLDS.island);
for(const c of Object.values(island.cells))assert(H.meetsThreshold(c,c.hits),'Integer equality must survive display floating rounding');
// Changed map content must invalidate precomputed masks, even for the same object identity.
const mutable={id:'land',objects:{}},before=H.compute(mutable);
mutable.objects['6,7']='building';const after=H.compute(mutable);
assert(before.cells['6,7'].hits>0);assert.equal(after.cells['6,7'].hits,0);
assert.deepEqual(after.origins,I.prepare(mutable).resolve(600).origins);
fs.writeFileSync('output/exact-verification.json',JSON.stringify({passed:true,originsCompared:compared,frameResidues:24,exactCases,checks:['reference scan equivalence','24-record cap with 32 eligible ring cells','radius 31 accepted / 32 rejected','r=0 duplicates','Track/Float and Overlay rejection','integer recurrence and exact mass conservation','nonzero failure retained after float underflow','exact threshold equality','world-mutation cache invalidation']},null,2));
console.log(`PASS: ${compared} origin/frame results match the reference; ${exactCases} exact rational distributions; radius/candidate caps and exact thresholds.`);
