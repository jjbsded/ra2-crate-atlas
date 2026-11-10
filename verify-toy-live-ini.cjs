/* Duplicate keys recover before object parsing, with explicit provenance. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const F=require('./toy-live/format.js'),{analyze}=require('./toy-live/analyze.js');
const base=fs.readFileSync('output/toy-live-qa/fixtures/flat-ore/source.map','utf8'),stock=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.env.TOY_ROOT||'output/toy','live/stock-yr.json.gz'))));
const run=async source=>(await analyze(typeof source==='string'?new TextEncoder().encode(source):source,stock)).report;
(async()=>{
 const text='; comment\n[Rules]\nValue = one\nVALUE=one ; same\n[rules]\nvalue=two\nVALUE=three',conflicts=[];
 assert.throws(()=>F.ini(text),e=>e.context?.section==='RULES'&&e.context.key==='VALUE'&&e.context.previousLine===4&&e.context.line===6&&e.context.previousValue==='one'&&e.context.selectedValue==='two');
 const parsed=F.ini(text,c=>conflicts.push(c));assert.equal(parsed.RULES.VALUE,'three');assert.deepEqual(conflicts.map(c=>[c.previousLine,c.line,c.previousValue,c.selectedValue]),[[4,6,'one','two'],[6,7,'two','three']]);
 const reference=await run(base),unread=await run(base+'\n[E1]\nSight=4\nSight=6\nRequiredHouses=Americans\n[ e1 ]\nrequiredhouses=none\n');
 assert.equal(unread.metadata.approximate,false);assert.equal(unread.metadata.irrelevantDuplicateKeys.length,2);assert.equal(unread.metadata.loadIssues.length,2);assert.deepEqual(unread.probability,reference.probability);assert.deepEqual(unread.cells,reference.cells);assert.deepEqual(unread.markers,reference.markers);
 const source=base+'\n[General]\nCliffBackImpassability=0\nCliffBackImpassability=2\n',relevant=await run(source);
 assert.equal(relevant.metadata.approximate,true);assert.equal(relevant.metadata.cliffBackImpassability,2);assert.equal(relevant.metadata.approximation.retryCellCount,0);assert.equal(relevant.metadata.iniKeyConflicts[0].affectsModel,true);assert.match(relevant.metadata.loadIssues[0].message,/previousValue=0.*selectedValue=2/);assert.ok(relevant.cells.some(c=>c.probability>0));
 const records=await run(base+'\n[Units]\nSight=Neutral,HTNK,256,20,20,0,Guard\n[Units]\nsight=Neutral,HTNK,256,21,20,0,Guard\n');
 assert.equal(records.metadata.approximate,true);assert.equal(records.metadata.irrelevantDuplicateKeys.length,0);assert.equal(records.cells.find(c=>c.x===20&&c.y===20).occupied,false);assert.equal(records.cells.find(c=>c.x===21&&c.y===20).occupied,true);
 const restored=await run(base+'\n[Map]\nSize=0,0,999,999\nSize=0,0,20,20\n');assert.equal(restored.cells.length,reference.cells.length);assert.equal(restored.metadata.approximate,true);
 await assert.rejects(run(base+'\n[Map]\nSize=0,0,999,999\n'),e=>e.context?.section==='Map');
 await assert.rejects(run(base+'\n[IsoMapPack5]\n1=!!!!\n'),e=>e.context?.section==='IsoMapPack5');
 const identical=await run(base+'\n[E1]\nSight=4\nSight=4\n');assert.equal(identical.metadata.iniKeyConflicts.length,0);assert.equal(identical.metadata.approximate,false);
 fs.mkdirSync('output/toy-live-ini-qa',{recursive:true});fs.writeFileSync('output/toy-live-ini-qa/conflict-rules.map',source);
 if(process.argv[2]){const r=await run(fs.readFileSync(process.argv[2])),conflict=r.metadata.iniKeyConflicts.find(c=>c.section==='YDOG'&&c.key==='REQUIREDHOUSES');assert.ok(conflict);assert.equal(conflict.selectedValue,'none');assert.equal(conflict.affectsModel,false);assert.ok(r.cells.some(c=>c.probability>0));console.log('PASS user sov01umd.map:',r.cells.length,'cells; conflict lines',conflict.previousLine,conflict.line);}
 console.log('PASS INI recovery: repeated sections, case/whitespace, equal values, full conflict chain, unread fields, relevant rules/records and fatal invalid core');
})().catch(e=>{console.error(e);process.exitCode=1;});
