'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),M=require('./simulation-model.js');
const template=JSON.parse(fs.readFileSync('output/simulation-20261104/source.json','utf8'));
function fixture(){const s=structuredClone(template),base=s.cells.find(c=>c.usable&&c.rawLand===0&&c.overlay===255);s.cells=[];for(let x=1;x<=90;x++)for(let y=1;y<=45;y++)s.cells.push({...base,x,y,level:0,slope:0,overlay:255,overlayData:0,overlayName:null,terrain:null,bridge:null,rawLand:0});s.map={MAP:structuredClone(s.map.MAP),STRUCTURES:{},UNITS:{},INFANTRY:{},AIRCRAFT:{},TERRAIN:{}};return s;}
{
 const s=fixture(),m=M.create(s);assert(!m.paint(['5,5'],'chrono')); // Prime the index.
 assert(m.place('MTNK',5,5));const snapshot=m.plan,checkpoint=m.checkpoint();assert.equal(m.count,1);
 assert(m.paint(['5,5'],'chrono'),'An appended object must appear in a primed spatial lookup');assert.equal(m.count,0);
 assert.equal(snapshot.placements.length,1);assert(m.undo());assert.equal(m.count,1);assert(m.redo());assert.equal(m.count,0);
 m.rollback(checkpoint);assert.equal(m.count,1);assert(m.paint(['5,5'],'magnet'));assert.equal(m.count,0);
 assert(m.undo());assert(!m.paint(['70,40'],'normal'));assert.equal(m.count,1);
 const next=M.create(s);assert(next.import(m.plan));assert(!next.import(next.plan),'Equivalent imported records do not create history');
 next.beginPlacement();assert(next.appendPlacement('MTNK',6,6));assert.equal(next.count,2);assert(next.appendPlacement('MTNK',7,7));assert.equal(next.count,3);assert(next.endPlacement());assert(next.undo());assert.equal(next.count,1);assert(next.redo());assert.equal(next.count,3);
 const publicPlan=next.plan;publicPlan.placements[0].x=88;assert.equal(next.plan.placements[0].x,5,'Public snapshots remain independent');
}
{
 const s=fixture(),m=M.create(s),ore=m.choices.find(c=>c.ore).type;
 assert(m.place('MTNK',20,20));assert(m.place(ore,20,20));const before=m.plan;
 // Restore can skip the full current-state build. A later destructive tool in
 // that transaction must still shield the lower layer as it was at its start.
 m.beginPaint('restore');assert(m.paint(['80,40'],'restore')===false);
 assert(m.paint(['20,20'],'magnet'));assert(!m.paint(['20,20'],'magnet'));
 assert(m.endPaint());assert.deepEqual(m.plan.placements.map(o=>o.type),[ore]);
 assert(m.undo());assert.deepEqual(m.plan,before);
}
{
 const s=fixture();s.rules.QA_CHAIN={...s.rules.GAPOWR,IMAGE:'QA_CHAIN',IMMUNE:'no',STRENGTH:'100'};s.art.QA_CHAIN={FOUNDATION:'2x1'};
 for(let i=39;i>=0;i--)s.map.STRUCTURES['chain'+i]=`Americans,QA_CHAIN,256,${20+i},20,0,None,1,0,1,0,0,None,None,None,0,0`;
 s.map.UNITS.other='Americans,MTNK,256,2,2,0,Guard,None,0,-1,0,0,1,0';
 const m=M.create(s);assert(m.quick('buildings','chrono'));assert(m.quick('units'));const removed=m.plan;assert.equal(Object.keys(removed.objects).length,41);
 assert(m.paint(['20,20'],'restore'));assert.deepEqual(Object.keys(m.plan.objects),['UNITS/other'],'Restoration follows all overlapping foundations, but never unrelated objects');
 const restored=m.plan;assert(m.undo());assert.deepEqual(m.plan,removed);assert(m.redo());assert.deepEqual(m.plan,restored);
}
console.log('PASS spatial lookup after append/undo/redo/rollback/import, copy-on-write snapshots, count invalidation, no-op history and reversed overlapping-foundation restoration');
