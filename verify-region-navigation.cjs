const fs=require('node:fs'),assert=require('node:assert/strict'),L=require('./toy-live/analyze.js'),A=require('./region-auto.js');
(async()=>{for(const c of JSON.parse(fs.readFileSync(process.argv[2]))){
 const before=structuredClone(c),nav=report=>L.navigation(report.cells,c.rules,2,'TEMPERATE');
 const units=nav(c.units),empty=nav(c.empty);assert.deepEqual(units,c.navigation,c.terrain+' native/Toy routing');assert.deepEqual(units,empty);
 const run=report=>A.partition({cells:report.cells,navigation:nav(report),starts:c.terrain==='water'?[]:[{number:1,x:1,y:1}],settings:{exclusive:true}},{yieldControl:async()=>{}});
 assert.deepEqual(await run(c.units),await run(c.empty),c.terrain+' region membership');
 if(c.terrain!=='water'){const result=await run(c.units);assert.deepEqual(result.unreachablePlayers,[]);assert.equal(result.regions[0].keys.length,5,'Units at start and choke must not split routes');}
 assert.deepEqual(c,before,'Navigation must preserve all source cells');
}
console.log('PASS native/Toy unit-free routing: start, land choke, bridge deck, water and immutable probabilities');
})().catch(e=>{console.error(e);process.exitCode=1;});
