'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const timers=new Map();let id=0,time=0,currentMap='A';const publications=[],busy=[];
const context={setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);},performance:{now(){time+=.2;return time;}},console};
vm.createContext(context);vm.runInContext(fs.readFileSync('region-refresh-queue.js','utf8'),context);
const queue=context.CrateRegionRefreshQueue.create({same:(a,b)=>a&&b&&a.map===b.map&&a.version===b.version,valid:t=>t.map===currentMap,
 capture:t=>({...t,keys:new Set(t.keys)}),compute:function*(t){for(let i=0;i<80;i++)yield;return t;},publish:t=>publications.push({map:t.map,version:t.version,keys:[...t.keys]}),onPending:value=>busy.push(value)});
function step(){const entry=timers.entries().next().value;if(!entry)return;timers.delete(entry[0]);entry[1]();}
function drain(){let n=0;while(timers.size){assert(++n<1000);step();}}
const keys=new Set([1]);queue.request({map:'A',version:0,keys});const deadline=[...timers.keys()][0];queue.request({map:'A',version:1,keys});assert.equal([...timers.keys()][0],deadline,'Continuous input cannot postpone the first refresh indefinitely');step();assert(queue.status.working);
for(let version=2;version<=100;version++){keys.add(version);queue.request({map:'A',version,keys});assert(queue.status.queued<=1);}
drain();assert.deepEqual(publications.map(p=>p.version),[1,100],'Intermediate requests must collapse into the latest target');
assert.deepEqual(publications[0].keys,[1],'A running snapshot must be immutable');assert.equal(publications[1].keys.length,100);assert.equal(queue.status.pending,false);
queue.request({map:'A',version:101,keys});step();currentMap='B';queue.reset();queue.request({map:'B',version:1,keys:new Set([500])});drain();
assert.deepEqual(publications.at(-1),{map:'B',version:1,keys:[500]});assert(!publications.some(p=>p.map==='A'&&p.version===101),'Invalidated maps cannot publish stale results');
queue.request({map:'B',version:2,keys:new Set([600])});step();queue.flush({map:'B',version:3,keys:new Set([700])});assert.equal(timers.size,0);assert.deepEqual(publications.at(-1).keys,[700]);assert.equal(queue.status.pending,false);
assert(queue.status.merged>=98);assert(queue.status.cancelled>=2);assert(queue.status.maxSliceMs<3);assert(busy.includes(true)&&busy.at(-1)===false);
console.log('PASS one active plus one latest refresh, immutable snapshots, bounded chunks, map reset and exact export flush');
