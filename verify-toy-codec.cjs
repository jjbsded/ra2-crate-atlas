'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const codec=require('./toy/static-codec.js');
(async()=>{
 if(process.argv[2]==='--cases'){
  const cases=JSON.parse(fs.readFileSync(process.argv[3]));
  for(let i=0;i<cases.length;i++){
   const item=cases[i],folder=path.dirname(item.report),read=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(folder,name))));
   const compact=read(path.basename(item.report)),report=await codec.report(compact,async name=>read(name));
   const original=JSON.parse(fs.readFileSync(item.original));
   for(const field of ['cells','probability','markers','potentialMarkers','clearance'])assert.deepEqual(report[field],original[field],item.report+' '+field);
   const binary=zlib.gunzipSync(fs.readFileSync(path.resolve(folder,report.precomputed.search)));
   assert.deepEqual(Buffer.from(codec.search(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength))),fs.readFileSync(path.join(path.dirname(item.original),'search.bin')));
   if((i+1)%25===0)console.log('Compared',i+1,'/',cases.length);
  }
  console.log('PASS: all',cases.length,'JavaScript reports match the original desktop model exactly');return;
 }
 const folder=process.argv[2];
 const read=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(folder,name))));
 const value=await codec.report(read('result.json.gz'),async name=>read(name));
 assert.deepEqual(value,JSON.parse(fs.readFileSync(path.join(folder,'original.json'))));
 const compact=zlib.gunzipSync(fs.readFileSync(path.join(folder,'search.bin.gz')));
 assert.deepEqual(Buffer.from(codec.search(compact.buffer.slice(compact.byteOffset,compact.byteOffset+compact.byteLength))),fs.readFileSync(path.join(folder,'original.bin')));
 assert.equal(codec.ratio(1n,2n),.5);assert.equal(codec.ratio(1n,3n),1/3);
 assert.equal(codec.ratio(1n,2n**1074n),Number.MIN_VALUE);
 assert.equal(codec.ratio(1n,2n**1075n),0);
 assert.equal(codec.ratio(2n**53n+1n,2n**53n),1,'Halfway ratios round to even');
 assert.equal(codec.ratio(2n**53n+3n,2n**53n),1+2**-51,'Odd halfway mantissas round up to even');
 console.log('PASS: Python/JavaScript cells, exact fractions and binary search round-trip',value.cells.length);
})().catch(error=>{console.error(error);process.exitCode=1;});
