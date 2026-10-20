'use strict';
const assert=require('assert/strict'),M=require('./model'),H=require('./probability'),T=require('./timing');
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const semantic=trace=>trace.steps.map(({i,start,end,duration,baseDuration,...step})=>step);
for(const preset of M.CORE_PRESETS){
 const baseline=H.decorate(M.buildTrace({preset})),original=semantic(baseline),baseDurations=baseline.steps.map(s=>s.duration),total=baseline.duration,probability=baseline.probability;
 T.apply(baseline);near(baseline.duration,total);
 T.apply(baseline,{speed:2});near(baseline.duration,total/2);
 const timing={speed:2,phases:{search:{speed:4},retry:{seconds:6},heatmap:{seconds:12,speed:3}}};
 T.apply(baseline,timing);
 const adjusted=baseline.duration;
 baseline.steps.forEach((s,i)=>{
  const expected=s.phase==='search'?baseDurations[i]/8:s.phase==='retry'?3:s.phase==='heatmap'?2:baseDurations[i]/2;
  near(s.duration,expected);near(s.end-s.start,expected);
  near(s.start,i?baseline.steps[i-1].end:0);
  const state=M.atTime(baseline,s.start+s.duration*.4);assert.equal(state.step,s);near(state.progress,.4);
 });
 assert.deepEqual(semantic(baseline),original);assert.equal(baseline.probability,probability);
 T.apply(baseline,timing);near(baseline.duration,adjusted);
 T.apply(baseline);near(baseline.duration,total);assert.deepEqual(baseline.steps.map(s=>s.duration),baseDurations);
}
const query=T.fromQuery('?speed=2&searchSpeed=4&retrySeconds=6&heatmapSeconds=12&heatmapSpeed=3');
assert.deepEqual(query,T.settings({speed:2,phases:{search:{speed:4},retry:{seconds:6},heatmap:{seconds:12,speed:3}}}));
for(const value of [null,[],{speed:0},{speed:Infinity},{speed:'2'},{phases:[]},{phases:{unknown:{}}},{phases:{search:{seconds:0}}},{phases:{heatmap:{seconds:601}}},{phases:{put:{speed:-1}}}])assert.throws(()=>T.settings(value));
for(const query of ['?speed=','?speed=NaN','?searchSeconds=-1','?heatmapSpeed=11'])assert.throws(()=>T.fromQuery(query));
const exhausted={steps:[{phase:'exhausted',duration:2}]};T.apply(exhausted,{phases:{exhausted:{seconds:3,speed:2}}});near(exhausted.duration,1.5);
console.log('PASS: timing for all 11 scenarios; stable steps/probability; scaling, overrides, contiguous timeline, repeated edits, reset, URL parameters and invalid values.');
