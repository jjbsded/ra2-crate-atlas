/* Static 3D: immutable exact data, bridge layers, touch, picking and lifetime. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {createCanvas}=require('@napi-rs/canvas'),{patch}=require('./toy/terrain3d-patch.js'),art=require('./toy/terrain-artwork.js'),codec=require('./toy/static-codec.js');
const folder=process.env.TOY_ROOT||'output/toy-official-3d',out='output/toy-3d-qa';fs.mkdirSync(out,{recursive:true});
const canvas=()=>createCanvas(64,64);
async function load(file){const read=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)));return codec.report(read(file),n=>read(path.resolve(path.dirname(file),n)));}
async function modelChecks(){
 const cells=[];for(let x=0;x<5;x++)for(let y=0;y<5;y++)cells.push({x,y,level:x===4?4:0,slope:0,rawLand:0,land:0,postLand:0,higher:[],status:'crate',probability:.01,overlay:255,occupied:false});
 const low=cells.find(c=>c.x===3&&c.y===2);Object.assign(low,{higher:[[4,2,4]],land:7,postLand:3,marked:true});
 for(const c of cells.filter(c=>c.x===2))Object.assign(c,{bridge:{kind:'high',deckLevel:4},rawLand:2});
 cells[0].terrain='TREE01';cells[1].overlayName='TIB01';cells[2].terrain='TIBTRE02';cells[3].slope=13;
 const d={metadata:{theater:'SNOW',cliffBackImpassability:2},cells,rendering:{simplified:{objects:[[2,2,4,'soldier',1,1,0]]}}},before=JSON.stringify(d);
 for(const theater of Object.keys(art.palettes)){
  const data={...d,metadata:{...d.metadata,theater}},p=patch(data,low,{radius:15,canvas});
  assert.equal(p.cells.length,25);assert.deepEqual(p.cells.find(c=>c.x===4&&c.y===2).affected,[[3,2,0]]);
  assert.equal(p.cells.find(c=>c.marked).canPlace,true);assert.deepEqual(p.cells.find(c=>c.slope===13).corners,[0,1,2,1]);
  const bridge=p.cells.find(c=>c.x===2&&c.y===2),deck=bridge.decorations.find(d=>d.bridge);
  assert.equal(bridge.level,0);assert.equal(deck.level,4);assert.deepEqual(deck.rails,[1,3],'Both lateral edges of the span have rails');
  assert.equal(bridge.decorations.find(d=>d.anchor).anchor.level,4);
  assert.equal(p.cells.find(c=>c.terrain==='TIBTRE02').decorations[0].texture,'icon:drill');
  assert.ok(Object.values(p.textures).every(t=>t.width===64&&t.height===64));
  assert.ok(p.cells.every(c=>c.probability===.01));
 }
 assert.equal(JSON.stringify(d),before);
 const cleared=structuredClone(d);delete cleared.cells[0].terrain;delete cleared.cells[1].overlayName;
 const clearPatch=patch(cleared,low,{canvas});assert.ok(!clearPatch.textures['icon:tree']&&!clearPatch.textures.ore&&clearPatch.textures['icon:drill']);
 const disabled=patch({...d,metadata:{...d.metadata,cliffBackImpassability:0}},low,{canvas});assert.ok(disabled.cells.every(c=>!c.higher.length&&!c.affected.length&&!c.canPlace));
 const abort=new AbortController();abort.abort();assert.throws(()=>patch(d,low,{canvas,signal:abort.signal}),{name:'AbortError'});
 for(const id of ['b66dc28891b9c3d09b86-yr','f1d9bb89e2eb07cdb7af-yr','036e439c07cbb98efef9-yr'])for(const state of ['ore','clear']){
  const data=await load(path.join(folder,'data',id,state,'result.json.gz')),before=JSON.stringify(data),c=data.cells.find(c=>c.bridge?.kind==='high')||data.cells.find(c=>c.marked),p=patch(data,c,{radius:15,canvas});
  assert.ok(p.cells.length<=961);for(const a of p.cells){const b=data.cells.find(c=>c.x===a.x&&c.y===a.y);for(const key of ['probability','marked','potentialMarked','level','postLand','higher'])assert.deepEqual(a[key],b[key]);}
  assert.equal(JSON.stringify(data),before);
 }
 console.log('PASS static patches: six climates, slopes, both bridge rails/layers, exact flags/probabilities, ore/tree states, cancellation, immutable reports.');
}
async function browserChecks(){
 const {chromium,devices}=require('playwright'),browser=await chromium.launch({channel:'msedge',headless:true}),summary={};
 const base=process.env.TOY_URL||'http://127.0.0.1:8788/toy/crate-atlas/';
 try{for(const mobile of [false,true]){
  const context=await browser.newContext(mobile?{...devices['iPhone 13'],locale:'zh-CN'}:{viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[],apis=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))apis.push(r.url());});
  const ready=()=>page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,{timeout:60000});
  const viewed=async()=>{await page.waitForFunction(()=>!document.getElementById('terrain3dStage').classList.contains('is-loading'));assert.equal(await page.locator('#terrain3dError').textContent(),'');await page.waitForTimeout(100);};
  await page.goto(base+'maps.html?result=data%2Fb66dc28891b9c3d09b86-yr%2Fore%2Fresult.json.gz');await ready();
  await page.addScriptTag({url:'lib/three-r160.min.js'});
  await page.evaluate(()=>{
   const Original=THREE.WebGLRenderer;window.qaRenderers=[];THREE.WebGLRenderer=class extends Original{constructor(o){super(o);qaRenderers.push(this);window.qaRenderer=this;const render=this.render.bind(this);this.render=(scene,camera)=>{window.qaScene=scene;window.qaCamera=camera;render(scene,camera);};}};
   const original=CrateToyTerrain3D.patch;CrateToyTerrain3D.patch=(...args)=>{window.qaPatch=original(...args);return qaPatch;};
  });
  await page.locator('#terrain3dOpen').click();await viewed();
  assert.equal(await page.locator('#terrain3dProbability').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#terrain3dRadius').inputValue(),'10');
  assert.equal(await page.locator('#terrain3dRelief').isVisible(),false);
  const initial=await page.evaluate(()=>({x:CrateMapViewer.state.selected.x,y:CrateMapViewer.state.selected.y}));
  assert.deepEqual(await page.evaluate(()=>qaPatch.center),[initial.x,initial.y]);
  // Project an actual batched triangle into screen space and use the same
  // raycaster to choose the frontmost visible cell. Click must report it back.
  const pick=await page.evaluate(()=>{
   const mesh=qaScene.children.flatMap(g=>g.children).find(m=>m.userData.faceCells?.length),g=mesh.geometry.attributes.position;
   for(let i=0;i<mesh.userData.faceCells.length;i++){
    const c=mesh.userData.faceCells[i];if(c.x===CrateMapViewer.state.selected.x&&c.y===CrateMapViewer.state.selected.y)continue;
    const p=new THREE.Vector3();for(let j=0;j<3;j++)p.add(new THREE.Vector3().fromBufferAttribute(g,i*3+j));p.multiplyScalar(1/3).project(qaCamera);
    if(Math.abs(p.x)>.8||Math.abs(p.y)>.7)continue;
    const ray=new THREE.Raycaster();ray.setFromCamera(p,qaCamera);const hit=ray.intersectObjects(qaScene.children.flatMap(g=>g.children).filter(m=>m.parent.visible&&(m.userData.faceCells||m.userData.cell)),false)[0];if(!hit)continue;
    const target=hit.object.userData.faceCells?.[hit.faceIndex]||hit.object.userData.cell,r=document.getElementById('terrain3dCanvas').getBoundingClientRect();return{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2,target:[target.x,target.y]};
   }
  });assert.ok(pick);await page.mouse.click(pick.x,pick.y);
  assert.deepEqual(await page.evaluate(()=>[CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y]),pick.target,'Batched triangles retain per-cell picking');
  if(mobile)await page.locator('#toy3dControls>summary').click();
  await page.locator('#terrain3dProbability').click();assert.equal(await page.locator('#terrain3dProbability').getAttribute('aria-pressed'),'true');
  await page.locator('#terrain3dRadius').selectOption('15');await viewed();
  assert.equal(await page.evaluate(()=>qaPatch.radius),15);
  await page.locator('#terrain3dProbability').click();
  await page.locator('#terrain3dReset').click();
  if(mobile)await page.locator('#toy3dControls>summary').click();
  const selected=await page.evaluate(()=>[CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y]);
  let r=await page.locator('#terrain3dCanvas').boundingBox();await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.65,r.y+r.height*.6,{steps:8});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>[CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y]),selected,'Dragging does not select');
  if(mobile){
   await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);r=await page.locator('#terrain3dCanvas').boundingBox();assert.ok(r.height>=220,'Landscape retains a useful canvas');
   const cdp=await context.newCDPSession(page),x=r.x+r.width/2,y=r.y+r.height/2;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-45,y,id:1},{x:x+45,y,id:2}]});
   for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-45-i*5,y:y+i*2,id:1},{x:x+45+i*9,y:y+i*2,id:2}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.deepEqual(await page.evaluate(()=>[CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y]),selected,'Pinch never selects');
  }
  const metrics=await page.evaluate(()=>({calls:qaRenderer.info.render.calls,geometries:qaRenderer.info.memory.geometries,textures:qaRenderer.info.memory.textures,cells:qaPatch.cells.length}));
  assert.ok(metrics.calls<700,'Shared static materials are batched');
  await page.locator('#terrain3dDialog').screenshot({path:path.join(out,mobile?'mobile-landscape-3d.png':'desktop-3d.png')});
  // Three.js retains its internal shared sprite quad; every patch geometry and
  // texture must be released, including those from earlier radius changes.
  await page.locator('#terrain3dClose').click();await page.waitForFunction(()=>qaRenderers.every(r=>r.info.memory.geometries<=1&&r.info.memory.textures===0));
  // A bridge patch loaded from the same existing compressed report, with no
  // service calls. The ore/tree pair also reuses the shared main-map loader.
  const catalog=await page.evaluate(()=>CrateMapPlatform.catalog());
  const report=catalog.maps.flatMap(e=>Object.values(e.variants)).find(v=>v.reports.ore.includes('036e439c07cbb98efef9-yr')).reports.ore;
  await page.evaluate(url=>CrateMapViewer.loadResult(url),report);await ready();
  await page.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.cells.find(c=>c.bridge?.kind==='high')));
  await page.locator('#terrain3dOpen').click();await viewed();
  assert.ok(await page.evaluate(()=>qaPatch.cells.some(c=>c.decorations.some(d=>d.bridge==='high'&&d.level>c.level))));
  if(mobile)await page.locator('#toy3dControls>summary').click();
  await page.locator('#terrain3dReset').click();await page.locator('#terrain3dDialog').screenshot({path:path.join(out,mobile?'mobile-bridge.png':'desktop-bridge.png')});
  await page.locator('#terrain3dClose').click();
  const clear=await page.evaluate(()=>CrateMapPlatform.minerals(CrateMapViewer.state.baseUrl+'result.json.gz',false));
  await page.evaluate(url=>CrateMapViewer.loadResult(url),clear);await ready();await page.locator('#terrain3dOpen').click();await viewed();
  assert.ok(await page.evaluate(()=>qaPatch.metadata.treesEnabled===false&&!qaPatch.textures['icon:tree']&&!qaPatch.textures.ore&&!qaPatch.textures.gems));
  await page.locator('#terrain3dClose').click();
  await page.evaluate(()=>{THREE.WebGLRenderer=class{constructor(){throw Error('Error creating WebGL context.');}};});
  await page.locator('#terrain3dOpen').click();await page.waitForFunction(()=>!document.getElementById('terrain3dStage').classList.contains('is-loading'));
  assert.match(await page.locator('#terrain3dError').textContent(),/WebGL/);await page.locator('#terrain3dClose').click();
  assert.equal(await page.locator('#map').isVisible(),true,'WebGL failure leaves the 2D map usable');
  assert.deepEqual(errors,[]);assert.deepEqual(apis,[]);summary[mobile?'mobile':'desktop']=metrics;await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(summary,null,2));console.log('PASS browser 3D:',summary);
}
(async()=>{await modelChecks();if(!process.argv.includes('--model-only'))await browserChecks();})().catch(e=>{console.error(e);process.exitCode=1;});
