'use strict';
const assert=require('node:assert/strict'),T=require('./transfer-origins.js');
const A=513,B=514,C=1026,G=1539;
const lists=[[A,A],[B,B],[A,B,A],[C,A],[A,C],[A],[],[C,A,C],[G,G]];
const cells=[
 {x:1,y:1,status:'crate',candidate:true,track:true,land:0},
 {x:2,y:1,status:'retry',candidate:true,track:true,land:0}, // ore: direct retry
 {x:3,y:1,status:'retry',candidate:false,track:true,land:0},
 {x:1,y:2,status:'crate',candidate:true,track:false,land:3},
 {x:2,y:2,status:'crate',candidate:true,track:true,land:0}, // passable secondary origin
 {x:1,y:3,status:'retry',candidate:false,track:false,land:3},
 {x:2,y:3,status:'retry',candidate:true,float:false,track:true,land:2},
 {x:3,y:3,status:'ghost',candidate:true,track:true,land:0},
];
for(const c of cells){c.usable=true;c.primary=!(c.x===2&&c.y===2);}
const statuses=new Map(cells.map(c=>[T.key(c),c.status])),N=9n,period=6,limit=3;
// Independent oracle: enumerate the ending origin, every frame and every
// retry round, retaining integer units of period * N^limit.
const expected=new Map(),oneSearchHits=new Map(),coefficients=[];
for(const n of [1,2,3])for(let r=0;r<n;r++)coefficients.push({n,r,numerator:0n});
for(let f=0;f<period;f++){
 const selected=lists.map(row=>row.length?row[f%row.length]:null);
 selected.forEach((k,i)=>{if(statuses.get(k)==='crate')oneSearchHits.set(i+':'+k,(oneSearchHits.get(i+':'+k)||0)+1);});
 const failures=BigInt(selected.filter(k=>!['crate','ghost'].includes(statuses.get(k))).length);
 for(let round=0;round<limit;round++){
  const units=failures**BigInt(round)*N**BigInt(limit-round-1);
  for(const co of coefficients)if(f%co.n===co.r)co.numerator+=units;
  selected.forEach((k,i)=>{if(statuses.get(k)==='crate')expected.set(i+':'+k,(expected.get(i+':'+k)||0n)+units);});
 }
}
for(const c of cells){c.terms=[];const counts=new Map();lists.forEach(row=>row.forEach((k,r)=>{if(k===T.key(c)&&c.status==='crate'){const id=coefficients.findIndex(co=>co.n===row.length&&co.r===r);counts.set(id,(counts.get(id)||0)+1);}}));c.terms=[...counts];}
const buffer=new ArrayBuffer(4*lists.reduce((s,r)=>s+1+r.length,0)),v=new DataView(buffer);let p=0;
for(const row of lists){v.setUint32(p,row.length,true);p+=4;for(const k of row){v.setUint32(p,k,true);p+=4;}}
const data={cells,probability:{sampleCount:9,exact:{denominator:String(BigInt(period)*N**BigInt(limit)),coefficients:coefficients.map(c=>({...c,numerator:String(c.numerator)}))}}};
const index=T.create(data,buffer),selected=cells[0],incoming=index.get(selected);
assert.deepEqual(incoming.sources.map(s=>[s.x,s.y]),[[3,1],[1,2],[2,2],[3,2],[2,3]]);
assert.equal(incoming.sources.find(s=>s.x===2&&s.y===2).reason,'投影优先规则');
for(const s of incoming.sources){const i=(s.y-1)*3+s.x-1;assert.equal(s.numerator,expected.get(i+':'+A));assert.equal(s.transferProbability,oneSearchHits.get(i+':'+A)/period);}
assert.equal(incoming.sources.find(s=>s.x===3&&s.y===1).transferProbability,2/3,'duplicate hits count, failed candidates remain in the denominator');
assert.equal(incoming.sources.find(s=>s.x===3&&s.y===2).transferProbability,1,'a deterministic search reports 100%, independent of sampling and retries');
assert.equal(incoming.sources.find(s=>s.x===3&&s.y===2).cell,null,'out-of-map sources survive');
assert.equal(index.get(cells[1]),null,'direct Overlay retry has no incoming crate');
assert.equal(index.get(cells.at(-1)),null,'ghost placement has no entity destination');
assert.equal(index.get(cells[5]),null,'no-search destinations have no overlay');
for(const c of cells)if(c.status==='crate'){
 const total=(index.get(c)?.sources||[]).reduce((sum,s)=>sum+s.numerator,index.directNumerator(c));
 const oracle=[...expected].filter(([k])=>k.endsWith(':'+T.key(c))).reduce((sum,[,n])=>sum+n,0n);
 assert.equal(total,oracle,'all final probability is explained by direct plus incoming origins');
}
assert.equal(Math.max(...incoming.sources.map(s=>s.strength)),1);
assert.ok(new Set(incoming.sources.map(s=>T.style(s.strength).fill)).size>1);
assert.throws(()=>T.create(data,buffer.slice(0,-1)),/不完整|损坏/);
const extended=new Uint8Array(buffer.byteLength+4);extended.set(new Uint8Array(buffer));assert.throws(()=>T.create(data,extended.buffer),/长度/);
console.log('PASS: conditional origin-to-destination frame oracle, duplicate hits and failed candidates; final contribution conservation remains exact.');

// Optional pixel regression with the same Canvas implementation as video export.
if(process.argv.includes('--render')){
 const {createCanvas}=require('@napi-rs/canvas'),R=require('./map-renderer.js');
 const canvas=createCanvas(400,300),ctx=canvas.getContext('2d'),art=createCanvas(400,300);
 art.getContext('2d').fillStyle='#405040';art.getContext('2d').fillRect(0,0,400,300);
 const c={x:1,y:1,px:180,py:140,level:0,terms:[],usable:false,visibleBand:true,occupied:true,objects:['HTNK'],marked:true,higher:[]};
 const target={...c,x:2,px:210,py:155,usable:true,occupied:false,objects:[],marked:false};
 const state={data:{rendering:{origin:[180,110],width:400,height:300,cameraRect:[0,0,400,300],missingSprites:[]}},image:art,cells:[c,target],lookup:new Map([['1,1',c],['2,1',target]]),x:0,y:0,scale:1,selected:target};
 const options={filter:'all',heatmap:false,blocked:true,grid:true,markers:true,coords:true,values:false},area={x:0,y:0,w:400,h:300};
 const display={get:()=>({multiplier:0}),meetsThreshold:()=>true};
 const render=()=>{ctx.clearRect(0,0,400,300);R.render(ctx,state,area,display,options);return Buffer.from(ctx.getImageData(0,0,400,300).data);};
 const before=render();state.incoming={key:T.key(target),sources:[{x:1,y:1,level:0,cell:c,strength:1,transferProbability:.5}]};const active=render();
 assert.notDeepEqual(active,before,'source layer replaces previous colors');
 const toggles={...options};state.incoming=null;assert.deepEqual(render(),before,'clearing restores pixels exactly');assert.deepEqual(options,toggles,'toggles untouched');
 state.incoming={key:999,sources:[{x:1,y:1,level:0,cell:c,strength:1}]};assert.deepEqual(render(),before,'stale source selection ignored');
 const full=[[[0,-15],[30,0],[0,15],[-30,0]]],partial={surface:full,visibleSurface:[[[0,0],[30,0],[0,15],[-30,0]]],surfaceVisibility:.5};
 const edge=R.outlineParts(partial);assert.ok(edge.visible.length&&edge.hidden.length);
 assert.ok(edge.hidden.flat().every(p=>p[1]<2),'occluded perimeter is above the visible half');
 const concealed=R.outlineParts({surface:full,visibleSurface:[],surfaceVisibility:0});assert.equal(concealed.visible.length,0);assert.equal(concealed.hidden.length,1);
 // A source behind a cliff must not fill the cliff's visible pixels.
 Object.assign(c,partial,{labelOffset:[0,8]});state.incoming=null;const occludedBefore=render();
 state.incoming={key:T.key(target),sources:[{x:1,y:1,level:0,cell:c,strength:1,transferProbability:.5}]};const clipped=render();
 const pixel=(pixels,x,y)=>pixels.subarray((y*400+x)*4,(y*400+x)*4+4);
 assert.deepEqual(pixel(clipped,180,134),pixel(occludedBefore,180,134),'source fill respects occlusion');
 assert.notDeepEqual(pixel(clipped,180,147),pixel(occludedBefore,180,147),'visible source surface remains colored');
 console.log('PASS: source overlay, exact pixel restoration, unchanged display settings and stale-selection guard.');
 console.log('PASS: terrain-clipped source fill and visible/hidden selection perimeter.');
 for(const scale of [.4,1,2.5,6]){
  const arms=R.selectionArms({surface:full,labelOffset:[18,7]},scale);
  assert.deepEqual(arms.map(([start])=>start),[[-30*scale,0],[30*scale,0],[0,-15*scale],[0,15*scale]],'arms start at full cell edges, unaffected by label offsets');
  const length=Math.max(12,60*scale/6);
  assert.deepEqual(arms.map(([a,b])=>[b[0]-a[0],b[1]-a[1]]),[[length,0],[-length,0],[0,length/2],[0,-length/2]],'arms extend inward with vertical length and minimum scaled to the 2:1 diamond');
 }
 console.log('PASS: edge-anchored hollow cross scales vertical length and minimum to the diamond aspect ratio at four zoom scales.');
}

const mapArg=process.argv.indexOf('--map');
if(mapArg>=0){
 const fs=require('node:fs'),path=require('node:path'),D=require('./probability-display.js'),folder=process.argv[mapArg+1];
 const data=JSON.parse(fs.readFileSync(path.join(folder,'result.json'))),raw=fs.readFileSync(path.join(folder,'search.bin'));
 const reverse=T.create(data,raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)),display=D.map(data);
 const boosted=data.cells.filter(c=>c.status==='crate'&&display.get(c).multiplier>1+1e-10);
 assert.equal(boosted.filter(c=>!reverse.get(c)).length,0,'all above-baseline destinations have actual search sources');
 console.log(`PASS: native map audit: ${boosted.length} above-baseline cells all have sources; every entity contribution conserved.`);
}
