'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),M=require('./simulation-model.js');
const source=JSON.parse(fs.readFileSync('output/simulation-20261104/source.json'));
source.map={...source.map,STRUCTURES:{},UNITS:{},INFANTRY:{},AIRCRAFT:{},TERRAIN:{}};
for(const land of [0,2,6]){
 const s=structuredClone(source);for(const c of s.cells)Object.assign(c,{rawLand:land,tileLand:land,slope:0,level:0,usable:true,overlay:255,overlayData:0,terrain:null,bridge:null,terrainError:false,overlayError:false});
 const m=M.create(s);assert.deepEqual(m.choices.filter(c=>c.category==='UNITS').map(c=>c.type),['MTNK','HYD','YHVR']);assert(!m.choices.some(c=>c.type==='E2'));assert(!m.placement('E2',30,30).allowed);
 for(const[type,allowed]of [['MTNK',land===0],['HYD',land===2],['YHVR',true]]){assert.equal(m.placement(type,30,30).allowed,allowed,`${type} on land ${land}`);assert.equal(m.placement(type,30,30,{ignoreLand:true}).allowed,allowed,'The building switch never changes unit movement');}
 const building=m.choices.find(c=>c.category==='STRUCTURES'&&!c.water).type;assert.equal(m.placement(building,30,30).allowed,land===0);assert(m.placement(building,30,30,{ignoreLand:true}).allowed,'Ignoring building land/water allows clear, water and beach');
 const ship=m.choices.find(c=>c.category==='STRUCTURES'&&c.water).type;assert(m.placement(ship,30,30,{ignoreLand:true}).allowed);
 const type=land===0?'MTNK':land===2?'HYD':'YHVR';assert(m.place(type,30,30));const copy=M.create(s);assert(copy.import(m.plan));assert.deepEqual(copy.plan,m.plan);assert(m.undo());assert(m.redo());
 if(land===0){const plan=M.empty(s);plan.placements.push({id:'sim-old-infantry',type:'E2',category:'INFANTRY',x:30,y:30,facing:64,subcell:0,onBridge:false});const legacy=M.create(s);assert(legacy.import(plan));assert.equal(legacy.plan.placements[0].type,'E2');assert(!legacy.place('E2',31,30),'Historical infantry stays visible without permitting new infantry');}
}
console.log('PASS original Track/Float/Hover movement, no new infantry, building-only override, coast construction and plan/history roundtrip');
