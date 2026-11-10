/* Object priority is per action/stroke, not per preview or pointer event. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),M=require('./simulation-model.js');
const template=JSON.parse(fs.readFileSync('output/simulation-20261104/source.json','utf8')),cases=[];
function fixture(){const s=structuredClone(template),base=s.cells.find(c=>c.usable&&c.rawLand===0&&c.overlay===255);s.cells=[];for(let x=10;x<=50;x++)for(let y=10;y<=50;y++)s.cells.push({...base,x,y,rawLand:0,level:0,slope:0,overlay:255,overlayData:0,bridge:null,terrain:null});s.map={MAP:structuredClone(s.map.MAP),STRUCTURES:{},UNITS:{},INFANTRY:{},AIRCRAFT:{},TERRAIN:{}};return s;}
function units(s,x,y){s.map.UNITS.tank=`Americans,MTNK,256,${x},${y},0,Guard,None,0,-1,0,0,1,0`;s.map.UNITS.boat=`Americans,HYD,256,${x},${y},0,Guard,None,0,-1,0,0,1,0`;s.map.AIRCRAFT.air=`Americans,ORCA,256,${x},${y},0,Guard,None,0,-1,0,0,1,0`;for(let n=0;n<3;n++)s.map.INFANTRY['i'+n]=`Americans,E1,256,${x},${y},${n+2},Guard,0,None,0,-1,0,0`;}
function record(name,m){const value=M.materialize(m.source,m.plan);cases.push({name,source:m.source,plan:m.plan,map:value.map,cells:value.cells.map(c=>[`${c.x},${c.y}`,c.overlay,c.overlayData])});}
function history(m,before,after){assert(m.undo());assert.deepEqual(m.plan,before);assert(m.redo());assert.deepEqual(m.plan,after);assert(M.create(m.source).import(after));}
for(const mode of ['normal','chrono','magnet'])for(const layer of ['ore','original-rubble','generated-rubble','placed-rubble']){
 const s=fixture();units(s,21,21);const types=Object.entries(s.rules.OVERLAYTYPES).sort((a,b)=>Number(a[0])-Number(b[0])).map(([,v])=>v.toUpperCase()),ore=types.find(n=>/^(TIB|GOLD)\d+$/.test(n));
 if(layer==='ore'){const c=s.cells.find(c=>c.x===21&&c.y===21);c.overlay=types.indexOf(ore);c.overlayName=ore;c.overlayData=11;}
 if(layer.includes('rubble')&&layer!=='placed-rubble')s.map.STRUCTURES.ruin=`Americans,CAOILD,${layer==='original-rubble'?0:256},20,20,0,None,1,0,1,0,0,None,None,None,0,0`;
 const m=M.create(s);if(layer==='placed-rubble'){assert(m.placement('CAOILD',20,20).allowed,'Units do not block rubble');assert(m.place('CAOILD',20,20));}
 if(layer==='generated-rubble')assert(m.paint(['20,20'],'normal'));
 const before=m.plan;assert(m.paint(['21,21'],mode));assert(!m.current().objects.some(o=>['UNITS','INFANTRY','AIRCRAFT'].includes(o.category)),'Every unit in the cell is removed');
 if(layer==='ore')assert.equal(m.current().cells.get('21,21').overlayName,ore);else assert(m.current().objects.some(o=>o.category==='RUBBLE'||o.id==='STRUCTURES/ruin'),'First action preserves the whole rubble foundation');
 const first=m.plan;history(m,before,first);record(`${mode}-${layer}-units`,m);
 const changed=m.paint(['21,21'],mode);if(layer!=='ore'&&mode==='normal'){assert.equal(changed,false,'Ordinary destruction keeps rubble');continue;}
 assert(changed);if(layer==='ore')assert.equal(m.current().cells.get('21,21').overlay,255);else assert(!m.current().objects.some(o=>o.category==='RUBBLE'||o.id==='STRUCTURES/ruin'));record(`${mode}-${layer}-lower`,m);
}
for(const layer of ['ore','rubble']){
 const s=fixture(),m=M.create(s),ore=m.choices.find(c=>c.ore).type;assert(m.place('MTNK',20,20));assert(m.place(layer==='ore'?ore:'CAOILD',20,20));const before=m.plan;
 m.beginPaint();assert(m.paint(['20,20'],'magnet'));assert(!m.paint(layer==='ore'?['20,20']:['21,21'],'magnet'),'One drag cannot erase the layer exposed by that same stroke');assert(m.endPaint());const first=m.plan;assert(first.placements.some(o=>o.type===(layer==='ore'?ore:'CAOILD')));history(m,before,first);record(`stroke-${layer}-unit`,m);
 assert(m.paint(['20,20'],'magnet'));assert.equal(m.plan.placements.length,0);record(`stroke-${layer}-lower`,m);
}
{
 const s=fixture();units(s,20,20);s.rules.MTNK.IMMUNE='yes';const m=M.create(s),ore=m.choices.find(c=>c.ore).type;assert(m.place(ore,20,20));m.paint(['20,20'],'normal');assert(m.current().objects.some(o=>o.id==='UNITS/tank'));assert(m.plan.placements.some(o=>o.type===ore),'An immune surviving unit still protects its lower layer');assert(m.paint(['20,20'],'magnet'));assert(m.plan.placements.some(o=>o.type===ore));assert(m.paint(['20,20'],'magnet'));assert(!m.plan.placements.length);record('immune-unit-priority',m);
}
for(const kind of ['GAPOWR','TREE01','GAWALL','ore']){
 const s=fixture(),m=M.create(s),type=kind==='ore'?m.choices.find(c=>c.ore).type:kind,category=m.choice(type)?.category;
 if(category)assert(m.place(type,20,20));else{s.map.TERRAIN['20020']=type;}
 const model=category?m:M.create(s);assert(!model.placement('CAOILD',20,20).allowed,'Nonunit blockers remain: '+kind);
}
for(const axis of ['x','y'])for(const material of [24,237,74,205]){
 const s=fixture(),low=material===74||material===205;for(let i=0;i<5;i++)for(let w=low?-1:0;w<=(low?1:0);w++){const[x,y]=axis==='x'?[20+i,20+w]:[20+w,20+i],c=s.cells.find(c=>c.x===x&&c.y===y);c.overlay=material+(low?(axis==='y'?9:0):(axis==='y'?1:0));c.overlayData=low?w+1:0;}
 const m=M.create(s),other=M.create(s),target=axis==='x'?'22,20':'20,22';assert(m.paint([target],'magnet'));assert(other.paint([target],'chrono'));assert.deepEqual([...m.current().cells].map(([p,c])=>[p,c.overlay,c.overlayData]),[...other.current().cells].map(([p,c])=>[p,c.overlay,c.overlayData]));record(`magnet-bridge-${axis}-${material}`,m);
}
if(process.argv[2]){fs.mkdirSync(path.dirname(process.argv[2]),{recursive:true});fs.writeFileSync(process.argv[2],JSON.stringify(cases));}
console.log('PASS unit-first stacked deletion, all mobile categories, original/generated/placed rubble, stroke shielding, blockers and magnetic bridge parity');
