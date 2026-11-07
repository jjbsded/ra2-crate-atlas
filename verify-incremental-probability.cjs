/* Compare browser incremental records and exact integers against native C/Python. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Store}=require('./toy-live/incremental.js'),S=require('./toy-live/solver.js');
const qa=path.join(__dirname,'output/incremental-probability-qa'),cases=JSON.parse(fs.readFileSync(path.join(qa,'cases.json'))),measurements=[];
for(const test of cases){const grid=Uint8Array.from(Buffer.from(test.grid,'base64')),statuses=Uint8Array.from(Buffer.from(test.statuses,'base64')),value=new Store(test.maximum,grid,statuses,S.search(grid,test.maximum));
 for(const[index,edit]of test.edits.entries()){
  for(const[k,g,s]of edit.changes){grid[k]=g;statuses[k]=s;}
  const start=performance.now(),{stats}=value.update(grid,statuses),result=value.calculate(),seconds=(performance.now()-start)/1000;
  const expected=JSON.parse(fs.readFileSync(path.join(qa,edit.expected))),cells=expected.cells;delete expected.cells;
  assert.deepEqual(result.probability,expected,test.name+' probability '+index);
  assert.deepEqual(Object.fromEntries(result.results),cells,test.name+' cells '+index);
  assert.deepEqual(Buffer.from(value.export().buffer),Buffer.from(edit.search,'base64'),test.name+' ordered search '+index);
  assert.equal(stats.searchedOrigins,edit.stats.searchedOrigins);
  assert.equal(stats.touchedDestinations,edit.stats.touchedDestinations);
  if(test.name==='open'&&index===1){assert(value.kernel.coefficientsReused);assert.equal(value.kernel.evaluatedDestinations,9);}
  if(index<2)measurements.push({case:test.name,edit:index,seconds,coefficientsReused:value.kernel.coefficientsReused,evaluatedDestinations:value.kernel.evaluatedDestinations,...stats});
 }
 console.log('PASS Toy',test.name,test.edits.length);
}
fs.writeFileSync(path.join(qa,'toy.json'),JSON.stringify({status:'PASS',cases:cases.reduce((n,c)=>n+c.edits.length,0),measurements},null,2));
console.log(measurements);

if(process.argv[2])(async()=>{
 const A=require('./toy-live/analyze.js'),folder=path.resolve(process.argv[2]),source=JSON.parse(fs.readFileSync(path.join(folder,'source.json'))),stock=JSON.parse(fs.readFileSync(path.join(folder,'stock.json'))),layouts=JSON.parse(fs.readFileSync(path.join(folder,'cases.json')));
 for(const test of layouts){const options={source,plan:test.plan},a=await A.analyze(new Uint8Array(),stock,{...options,incremental:true}),b=await A.analyze(new Uint8Array(),stock,options);
  for(const key of ['probability','cells','markers','potentialMarkers','clearance'])assert.deepEqual(a.report[key],b.report[key],test.name+' '+key);
  assert.deepEqual(Buffer.from(a.search),Buffer.from(b.search),test.name+' search');
 }
 console.log('PASS Toy incremental map layouts:',layouts.length);
})().catch(error=>{console.error(error);process.exitCode=1;});
