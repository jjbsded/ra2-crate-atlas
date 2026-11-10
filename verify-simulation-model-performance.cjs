/* Large real plans: isolate edit handlers from rendering/network latency. */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),M=require('./simulation-model.js');
const source=JSON.parse(fs.readFileSync(process.env.MODEL_SOURCE||'output/bulk-performance-qa/source.json','utf8'));
assert(process.env.SIM_PLAN,'Set SIM_PLAN to an exported simulation plan');
const plan=JSON.parse(fs.readFileSync(process.env.SIM_PLAN,'utf8').replace(/^\uFEFF/,''));plan.map.version=source.version;
const rows=[];
function model(){const m=M.create(source);m.import(plan);m.current();return m;}
function measure(name,fn,n=1){const times=[];for(let i=0;i<n;i++){const at=performance.now();fn(i);times.push(performance.now()-at);}const row={name,total:times.reduce((a,b)=>a+b,0),max:Math.max(...times),mean:times.reduce((a,b)=>a+b,0)/times.length,count:n};rows.push(row);console.log(name,JSON.stringify(row));}
const m=model(),state=m.current(),points=[...state.cells].filter(([p,c])=>c.usable&&c.overlay===255&&!c.terrain&&!state.occupants.get(p)?.length).slice(0,120).map(([p])=>p);assert(points.length===120);
measure('count same plan',()=>m.count,100);
measure('public snapshot',()=>m.plan,30);
m.beginPaint();measure('erase empty brush',i=>assert.equal(m.paint([points[i]],'chrono'),false),120);assert.equal(m.endPaint(),false);
const targets=plan.placements.filter(o=>o.category==='STRUCTURES').slice(0,80).map(o=>o.x+','+o.y);assert.equal(targets.length,80);
const erased=model();erased.beginPaint();measure('erase buildings brush',i=>erased.paint([targets[i]],'chrono'),80);assert(erased.endPaint());
const final=erased.plan;assert(erased.undo());assert.deepEqual(erased.plan,plan);assert(erased.redo());assert.deepEqual(erased.plan,final);
const restored=model();restored.beginPaint();measure('restore brush',i=>restored.paint([targets[i]],'restore'),80);assert(restored.endPaint());
fs.mkdirSync('output/other-operation-performance',{recursive:true});fs.writeFileSync('output/other-operation-performance/model-'+(process.env.MODEL_STAGE||'current')+'.json',JSON.stringify({placements:plan.placements.length,objects:state.objects.length,cells:state.cells.size,rows},null,2));
console.log('PASS unchanged empty strokes and atomic undo/redo on the real 5,572-placement plan');
