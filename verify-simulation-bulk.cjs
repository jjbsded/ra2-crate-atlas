/* Bulk bridge damage, startup rubble and magnetic erase; shared Full/Toy delta. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),M=require('./simulation-model.js');
const template=JSON.parse(fs.readFileSync('output/simulation-20261104/source.json','utf8')),cases=[];
function fixture(){
 const s=structuredClone(template),base=s.cells.find(c=>c.usable&&c.rawLand===0&&c.overlay===255);
 s.cells=[];for(let x=10;x<=50;x++)for(let y=10;y<=50;y++)s.cells.push({...base,x,y,overlay:255,overlayData:0,overlayName:null,bridge:null,terrain:null});
 s.map={MAP:structuredClone(template.map.MAP),STRUCTURES:{},UNITS:{},INFANTRY:{},AIRCRAFT:{},TERRAIN:{}};return s;
}
function record(name,s,m){const data=M.materialize(s,m.plan);cases.push({name,source:s,plan:m.plan,map:data.map,cells:data.cells.map(c=>[`${c.x},${c.y}`,c.overlay,c.overlayData])});}
function history(m,before,after){assert(m.undo());assert.deepEqual(m.plan,before);assert(m.redo());assert.deepEqual(m.plan,after);assert(M.create(m.source).import(after));assert.deepEqual(M.create(m.source).normalized(after),after);}
for(const axis of ['x','y'])for(const material of [24,237,74,205]){
 const s=fixture(),at=(i,w)=>axis==='x'?[20+i,20+w]:[20+w,20+i],cell=(i,w)=>{const [x,y]=at(i,w);return s.cells.find(c=>c.x===x&&c.y===y);},low=material>=74&&material!==237;
 for(let i=0;i<7;i++)for(let w=low?-1:-2;w<=1;w++){
  const c=cell(i,w);if(low){const n=i===0?(axis==='x'?18:22):i===6?(axis==='x'?20:24):i===4?(axis==='x'?26:27):(axis==='x'?0:9);c.overlay=material+n;c.overlayData=w+1;}
  else if(w===0){c.overlay=material+(axis==='y'?1:0);c.overlayData=0;}
 }
 const [x,y]=at(2,0);s.map.UNITS.rider=['Americans','MTNK',256,x,y,0,'Guard','None',0,-1,0,1,1,0].join(',');
 s.cells.find(c=>c.x===12&&c.y===12).tileIndex=9876; // Fixed TMP terrain remains unchanged.
 const m=M.create(s),before=m.plan;assert(m.quick('bridges'));const after=m.plan,state=m.current();
 for(let i=0;i<7;i++)for(let w=low?-1:0;w<=(low?1:0);w++){
  const [cx,cy]=at(i,w),c=state.cells.get(`${cx},${cy}`);assert.equal(c.overlay,low?material+(i===0?(axis==='x'?19:23):i===6?(axis==='x'?21:25):axis==='x'?26:27):255,`${axis}/${material}/${i}`);
 }
 assert.equal(after.objects['UNITS/rider'],'remove');assert.equal(state.cells.get('12,12').tileIndex,9876);
 history(m,before,after);assert.equal(m.quick('bridges'),false,'Already broken bridges add no history');record(`bridges-${axis}-${material}`,s,m);
}
for(const low of [false,true])for(const protection of ['IMMUNE','STRENGTH']){
 const s=fixture(),types=Object.entries(s.rules.OVERLAYTYPES).sort((a,b)=>Number(a[0])-Number(b[0])).map(([,v])=>v.toUpperCase()),protectedIndex=low?79:237;
 s.rules[types[protectedIndex]]={...s.rules[types[protectedIndex]],[protection]:protection==='IMMUNE'?'yes':'0'};
 for(let i=0;i<5;i++)for(let w=low?-1:0;w<=(low?1:0);w++){const c=s.cells.find(c=>c.x===20+i&&c.y===20+w);c.overlay=i===2?protectedIndex:low?74:24;c.overlayData=low?w+1:0;}
 const m=M.create(s);assert(m.quick('bridges'));for(let w=low?-1:0;w<=(low?1:0);w++){assert.equal(m.current().cells.get(`22,${20+w}`).overlay,protectedIndex);assert(!m.plan.overlays[`22,${20+w}`],'Protected bridge owner/projected strip unchanged');}
 assert.equal(m.current().cells.get('20,20').overlay,low?100:255);record(`bridges-protected-${low}-${protection}`,s,m);
}
{
 const s=fixture();s.rules.QA_BUILDING={...s.rules.GAPOWR,IMAGE:'QA_BUILDING',LEAVERUBBLE:'yes',IMMUNE:'no',STRENGTH:'100'};s.art.QA_BUILDING={FOUNDATION:'1x1'};s.rules.QA_IMMUNE={...s.rules.QA_BUILDING,IMMUNE:'yes'};
 for(const[id,type,hp,x]of [['old-rubble','QA_BUILDING',0,20],['living','QA_BUILDING',256,22],['immune','QA_IMMUNE',256,24]])s.map.STRUCTURES[id]=['Americans',type,hp,x,20,0,'None',1,0,1,0,0,'None','None','None',0,0].join(',');
 const rubbleTypes=Object.entries(s.rules.OVERLAYTYPES).sort((a,b)=>Number(a[0])-Number(b[0])).map(([,v])=>v.toUpperCase()),originalRubble=s.cells.find(c=>c.x===30&&c.y===30);originalRubble.overlay=rubbleTypes.indexOf('RUBBLE_OVERLAY');originalRubble.overlayData=3;
 const m=M.create(s);assert(m.quick('buildings'));assert.equal(m.plan.objects['STRUCTURES/living'],'rubble');assert(!m.plan.objects['STRUCTURES/old-rubble']);assert(!m.plan.objects['STRUCTURES/immune']);record('normal-buildings',s,m);
 const before=m.plan;assert(m.quick('buildings','chrono'));assert.equal(m.plan.objects['STRUCTURES/living'],'remove');assert(!m.plan.objects['STRUCTURES/old-rubble']);assert(!m.plan.objects['STRUCTURES/immune']);assert.equal(m.current().cells.get('30,30').overlay,originalRubble.overlay);assert(!m.plan.overlays['30,30']);history(m,before,m.plan);record('chrono-generated-rubble',s,m);
 const chrono=M.create(s);assert(chrono.quick('buildings','chrono'));assert(!chrono.plan.objects['STRUCTURES/old-rubble']);record('chrono-original-buildings',s,chrono);
}
{
 const s=fixture();s.rules.QA_BUILDING={...s.rules.GAPOWR,IMAGE:'QA_BUILDING',LEAVERUBBLE:'yes',IMMUNE:'no',STRENGTH:'100'};s.art.QA_BUILDING={FOUNDATION:'2x2'};s.rules.QA_IMMUNE={...s.rules.QA_BUILDING,IMMUNE:'yes'};
 s.rules.QA_MINE={SPAWNSTIBERIUM:'yes',IMMUNE:'yes',STRENGTH:'0'};s.rules.QA_LIGHT={INVISIBLEINGAME:'yes',IMMUNE:'yes',STRENGTH:'0',LIGHTINTENSITY:'0.01'};
 s.map.STRUCTURES.normal='Americans,QA_BUILDING,256,20,20,0,None,1,0,1,0,0,None,None,None,0,0';s.map.STRUCTURES.immune='Americans,QA_IMMUNE,256,24,20,0,None,1,0,1,0,0,None,None,None,0,0';
 s.rules.MTNK.IMMUNE='yes';s.rules.E1.IMMUNE='yes';s.rules.ORCA.IMMUNE='yes';
 s.map.UNITS.tank='Americans,MTNK,256,20,24,0,Guard,None,0,-1,0,0,1,0';s.map.INFANTRY.soldier='Americans,E1,256,21,24,3,Guard,0,None,0,-1,0,0';s.map.AIRCRAFT.air='Americans,ORCA,256,22,24,0,Guard,None,0,-1,0,0,1,0';
 s.map.TERRAIN['28020']='QA_MINE';s.map.TERRAIN['28021']='QA_LIGHT';s.map.TERRAIN['28022']='TREE01';
 const types=Object.entries(s.rules.OVERLAYTYPES).sort((a,b)=>Number(a[0])-Number(b[0])).map(([,v])=>v.toUpperCase());
 for(const[x,y,name]of [[30,30,'GAWALL'],[31,30,types.find(n=>/^(TIB|GOLD)\d+$/.test(n))]]){const c=s.cells.find(c=>c.x===x&&c.y===y);c.overlay=types.indexOf(name);assert(c.overlay>=0,name);}
 const bridge=s.cells.find(c=>c.x===33&&c.y===33);bridge.overlay=24;bridge.overlayData=0;
 const all=s.cells.map(c=>`${c.x},${c.y}`),m=M.create(s);assert(m.place('MTNK',40,40));assert(m.place('GAPOWR',35,40));const before=m.plan;
 assert(m.paint(all,'magnet'));const after=m.plan;assert.equal(m.current().objects.length,0);assert.equal(after.placements.length,0);assert(Object.keys(after.overlays).length>0);for(const o of M.objects(s))assert.equal(after.objects[o.id],'magnet',o.id);
 assert.equal(m.current().cells.get('33,33').overlay,255);assert.equal(m.current().cells.get('30,30').overlay,255);assert.equal(m.current().cells.get('31,30').overlay,255);history(m,before,after);record('magnetic-all',s,m);
 assert(m.paint(['24,20'],'restore'));assert(!m.plan.objects['STRUCTURES/immune']);assert(m.current().objects.some(o=>o.id==='STRUCTURES/immune'));record('magnetic-restored',s,m);
 const normal=M.create(s);normal.paint(all,'chrono');for(const id of ['STRUCTURES/immune','UNITS/tank','INFANTRY/soldier','AIRCRAFT/air','TERRAIN/28020','TERRAIN/28021'])assert(!normal.plan.objects[id],id+' stays immune to chrono');
 assert.throws(()=>M.create(s).import({...after,objects:{...after.objects,'UNITS/missing':'magnet'}}));assert.throws(()=>M.create(s).import({...after,objects:{...after.objects,'UNITS/tank':'other'}}));
}
if(process.argv[2]){fs.mkdirSync(path.dirname(process.argv[2]),{recursive:true});fs.writeFileSync(process.argv[2],JSON.stringify(cases));}
console.log('PASS both bridge orientations/materials, fixed approaches, startup rubble, immune magnetic targets, restore, atomic history and delta roundtrip');
