/* Exact square sums, cached indexes and cancellation of superseded UI work. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const D=require('./probability-display.js'),R=require('./region-statistics.js');
global.CrateProbabilityDisplay=D;global.CrateRegionStatistics=R;
const U=require('./unit-buff.js');
function fixture(factor=1n,dense=true){
 const cells=[];for(let y=0;y<52;y++)for(let x=0;x<64;x++)if((x*3+y)%17)cells.push({x,y,px:x*30,py:y*15,n:BigInt((x*7+y*11)%23)*factor});
 const lookup=new Map(cells.map(c=>[c.x+','+c.y,c])),placements=[];
 for(let i=0;i<(dense?800:2);i++){const c=cells[i*3%cells.length];placements.push({type:i%3?'MTNK':'E2',x:c.x,y:c.y,subcell:i%3,onBridge:!!(i%2)});}
 placements.push({...placements[0],subcell:2},{type:'IGNORED',x:20,y:20},{type:'MTNK',x:500,y:500});
 const data={metadata:{sourceSha256:'fixture',simulationPlan:{placements}}},s={data,cells,lookup};
 const display={baselineNumerator:7n*factor,_denominator:cells.reduce((n,c)=>n+c.n,0n)*2n,get:c=>({numerator:c.n})};
 const members=new Map(cells.map(c=>[R.key(c),[{id:c.x<32?'left':'right'},...(c.y<10?[{id:'overlap'}]:[])]]));
 return {s,display,members};
}
function oracle({s,display,members},radius){
 const totals=new Map(),denominator=display.baselineNumerator*BigInt(U.baseline(radius));
 for(const unit of s.data.metadata.simulationPlan.placements){
  const group={MTNK:'tank',E2:'infantry'}[unit.type];if(!group||!s.lookup.has(unit.x+','+unit.y))continue;let n=0n;
  for(let dx=1-radius;dx<radius;dx++)for(let dy=1-radius;dy<radius;dy++)n+=s.lookup.get((unit.x+dx)+','+(unit.y+dy))?.n||0n;
  for(const region of members.get(R.key(unit))||[]){let sum=totals.get(region.id);if(!sum)totals.set(region.id,sum={});const v=sum[group]||={count:0,n:0n,denominator};v.count++;v.n+=n;}
 }
 return totals;
}
const normalize=m=>JSON.parse(JSON.stringify([...m].sort(([a],[b])=>a.localeCompare(b)),(_,v)=>typeof v==='bigint'?v.toString():v));
for(const dense of [false,true])for(const factor of [1n,10n**25n+1n]){
 const f=fixture(factor,dense);let radius=1;const buff=U.create(()=>f.s,()=>f.display,()=>radius,()=>f.members);
 for(radius of [1,3,8,32,2])assert.deepEqual(normalize(buff.statistics()),normalize(oracle(f,radius)),'Exact arithmetic at radius '+radius);
 if(dense)assert.equal(buff.status.indexBuilds,1,'All radius changes share one probability index');
}
console.log('PASS exact sparse/dense sums, huge integers, borders, holes, overlapping regions and per-unit totals');
{
 const cell={x:5,y:6,px:100,py:80,labelOffset:[6,-3]},units=[0,1,2].map(subcell=>({type:'E2',x:5,y:6,subcell}));units.push({type:'MTNK',x:5,y:6,onBridge:true});
 const state={data:{metadata:{simulationPlan:{placements:units}}},cells:[cell],lookup:new Map([['5,6',cell]])},display={baselineNumerator:1n,_denominator:22n,get:()=>({numerator:11n})};
 const buff=U.create(()=>state,()=>display,()=>1,()=>new Map()),drawn=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},strokeText(){},fillText(text,x,y){drawn.push({text,x,y});}};
 buff.paint(ctx,{x:20,y:40,scale:2},{x:0,y:0,w:1000,h:1000});
 assert.equal(drawn.length,2,'Three infantry share one centered cell label; bridge and ground stay separate');
 assert.equal(drawn[0].x,20+(cell.px+6)*2);assert.equal(drawn[0].y,40+(cell.py-3)*2+18/3);
 assert(Math.abs(drawn[0].y-drawn[1].y-120)<1e-10,'Bridge labels keep the correct deck elevation');
}
const timers=new Map(),pending=[],published=[];let time=0,id=0;
const context={console,performance:{now(){time+=.2;return time;}},setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);},CrateProbabilityDisplay:D,CrateRegionStatistics:R,CrateBuffReference:require('./buff-reference.js')};
vm.createContext(context);vm.runInContext(fs.readFileSync('unit-buff.js','utf8'),context);
let f=fixture(),radius=3;const buff=context.CrateUnitBuff.create(()=>f.s,()=>f.display,()=>radius,()=>f.members,{onChange:()=>published.push(buff.status.appliedRadius),onPending:v=>pending.push(v)});
const step=()=>{const first=timers.entries().next().value;if(!first)return;timers.delete(first[0]);first[1]();};
const drain=()=>{let n=0;while(timers.size){assert(++n<1000);step();}};
buff.statistics();assert.equal(timers.size,1);step();assert.equal(buff.status.pending,true);
radius=20;buff.refresh(90);radius=7;buff.refresh(90);assert.equal(timers.size,1,'Only the latest task is queued');
assert.equal(buff.status.completed,0);drain();assert.deepEqual(published,[7]);assert.deepEqual(normalize(buff.statistics()),normalize(oracle(f,7)));
const builds=buff.status.indexBuilds;
radius=10;buff.refresh(90);step();radius=7;buff.refresh(90);assert.equal(timers.size,0,'Returning to the committed radius cancels work immediately');assert.equal(buff.status.pending,false);
for(let i=8;i<=28;i++){radius=i;buff.refresh(90);}for(let i=27;i>=4;i--){radius=i;buff.refresh(90);}assert.equal(timers.size,1);drain();
assert.deepEqual(published,[7,4]);assert.equal(buff.status.indexBuilds,builds);assert.deepEqual(normalize(buff.statistics()),normalize(oracle(f,4)));
radius=18;buff.refresh(90);step();f=fixture(3n);f.s.data.metadata.sourceSha256='other';buff.refresh();assert.equal(buff.statistics().size,0,'Different maps must not display old region totals');drain();
assert.equal(buff.status.appliedRadius,18);assert.deepEqual(normalize(buff.statistics()),normalize(oracle(f,18)));
radius=5;buff.refresh(90);const snapshot=buff.snapshot();assert.equal(buff.status.pending,false);assert.equal(timers.size,0);assert.equal(buff.status.appliedRadius,5);
function labels(draw){const texts=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},strokeText(){},fillText(text){texts.push(text);}};draw(ctx,{x:10,y:30,scale:.5},{x:0,y:0,w:10000,h:10000});return texts;}
const frozen=labels(snapshot);radius=9;buff.refresh();drain();assert.deepEqual(labels(snapshot),frozen,'Exports freeze exact latest-radius values across later input');
f.members=new Map();buff.refresh();drain();assert.equal(buff.statistics().size,0,'Region changes reaggregate the committed unit values');
assert.equal(buff.status.pending,false);assert(buff.status.cancelled>20);assert(pending.includes(true)&&pending.at(-1)===false);
console.log('PASS cooperative chunks, latest-only cancellation, index reuse, return-to-committed radius, map reset and exact immutable export');

// Probability patches retain untouched unit sums, including queued patches.
for(const r of [1,3,15]){
 const f=fixture(10n**60n+7n,true);f.s.data.metadata.simulationPlan.placements.forEach((u,i)=>u.id='unit-'+i);let radius=r;
 const b=U.create(()=>f.s,()=>f.display,()=>radius,()=>f.members);b.statistics();
 function edit(index,amount){const before=f.s.cells[index],after={...before,n:before.n+amount},previousData=f.s.data,previousDisplay=f.display;f.s.cells=f.s.cells.slice();f.s.cells[index]=after;f.s.lookup=new Map(f.s.lookup);f.s.lookup.set(after.x+','+after.y,after);f.s.data={...previousData,metadata:{...previousData.metadata,simulationPlan:{placements:previousData.metadata.simulationPlan.placements.slice()}}};f.display={...previousDisplay};b.updateCells([[before,after]],{previousData,previousDisplay,compatible:true});assert.deepEqual(normalize(b.statistics()),normalize(oracle(f,r)));}
 edit(200,13n);edit(205,-3n);assert.equal(b.status.incremental,2);assert(b.status.reusedUnits>0);assert(b.status.updatedUnits<800);
 const previousData=f.s.data,previousDisplay=f.display,unit={...previousData.metadata.simulationPlan.placements[4],id:'new-unit'};f.s.data={...previousData,metadata:{...previousData.metadata,simulationPlan:{placements:[...previousData.metadata.simulationPlan.placements.slice(1),unit]}}};f.display={...previousDisplay};b.updateCells([],{previousData,previousDisplay,compatible:true});assert.deepEqual(normalize(b.statistics()),normalize(oracle(f,r)),'Added/removed units use the same exact sums');
}
{
 f=fixture(10n**40n+1n,true);f.s.data.metadata.simulationPlan.placements.forEach((u,i)=>u.id='queued-'+i);radius=3;const b=context.CrateUnitBuff.create(()=>f.s,()=>f.display,()=>radius,()=>f.members,{onChange(){}});b.snapshot();
 for(let i=0;i<4;i++){const before=f.s.cells[180+i],after={...before,n:before.n+BigInt(i+5)},previousData=f.s.data,previousDisplay=f.display;f.s.cells=f.s.cells.slice();f.s.cells[180+i]=after;f.s.lookup=new Map(f.s.lookup);f.s.lookup.set(after.x+','+after.y,after);f.s.data={...previousData};f.display={...previousDisplay};b.updateCells([[before,after]],{previousData,previousDisplay,compatible:true});}
 drain();assert.deepEqual(normalize(b.statistics()),normalize(oracle(f,radius)),'Superseded local patches merge relative to the committed source');assert.equal(b.status.changedCells,4);assert(b.status.cancelled>0);
}
console.log('PASS incremental exact coverage, unchanged-unit reuse, additions/removals, queued patch merging and overlapping region totals');
