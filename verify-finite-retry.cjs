const fs=require('node:fs'),assert=require('node:assert/strict'),S=require('./toy-live/solver.js');
const fixtures=JSON.parse(fs.readFileSync('output/finite-retry-qa/fixtures.json'));
for(const t of fixtures){const binary=Uint32Array.from(t.records.flatMap(row=>[row.length,...row])),cells=Object.entries(t.statuses).map(([k,status])=>({x:Number(k)%512,y:Math.floor(Number(k)/512),status}));
 const r=S.calculate(binary,cells,t.records.length,()=>{},t.limit),actual={...r.probability,cells:Object.fromEntries(r.results)};assert.deepEqual(actual,t.result);}
const D=require('./probability-display.js');for(const t of fixtures){const cells=Object.values(t.result.cells),old=structuredClone(cells),current=D.reweight(cells,t.result);assert.deepEqual(current,cells);assert.deepEqual(cells,old);const stale=cells.map(c=>({...c,probability:0,multiplier:0}));assert.deepEqual(D.reweight(stale,t.result),cells);}
console.log('PASS',fixtures.length,'Python/JS exact finite-retry distributions, termination, exhaustion and CRT');
