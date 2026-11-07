/* Actual component resolver + decoded atlas pixels, checked against native PIL. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {compose}=require('./toy-live/components.js');require('./toy-live/objects.js');
const parser=require('./toy-live/parser.js');
const out=path.resolve(process.argv[2]||'output/toy-components-20261104'),site=path.resolve(process.argv[3]||path.join(out,'site'));
const read=file=>JSON.parse(zlib.gunzipSync(fs.readFileSync(file))),lib=read(path.join(site,'live/objects/index.json.gz')),data=JSON.parse(fs.readFileSync(path.join(out,'cases.json')));
(async()=>{
 const pages=new Map(),fingerprints=new Map();let parts=0;
 for(const c of data.cases){
  const before=JSON.stringify(c.meta),refs=compose(lib,c.scope,c.meta);assert.ok(refs,JSON.stringify(c.meta));assert.equal(JSON.stringify(c.meta),before);
  assert.equal(refs.length,c.expected.length,c.meta.type+' '+c.scope+' parts');const fields=JSON.parse(c.meta.key);
  for(let i=0;i<refs.length;i++){
   const [id,x,y,palette,opacity,shadow=0]=refs[i],a=lib.assets[id],expected=c.expected[i];
   assert.deepEqual([x,y,a[3],a[4],!!shadow],[expected.x,expected.y,expected.width,expected.height,expected.shadow],c.meta.type+' '+expected.file+' anchor');
   const token=JSON.stringify([id,palette,opacity,fields[2],fields[7]??31]);let hash=fingerprints.get(token);
   if(!hash){
    if(!pages.has(a[0])){const im=await loadImage(path.join(site,'live/objects',lib.atlases[a[0]].file)),canvas=createCanvas(im.width,im.height),ctx=canvas.getContext('2d');ctx.drawImage(im,0,0);pages.set(a[0],ctx);}
    const rgba=pages.get(a[0]).getImageData(a[1],a[2],a[3],a[4]).data,colors=CrateLiveObjects.colors(lib.palettes[palette],fields[2],fields[7]??31);
    for(let j=0;j<rgba.length;j+=4){const k=rgba[j];rgba[j]=k?colors[k][0]:0;rgba[j+1]=k?colors[k][1]:0;rgba[j+2]=k?colors[k][2]:0;rgba[j+3]=k?opacity:0;}
    hash=crypto.createHash('sha256').update(rgba).digest('hex');fingerprints.set(token,hash);
   }
   assert.equal(hash,expected.sha256,c.meta.type+' '+c.scope+' '+expected.file+' '+c.meta.key);parts++;
  }
 }
 for(const c of data.rejected)assert.equal(compose(lib,c.scope,c.meta),undefined,'Unsupported state reused a wrong frame');
 let stockStates=0;
 for(const version of ['ra2','yr']){
  const stock=read(path.join(site,'live/stock-'+version+'.json.gz')),types=new Map();
  for(const [category,table] of [['STRUCTURES','BUILDINGTYPES'],['UNITS','VEHICLETYPES'],['INFANTRY','INFANTRYTYPES'],['AIRCRAFT','AIRCRAFTTYPES']])for(const name of Object.values(stock.rules[table])){
   const kind=name.toUpperCase(),cfg=stock.rules[kind]||{},visual=lib.visualFields.map(f=>String(cfg[f]??(f==='IMAGE'?kind:'')).toUpperCase()),token=JSON.stringify([category,visual]);if(!types.has(token))types.set(token,kind);
  }
  for(const [scope,entries] of Object.entries(lib.scopes)){if(!scope.startsWith(version+'/'))continue;
   for(const [key,id] of Object.entries(entries)){const fields=JSON.parse(key),type=types.get(JSON.stringify(fields.slice(0,2)));assert.ok(type);
    const actual=compose(lib,scope,{key,type,category:fields[0]});assert.ok(actual,type+' stock composition '+scope);
    assert.deepEqual(actual.filter(r=>!r[5]),lib.refs[id].filter(r=>!r[5]),type+' stock visible recipe '+key);stockStates++;
   }
  }
 }
 // Exercise the real async loader/cache too, including identical visual keys
 // whose type-derived default barrels differ.
 global.document={baseURI:'https://qa.invalid/'};
 global.CrateWebConfig={liveVersion:'components-test'};
 global.CrateMapPlatform={readJSON:async()=>lib};
 global.CrateToyOriginal={canvas:createCanvas,page:async url=>loadImage(path.join(site,new URL(url).pathname))};
 const samples=data.cases.filter(c=>c.scope==='yr/TEMPERATE'&&JSON.parse(c.meta.key)[4]===64&&JSON.parse(c.meta.key)[3]===2);
 const prepared=await CrateLiveObjects.prepare({metadata:{version:'yr',theater:'TEMPERATE'},rendering:{visualObjects:samples.map(c=>c.meta)}},()=>true,{baseLibrary:{refs:[]}});
 for(const c of samples){const drawn=prepared.get(c.meta);assert.equal(drawn.length,c.expected.length,c.meta.type+' prepared parts');for(let i=0;i<drawn.length;i++){
  const p=drawn[i],e=c.expected[i],rgba=p.image.getContext('2d').getImageData(0,0,p.image.width,p.image.height).data;
  assert.deepEqual([p.x,p.y,p.shadow],[e.x,e.y,e.shadow]);assert.equal(crypto.createHash('sha256').update(rgba).digest('hex'),e.sha256,c.meta.type+' prepared pixels');
 }}
 const stock=read(path.join(site,'live/stock-yr.json.gz')),parsed=parser.parse(new Uint8Array(fs.readFileSync(path.join(out,'combinations.yrm'))),stock,'yr');
 assert.equal(parsed.metadata.approximate,false);assert.equal(parsed.visualObjects.length,Object.keys(data.mapKeys).length);
 for(const meta of parsed.visualObjects){assert.equal(meta.key,data.mapKeys[meta.type],meta.type+' Python/JS map signature');assert.ok(compose(lib,'yr/TEMPERATE',meta));}
 const result={status:'PASS',states:data.cases.length,parts,stockStates,unsupported:data.rejected.length,asyncPrepared:samples.length,mapObjects:parsed.visualObjects.length,atlasPages:pages.size};
 fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify(result,null,2));console.log(result);
})().catch(e=>{console.error(e);process.exitCode=1;});
