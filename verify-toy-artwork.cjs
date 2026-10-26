/* Procedural artwork: geometry, ore/objects, crop alignment and bounded work. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {createCanvas}=require('@napi-rs/canvas'),T=require('./toy/terrain-artwork.js'),A=require('./map-artwork.js'),C=require('./toy/static-codec.js');
assert.deepEqual(T.top({x:1,y:1,level:4,slope:0},[0,0]),[[0,-45],[30,-30],[0,-15],[-30,-30]]);
assert.equal(T.material({rawLand:2}),'water');assert.equal(T.material({rawLand:6}),'shore');
async function load(file){const r=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));return C.report(r,name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(path.dirname(file),name)))));}
function pixels(canvas){return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;}
function difference(a,b){const aa=pixels(a),bb=pixels(b);let d=0;for(let i=0;i<aa.length;i++)d+=Math.abs(aa[i]-bb[i]);return d/aa.length;}
(async()=>{
 const folder=process.argv[2]||'output/toy-official-tiles',out='output/tile-art-qa';fs.mkdirSync(out,{recursive:true});
 const ids=['f1d9bb89e2eb07cdb7af-yr','036e439c07cbb98efef9-yr'];
 const results=[];
 for(const id of ids){
  const report=await load(path.join(folder,'data',id,'ore/result.json.gz')),before=JSON.stringify(report),start=performance.now(),art=T.create(report),prepared=performance.now()-start;
  assert.equal(JSON.stringify(report),before,'Rendering must not change analysis or surface polygons');
  const c=report.cells.find(c=>c.bridge?.kind==='high'&&c.x>70)||report.cells.find(c=>c.x===99&&c.y===105);
  const x=Math.round(30*(c.x-c.y)+report.rendering.origin[0]-600),y=Math.round(15*(c.x+c.y-c.level)+report.rendering.origin[1]-350);
  const full=createCanvas(1200,700),crop=createCanvas(500,300),hidden=createCanvas(1200,700);
  const begin=performance.now();A.draw(full.getContext('2d'),art.objectImage,-x,-y,report.rendering.width,report.rendering.height);const painted=performance.now()-begin;
  A.draw(crop.getContext('2d'),art.objectImage,x+200,y+150,500,300,0,0,500,300);
  const expected=createCanvas(500,300);expected.getContext('2d').drawImage(full,200,150,500,300,0,0,500,300);
  assert.ok(difference(crop,expected)<.15,'Cropped thumbnails/exports must use the same map-space coordinates');
  A.draw(hidden.getContext('2d'),art.im,-x,-y,report.rendering.width,report.rendering.height);
  if(art.stats.objects)assert.ok(difference(full,hidden)>.01,'Object toggle changes only symbols');
  fs.writeFileSync(path.join(out,id+'-detail.png'),full.toBuffer('image/png'));
  results.push({id,...art.stats,prepareMs:Math.round(prepared),closeDrawMs:Math.round(painted),cropDelta:difference(crop,expected)});
 }
 const cells=[];for(let x=0;x<5;x++)for(let y=0;y<5;y++)cells.push({x,y,level:0,slope:0,rawLand:0,overlayName:x===2&&y===2?'TIB01':null});
 const report={metadata:{theater:'SNOW'},rendering:{width:300,height:180,origin:[150,20],simplified:{objects:[]}},cells};
 const clearReport=structuredClone(report);clearReport.cells[12].overlayName=null;
 const ore=T.create(report).im,clear=T.create(clearReport).im;
 const a=createCanvas(300,180),b=createCanvas(300,180);A.draw(a.getContext('2d'),ore,0,0);A.draw(b.getContext('2d'),clear,0,0);
 assert.ok(difference(a,b)>.05,'TIB ore is drawn and clear layout removes it');
 const terrainImage=kind=>{const r=structuredClone(clearReport);r.cells[12].terrain=kind;const canvas=createCanvas(300,180);A.draw(canvas.getContext('2d'),T.create(r).im,0,0);return canvas;};
 assert.ok(difference(terrainImage('TREE01'),b)>.05,'Trees change the map and minimap/export artwork');
 assert.ok(difference(terrainImage('TREE01'),terrainImage('TIBTRE01'))>.05,'Retained ore drills must not look like trees');
 assert.ok(difference(terrainImage('TREE01'),terrainImage('TRFF01'))>.05,'Non-tree scenery uses a distinct symbol');
 fs.writeFileSync(path.join(out,'artwork-verification.json'),JSON.stringify(results,null,2));console.log('PASS per-cell geometry, immutable analysis, object toggle, ore and source/crop coordinates',results);
})().catch(error=>{console.error(error);process.exitCode=1;});
