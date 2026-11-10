/* Actual pointer gestures exercise empty screen boxes and directional foundations. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const toy=process.env.SIM_EDITION==='toy',edition=toy?'toy':'full',base=process.env.SIM_BASE||'http://127.0.0.1:8769/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1400}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.route('**/region-statistics-ui.js*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('return {load,beforeLoad:','return root.__regionQA={get selectionPreview(){return stroke?.preview||[];},get document(){return doc;},load,beforeLoad:')});});
 await p.route('**/simulation-ui.js*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('return {shortcut,adjustSize,','return {get selectionPreview(){return stroke&&isBox(stroke.method)?selectionCells(stroke):[];},get targetPreview(){return stroke?.tool===\'place\'?[...placementTargets(stroke,null,null)]:[];},shortcut,adjustSize,')});});
 await p.goto(base+(toy?'index.html':'maps.html?result='+(process.env.SIM_RESULT||'/output/map-22309489b5d3/result.json')));
 const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy&&(CrateMapViewer.simulation.liveReady||!CrateMapViewer.simulation.pending&&!CrateMapViewer.simulation.computing)&&!CrateMapViewer.simulation.waiting&&!CrateMapViewer.state.regionPending,null,{timeout:120000});await ready();console.log(edition,'initial map ready');
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map',null,{timeout:120000});await ready();}
 await p.locator('#simulationPlaceTab').click();await p.locator('#minimap').uncheck();
 const patch=await p.evaluate(()=>{const v=CrateMapViewer,m=v.simulation.model;for(const c of v.state.cells){if(c.x<40||c.y<40||c.x>140||c.y>140||c.level!==0)continue;let ok=true;for(let x=0;x<11&&ok;x++)for(let y=0;y<11;y++)if(!m.placement('CAOILD',c.x+x,c.y+y).allowed){ok=false;break;}if(ok)return{x:c.x,y:c.y};}throw Error('No flat clear patch');});
 const view=async()=>{await p.locator('#map').scrollIntoViewIfNeeded();await p.evaluate(patch=>{const v=CrateMapViewer,c=v.state.lookup.get((patch.x+5)+','+(patch.y+5));v.state.scale=2;v.state.x=v.area.x+v.area.w/2-c.px*2;v.state.y=v.area.y+v.area.h/2-c.py*2;v.draw();},patch);};
 const at=(x,y,ox=0,oy=0)=>p.evaluate(({patch,x,y,ox,oy})=>{const v=CrateMapViewer,c=v.state.lookup.get((patch.x+x)+','+(patch.y+y)),b=document.getElementById('map').getBoundingClientRect(),k=Math.min(b.width/v.viewport.width,b.height/v.viewport.height);return{x:b.x+(b.width-v.viewport.width*k)/2+(v.state.x+(c.px+ox)*v.state.scale)*k,y:b.y+(b.height-v.viewport.height*k)/2+(v.state.y+(c.py+oy)*v.state.scale)*k};},{patch,x,y,ox,oy});
 const key=async k=>{await p.locator('#map').focus();await p.keyboard.press(k);};
 const object=async type=>{await p.locator('#simulationTool').selectOption('place',{force:true});await p.locator('#simulationObject').selectOption(type,{force:true});};
 const begin=async(a,b)=>{await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(b.x,b.y,{steps:3});};
 const end=async()=>{await p.mouse.up();await ready();};
 const plan=()=>p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.map(o=>({x:o.x,y:o.y})));
 const targets=()=>p.evaluate(()=>CrateMapViewer.simulation.targetPreview),selected=()=>p.evaluate(()=>CrateMapViewer.simulation.selectionPreview.map(c=>({x:c.x,y:c.y})));
 const undo=async()=>{await p.locator('#simulationUndo').click();await ready();};
 const tip=p.locator('#simulationCursorMode');fs.mkdirSync('output/selection-anchor-qa',{recursive:true});
 const compact=async(name)=>{await tip.waitFor({state:'visible'});const m=await tip.evaluate(e=>{const main=e.querySelector('.cursor-main'),children=[...main.children].filter(c=>!c.hidden),rect=main.getBoundingClientRect(),width=children.reduce((n,c)=>n+c.getBoundingClientRect().width,0)+(children.length-1)*parseFloat(getComputedStyle(main).gap);return{extra:rect.width-width,width:e.getBoundingClientRect().width,viewport:innerWidth,overflow:e.scrollWidth-e.clientWidth};});assert(m.extra<30,'No stretched empty header space: '+JSON.stringify(m));assert(m.width<=m.viewport-14);assert(m.overflow<2);await tip.screenshot({path:'output/selection-anchor-qa/'+edition+'-'+name+'.png'});};
 console.log(edition,'clear patch',patch);
 for(const type of ['MTNK','CAOILD']){
  await object(type);await key('w');await view();await begin(await at(2,6,-5,5),await at(6,2,5,7));
  assert.deepEqual(await selected(),[{x:patch.x+6,y:patch.y+2}],'Long thin empty box uses the end cell in the live preview');assert.deepEqual(await targets(),await selected(),'Single rubble uses its top foundation cell');await compact(type+'-fallback');console.log(edition,type,'fallback preview OK');await end();assert.deepEqual(await plan(),[{x:patch.x+6,y:patch.y+2}]);await undo();
 }
 // A release cell outside the center-selected set must not be added.
 await object('MTNK');await key('w');await view();await begin(await at(2,2,-5,-5),await at(4,4,0,-10));const nonempty=await selected();assert(nonempty.length>1);assert(!nonempty.some(c=>c.x===patch.x+4&&c.y===patch.y+4));const preview=await targets();await end();assert.deepEqual(await plan(),preview);await undo();
 await view();await begin(await at(2,6,-5,5),await at(6,2,5,7));await p.mouse.down({button:'right'});await p.mouse.up({button:'right'});await p.mouse.up();assert.deepEqual(await plan(),[],'Canceled fallback makes no edit');
 await object('MTNK');await key('q');await view();let q=await at(6,2);await p.mouse.click(q.x,q.y);await ready();
 await p.locator('#simulationTool').selectOption('magnet',{force:true});await key('w');await view();await begin(await at(2,6,-5,5),await at(6,2,5,7));assert.deepEqual(await selected(),[{x:patch.x+6,y:patch.y+2}],'Empty deletion boxes preview the same end cell');await end();assert.deepEqual(await plan(),[]);await undo();assert.equal((await plan()).length,1);await undo();assert.deepEqual(await plan(),[]);
 for(const type of ['CAOILD','GAPOWR'])for(const k of ['e','w'])for(const [a,b] of (k==='w'?[[[5,5],[9,5]],[[5,5],[5,1]],[[5,5],[5,9]],[[5,5],[1,5]]]:[[[3,3],[7,7]],[[7,7],[3,3]],[[3,7],[7,3]],[[7,3],[3,7]]])){
  await object(type);await key(k);await view();await begin(await at(...a),await at(...b));const expected=await targets();assert(expected.length);assert.deepEqual(await plan(),[],'Building preview is read-only');
  if(k==='w'){
   const gaps=await p.evaluate(({a,b,patch,type,expected})=>{const v=CrateMapViewer,lookup=v.state.lookup,first=lookup.get((patch.x+a[0])+','+(patch.y+a[1])),last=lookup.get((patch.x+b[0])+','+(patch.y+b[1])),sx=Math.sign(last.px-first.px),sy=Math.sign(last.py-first.py),f=v.simulation.model.choice(type).footprint;return expected.map(p=>{const cells=f.map(([x,y])=>lookup.get((p.x+x)+','+(p.y+y)));return[sx>0?Math.min(...cells.map(c=>c.px))-first.px:first.px-Math.max(...cells.map(c=>c.px)),sy>0?Math.min(...cells.map(c=>c.py))-first.py:first.py-Math.max(...cells.map(c=>c.py))];});},{a,b,patch,type,expected});
   assert(gaps.every(g=>g.every(n=>n>=-1e-6)),'Footprint centers respect both start sides');assert(gaps.some(g=>g[0]<30-1e-6||g[1]<15-1e-6),'Use center-selected edge cells without the old half-cell inset');
  }
  await end();const actual=await plan();assert.deepEqual(actual,expected,'All allowed preview anchors are committed');await undo();
 }
 console.log(edition,'placement anchors and cancellation OK');
 await key('3');await key('w');if(await p.locator('#regionColorOverlay').getAttribute('aria-pressed')!=='true')await p.locator('#regionColorOverlay').click();await view();
 const members=()=>p.evaluate(()=>[...__regionQA.document.regions.find(r=>r.id===__regionQA.document.active).cells]);const before=await members();
 await begin(await at(2,6,-5,5),await at(6,2,5,7));assert.deepEqual(await p.evaluate(()=>__regionQA.selectionPreview.map(c=>({x:c.x,y:c.y}))),[{x:patch.x+6,y:patch.y+2}]);await compact('region-fallback');await p.mouse.up();await p.waitForFunction(()=>!CrateMapViewer.regionRefresh.pending);const after=await members();assert(after.includes((patch.x+6)*1024+patch.y+2));
 if(!before.includes((patch.x+6)*1024+patch.y+2)){await p.locator('#regionUndo').click();await p.waitForFunction(()=>!CrateMapViewer.regionRefresh.pending);assert.deepEqual((await members()).sort((a,b)=>a-b),before.sort((a,b)=>a-b));}
 await view();await begin(await at(2,6,-5,5),await at(6,2,5,7));await p.keyboard.press('Escape');await p.mouse.up();assert.deepEqual((await members()).sort((a,b)=>a-b),before.sort((a,b)=>a-b),'Cancel does not apply a region fallback');
 // Native CSS must stay compact and visible in a narrow viewport too.
 await p.setViewportSize({width:420,height:850});await key('1');await object('MTNK');await key('w');await view();q=await at(5,5);await p.mouse.move(q.x,q.y);await compact('narrow-tip');
 assert.deepEqual(errors,[]);console.log('PASS',edition,'compact tooltips, empty-box preview/release, nonempty exclusion, top-aligned single cells, four-direction buildings/rubble, cancel and undo');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
