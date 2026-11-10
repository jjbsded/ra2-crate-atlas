'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),M=require('./simulation-model.js'),A=require('./region-auto.js');
if(process.argv[2]==='plans'){
 const source=JSON.parse(fs.readFileSync(process.argv[3])),m=M.create(source),cases=[],record=(name,expected)=>cases.push({name,plan:m.plan,expected});
 record('baseline',{east:true,mine:false,hut:false,deck:true});
 assert(m.quick('bridges'));record('broken-bridge',{east:false,mine:false,hut:false,deck:false});
 assert(m.undo());record('undo-bridge',{east:true,mine:false,hut:false,deck:true});
 assert(m.paint(['14,19'],'magnet'));record('magnet-mine',{east:true,mine:true,hut:false,deck:true});
 assert(m.paint(['14,21'],'magnet'));record('magnet-immune-hut',{east:true,mine:true,hut:true,deck:true});
 assert(m.paint(['14,19','14,21'],'restore'));record('restore-objects',{east:true,mine:false,hut:false,deck:true});
 assert(m.place('MTNK',13,20));record('tank-no-route-change',{east:true,mine:false,hut:false,deck:true,unchanged:true});
 assert(m.undo());record('undo-tank-no-route-change',{east:true,mine:false,hut:false,deck:true,unchanged:true});
 fs.writeFileSync(process.argv[4],JSON.stringify(cases));console.log('PASS generated bridge/magnetic/restore/undo plans through the real simulation model');
}else(async()=>{
 for(const c of JSON.parse(fs.readFileSync(process.argv[2]))){
  const nav=require('./toy-live/analyze.js').navigation(c.cells,c.rules,2,'TEMPERATE');assert.deepEqual(nav,c.navigation,c.name+' Full/Toy navigation parity');
  const result=await A.partition({cells:c.cells,navigation:c.navigation,starts:[{number:1,x:14,y:20}],eligible:new Set(c.cells.filter(c=>c.usable).map(c=>c.x*1024+c.y)),settings:{maxSea:0,exclusive:true}},{yieldControl:async()=>{}}),player=result.regions.find(r=>r.kind==='player'&&r.number===1),owns=(x,y)=>!!player?.keys.includes(x*1024+y),bits=A.flags(c.navigation,c.cells.length),at=(x,y)=>bits[c.cells.findIndex(c=>c.x===x&&c.y===y)];
  assert.equal(owns(23,20),c.expected.east,c.name+' far bank');assert.equal(owns(14,19),c.expected.mine,c.name+' mine');assert.equal(owns(14,21),c.expected.hut,c.name+' immune hut');assert.equal(!!(at(19,20)&8),c.expected.deck,c.name+' deck');
 }
 console.log('PASS automatic regions: bridge damage/undo, magnetic drill/immune hut removal, restore, unit-free routes and Full/Toy parity');
})().catch(error=>{console.error(error);process.exitCode=1;});
