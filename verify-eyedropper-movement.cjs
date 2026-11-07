/* Stock and embedded movement rules, independent of category/draw ordering. */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),M=require('./simulation-model.js');
const original=JSON.parse(fs.readFileSync('output/simulation-20261104/source.json'));
const source={...original,map:{...original.map,STRUCTURES:{},UNITS:{},INFANTRY:{},AIRCRAFT:{},TERRAIN:{}},cells:[{x:30,y:30,rawLand:0,overlay:255,overlayData:0}]};
const m=M.create(source),state=m.current(),cell=state.cells.get('30,30');
const object=(category,type,extra={})=>({category,type,x:30,y:30,footprint:[[0,0]],...extra});
function sample(objects,overlay=255,hitObject=null){state.occupants.set('30,30',objects);cell.overlay=overlay;return m.sample(30,30,{fallback:null,state,hitObject});}
const cases=[
 ['UNITS','MTNK','MTNK'],['UNITS','HTNK','MTNK'],['UNITS','HYD','HYD'],['UNITS','DLPH','HYD'],['UNITS','SQD','HYD'],
 ['UNITS','YHVR','YHVR'],['UNITS','SHAD','YHVR'],['UNITS','ZEP','YHVR'],
 ['INFANTRY','E2','MTNK'],['INFANTRY','TANY','YHVR'],['INFANTRY','GHOST','YHVR'],['INFANTRY','YURIPR','YHVR'],
 ['INFANTRY','JUMPJET','YHVR'],['INFANTRY','LUNR','YHVR'],['INFANTRY','DNOB','HYD'],
 ['AIRCRAFT','ORCA','YHVR'],['AIRCRAFT','HORNET','YHVR']
];
for(const [category,type,expected]of cases){assert(source.rules[type],type);assert.equal(sample([object(category,type)]),expected,category+'/'+type);}
const ore=m.choices.find(c=>c.ore),tree=m.choices.find(c=>c.tree),wall=m.choices.find(c=>c.wall),building=m.choices.find(c=>c.category==='STRUCTURES');
assert(ore&&tree&&wall&&building);
const overlayIndex=type=>Object.entries(source.rules.OVERLAYTYPES).sort((a,b)=>+a[0]-b[0]).findIndex(([,name])=>name.toUpperCase()===type);
assert.equal(sample([]),null);assert.equal(sample([],overlayIndex(ore.type)),ore.type);
const chain=[object('OVERLAY',ore.type),object('TERRAIN',tree.type,{tree:true}),object('OVERLAY',wall.type),object('STRUCTURES',building.type,{footprint:building.footprint}),object('INFANTRY','E2'),object('INFANTRY','DNOB'),object('INFANTRY','TANY')];
const expected=[ore.type,tree.type,wall.type,building.type,'MTNK','HYD','YHVR'];
for(let length=1;length<=chain.length;length++){
 const list=chain.slice(0,length);
 for(let shift=0;shift<length;shift++){
  const rotated=[...list.slice(shift),...list.slice(0,shift)];
  assert.equal(sample(rotated),expected[length-1]);assert.equal(sample(rotated.toReversed()),expected[length-1]);
 }
}
assert.equal(sample([chain[1]],overlayIndex(wall.type)),wall.type,'Wall overlay beats tree');
assert.equal(sample([chain[3]],overlayIndex(wall.type)),building.type,'Building beats wall');
assert.equal(sample([chain[4]],overlayIndex(ore.type)), 'MTNK','Land infantry beats ore');
assert.equal(sample([chain[4]],255,chain[1]),'MTNK','Pixel-picked tree cannot override a unit in the cell');
assert.equal(sample([chain[1]],255,chain[6]),'YHVR','Pixel-picked unit joins the same priority comparison');
assert.equal(sample([object('STRUCTURES',building.type,{isRubble:true})]),null,'Rubble is not an intact selectable building');
assert(!m.choices.some(c=>c.type==='E2'),'Sampling infantry must not reenable infantry placement');
assert.equal(m.count,0);assert.deepEqual(m.plan,M.empty(source),'Sampling never changes the plan');

// Embedded rules can change a stock unit or define a new one. Naval=yes is
// deliberately insufficient: hover transports carry it as well as ships.
const custom=structuredClone(source);
Object.assign(custom.rules,{
 CUSTOMSWIM:{SPEEDTYPE:'Float',MOVEMENTZONE:'Water'},
 CUSTOMAMPH:{SPEEDTYPE:'Amphibious',MOVEMENTZONE:'AmphibiousDestroyer'},
 CUSTOMFLY:{LOCOMOTOR:source.rules.ORCA.LOCOMOTOR},
 CUSTOMNAVALFLAG:{NAVAL:'yes',SPEEDTYPE:'Track'},
 TANY:{...source.rules.TANY,SPEEDTYPE:'Float',MOVEMENTZONE:'Water'}
});
const cm=M.create(custom);
for(const [type,target]of [['CUSTOMSWIM','HYD'],['CUSTOMAMPH','YHVR'],['CUSTOMFLY','YHVR'],['CUSTOMNAVALFLAG','MTNK'],['TANY','HYD']])assert.equal(cm.sampleObject(object('INFANTRY',type)).type,target,type);
const landOnly=structuredClone(custom);landOnly.rules.WATER.AMPHIBIOUS='0%';
assert.equal(M.create(landOnly).sampleObject(object('INFANTRY','CUSTOMAMPH')).type,'MTNK','Embedded terrain passage costs apply');
console.log('PASS eyedropper: stock/embedded land, naval, amphibious and flying units, infantry, pixel hits, all object priorities, no edits');
