const fs=require('node:fs'),assert=require('node:assert/strict'),L=require('./toy-live/analyze.js'),A=require('./region-auto.js'),R=require('./region-statistics.js');
(async()=>{for(const c of JSON.parse(fs.readFileSync(process.argv[2]))){
 const before=structuredClone(c),nav=report=>L.navigation(report.cells,c.rules,2,'TEMPERATE');
 const units=nav(c.units),empty=nav(c.empty);assert.deepEqual(units,c.navigation,c.terrain+' native/Toy routing');assert.deepEqual(units,empty);
 const run=report=>A.partition({cells:report.cells,navigation:nav(report),starts:c.terrain==='water'?[]:[{number:1,x:1,y:1}],settings:{exclusive:true}},{yieldControl:async()=>{}});
 assert.deepEqual(await run(c.units),await run(c.empty),c.terrain+' region membership');
 if(c.terrain!=='water'){
  const result=await run(c.units);assert.deepEqual(result.unreachablePlayers,[]);assert.equal(result.regions[0].keys.length,c.reachable??5,'Mobile objects do not override fixed blocker rules: '+c.terrain);
  const doc=R.defaults(),eligible=new Map(c.units.cells.map(cell=>[R.key(cell),cell]));
  // Assigned-region filling can cross categories, but uses the same obstacles.
  doc.regions[1].cells=new Set(eligible.keys());
  assert.equal(R.fillKeys(doc,c.units.cells[0],eligible,{cells:c.units.cells,navigation:units}).length,c.reachable??5,'Fill must preserve native/Toy fixed blocker and layer semantics: '+c.terrain);
 }
 assert.deepEqual(c,before,'Navigation must preserve all source cells');
}
console.log('PASS native/Toy unit-free routing: start, land choke, bridge deck, water and immutable probabilities');
})().catch(e=>{console.error(e);process.exitCode=1;});
