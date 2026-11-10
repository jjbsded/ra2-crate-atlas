/* Exercise actual workspace handlers with native Canvas and a small DOM adapter. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCanvas,Path2D}=require('@napi-rs/canvas');
const R=require('./region-statistics.js'),M=require('./map-renderer.js'),P=require('./player-starts.js');
const listeners={},windowListeners={},nodes=new Map(),memory=new Map();
function element(tag='div'){
 const e=tag==='canvas'?createCanvas(180,90):{};
 return Object.assign(e,{value:'',checked:false,hidden:false,disabled:false,children:[],style:{setProperty(){}},classList:{toggle(){}},
  setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
  addEventListener(type,fn){this['on'+type]=fn;},click(){if(!this.disabled)this.onclick?.();},focus(){},closest(){return null;}});
}
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
const cells=Array.from({length:100},(_,i)=>{const x=i%10+1,y=Math.floor(i/10)+1;return {x,y,level:0,px:30*(x-y)+300,py:15*(x+y),land:0,usable:x>1,cameraCoverage:y<10?1:0};});
const lookup=new Map(cells.map(c=>[`${c.x},${c.y}`,c])),data={metadata:{sourceSha256:'fixture',waypoints:{0:'2003',1:'4005',7:'7008',8:'2002',26:'3003',2:'-1',3:'2003oops',4:'999999'}},rendering:{width:600,height:330,origin:[300,0],cameraRect:[0,0,600,300]}};
const state={data,cells,lookup,image:createCanvas(600,330),x:0,y:0,scale:1},area={x:0,y:0,w:600,h:330};
const display={baselineNumerator:1n,get:()=>({numerator:1n})};
const stored=R.defaults();stored.regions[0].cells.add(R.key(cells[0]));delete stored.selectionBoundsVersion;
const storageKey='crate-atlas.regions.v1.fixture';memory.set(storageKey,R.encode(stored));
$('regionTool').value='brush-ellipse';$('regionOperation').value='add';$('regionWidth').value=$('regionHeight').value='1';$('regionSort').value='all.total';$('players').checked=true;
$('dynamicRegionTitles').checked=true;
const context={CrateRegionStatistics:R,CrateRegionAuto:require('./region-auto.js'),AbortController,performance,CrateRegionLabelLayout:require('./region-label-layout.js'),CrateRegionTitleControls:{create:()=>({settings:{...require('./region-label-layout.js').defaults,insetEnabled:false,lazy:false,returnMargin:0,maxShrink:0}})},CrateMapRenderer:M,CratePlayerStarts:P,Path2D,console,
 document:{getElementById:$,createElement:element,createTextNode:s=>s,addEventListener:(k,v)=>listeners[k]=v,activeElement:null,querySelector(){return null;}},
 window:{addEventListener:(k,v)=>windowListeners[k]=v},localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},setTimeout:()=>1,clearTimeout(){}};
vm.createContext(context);vm.runInContext(fs.readFileSync('region-overlay-cache.js','utf8'),context);vm.runInContext(fs.readFileSync('region-thumbnails.js','utf8'),context);vm.runInContext(fs.readFileSync('region-statistics-ui.js','utf8'),context);
let pointedCell=cells[0];
const ui=context.CrateRegionStatisticsUI.create({getState:()=>state,getDisplay:()=>display,schedule(){},pick:()=>pointedCell,area,onMode(){}});
data.cells=cells;data.regionNavigation={version:context.CrateRegionAuto.navigationVersion,count:cells.length,flags:Buffer.alloc(cells.length,17).toString('base64')};
const settleFill=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
(async()=>{
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
$('regionUndo').click();assert.equal(snapshot().transparency,80);$('regionRedo').click();assert.equal(snapshot().transparency,25);
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
// Undo region edits without restoring independent view/tool preferences.
resetSelection();chooseTool('brush-game');clickCell(a);
$('regionShowTotals').click();assert.equal(snapshot().showTotals,false);
$('regionToolbarOptions').children.find(e=>e.value==='r2').onclick();chooseTool('fill');$('regionOperation').value='remove';$('regionWidth').value='5';
$('regionUndo').click();assert.equal(snapshot().showTotals,false);assert.equal(snapshot().active,'r2');assert.equal(snapshot().regions[0].cells.length,0);
assert.equal($('regionTool').value,'fill');assert.equal($('regionOperation').value,'remove');assert.equal($('regionWidth').value,'5');
$('regionShowTotals').click();$('regionRedo').click();assert.equal(snapshot().showTotals,true);assert.equal(snapshot().active,'r2');assert(snapshot().regions[0].cells.includes(ka));
resetSelection();chooseTool('brush-game');$('regionOperation').value='add';$('regionWidth').value='1';pointedCell=a;ui.down(point(a));$('regionShowTotals').click();ui.cancel();assert.equal(snapshot().showTotals,false,'Cancel also preserves the latest title setting');
console.log('PASS undo/redo/cancel preserve title visibility, current target, brush, operation and size');
const sample=R.defaults();sample.overlap=true;sample.active='r2';sample.regions[0].cells.add(ka);sample.regions[2].cells.add(ka);sample.regions[1].cells.add(kb);
resetSelection(sample);chooseTool('brush-circle');const membership=members(snapshot());
$('regionEyedropper').click();assert.equal($('regionTool').value,'picker');
clickCell(a);assert.equal(snapshot().active,'r3','Sample the topmost region when current region is absent.');
assert.equal($('regionTool').value,'brush-circle','Successful picker restores the last non-picker tool.');
assert.deepEqual(members(snapshot()),membership,'Sampling must never paint.');
clickCell(b,mods(false,true));assert.equal(snapshot().active,'r2');assert.deepEqual(members(snapshot()),membership);
assert.equal($('regionUndo').disabled,true,'Sampling does not create undo entries.');
chooseTool('picker');clickCell(c);assert.equal(snapshot().active,R.EMPTY);assert.equal($('regionTool').value,'brush-circle','Sampling Empty restores the previous brush.');
chooseTool('picker');pointedCell=a;ui.down(point(a),mods());ui.move(point(b),false,mods());ui.up();assert.equal(snapshot().active,R.EMPTY,'Dragging in picker must not sample.');
assert.deepEqual(members(snapshot()),membership);
$('regionEyedropper').click();assert.equal($('regionTool').value,'brush-circle');
// Empty is a persistent erase target, not a thirteenth statistics region.
assert.equal(snapshot().regions.length,12);assert.equal($('regionOptions').children[0].value,R.EMPTY);
assert.ok($('regionName').disabled&&$('regionColor').disabled&&$('regionDelete').disabled&&$('regionClear').disabled);
ui.load();assert.equal(snapshot().active,R.EMPTY,'Empty selection survives reload.');
for(const brush of ['brush-screen','brush-game','brush-circle','brush-ellipse','box-screen','box-game','fill'])for(const operation of ['add','remove'])for(const shift of [false,true]){
 const erase=R.decode(R.encode(sample),new Map(cells.map(cell=>[R.key(cell),cell])));erase.active=R.EMPTY;
 resetSelection(erase);chooseTool(brush);$('regionOperation').value=operation;clickCell(a,mods(shift));if(brush==='fill')await settleFill();
 const erased=snapshot();assert.ok(erased.regions.every(r=>!r.cells.includes(ka)),`${brush}/${operation}/${shift}: erase every overlapping membership`);
 assert.ok(erased.regions[1].cells.includes(kb),'Unhit cells are preserved.');
 $('regionUndo').click();assert.deepEqual(members(snapshot()),members(JSON.parse(R.encode(erase))));
 $('regionRedo').click();assert.deepEqual(members(snapshot()),members(erased));
}
resetSelection({...sample,active:R.EMPTY});chooseTool('brush-game');pointedCell=a;ui.down(point(a),mods());ui.cancel();
assert.deepEqual(members(snapshot()),membership,'Cancel restores all erased memberships.');
clickCell(c,mods(false,true));assert.equal(snapshot().active,R.EMPTY);assert.equal($('regionTool').value,'brush-game');
chooseTool('picker');clickCell(cells[0]);assert.equal(snapshot().active,R.EMPTY);assert.equal($('regionTool').value,'brush-game','An unselectable cell samples Empty and restores the previous tool.');
console.log('PASS: Empty picker, persistence, all brushes/boxes/fill, overlapping erasure, both operations/Shift, undo/redo/cancel.');
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
// Fill is an atomic click tool. Drag/cancel cannot merge, and Ctrl still picks.
const fillDoc=R.defaults();fillDoc.autoHandled=true;fillDoc.regions[1].cells=new Set([ka,R.key(lookup.get('6,5')),kb]);
resetSelection(fillDoc);chooseTool('fill');clickCell(a);await settleFill();let filled=snapshot();
assert.ok(filled.regions[0].cells.includes(ka));assert.ok(filled.regions[0].cells.includes(R.key(lookup.get('6,5'))));assert.ok(!filled.regions[0].cells.includes(kb));
assert.ok(filled.regions[1].cells.includes(kb));assert.ok(!filled.regions[1].cells.includes(ka));
$('regionUndo').click();assert.equal(snapshot().regions[0].cells.length,0);$('regionRedo').click();assert.deepEqual(snapshot().regions,filled.regions);
clickCell(a,mods(true));await settleFill();assert.equal(snapshot().regions[0].cells.length,0,'Shift fill removes only the current connected part');
resetSelection(fillDoc);chooseTool('fill');pointedCell=a;ui.down(point(a),mods());pointedCell=b;ui.move(point(b),false,mods());ui.up();assert.equal(snapshot().regions[0].cells.length,0,'Dragging cannot fill');
pointedCell=a;ui.down(point(a),mods());ui.cancel();assert.equal(snapshot().regions[0].cells.length,0,'Cancel cannot fill');
clickCell(a,mods(false,true));assert.equal(snapshot().active,'r2');assert.equal($('regionTool').value,'fill','Ctrl sampling restores fill');
console.log('PASS: connected fill, atomic undo/redo, Shift removal, drag/cancel safety and Control picker.');
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

// Web artwork is resized, while regions and player starts keep native map pixels.
// Both thumbnails must agree with a full-resolution source, including different
// X/Y resize ratios caused by integer image dimensions.
const pattern=createCanvas(600,330),patternCtx=pattern.getContext('2d');
patternCtx.fillStyle='#153d6d';patternCtx.fillRect(0,0,600,330);
patternCtx.fillStyle='#d17628';patternCtx.fillRect(300,0,300,330);
patternCtx.fillStyle='#2ca86f';patternCtx.fillRect(200,90,200,150);
const resized=createCanvas(240,99);resized.getContext('2d').drawImage(pattern,0,0,240,99);
const regionFixture=R.defaults();regionFixture.regions[0].cells=new Set(['5,5','5,6','6,5'].map(k=>R.key(lookup.get(k))));
$('players').checked=false;$('objects').checked=false;state.image=pattern;
resetSelection(regionFixture);ui.setMode(true);
const thumbnailPixels=()=>$('regionRows').children[0].children[1].children.map(button=>{
 const cv=button.children[0];return cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
});
const referenceThumbs=thumbnailPixels();
for(const button of $('regionRows').children[0].children[1].children){const cv=button.children[0],ctx=cv.getContext('2d');for(const [x,y]of [[0,0],[cv.width-1,0],[0,cv.height-1],[cv.width-1,cv.height-1]])assert.notDeepEqual([...ctx.getImageData(x,y,1,1).data].slice(0,3),[10,21,30],'Thumbnail content fills the frame without an artificial margin');}
for(const useObjects of [false,true]){
 state.image=useObjects?pattern:resized;state.objectImage=useObjects?resized:null;$('objects').checked=useObjects;
 ui.load({preserve:true});const actualThumbs=thumbnailPixels();
 for(let i=0;i<2;i++){
  const delta=actualThumbs[i].reduce((sum,value,j)=>sum+Math.abs(value-referenceThumbs[i][j]),0)/actualThumbs[i].length;
  assert.ok(delta<1.5,`${i?'Overview':'Terrain crop'} must use native-to-artwork coordinates; mean pixel difference ${delta}`);
 }
}
console.log('PASS: terrain crop / overview align for native and resized ground/object artwork.');
// A live shape/elevation change must match a complete region reload. Ordinary
// occupancy/probability edits retain geometry and the resident overlay.
const beforeShapeCells=state.cells;
resetSelection(regionFixture);ui.setMode(true);ui.leave();
const regionPixels=()=>{const cv=createCanvas(600,330);ui.render(cv.getContext('2d'),state);return cv.toBuffer('image/png');};
const oldRegionPixels=regionPixels(),changedShape={...lookup.get('5,5'),py:135,level:1,visibleSurface:[[[0,-15],[30,0],[0,15]]]};
state.cells=state.cells.map(c=>c.x===5&&c.y===5?changedShape:c);ui.updateCells([changedShape]);
const localShapePixels=regionPixels();assert.notDeepEqual(localShapePixels,oldRegionPixels);
ui.load({preserve:true});ui.leave();assert.deepEqual(regionPixels(),localShapePixels,'Live geometry must match a full reload');
state.cells=beforeShapeCells;ui.load({preserve:true});ui.leave();
console.log('PASS: local terrain geometry/elevation changes invalidate region pixels without relying on a full reload.');
 const A=require('./region-auto.js'),D=require('./probability-display.js');context.CrateRegionAuto=A;context.CrateProbabilityDisplay=D;context.AbortController=AbortController;
 data.cells=cells;data.probability={exact:{denominator:'100'}};data.regionNavigation={version:A.navigationVersion,count:cells.length,flags:Buffer.alloc(cells.length,17).toString('base64')};
 const empty=R.defaults();empty.autoHandled=true;resetSelection(empty);ui.setMode(true);const colors=snapshot().regions.map(r=>r.color);
 await ui.autoPartition();let automatic=snapshot();assert.ok(automatic.regions.some(r=>r.cells.length));
 assert.deepEqual(automatic.regions.slice(0,3).map(r=>r.generatedName.number),[1,2,8]);assert.deepEqual(automatic.regions.map(r=>r.color),colors);
 $('regionUndo').click();assert.ok(snapshot().regions.every(r=>!r.cells.length));assert.equal(snapshot().autoHandled,true,'Undoing auto partition must not trigger auto again on reload');$('regionRedo').click();
 const ops=[],measurer=createCanvas(1,1).getContext('2d'),fake={save(){},restore(){},beginPath(){},rect(){},clip(){},measureText(text){measurer.font=this.font;return measurer.measureText(text);},strokeText(text,x,y){ops.push({text,color:this.strokeStyle,width:this.lineWidth,font:this.font,alpha:this.globalAlpha,x,y});},fillText(){}};
 const labelViewport={x:0,y:0,w:1400,h:800};
 ui.labels(fake,{x:0,y:0,scale:1},labelViewport);assert.ok(ops.length>0);assert.equal(ops[0].color,'#fff');assert.equal(ops[1].color,'#050a0b');assert.ok(ops[0].width>ops[1].width);
 const title=ops[0].text,font=Number(ops[0].font.split(' ')[1].slice(0,-2)),reg=automatic.regions.find(r=>R.displayName(r)+':'===title);
 const maximumFont=.74*2*Math.min(34,14+Math.sqrt(reg.cells.length)*.72);assert(font>0&&font<=maximumFont,'Titles respect both visible-cell sizing and projected region bounds');
 for(const scale of [.5,2]){
  ops.length=0;ui.labels(fake,{x:0,y:0,scale},labelViewport);
  const label=ops.find(op=>op.text===title);
  const currentFont=Number(label.font.split(' ')[1].slice(0,-2));assert(currentFont<=maximumFont);assert(scale<1?currentFont<=font:currentFont>=font);
  assert.equal(label.alpha,scale>1?.78:1);
 }
 ops.length=0;ui.labels(fake,{x:5000,y:5000,scale:1});assert.equal(ops.length,0);
 $('dynamicRegionTitles').checked=false;ops.length=0;ui.labels(fake,{x:0,y:0,scale:1},labelViewport);const staticAnchor=ops.find(op=>op.text===title);
 ops.length=0;ui.labels(fake,{x:25,y:10,scale:1},labelViewport);const staticPanned=ops.find(op=>op.text===title);assert.equal(staticPanned.x,staticAnchor.x+25);assert.equal(staticPanned.y,staticAnchor.y+10);assert.equal(staticPanned.alpha,1,'Static titles have no relocation/fade animation');$('dynamicRegionTitles').checked=true;
 let clock=0;context.performance={now:()=>clock};
 const animatedTitle=()=>{ops.length=0;ui.labels(fake,state,labelViewport);return ops.find(op=>op.text===title);};
 assert.equal(animatedTitle(),undefined,'Zero-alpha title frames do not submit invisible glyphs');
 clock=100;assert.equal(animatedTitle().alpha,.5);
 clock=200;const start=animatedTitle();assert.equal(start.alpha,1);
 const initialX=state.x;state.x+=80;
 clock=210;const accelerating=animatedTitle();assert.equal(accelerating.x,start.x+80,'Camera panning transports the title with no lag');
 state.x+=80;clock=245;const throttled=animatedTitle();
 assert.equal(throttled.x,accelerating.x+80,'Repeated pan frames preserve the original world anchor');
 state.scale=1.2;
 clock=248;const following=animatedTitle();clock=264;assert.equal(animatedTitle().x,following.x,'No extra chasing animation runs between camera updates');
 state.scale=1;state.x=initialX;
 clock=1000;animatedTitle();
 state.x=5000;clock=1010;assert.equal(animatedTitle(),undefined);
 state.x=initialX;clock=1020;assert.equal(animatedTitle(),undefined,'Re-entry waits for a constrained anchor instead of flashing the old title');
 clock=1120;assert.equal(animatedTitle(),undefined);clock=1220;assert.equal(animatedTitle().alpha,.5);
 clock=1320;assert.equal(animatedTitle().alpha,1);
 delete context.performance;
 console.log('PASS: rigid map following, no between-frame chasing, final-anchor re-entry and 200 ms fade.');
 const frozen=ui.snapshotLayer();ops.length=0;frozen.labels(fake,{x:0,y:0,scale:1,cells});const expected=JSON.stringify(ops);
 $('regionClear').click();ops.length=0;frozen.labels(fake,{x:0,y:0,scale:1,cells});assert.equal(JSON.stringify(ops),expected,'Export labels freeze totals and placement');
 const partial=R.defaults();partial.autoHandled=true;partial.regions[0].cells=new Set(['5,5','7,3','8,8'].map(k=>R.key(lookup.get(k))));resetSelection(partial);ui.setMode(true);
 const partialViewport={x:325,y:0,w:1000,h:220};
 function titleBox(viewport=partialViewport,view={...state}){
  ops.length=0;ui.labels(fake,view,viewport);if(!ops.length)return null;
  const name=ops[0],probability=ops[2],size=Number(probability.font.split(' ')[1].slice(0,-2));
  measurer.font=probability.font;const right=probability.x+measurer.measureText(probability.text).width;
  measurer.font=name.font;const metrics=measurer.measureText(name.text);
  return {size,x:(name.x+right)/2,y:name.y-(metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2,
   margin:(right-name.x)/2+3+size*.11};
 }
 const both=titleBox();assert(both.size<=2*(14+Math.sqrt(2)*.72),'Projected bounds cap the visible-cell font size');
 const one=titleBox({...partialViewport,x:331});assert(one.size<=2*(14+.72),'Offscreen cells do not contribute to title size');
 assert(both.x>=partialViewport.x+both.margin-1e-6,'The title remains fully within the viewport after the region-size cap');
 assert(Math.abs(both.y-150)<1e-6);
 assert(Math.abs(both.x-420)/30+Math.abs(both.y-150)/15<=1+1e-6,'The relocated title anchor stays on its own terrain polygon');
 let motionClock=0;context.performance={now:()=>motionClock};
 const anchored=viewport=>titleBox(viewport,state);
 anchored(labelViewport);motionClock=200;const original=anchored(labelViewport);
 // While the size interpolates, hinted glyph widths can round by a fraction
 // of a pixel; the separately tested world anchor itself remains unchanged.
 motionClock=210;assert(Math.abs(anchored(partialViewport).x-original.x)<.1);
 motionClock=259;assert(Math.abs(anchored(partialViewport).x-original.x)<.1,'No new anchor is selected before the viewport has been still for 50 ms');
 motionClock=260;const inFlight=anchored(partialViewport);assert(Math.abs(inFlight.x-original.x)<.1,'Keep the old anchor until the final relocation starts');
 for(motionClock=276;motionClock<=3000;motionClock+=16)anchored(partialViewport);
 assert(Math.abs(anchored(partialViewport).x-both.x)<1e-6);
 delete context.performance;
 const corner=R.defaults();corner.autoHandled=true;corner.regions[0].cells.add(R.key(lookup.get('5,5')));resetSelection(corner);
 assert.equal(titleBox({x:325,y:0,w:1000,h:140}),null,'A diamond bounding-box corner is not a visible cell');
 const originalCells=state.cells;
 const concave={...lookup.get('5,5'),visibleSurface:[[[-30,-15],[30,-15],[30,-8],[-15,-8],[-15,8],[30,8],[30,15],[-30,15]]]};
 state.cells=originalCells.map(c=>R.key(c)===R.key(concave)?concave:c);resetSelection(corner);
 const onConcave=title=>title&&title.x>=270-1e-6&&title.x<=330+1e-6&&title.y>=135-1e-6&&title.y<=165+1e-6&&(title.x<=285+1e-6||title.y<=142+1e-6||title.y>=158-1e-6);
 assert(onConcave(titleBox(labelViewport)),'The original center is projected out of a concave hole onto its own surface');
 $('dynamicRegionTitles').checked=false;
 assert(onConcave(titleBox(labelViewport)),'Static labels also retain an in-region anchor');
 $('dynamicRegionTitles').checked=true;
 assert.equal(titleBox({x:325,y:0,w:1000,h:300}),null,'A five-pixel visible sliver cannot fit a title');
 const edgeTitle=titleBox({x:1160,y:0,w:1000,h:1300},{...state,x:0,y:0,scale:4});assert(edgeTitle);
 assert(edgeTitle.x>=1160);
 assert(edgeTitle.y<=568+1e-6||edgeTitle.y>=632-1e-6,'A clipped concave surface cannot anchor a title in the gap between its visible pieces');
 state.cells=originalCells;ui.load();
 console.log('PASS: visible-cell size caps, closest in-region anchors, stationary-camera gating and fixed-position fades.');
 console.log('PASS: automatic player names/colors, undo/redo, once-only handling, probability labels, double outlines, zoom and immutable export labels.');
 // A large partition must keep two genuinely unused slots (not blocked player
 // placeholders); repeated partitioning must not keep growing the list.
 const partition=A.partition,waterCells=cells.filter(c=>R.canSelect(c,data.rendering)).slice(0,14);
 try{
  A.partition=async()=>({regions:waterCells.map((c,i)=>({kind:'water',number:i+1,keys:[R.key(c)]})),players:0,unassigned:0,unreachablePlayers:[],settings:A.options()});
  resetSelection(empty);await ui.autoPartition();const water=snapshot();
  assert.equal(water.regions.length,16);assert.equal(water.regions.filter(r=>!r.cells.length&&!r.generatedName).length,2);
  assert.equal(water.regions[6].name,'水域 7');assert.deepEqual(water.regions[6].generatedName,{kind:'water',number:7});
  assert.deepEqual(water.regions.slice(0,12).map(r=>r.color),colors);assert.equal(new Set(water.regions.map(r=>r.color)).size,16);
  $('regionUndo').click();assert.equal(snapshot().regions.length,12);$('regionRedo').click();assert.deepEqual(snapshot().regions,water.regions);
  ui.load();assert.deepEqual(snapshot().regions,water.regions,'Water names and spare regions survive autosave/reload');
  await ui.autoPartition();assert.equal(snapshot().regions.length,16,'Repartition reuses spare slots');
 }finally{A.partition=partition;}
 console.log('PASS: water names, >12 regions, two spare slots, palette preservation, undo/redo and persistence.');
})().catch(error=>{console.error(error);process.exitCode=1;});
