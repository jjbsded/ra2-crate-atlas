'use strict';
const assert=require('node:assert/strict'),C=require('./buff-source.js'),B=require('./buff-expectation.js'),S=require('./toy-live/solver.js');
const finish=steps=>{let p;do{p=steps.next();}while(!p.done);return p.value;};
const cells=[];for(let y=1;y<=7;y++)for(let x=1;x<=7;x++)cells.push({x,y,px:30*(x-y)+100,py:15*(x+y),land:x>5?2:0,candidate:true,track:x<=5,float:x>5,primary:true,status:'crate',surface:[[[0,-15],[30,0],[0,15],[-30,0]]]});
function report(cells){const grid=new Uint8Array(262144);for(const c of cells)grid[c.y*512+c.x]=(c.candidate?(+c.track|(+c.float<<1)):0)|(+c.primary<<2)|(+ (c.land===2)<<3);return{cells,metadata:{size:[0,0,4,4]},probability:S.calculate(S.search(grid,7),cells,49).probability};}
let data=report(cells),base=finish(C.pack(data,1)),old=structuredClone(base.wire),resident=structuredClone(base.wire);
for(let i=0;i<6;i++){
 const changed={...data.cells[12+i],candidate:false,status:i%2?'ghost':'retry',land:i===1?2:data.cells[12+i].land},next=report(data.cells.map(c=>c===data.cells[12+i]?changed:c));
 const patched=finish(C.patch(base,next,i+2,[changed])),fresh=finish(C.pack(next,i+2));
 assert.equal(patched.wire.geometry.points,base.wire.geometry.points);assert.equal(patched.index,base.index);assert.deepEqual(patched.wire,fresh.wire);resident=C.apply(resident,structuredClone(patched.update));assert.deepEqual(resident,fresh.wire,'Sparse worker transport is lossless');
 const direct=finish(B.prepare(next)),encoded=finish(B.prepare(resident));for(const[x,y]of [[2,2],[3,4],[6,5],[0,0],[8,8]])for(const r of [1,2,3])assert.equal(B.value(encoded,x,y,r),B.value(direct,x,y,r),'Every counterfactual matches the complete source');
 if(i===0)assert.deepEqual(base.wire,old,'Later updates cannot mutate a cached source');base=patched;data=next;
}
const unchanged=finish(C.patch(base,data,99,[]));assert.equal(unchanged.update.delta.length,0);assert.equal(unchanged.update.probability,null);assert.equal(unchanged.wire.packed.grid,base.wire.packed.grid);assert.equal(unchanged.wire.geometry.headers,base.wire.geometry.headers);
assert.equal(C.apply({...resident,id:-1},unchanged.update),null,'A missing/obsolete worker base requests a complete source');
assert.equal(finish(C.patch(base,{...data,cells:data.cells.slice(1)},100,[])),null);
console.log('PASS sparse Buff sources: complete-pack equality, immutable buffers, geometry/index/coefficient reuse, missing-base fallback and unchanged counterfactual numbers');
