'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const D=require('./probability-display'),H=require('./probability'),M=require('./model');
const close=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const results=[];
// Independent two-frame, two-attempt example, N=4. The direct-only cell has
// one hit in both frames, while its neighbor receives 0 then 2 hits. Frame
// terminal totals 1 and 3 give weights 7 and 5 over denominator 32.
// Dropping retries gives 1:1; preserving final ratios gives 12:10.
const synthetic={probability:{exact:{denominator:'32',coefficients:[{n:2,r:0,numerator:'7'},{n:2,r:1,numerator:'5'}]}},cells:[{terms:[[0,1],[1,1]]},{terms:[[1,2]]},{terms:[]}]};
const a=D.map(synthetic);assert.equal(a.baselineNumerator,12n);close(a.get(synthetic.cells[1]).multiplier,5/6);
const edited={...synthetic,cells:[synthetic.cells[0],{terms:[[0,2]]},synthetic.cells[2]]},incremental=D.map(edited,a);
assert.equal(incremental.get(edited.cells[0]),a.get(synthetic.cells[0]));
assert.equal(incremental._coeff,a._coeff,'Unchanged shared integers must be reused');
close(incremental.get(edited.cells[1]).multiplier,7/6);close(a.get(synthetic.cells[1]).multiplier,5/6);
const reweighted={...edited,probability:{exact:{denominator:'32',coefficients:[{n:2,r:0,numerator:'9'},{n:2,r:1,numerator:'5'}]}}},updated=D.map(reweighted,incremental);
assert.notEqual(updated._coeff,incremental._coeff,'Changed coefficient schema must invalidate every affected display value');
close(updated.get(reweighted.cells[1]).multiplier,9/7);
assert.deepEqual(a.exactFraction(synthetic.cells[0]),{numerator:'1',denominator:'1'});
assert.equal(a.showLabel(synthetic.cells[0]),false);assert.equal(a.showLabel(synthetic.cells[0],true),true);
assert.equal(a.showLabel(synthetic.cells[1]),true);assert.equal(a.showLabel(synthetic.cells[2],true),false);
assert.equal(a.meetsThreshold(synthetic.cells[0],1),true);assert.equal(a.meetsThreshold(synthetic.cells[0],1.000000000000001),false);
assert.equal(a.meetsThreshold(synthetic.cells[1],.8333333333333333),true);
assert.equal(a.meetsThreshold(synthetic.cells[1],.8333333333333334),false);
// Rounded 1.0x is not exact 1x. Never hide it or apply baseline alpha.
const rounding={probability:{exact:{denominator:'10000',coefficients:[{n:1,r:0,numerator:'100'},{n:2,r:0,numerator:'1'},{n:2,r:1,numerator:'99'}]}},cells:[{terms:[[0,1],[1,1]]}]};
const rv=D.map(rounding),rc=rounding.cells[0];assert.equal(rv.get(rc).multiplier.toFixed(1),'1.0');assert(!rv.get(rc).isBaseline);assert(rv.showLabel(rc));
for(const t of [0,.01,.25,.45,.81,1]){
 close(a.cellAlpha(synthetic.cells[0],{opacity:1-t}),1-Math.sqrt(t));
 close(a.cellAlpha(synthetic.cells[1],{opacity:1-t}),1-t);
 assert.equal(a.cellAlpha(synthetic.cells[2],{opacity:1-t}),0);
 assert.equal(a.cellAlpha(synthetic.cells[0],{opacity:1-t,enabled:false}),0);
 assert.equal(a.cellAlpha(synthetic.cells[0],{opacity:1-t,minMultiplier:1.1}),0);
 for(const factor of [0,.25,.5,.75,1]){
  close(a.cellAlpha(synthetic.cells[0],{opacity:1-t,baselineFactor:factor}),1-Math.pow(t,factor));
  close(a.cellAlpha(synthetic.cells[1],{opacity:1-t,baselineFactor:factor}),1-t);
 }
}
for(const world of Object.values(M.WORLDS))for(const limit of [1]){
 const r=H.computeRandom(world,limit),original=JSON.stringify(r),v=D.demo(r),N=BigInt(r.sampleCount),base=N**BigInt(limit);
 const baseline=BigInt(r.frameDistribution.period);
 assert.equal(v.baselineNumerator,baseline);
 for(const c of Object.values(r.cells)){
  const fraction=v.exactFraction(c),n=BigInt(c.exactNumerator);
  assert.equal(BigInt(fraction.numerator)*baseline,BigInt(fraction.denominator)*n);
  close(v.get(c).multiplier*v.baselineProbability,c.probability);
  assert.equal(v.get(c).isBaseline,n===baseline&&n>0n);
 }
 assert.equal(JSON.stringify(r),original,'presentation must not mutate exact results');
 results.push({world:world.id,limit,maxRelative:v.maxMultiplier,baseline:v.baselineProbability});
}
const fixed=H.compute(M.WORLDS.land,600,3),fixedView=D.demo(fixed);for(const c of Object.values(fixed.cells))assert.equal(fixedView.get(c).multiplier,c.hits);
const blocked={id:'land',objects:{}};for(let x=1;x<=13;x++)for(let y=1;y<=13;y++)blocked.objects[`${x},${y}`]='building';
const zero=H.computeRandom(blocked),zeroView=D.demo(zero);assert.equal(zeroView.maxMultiplier,0);for(const c of Object.values(zero.cells)){assert.equal(zeroView.cellAlpha(c),0);assert.equal(zeroView.showLabel(c),false);}
const mapFile=path.join(__dirname,'output/map-690d23bccea0/result.json'),raw=fs.readFileSync(mapFile),map=JSON.parse(raw),v=D.map(map);
const baselineCells=map.cells.filter(c=>v.get(c).isBaseline);assert.equal(baselineCells.length,7318);
const positives=map.cells.filter(c=>v.get(c).numerator>0n);assert.equal(Math.min(...positives.map(c=>v.get(c).multiplier)),1);
for(const c of map.cells){
 close(v.get(c).multiplier*v.baselineProbability,c.probability);
 assert.equal(v.meetsThreshold(c,1),v.get(c).numerator>=v.baselineNumerator);
 assert.equal(v.meetsThreshold(c,1.1),v.get(c).numerator*10n>=v.baselineNumerator*11n);
}
assert(fs.readFileSync(mapFile).equals(raw));assert.equal(map.markers.length,13);
fs.mkdirSync('output/relative-verification',{recursive:true});
fs.writeFileSync('output/relative-verification/verification.json',JSON.stringify({passed:true,checks:['exact ratio with correlated frames','exact threshold above/below 1','rounded baseline is not exact baseline','sqrt transparency endpoints','zero and threshold hiding','four demo worlds with single-attempt probabilities','fixed frame direct-hit normalization','all blocked map','original result not mutated','all 19690 Heck cells preserve final probability ratios'],heck:{baselineCells:baselineCells.length,oldBaseline:baselineCells[0].multiplier,maxRelative:v.maxMultiplier},results},null,2));
console.log(`PASS: relative display; ${baselineCells.length} exact baseline cells; max ${v.maxMultiplier}.`);
