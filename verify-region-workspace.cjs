/* Exercise actual workspace handlers with native Canvas and a small DOM adapter. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas,Path2D}=require('@napi-rs/canvas');
const R=require('./region-statistics.js'),M=require('./map-renderer.js'),P=require('./player-starts.js');
const listeners={},windowListeners={},nodes=new Map(),memory=new Map();
function element(tag='div'){
 const e=tag==='canvas'?createCanvas(180,90):{};
 return Object.assign(e,{value:'',checked:false,hidden:false,disabled:false,children:[],style:{setProperty(){}},classList:{toggle(){}},
  setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
  addEventListener(type,fn){this['on'+type]=fn;},click(){if(!this.disabled)this.onclick?.();},closest(){return null;}});
}
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
const cells=Array.from({length:100},(_,i)=>{const x=i%10+1,y=Math.floor(i/10)+1;return {x,y,level:0,px:30*(x-y)+300,py:15*(x+y),land:0,usable:x>1,cameraCoverage:y<10?1:0};});
const lookup=new Map(cells.map(c=>[`${c.x},${c.y}`,c])),data={metadata:{sourceSha256:'fixture',waypoints:{0:'2003',1:'4005',7:'7008',8:'2002',26:'3003',2:'-1',3:'2003oops',4:'999999'}},rendering:{width:600,height:330,origin:[300,0],cameraRect:[0,0,600,300]}};
const state={data,cells,lookup,image:createCanvas(600,330),x:0,y:0,scale:1},area={x:0,y:0,w:600,h:330};
const display={baselineNumerator:1n,get:()=>({numerator:1n})};
const stored=R.defaults();stored.regions[0].cells.add(R.key(cells[0]));delete stored.selectionBoundsVersion;
const storageKey='crate-atlas.regions.v1.fixture';memory.set(storageKey,R.encode(stored));
$('regionTool').value='brush-ellipse';$('regionOperation').value='add';$('regionWidth').value=$('regionHeight').value='1';$('regionSort').value='all.total';$('players').checked=true;
const context={CrateRegionStatistics:R,CrateMapRenderer:M,CratePlayerStarts:P,Path2D,console,
 document:{getElementById:$,createElement:element,createTextNode:s=>s,addEventListener:(k,v)=>listeners[k]=v,activeElement:null,querySelector(){return null;}},
 window:{addEventListener:(k,v)=>windowListeners[k]=v},localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},setTimeout:()=>1,clearTimeout(){}};
vm.createContext(context);vm.runInContext(fs.readFileSync('region-statistics-ui.js','utf8'),context);
let pointedCell=cells[0];
const ui=context.CrateRegionStatisticsUI.create({getState:()=>state,getDisplay:()=>display,schedule(){},pick:()=>pointedCell,area,onMode(){}});
ui.load();ui.setMode(true);
const snapshot=()=>{ui.beforeLoad();return JSON.parse(memory.get(storageKey));};
assert.equal(snapshot().regions[0].cells.length,0,'Legacy out-of-bounds membership is removed.');
function paint(x,y){const c=lookup.get(`${x},${y}`);ui.down({x:c.px,y:c.py});ui.up();}
paint(5,5);const first=snapshot();assert.ok(first.regions[0].cells.length>0);
pointedCell=lookup.get('5,5');ui.move({x:pointedCell.px,y:pointedCell.py});
assert.equal(ui.hoverInfo().regions[0].id,'r1');
assert.equal(ui.hoverInfo().regions[0].color,first.regions[0].color);
pointedCell=lookup.get('9,9');ui.move({x:pointedCell.px,y:pointedCell.py});
assert.equal(ui.hoverInfo().regions.length,0,'Hover reports the pointed cell, not the active region.');
pointedCell=cells[0];assert.equal(ui.hoverInfo().selectable,false);
ui.leave();assert.equal(ui.hoverInfo(),null,'Leaving the map must clear stale membership.');
assert.equal($('regionRedo').disabled,true);$('regionUndo').click();assert.equal(snapshot().regions[0].cells.length,0);
assert.equal($('regionRedo').disabled,false);$('regionRedo').click();assert.deepEqual(snapshot().regions[0].cells,first.regions[0].cells);
$('regionUndo').click();paint(8,8);assert.equal($('regionRedo').disabled,true,'A new edit clears the redo branch.');
const second=snapshot();$('regionUndo').click();
listeners.keydown({ctrlKey:true,key:'Z',shiftKey:true,preventDefault(){},target:{closest(){return null;}}});
assert.deepEqual(snapshot().regions[0].cells,second.regions[0].cells);
$('regionTransparency').value='25';$('regionTransparency').oninput();$('regionTransparency').onchange();assert.equal(snapshot().transparency,25);
$('regionUndo').click();assert.equal(snapshot().transparency,50);$('regionRedo').click();assert.equal(snapshot().transparency,25);
$('regionClear').click();const old=lookup.get('1,1');$('regionTool').value='box-screen';ui.down({x:old.px,y:old.py});ui.up();
assert.equal(snapshot().regions[0].cells.length,0,'Click fallback must not add forbidden cells.');
$('regionTool').value='box-game';ui.down({x:20,y:20});ui.move({x:590,y:300});ui.up();
for(const r of snapshot().regions)for(const k of r.cells)assert.ok(R.canSelect(cells.find(c=>R.key(c)===k),data.rendering));
assert.deepEqual(P.positions(state).map(p=>p.number),[1,2,8],'Exclude non-start, malformed and out-of-map waypoints.');
assert.deepEqual(P.positions(state)[0],{number:1,x:3,y:2,px:330,py:75});
const canvas=createCanvas(600,330),ctx=canvas.getContext('2d');P.draw(ctx,state,state,{radius:8});assert.ok(ctx.getImageData(330,75,1,1).data[3]>0);
assert.equal(P.positions({...state,data:{...data,metadata:{...data.metadata,multiplayerOnly:false}}}).length,0,'Campaign waypoints are not multiplayer starts.');
// Real tool handlers: sampling cannot paint or discard history; Shift is momentary.
const a=lookup.get('5,5'),b=lookup.get('8,8'),c=lookup.get('9,3'),ka=R.key(a),kb=R.key(b),kc=R.key(c);
const members=d=>d.regions.map(r=>r.cells),mods=(shiftKey=false,ctrlKey=false)=>({shiftKey,ctrlKey});
const point=c=>({x:c.px,y:c.py});
const chooseTool=t=>{$('regionTool').value=t;$('regionTool').onchange();};
function resetSelection(d=R.defaults()){ui.beforeLoad();memory.set(storageKey,R.encode(d));ui.load();}
function clickCell(cell,e=mods()){pointedCell=cell;ui.down(point(cell),e);ui.up();}
const sample=R.defaults();sample.overlap=true;sample.active='r2';sample.regions[0].cells.add(ka);sample.regions[2].cells.add(ka);sample.regions[1].cells.add(kb);
resetSelection(sample);chooseTool('brush-circle');const membership=members(snapshot());
$('regionEyedropper').click();assert.equal($('regionTool').value,'picker');
clickCell(a);assert.equal(snapshot().active,'r3','Sample the topmost region when current region is absent.');
assert.equal($('regionTool').value,'brush-circle','Successful picker restores the last non-picker tool.');
assert.deepEqual(members(snapshot()),membership,'Sampling must never paint.');
clickCell(b,mods(false,true));assert.equal(snapshot().active,'r2');assert.deepEqual(members(snapshot()),membership);
assert.equal($('regionUndo').disabled,true,'Sampling does not create undo entries.');
chooseTool('picker');clickCell(c);assert.equal(snapshot().active,'r2');assert.equal($('regionTool').value,'picker','Empty sample allows retry.');
pointedCell=a;ui.down(point(a),mods());ui.move(point(b),false,mods());ui.up();assert.equal(snapshot().active,'r2','Dragging in picker must not sample.');
assert.deepEqual(members(snapshot()),membership);
$('regionEyedropper').click();assert.equal($('regionTool').value,'brush-circle');
resetSelection();chooseTool('brush-game');$('regionOperation').value='add';
clickCell(a);assert.ok(snapshot().regions[0].cells.includes(ka));
clickCell(a,mods(true));assert.ok(!snapshot().regions[0].cells.includes(ka));assert.equal($('regionOperation').value,'add');
clickCell(b);assert.ok(snapshot().regions[0].cells.includes(kb),'Releasing Shift restores add.');
$('regionOperation').value='remove';clickCell(a,mods(true));assert.ok(snapshot().regions[0].cells.includes(ka),'Shift also reverses the remove tool.');
clickCell(a);assert.ok(!snapshot().regions[0].cells.includes(ka));assert.equal($('regionOperation').value,'remove');
$('regionOperation').value='add';pointedCell=a;ui.down(point(a),mods());
listeners.keydown({key:'Shift',...mods(true),target:{closest(){return null;}}});
pointedCell=b;ui.move(point(b),false,mods(true));listeners.keyup({key:'Shift',...mods()});
pointedCell=c;ui.move(point(c),false,mods());ui.up();
assert.ok(snapshot().regions[0].cells.includes(ka));assert.ok(!snapshot().regions[0].cells.includes(kb));assert.ok(snapshot().regions[0].cells.includes(kc));
chooseTool('box-game');pointedCell=a;ui.down(point(a),mods());pointedCell=c;ui.move(point(c),false,mods());
listeners.keydown({key:'Shift',...mods(true),target:{closest(){return null;}}});ui.up();
assert.ok(!snapshot().regions[0].cells.includes(ka));assert.ok(!snapshot().regions[0].cells.includes(kc),'Shift affects the rectangle committed on release.');
windowListeners.blur();chooseTool('brush-game');clickCell(a);assert.ok(snapshot().regions[0].cells.includes(ka),'Blur clears stuck modifier keys.');
chooseTool('picker');pointedCell=a;ui.down(point(a),mods());ui.cancel();assert.ok(snapshot().regions[0].cells.includes(ka),'Canceling a pick is harmless.');
const beforeLayout=snapshot(),oldRegionTotal=$('regionLive').textContent,previousGet=display.get;
display.get=()=>({numerator:3n});ui.load({preserve:true});
assert.deepEqual(snapshot(),beforeLayout,'Layout switch must retain all region settings/memberships.');
assert.equal($('regionUndo').disabled,false,'Layout switch must preserve undo history.');
assert.notEqual($('regionLive').textContent,oldRegionTotal,'Region totals must use the new layout, not cached probabilities.');
$('regionUndo').click();assert.ok(!snapshot().regions[0].cells.includes(ka));
$('regionRedo').click();assert.deepEqual(snapshot(),beforeLayout,'Redo still works after layout change.');
display.get=previousGet;
// A pending export must keep its region geometry, colors and camera clipping
// when the user continues editing or loads another map before the next frame.
ui.leave();const exportView={x:0,y:0,scale:1};
function layerPixels(layer){const image=createCanvas(600,330);layer(image.getContext('2d'),exportView);return image.toBuffer('image/png');}
const savedLayer=ui.snapshotLayer(),savedPixels=layerPixels(savedLayer);
assert.deepEqual(savedPixels,layerPixels(ui.render));
clickCell(c);$('regionTransparency').value='85';$('regionTransparency').oninput();
$('regionColor').value='#ff3355';$('regionColor').oninput();$('regionColor').onchange();
assert.notDeepEqual(savedPixels,layerPixels(ui.render));
assert.deepEqual(savedPixels,layerPixels(savedLayer),'Pending exports must ignore region edits and transparency changes.');
const previousCamera=state.data.rendering.cameraRect;state.data.rendering.cameraRect=[0,0,1,1];resetSelection();ui.setMode(false);
assert.deepEqual(savedPixels,layerPixels(savedLayer),'Captured paths must outlive map changes and leaving region mode.');
state.data.rendering.cameraRect=previousCamera;
console.log('PASS: export region snapshots preserve pixels across edits, map changes and mode changes.');
console.log('PASS: layout switch refreshes region statistics and retains selections, undo and redo.');
console.log('PASS: picker/Control-click, last-tool restore, overlap priority, no-op/drag/cancel sampling, Shift inversion and mid-stroke transitions.');
console.log('PASS: workspace undo/redo/branching, keyboard redo, transparency persistence, boundary migration/click fallback, start numbering and Canvas drawing.');
