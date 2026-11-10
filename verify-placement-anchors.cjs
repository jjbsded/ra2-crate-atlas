'use strict';
const assert=require('node:assert/strict'),P=require('./simulation-placement.js');
const project=(x,y)=>({x:30*(x-y),y:15*(x+y)}),cell=(x,y)=>({x,y,px:30*(x-y),py:15*(x+y)});
const footprint=(w,h)=>Array.from({length:w*h},(_,i)=>[i%w,Math.floor(i/w)]);
let checks=0;
for(const [w,h] of [[2,2],[2,3],[4,4]])for(const sx of [-1,1])for(const sy of [-1,1]){
 const start=cell(20,20),end=cell(20+sx*4,20+sy*6),cells=[];
 for(let x=Math.min(start.x,end.x);x<=Math.max(start.x,end.x);x++)for(let y=Math.min(start.y,end.y);y<=Math.max(start.y,end.y);y++)cells.push(cell(x,y));
 const settings={method:'box-game',start,boxLast:end,width:w,height:h},f=footprint(w,h),targets=[...P.boxTargets(settings,cells,{footprint:f,building:true,project})];
 assert(targets.some(p=>p.x===start.x-(sx<0?w-1:0)&&p.y===start.y-(sy<0?h-1:0)),'Opposite corner belongs to the first selected cell');
 assert.equal(new Set(targets.flatMap(p=>f.map(([x,y])=>(p.x+x)+','+(p.y+y)))).size,targets.length*f.length,'Foundations do not overlap');
 for(const method of ['box','box-game'])assert.deepEqual([...P.boxTargets({...settings,method,boxStart:project(start.x,start.y),boxEnd:project(end.x,end.y)},[end],{footprint:f,building:true,project})],[{x:end.x,y:end.y}],'Single cells always align to the top foundation cell');
 checks++;
}
for(const [w,h] of [[2,2],[2,3],[4,4]])for(const sx of [-1,0,1])for(const sy of [-1,0,1]){
 if(!sx&&!sy)continue;
 const start=cell(20,20),a={x:start.px+3,y:start.py+4},b={x:a.x+sx*600,y:a.y+sy*330},f=footprint(w,h),cells=[];
 // Degenerate axes retain a narrow row of actual selected cell centers.
 if(!sx)a.x=b.x=start.px;if(!sy)a.y=b.y=start.py;
 for(let x=0;x<60;x++)for(let y=0;y<60;y++){const c=cell(x,y);if(c.px>=Math.min(a.x,b.x)&&c.px<=Math.max(a.x,b.x)&&c.py>=Math.min(a.y,b.y)&&c.py<=Math.max(a.y,b.y))cells.push(c);}
 const settings={method:'box',start,boxStart:a,boxEnd:b,boxLast:cell(30,30),width:w,height:h},targets=[...P.boxTargets(settings,cells,{footprint:f,building:true,project})];
 assert(targets.length,'Screen boxes produce full buildings for every direction');
 for(const p of targets)for(const [x,y] of f){const q=project(p.x+x,p.y+y);
  if(sx>0)assert(q.x>=a.x-1e-6,'Left start boundary uses cell centers');if(sx<0)assert(q.x<=a.x+1e-6,'Right start boundary uses cell centers');
  if(sy>0)assert(q.y>=a.y-1e-6,'Top start boundary uses cell centers');if(sy<0)assert(q.y<=a.y+1e-6,'Bottom start boundary uses cell centers');
 }
 assert.equal(new Set(targets.flatMap(p=>f.map(([x,y])=>(p.x+x)+','+(p.y+y)))).size,targets.length*f.length);
 const units=[...P.boxTargets({...settings,width:1,height:1},cells,{footprint:[[0,0]],building:false,project})];assert.deepEqual(units,cells.map(c=>({x:c.x,y:c.y})),'Units retain the selected centers');checks++;
}
// An independent exhaustive oracle checks that the first building minimizes
// its two start-side gaps. It also catches the old 30px/15px extra inset.
let edgeChecks=0,usedEdges=0;
for(const [w,h] of [[2,2],[2,3],[3,2],[4,4]])for(const sx of [-1,1])for(const sy of [-1,1])for(const [ox,oy] of [[0,0],[3,4],[-11,7],[19,-6]]){
 const start=cell(20,20),a={x:start.px+ox,y:start.py+oy},b={x:a.x+sx*600,y:a.y+sy*330},f=footprint(w,h),cells=[];
 for(let x=0;x<60;x++)for(let y=0;y<60;y++){const c=cell(x,y);if(c.px>=Math.min(a.x,b.x)-1e-6&&c.px<=Math.max(a.x,b.x)+1e-6&&c.py>=Math.min(a.y,b.y)-1e-6&&c.py<=Math.max(a.y,b.y)+1e-6)cells.push(c);}
 const gaps=p=>{const points=f.map(([x,y])=>project(p.x+x,p.y+y));return [sx>0?Math.min(...points.map(q=>q.x))-a.x:a.x-Math.max(...points.map(q=>q.x)),sy>0?Math.min(...points.map(q=>q.y))-a.y:a.y-Math.max(...points.map(q=>q.y))];};
 let minimum=Infinity;
 for(let x=10;x<=30;x++)for(let y=10;y<=30;y++){const g=gaps({x,y});if(g.every(n=>n>=-1e-6))minimum=Math.min(minimum,g[0]**2+g[1]**2);}
 const targets=[...P.boxTargets({method:'box',start,boxStart:a,boxEnd:b,boxLast:cell(30,30),width:w,height:h},cells,{footprint:f,building:true,project})];
 const scores=targets.map(p=>{const g=gaps(p);if(g[0]<30||g[1]<15)usedEdges++;return g[0]**2+g[1]**2;});
 assert.equal(Math.min(...scores),minimum,'Both start sides use the closest feasible center-based foundation');edgeChecks++;
}
assert(usedEdges>0,'Use selected edge-cell centers instead of keeping their entire diamonds inside');
assert.deepEqual([...P.boxTargets({},[],{footprint:[],project})],[]);
console.log('PASS',checks,'direction/footprint combinations and',edgeChecks,'exhaustive edge-alignment cases; single cells, independent units and nonoverlapping foundations');
