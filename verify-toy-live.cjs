const fs=require('fs'),path=require('path'),zlib=require('zlib'),assert=require('assert/strict'),{analyze}=require('./toy-live/analyze.js');
let cases=JSON.parse(fs.readFileSync('output/toy-original-qa/cases.json')),stocks={};
for(const version of ['ra2','yr'])stocks[version]=JSON.parse(zlib.gunzipSync(fs.readFileSync('output/toy-live/live/stock-'+version+'.json.gz')));
if(process.argv.includes('--fixtures'))cases=fs.readdirSync('output/toy-live-qa/fixtures').map(name=>({original:path.resolve('output/toy-live-qa/fixtures',name,'result.json'),report:name}));
const fixtures=process.argv.includes('--fixtures');
const ids=process.argv.includes('--all')||fixtures?null:['f1d9bb89e2eb07cdb7af','036e439c07cbb98efef9','1557d2f6b8e380c95042','74d05e725c561b9d186e'];
(async()=>{
const format=require('./toy-live/format.js');
assert.throws(()=>format.lcw(Uint8Array.of(0xff,255,255,0,0),10));
assert.throws(()=>format.lzo(Uint8Array.of(0),10));
assert.throws(()=>format.ini('[Map]\nSize=0,0,20,20\nSize=0,0,30,30'));
assert.throws(()=>format.pack({ISOMAPPACK5:{1:'AAAA'}},'IsoMapPack5'));
await assert.rejects(analyze(Uint8Array.of(0),stocks.yr));
let n=0;for(const item of cases){if(ids&&!ids.some(id=>item.report.includes(id)))continue;const expected=JSON.parse(fs.readFileSync(item.original)),folder=path.dirname(item.original),bytes=new Uint8Array(fs.readFileSync(path.join(folder,'source.map'))),version=expected.metadata.version,start=Date.now();
const result=await analyze(bytes,stocks[version],{version,minerals:expected.metadata.mineralsEnabled,filename:expected.metadata.filename});
const data=result.report;assert.equal(data.cells.length,expected.cells.length);const skip=new Set(['surface','visibleSurface','surfaceVisibility','cameraCoverage','visibleBand','labelOffset',...(fixtures?['knownOccupiedGround','knownOccupiedDeck','unknownObjects','terrainError','retryAssumptions','occupancyUnknown']:[])]);
for(let i=0;i<data.cells.length;i++){const a=data.cells[i],b=expected.cells[i];for(const field of Object.keys(b)){if(skip.has(field))continue;if(field==='bridge'){assert.deepEqual(a[field]&&Object.fromEntries(Object.entries(a[field]).filter(([k])=>k!=='emptySprite')),b[field]&&Object.fromEntries(Object.entries(b[field]).filter(([k])=>k!=='emptySprite')));continue;}assert.deepEqual(a[field],b[field],`${expected.metadata.filename} ${a.x},${a.y} ${field}`);}}
assert.deepEqual(Buffer.from(result.search),fs.readFileSync(path.join(folder,'search.bin')),expected.metadata.filename+' source order');
assert.deepEqual(data.probability,expected.probability,expected.metadata.filename+' probability');for(const key of ['markers','potentialMarkers','zeroProbabilityRockCandidates'])if(expected[key])assert.deepEqual(data[key],expected[key]);if(expected.regionNavigation)assert.deepEqual(data.regionNavigation,expected.regionNavigation,'layered region routes');
console.log('PASS',++n,version,expected.metadata.mineralsEnabled,expected.metadata.filename,Date.now()-start+' ms');
}console.log('PASS browser-analysis model cases:',n);})().catch(e=>{console.error(e);process.exitCode=1});
