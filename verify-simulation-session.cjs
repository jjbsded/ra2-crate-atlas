/* Map generations, edit revisions, visibility and delta ordering contracts. */
'use strict';
const assert=require('node:assert/strict'),S=require('./simulation-session.js');
const prepared=name=>({url:'/result/'+name,data:{metadata:{sourceSha256:name,version:'yr'}}});
const s=S.create();s.reset(prepared('a'));assert(!s.pending);s.changed('paint');
const old=s.capture({placements:[]});assert(s.current(old));assert(s.pending&&s.probabilityPending&&s.waiting);
s.probabilityApplied=s.revision;assert(!s.probabilityPending);assert(s.waiting);
s.live={painted:s.revision};assert(s.liveReady);assert(!s.waiting);
s.running=old;assert(s.waiting,'An explicit report still waits after the live pair is ready');
s.consider=false;assert(!s.pending&&!s.waiting&&!s.liveReady);s.consider=true;
s.invalidate();assert(old.controller.signal.aborted);assert(!s.current(old));assert(s.loading);
s.reset(prepared('b'));s.changed();assert.equal(s.revision,old.revision);assert(!s.current(old),'A matching revision on another map cannot accept an old result');
const next=s.capture({placements:[]});s.force();assert(!s.current(next));assert(s.forceQueued&&!s.failed);
assert(S.supported({version:'directory'}));assert(!S.supported({version:'yr',previewOnly:true}));

function apply(before,delta){
 const result=structuredClone(before),patch=(table,changes)=>{for(const [k,v]of Object.entries(changes))v===null?delete table[k]:table[k]=v;};
 patch(result.objects,delta.objects);patch(result.overlays,delta.overlays);
 const placements=Object.fromEntries(result.placements.map(p=>[p.id,p]));patch(placements,delta.placements);
 result.placements=(delta.order||Object.keys(placements)).map(k=>placements[k]);return result;
}
let before={objects:{},overlays:{},placements:[]};
for(let round=0;round<40;round++){
 const after={objects:round%3?{'UNITS/0':'delete'}:{},overlays:round%2?{'30,30':[255,0]}:{},placements:Array.from({length:round%9},(_,i)=>({id:'sim-'+i,x:i,y:round,regionColor:round%2?'ff0000':'0000ff'}))};
 if(round%2)after.placements.reverse();
 assert.deepEqual(apply(before,S.planDelta(before,after)),after);before=after;
}
assert.deepEqual(S.planDelta(before,before),{objects:{},overlays:{},placements:{}});
console.log('PASS session generations, revision guards, live/default visibility, cancellation and 40 ordered delta roundtrips');
