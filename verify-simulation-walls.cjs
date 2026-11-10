/* Wall variants, native delta compatibility and one-step history. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),M=require('./simulation-model.js');
const source=JSON.parse(fs.readFileSync('output/simulation-20261104/source.json','utf8'));
const types=Object.entries(source.rules.OVERLAYTYPES).sort((a,b)=>Number(a[0])-Number(b[0])).map(([,v])=>v.toUpperCase());
const names=['GAWALL','NAWALL','GAFWLL','GASAND','CAFNCB','CAFNCW','CAKRMW','CAFNCP',...Array.from({length:22},(_,i)=>'FENCE'+String(i+1).padStart(2,'0'))];
const free=source.cells.filter(c=>c.usable&&c.x>=44&&c.overlay===255&&!c.bridge);assert(free.length>names.length+4);
const targets=names.map((name,i)=>{const c=free[i],index=types.indexOf(name);assert(index>=0,name);c.overlay=index;c.overlayData=15;return {name,x:c.x,y:c.y};});
const alias=types.indexOf('FENCE11'),registryKey=Object.entries(source.rules.OVERLAYTYPES).sort((a,b)=>Number(a[0])-Number(b[0]))[alias][0];source.rules.OVERLAYTYPES[registryKey]='CUSTOMWIRE';source.rules.CUSTOMWIRE={...source.rules.FENCE11,IMAGE:'FENCE11',LEGALTARGET:'yes'};types[alias]='CUSTOMWIRE';
source.rules.IMMUNE_WALL={WALL:'yes',IMMUNE:'yes',STRENGTH:'100'};source.rules.ZERO_WALL={WALL:'yes',STRENGTH:'0'};
for(const [id,type,i]of [['qa-wall','GAWALL',0],['qa-fence','FENCE12',1],['qa-alias','CUSTOMWIRE',2],['qa-immune','IMMUNE_WALL',3],['qa-zero','ZERO_WALL',4]]){
 const c=free[i];source.map.STRUCTURES[id]=['Americans',type,'256',c.x,c.y,'0','None','1','0','1','0','0','None','None','None','0','0'].join(',');
}
const m=M.create(source),ore=m.choices.find(c=>c.ore).type,tree=m.choices.find(c=>c.tree).type;
assert(m.place('GAWALL',40,35));assert(m.place('MTNK',41,35));assert(m.place(ore,41,35));assert(m.place(tree,43,35));
const before=m.plan,beforeCells=new Map(m.current().cells),nonwall=m.current().objects.filter(o=>['MTNK',tree].includes(o.type)).map(o=>o.id);
assert(m.quick('walls'));const after=m.plan,state=m.current();
const yes=v=>/^(yes|true|1)$/i.test(v),wall=name=>{const cfg=source.rules[name]||{};return !yes(cfg.IMMUNE)&&Number(cfg.STRENGTH??1)>0&&(yes(cfg.WALL)||yes(cfg.LEGALTARGET)&&(/^FENCE\d+$/.test(name)||/^FENCE\d+$/.test(cfg.IMAGE||'')));};
for(const c of targets){const index=types.indexOf(c.name==='FENCE11'?'CUSTOMWIRE':c.name);assert.equal(state.cells.get(c.x+','+c.y).overlay,wall(types[index])?255:index,c.name+' eligibility');}
assert(!after.placements.some(o=>o.type==='GAWALL'));assert(after.placements.some(o=>o.type==='MTNK'));assert(after.placements.some(o=>o.type===ore));assert(after.placements.some(o=>o.type===tree));
assert.deepEqual(state.objects.filter(o=>['MTNK',tree].includes(o.type)).map(o=>o.id),nonwall);
for(const id of ['qa-wall','qa-fence','qa-alias','qa-immune','qa-zero'])assert(!after.objects['STRUCTURES/'+id],'Health-bar buildings are not walls');
for(const [p,c]of beforeCells){const kind=types[c.overlay],cfg=source.rules[kind]||{};if(!names.includes(kind)&&!/^FENCE\d+$/.test(cfg.IMAGE||''))assert.equal(state.cells.get(p).overlay,c.overlay,'Unrelated overlays, ore and bridges are preserved');}
assert(M.create(source).import(after));assert.deepEqual(M.create(source).normalized(after),after);
assert(m.undo());assert.deepEqual(m.plan,before,'All walls form one undo step');assert(m.redo());assert.deepEqual(m.plan,after);
assert.equal(m.quick('walls'),false,'A second click is a no-op');assert(m.undo());assert.deepEqual(m.plan,before,'No-op must not add history');assert(m.redo());
if(process.argv[2]){fs.mkdirSync(require('node:path').dirname(process.argv[2]),{recursive:true});fs.writeFileSync(process.argv[2],JSON.stringify({source,plan:after,cells:[...state.cells].map(([p,c])=>[p,c.overlay,c.overlayData])}));}
console.log('PASS destructible stock walls/fences, Image alias, decorative fences and health-bar buildings preserved, no-op, undo/redo and import');
