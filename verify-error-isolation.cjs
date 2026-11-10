/* Native / Toy parity after isolating broken objects and prediction rules. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{analyze}=require('./toy-live/analyze.js');
const root=path.resolve('output/error-isolation-qa'),latest=JSON.parse(fs.readFileSync('output/latest-release.json')),stock=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join('output',latest.toy,'live/stock-yr.json.gz'))));
(async()=>{for(const name of JSON.parse(fs.readFileSync(path.join(root,'cases.json')))){
 const folder=path.join(root,name),native=JSON.parse(fs.readFileSync(path.join(folder,'result.json'))),bytes=new Uint8Array(fs.readFileSync(path.join(folder,'source.map'))),{report,search}=await analyze(bytes,stock,{filename:name+'.yrm'});
 assert.equal(report.metadata.approximate,!!native.metadata.approximate,name+' confidence');
 assert.equal(report.metadata.riskUnknownCellCount||0,native.metadata.riskUnknownCellCount||0,name+' unknown predictions');
 for(let i=0;i<native.cells.length;i++){
  const a=report.cells[i],b=native.cells[i];for(const key of ['x','y','land','postLand','rockTransition','marked','potentialMarked','candidate','status','occupied','track','foot','float','primary','terms'])assert.deepEqual(a[key],b[key],`${name} ${b.x},${b.y} ${key}`);
  if(b.riskKnown!==undefined)assert.equal(a.riskKnown,b.riskKnown,name+' riskKnown');
 }
 assert.deepEqual(report.probability.exact,native.probability.exact,name+' exact probability');
 for(const key of ['markers','potentialMarkers','zeroProbabilityRockCandidates'])assert.deepEqual(report[key],native[key],name+' '+key);
 assert.equal(report.clearance.model,native.clearance.model);assert.equal(report.clearance.unknownCellCount,native.clearance.unknownCellCount);
 assert.deepEqual(Buffer.from(search),fs.readFileSync(path.join(folder,'search.bin')),name+' ordered origins');
 console.log('PASS native / Toy',name,'risks',report.markers.length,'unknown',report.metadata.riskUnknownCellCount||0);
}})().catch(error=>{console.error(error);process.exitCode=1;});
