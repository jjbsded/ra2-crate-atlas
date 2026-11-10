'use strict';
const assert=require('node:assert/strict'),A=require('./region-auto.js'),R=require('./region-statistics.js');
const key=(x,y)=>x*1024+y;
function grid(w,h=1){return {cells:Array.from({length:w*h},(_,i)=>({x:i%w+1,y:Math.floor(i/w)+1,level:0,slope:0})),navigation:{version:A.navigationVersion,count:w*h,flags:new Uint8Array(w*h).fill(17)},starts:[{number:1,x:1,y:1}]};}
function set(g,x,y,flag,props={}){const i=g.cells.findIndex(c=>c.x===x&&c.y===y);g.navigation.flags[i]=flag;Object.assign(g.cells[i],props);}
const run=(g,settings={})=>A.partition({...g,settings:{exclusive:false,maxPath:1,maxStraight:1,...settings}},{yieldControl:async()=>{}}),owns=(r,n,x,y=1)=>r.regions[n]?.keys.includes(key(x,y));
(async()=>{
 let g=grid(80),r=await run(g);assert.equal(r.regions[0].keys.length,80);assert.equal(r.cornerCells,78);r=await run(g,{claimCorners:false});assert.equal(r.regions[0].keys.length,2);assert.equal(r.cornerCells,0);
 g=grid(9);g.starts.push({number:2,x:9,y:1});r=await run(g);assert.equal(r.regions[0].keys.length,2);assert.equal(r.regions[1].keys.length,2);assert(!owns(r,0,5)&&!owns(r,1,5),'A shared frontier stays unclaimed');
 r=await run(g,{teams:{1:'A',2:'A'}});assert.equal(r.regions.length,1);assert.equal(r.regions[0].keys.length,9,'Allied players are one region');
 g=grid(7,5);g.navigation.flags.fill(0);for(let x=1;x<=7;x++)set(g,x,3,17);for(let y=1;y<=2;y++)set(g,2,y,17);g.starts=[{number:1,x:1,y:3},{number:2,x:7,y:3}];
 r=await run(g,{maxPath:2,maxStraight:2});assert(owns(r,0,2,1),'Only the player-one corner is annexed');assert(!owns(r,0,4,3)&&!owns(r,1,4,3));assert.equal(r.cornerCells,1);
 assert.deepEqual((await run({...g,starts:[...g.starts].reverse()},{maxPath:2,maxStraight:2})).regions,r.regions,'Input player order is immaterial');
 for(const barrier of [0,2,5]){g=grid(7);set(g,3,1,barrier);r=await run(g,{maxSea:100});assert(!owns(r,0,4),'No annexation across rock, bare water or coast');}
 g=grid(7);for(let x=3;x<=7;x++)set(g,x,1,17,{level:4});r=await run(g);assert(!owns(r,0,3),'Cliff edges do not join equal XY neighbors');
 g=grid(7);set(g,1,1,17,{level:4});set(g,7,1,17,{level:4});for(let x=2;x<=6;x++)set(g,x,1,10,{bridge:{kind:'high',deckLevel:4}});r=await run(g);assert.equal(r.regions[0].keys.length,7,'Intact deck connects both banks');
 set(g,4,1,2,{bridge:null});r=await run(g);assert(!owns(r,0,5),'A broken bridge no longer connects the far bank');
 g=grid(7);for(let x=2;x<=6;x++)set(g,x,1,1,{bridge:{kind:'low'}});r=await run(g);assert.equal(r.regions[0].keys.length,7,'Low bridges remain walkable');
 g=grid(7);g.eligible=new Set(g.cells.filter(c=>c.x!==3).map(c=>key(c.x,c.y)));r=await run(g);assert(!owns(r,0,4),'Ineligible ground cannot join the fill');
 g=grid(40);g.starts=[];r=await run(g);assert.equal(r.regions[0].kind,'land','Standalone large land is still created afterwards');assert.equal(r.cornerCells,0);
 const d=R.defaults();assert.equal(d.autoOptions.claimCorners,true);d.autoOptions.claimCorners=false;assert.equal(R.decode(R.encode(d),new Map()).autoOptions.claimCorners,false,'The switch survives backup/import');
 const controller=new AbortController();g=grid(200,200);let yielded=0;await assert.rejects(A.partition({...g,settings:{exclusive:false,maxPath:1,maxStraight:1}},{signal:controller.signal,yieldControl:async()=>{yielded++;controller.abort();}}));assert(yielded>0,'Large work yields and can be cancelled');
 console.log('PASS corner annexation switch, one/two/team owners, pre-large-area stage, water/coast/cliff/bridge constraints, persistence and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
