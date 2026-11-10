'use strict';
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),R=require('./region-statistics.js'),A=require('./region-auto.js');
const key=(x,y=1)=>R.key({x,y});
function fixture(masks){
 const cells=masks.map((mask,i)=>({x:i+1,y:1,land:mask&2?2:mask&4?6:0,level:0,slope:0})),eligible=new Map(cells.map(c=>[R.key(c),c])),doc=R.defaults(),navigation={version:A.navigationVersion,count:cells.length,flags:masks};
 return {cells,eligible,doc,navigation};
}
const fill=(f,x=1)=>R.fillKeys(f.doc,f.cells[x-1],f.eligible,f);
let f=fixture([17,17,5,17,2,5,17]);
assert.deepEqual(fill(f),[key(1),key(2)],'Unassigned land cannot enter or traverse coast');
assert.deepEqual(new Set(fill(f,3)),new Set([key(1),key(2),key(3),key(4)]),'A direct coast seed can expand through coast and land, not water');
assert.deepEqual(fill(f,5),[key(5)],'Unassigned water still stops at the shoreline');
f.doc.regions[1].cells=new Set(f.eligible.keys());
assert.deepEqual(fill(f),[...f.eligible.keys()],'An existing region crosses connected land/water/coast');
for(const blocked of [0,4,16,20]){
 f=fixture([17,blocked,17]);f.doc.regions[1].cells=new Set(f.eligible.keys());
 assert.deepEqual(fill(f),[key(1)],'Fixed blockers have no traversable surface, even when assigned');assert.deepEqual(fill(f,2),[],'Cannot fill a blocked seed');
}
f=fixture([17,17,17]);f.cells[1].level=f.cells[2].level=1;assert.deepEqual(fill(f),[key(1)],'No jumping height discontinuities');
f.cells[0].slope=1;f.eligible=new Map(f.eligible);assert.deepEqual(fill(f),[key(1),key(2),key(3)],'Shared ramp edge reaches matching upper terrain');
f=fixture([17,10,10,17]);f.cells[0].level=f.cells[3].level=4;
f.cells[1].bridge=f.cells[2].bridge={kind:'high',deckLevel:4};
assert.deepEqual(fill(f),[key(1),key(2),key(3),key(4)],'An intact high bridge joins land banks');
assert.deepEqual(fill(f,2),[key(2),key(3),key(1),key(4)],'Clicking a bridge uses its visible deck');
f.revision={};assert.equal(fill(f).length,4);f.cells[1]={...f.cells[1],bridge:null};f.revision={};assert.deepEqual(fill(f),[key(1)],'A new live revision cannot reuse a removed deck from the previous node cache');
f=fixture([17,25,17]);f.cells[0].level=4;f.cells[1].bridge={kind:'high',deckLevel:4};f.doc.regions[0].cells=new Set(f.eligible.keys());
assert.deepEqual(fill(f),[key(1),key(2)],'A bridge must not transfer vertically to the ground underneath');
f=fixture([17,17,17]);f.doc.regions[1].cells.add(key(2));assert.deepEqual(fill(f),[key(1)],'Unassigned fill never crosses existing ownership');
f.doc.overlap=true;f.doc.regions[0].cells=new Set([key(1)]);f.doc.regions[1].cells.add(key(1));assert.deepEqual(fill(f),[key(1)],'Active region wins overlapping membership');
f.eligible.delete(key(1));assert.deepEqual(fill(f),[],'Out-of-bounds seeds cannot fill');
f=fixture([17,17]);f.cells[0].occupied=true;f.cells[0].objects=['MTNK'];assert.equal(fill(f).length,2,'Removable object occupancy does not override navigation flags');
assert.throws(()=>R.fillKeys(f.doc,f.cells[0],f.eligible,{cells:f.cells,navigation:{version:3,count:2,flags:[17,17]}}),/REGION_NAVIGATION_INVALID/,'No permissive fallback when navigation is missing or obsolete');
f=fixture(new Array(65000).fill(17)); // Use a two-dimensional, valid coordinate grid.
f.cells.forEach((c,i)=>{c.x=Math.floor(i/250)+1;c.y=i%250+1;});f.eligible=new Map(f.cells.map(c=>[R.key(c),c]));
const before=R.encode(f.doc),steps=R.fillSteps(f.doc,f.cells[0],f.eligible,f);let value,chunks=0,maxChunk=0,t=performance.now();
do{const start=performance.now();value=steps.next();maxChunk=Math.max(maxChunk,performance.now()-start);chunks++;}while(!value.done);
const cold=performance.now()-t;assert.equal(value.value.length,65000);assert(chunks>100,'Large searches yield repeatedly');assert.equal(R.encode(f.doc),before,'Search never mutates history or region membership');
t=performance.now();assert.equal(fill(f).length,65000);const warm=performance.now()-t;
console.log('PASS region fill: shoreline/ownership, blocked seeds, cliffs/ramps, bridge layers, no object barrier, validated navigation, cooperative search',JSON.stringify({cells:65000,chunks,maxChunkMs:+maxChunk.toFixed(2),coldMs:+cold.toFixed(2),warmMs:+warm.toFixed(2)}));
