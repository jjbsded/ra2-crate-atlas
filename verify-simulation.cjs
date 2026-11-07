const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const M=require('./simulation-model.js'),P=require('./toy-live/parser.js');
const qa=path.resolve(process.argv[2]||'output/simulation-20261104'),source=JSON.parse(fs.readFileSync(path.join(qa,'source.json'))),stock=JSON.parse(fs.readFileSync(path.join(qa,'stock.json'))),m=M.create(source);
const FIELDS=['land','overlay','overlayName','overlayData','terrain','occupiedGround','occupiedDeck','occupied','candidate','status','primary','track','foot','float','bridge','bridgeProjection'];
const S=require('./toy-live/solver.js'),A=require('./toy-live/analyze.js');
const cases=[];function save(name){const plan=m.plan,p=P.parse(new Uint8Array(),stock,'yr',true,'simulation.map',()=>{},{source,plan});const max=p.metadata.size[2]+p.metadata.size[3]-1,binary=S.search(A.grid(p.cells),max),calculated=S.calculate(binary,p.cells,max**2);fs.writeFileSync(path.join(qa,name+'-search.bin'),Buffer.from(binary.buffer));cases.push({name,plan,cells:p.cells.map(c=>FIELDS.map(k=>c[k]??null)),probability:calculated.probability,terms:p.cells.map(c=>calculated.results.get(P.key(c.x,c.y))?.terms||[])});return p;}
assert.equal(m.choices.filter(o=>o.category==='UNITS').length,1);assert.equal(m.choices.filter(o=>o.category==='INFANTRY').length,1);
const dirtyModel=M.create(source),emptyPlan=dirtyModel.plan;
assert(dirtyModel.place('MTNK',30,30));assert.deepEqual([...dirtyModel.changesSince(emptyPlan)],['30,30']);
const tankPlan=dirtyModel.plan;assert.equal(dirtyModel.changesSince(tankPlan).size,0);
dirtyModel.undo();assert.deepEqual([...dirtyModel.changesSince(tankPlan)],['30,30']);dirtyModel.redo();assert.equal(dirtyModel.changesSince(tankPlan).size,0);
dirtyModel.reset();dirtyModel.paint(['26,26'],'normal');assert(dirtyModel.changesSince(emptyPlan).has('27,27'),'Changed building covers its complete foundation');
const rubblePlan=dirtyModel.plan;dirtyModel.paint(['26,26'],'restore');assert(dirtyModel.changesSince(rubblePlan).has('27,27'),'Restoring a removed building also marks its old footprint');
assert.equal(new Set(m.choices.filter(o=>o.category==='STRUCTURES').map(o=>JSON.stringify([o.footprint,!!o.water]))).size,m.choices.filter(o=>o.category==='STRUCTURES').length);
save('default');
assert.equal(m.choices.find(o=>o.type==='NACNST').label,'4x4[Land] · 苏军基地');assert.equal(m.choices.find(o=>o.type==='GAYARD').label.startsWith('4x4[Water]'),true);
const yardCell=source.cells.find(c=>m.placement('NACNST',c.x,c.y).allowed);assert(yardCell);assert(m.place('NACNST',yardCell.x,yardCell.y));assert.equal(m.count,16);save('soviet-yard');assert(M.create(source).import(m.plan));m.undo();assert.equal(m.count,0);

assert(m.place('MTNK',30,30));assert(!m.place('MTNK',30,30));assert(m.place('E2',30,31));assert(m.place('E2',30,31));assert(m.place('E2',30,31));assert(!m.place('E2',30,31));
assert(!m.placement('GAPOWR',30,30).allowed);assert(m.place('GAPOWR',38,32));const placed=save('placed');assert(placed.visualObjects.some(o=>o.key.includes('stripe-3-yellow-black-fixed')));
const before=JSON.stringify(m.plan);assert(m.undo());assert(m.redo());assert.equal(JSON.stringify(m.plan),before);
const second=M.create(source);second.import(m.plan);assert.deepEqual(second.plan,m.plan);assert.throws(()=>second.import({...m.plan,map:{sha256:'0'.repeat(64),version:'yr'}}));
m.reset();m.paint(['26,26'],'normal');let parsed=save('rubble');assert.equal(parsed.lookup.get(26+26*512).overlayName,'RUBBLE_OVERLAY');assert(!parsed.lookup.get(26+26*512).occupied);assert.equal(parsed.lookup.get(27+27*512).status,'retry');assert(m.placement('MTNK',26,26).allowed);assert(!m.placement('GAPOWR',26,26).allowed);
m.paint(['26,26'],'restore');assert.equal(m.count,0);save('restored');m.paint(['26,26'],'chrono');parsed=save('chrono');assert.equal(parsed.lookup.get(26+26*512).overlay,255);assert(!parsed.lookup.get(26+26*512).occupied);
m.reset();m.quick('mine');parsed=save('mining');assert.equal(parsed.cells.filter(c=>stock.rules[c.overlayName]?.TIBERIUM==='yes').length,6);assert.equal(parsed.lookup.get(40+30*512).overlay,255);assert.equal(parsed.lookup.get(21+20*512).overlay,255);assert.equal(parsed.lookup.get(19+20*512).overlayName,'CAFNCB');
m.reset();m.quick('trees');parsed=save('trees');assert.equal(parsed.lookup.get(22+28*512).terrain,null);assert.equal(parsed.lookup.get(24+28*512).terrain,'TRFF01');assert.equal(parsed.lookup.get(20+20*512).terrain,'TIBTRE01');
m.reset();m.quick('buildings');parsed=save('buildings');assert(parsed.lookup.get(35+25*512).occupied);assert(!parsed.lookup.get(21+20*512).occupied);
m.reset();m.quick('units');parsed=save('units');for(const[x,y]of [[32,32],[33,33],[34,34]])assert(!parsed.lookup.get(x+y*512).occupied);
m.reset();m.paint(['31,39'],'normal');parsed=save('bridge');assert(!parsed.lookup.get(31+39*512).bridge);assert.equal(parsed.lookup.get(30+40*512).overlayData,8);assert.equal(parsed.lookup.get(32+40*512).overlayData,7);assert.equal(parsed.lookup.get(30+40*512).bridge.kind,'high');assert.equal(parsed.visualObjects.filter(o=>o.type==='MTNK').length,1);assert.equal(m.plan.objects['UNITS/1'],'remove');
m.paint(['31,39'],'restore');assert.equal(m.count,0);save('bridge-restored');
for(const [x,base]of [[22,74],[38,205]]){m.reset();m.paint([`${x},43`],'normal');parsed=save('low-bridge-'+base);for(const y of [43,44,45])assert.equal(parsed.lookup.get(x+y*512).overlay,base+26);assert.equal(parsed.lookup.get(x-1+44*512).overlay,base+8);assert.equal(parsed.lookup.get(x+1+44*512).overlay,base+7);assert.equal(parsed.lookup.get(x-2+44*512).overlay,base);m.paint([`${x},45`],'restore');assert.equal(m.count,0);save('low-bridge-restored-'+base);}
const immune=structuredClone(source);immune.rules.MTNK.IMMUNE='yes';const im=M.create(immune);im.paint(['32,32'],'chrono');assert(!im.count);im.quick('units');assert.equal(im.plan.objects['UNITS/0'],'delete');assert(M.create(immune).import(im.plan));
m.reset();m.paint(['31,20'],'normal');assert.equal(m.current().cells.get('30,20').overlayData,0);assert.equal(m.current().cells.get('32,20').overlayData,0);m.paint(['31,20'],'restore');assert.equal(m.count,0);assert.equal(m.brush(30,30,5,'circle').length,21);assert.equal(m.brush(30,30,5).length,25);
const water=structuredClone(source);for(const c of water.cells){c.rawLand=2;c.overlay=255;c.bridge=null;}water.map={...water.map,STRUCTURES:{},UNITS:{},INFANTRY:{},AIRCRAFT:{},TERRAIN:{}};const wm=M.create(water);assert(wm.placement('MTNK',30,30).allowed);assert(!wm.placement('GAPOWR',30,30).allowed);assert(wm.placement('GAPOWR',30,30,{ignoreLand:true}).allowed);assert(wm.placement('GAYARD',30,30).allowed);assert(!wm.placement('NACNST',30,30).allowed);assert(wm.placement('NACNST',30,30,{ignoreLand:true}).allowed);
fs.writeFileSync(path.join(qa,'cases.json'),JSON.stringify(cases));console.log('PASS simulation transitions, history, import identity, placement, shortcuts and bridge groups');

const invalid=structuredClone(second.plan);invalid.placements.push({...invalid.placements[0],id:'sim-collision'});assert.throws(()=>M.create(source).import(invalid));
// Both bridge orientations, materials and consecutive deck collapse.
const B=require('./simulation-bridges.js');
for(const axis of ['x','y'])for(const base of [74,205]){
 const lookup=new Map();for(let i=0;i<5;i++)for(let w=-1;w<=1;w++){const[x,y]=axis==='x'?[i,w]:[w,i];lookup.set(`${x},${y}`,{x,y,overlay:base+(axis==='y'?9:0),overlayData:w+1});}
 const original=structuredClone(lookup),segments=B.segments(null,lookup),target=axis==='x'?'2,0':'0,2';
 B.edit(segments,lookup,new Set([target]),()=>{});assert.equal(lookup.get(target).overlay,base+(axis==='x'?26:27));
 for(const[i,n]of axis==='x'?[[1,8],[3,7]]:[[1,16],[3,17]])assert.equal(lookup.get(axis==='x'?`${i},0`:`0,${i}`).overlay,base+n);
 B.edit(segments,lookup,new Set([target]),()=>{},original);assert.deepEqual(lookup,original);
}
for(const axis of ['x','y'])for(const material of [24,237]){
 const lookup=new Map();for(let i=0;i<5;i++)for(let w=-2;w<=1;w++){const[x,y]=axis==='x'?[i,w]:[w,i];lookup.set(`${x},${y}`,{x,y,overlay:w===0?material+(axis==='y'?1:0):255,overlayData:0});}
 const original=structuredClone(lookup),segments=B.segments(null,lookup),key=i=>axis==='x'?`${i},0`:`0,${i}`;
 B.edit(segments,lookup,new Set([key(1),key(3)]),()=>{});for(const i of [1,2,3])assert.equal(lookup.get(key(i)).overlay,255);
 B.edit(segments,lookup,new Set([key(1)]),()=>{},original);assert.notEqual(lookup.get(key(1)).overlay,255);for(const i of [2,3])assert.equal(lookup.get(key(i)).overlay,255);
 B.edit(segments,lookup,new Set([key(2),key(3)]),()=>{},original);assert.deepEqual(lookup,original);
}
console.log('PASS stone/wood bridges: both orientations, collapse and partial restoration');

// Large strokes reuse their occupancy index and are atomic in history. The
// copied source is immutable across cancellations, undo, redo and imports.
const row=M.create(water),initial=JSON.stringify(water),index=row.current().cells;
row.beginPlacement();for(let x=25;x<=35;x++)assert(row.appendPlacement('MTNK',x,30));
assert.equal(row.current().cells,index);assert(!row.appendPlacement('MTNK',30,30));assert(row.endPlacement());assert.equal(row.plan.placements.length,11);
assert(row.undo());assert.equal(row.count,0);assert(row.placement('MTNK',30,30).allowed);assert(row.redo());assert.equal(row.plan.placements.length,11);assert(!row.placement('MTNK',30,30).allowed);
row.beginPlacement();assert(row.appendPlacement('E2',30,31));row.endPlacement(true);assert.equal(row.plan.placements.length,11);assert(row.placement('E2',30,31).allowed);
assert(M.create(water).import(row.plan));assert.equal(JSON.stringify(water),initial);
console.log('PASS incremental stroke index, atomic undo/redo and cancelled stroke');
