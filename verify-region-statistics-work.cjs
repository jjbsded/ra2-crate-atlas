/* Shared synchronous/cooperative sums and reversible membership-only patches. */
'use strict';
const assert=require('node:assert/strict'),R=require('./region-statistics.js');
function finish(work){let step,yields=0;do{step=work.next();if(!step.done)yields++;}while(!step.done);return {value:step.value,yields};}
const values=[3n,7n,0n,12n],cells=values.map((n,i)=>({x:i+1,y:1,land:i%2?2:0,n}));
const lookup=new Map(cells.map(c=>[R.key(c),c])),display={baselineNumerator:2n,get:c=>({numerator:c.n})};
const region={cells:new Set([...lookup.keys(),999999])};
const expected={land:{count:2,n:3n,total:1.5,average:.75},sea:{count:2,n:19n,total:9.5,average:4.75},all:{count:4,n:22n,total:11,average:2.75}};
assert.deepEqual(R.statistics(region,lookup,display),expected);
assert.deepEqual(finish(R.statisticsSteps(region,lookup,display)).value,expected);
const zero={...display,baselineNumerator:0n};assert.equal(R.statistics(region,lookup,zero).all.total,0);
assert.equal(R.statistics({cells:new Set()},lookup,display).all.average,null);

const many=Array.from({length:900},(_,i)=>({x:i%30+1,y:Math.floor(i/30)+1,land:i%3?0:2,n:BigInt(i+1)*10n**80n}));
const largeLookup=new Map(many.map(c=>[R.key(c),c]));let reads=0;
const largeDisplay={baselineNumerator:7n*10n**80n,get(c){reads++;return {numerator:c.n};}};
let previousCells=new Set(many.slice(0,500).map(R.key));
let previous=R.statistics({cells:previousCells},largeLookup,largeDisplay);
for(let turn=0;turn<25;turn++){
 const next=new Set(previousCells),changes=new Map();
 for(let i=0;i<185;i++){const key=R.key(many[(turn*137+i*7)%many.length]);changes.set(key,turn);next.has(key)?next.delete(key):next.add(key);}
 changes.set(999999,turn);next.add(999999); // Unknown coordinates never affect sums.
 const old=structuredClone(previous);reads=0;
 const patch=finish(R.patchStatisticsSteps({cells:next},previousCells,changes,previous,largeLookup,largeDisplay));
 assert(patch.yields>0,'Large patches must yield to the UI');assert(reads<=changes.size,'Only changed membership is evaluated');
 const full=finish(R.statisticsSteps({cells:next},largeLookup,largeDisplay));
 assert(full.yields>=2);assert.deepEqual(patch.value,full.value);assert.deepEqual(previous,old,'Patches never mutate published statistics');
 previousCells=next;previous=patch.value;
}
const old=structuredClone(previous),cancelled=R.patchStatisticsSteps({cells:new Set()},previousCells,new Map([...previousCells].map(k=>[k,true])),previous,largeLookup,largeDisplay);
assert.equal(cancelled.next().done,false);cancelled.return();assert.deepEqual(previous,old,'Cancellation leaves the previous result intact');
assert.deepEqual(finish(R.patchStatisticsSteps({cells:previousCells},previousCells,new Map(),previous,largeLookup,largeDisplay)).value,previous);
console.log('PASS shared region sums: exact examples, zero/empty values, 25 large-integer patches, cooperative yields and immutable cancellation');
