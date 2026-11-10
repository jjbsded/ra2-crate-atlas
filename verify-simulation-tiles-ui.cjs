/* Native recovery from a lost ground checkpoint and live minimap pixel updates. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
// Ground-reference reuse requires an object-free, single-level tile. A saved
// battle scene can legitimately have no eligible tiles, so use a stock fixture.
const fixture=path.resolve('output/render-stage-qa/flat-checkpoints.map');fs.mkdirSync(path.dirname(fixture),{recursive:true});
const python=process.env.CRATE_TEST_PYTHON||path.resolve('output/CrateAtlas-Windows-x64-Simulation-20261104/runtime/python/python.exe');
execFileSync(python,['-B','-c',"from pathlib import Path; from map_test_fixtures import fixture; Path('output/render-stage-qa/flat-checkpoints.map').write_bytes(fixture(width=80,height=80))"]);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],packets=[];let dropped=false;
 p.on('pageerror',e=>errors.push(e.stack));
  await p.route('**/simulation-publication.js*',async route=>{const response=await route.fetch();let body=await response.text();
  body=body.replace('     const plan=result.plan||session.plans.get(result.revision);',
   "     if(!window.tilePlanMiss&&!result.plan){window.tilePlanMiss=true;session.plans.delete(result.revision);}\n     const plan=result.plan||session.plans.get(result.revision);");
  await route.fulfill({response,body});
 });
 await p.route('**/realmap-ui.js*',async route=>{const response=await route.fetch();let body=await response.text();
  const hook=`window.tileMini=()=>{const artwork=$('objects').checked&&state.objectImage?state.objectImage:state.image,entry=miniArtwork;if(!entry)return null;const actual=entry.image,c=document.createElement('canvas');c.width=actual.width;c.height=actual.height;const target=c.getContext('2d',{willReadFrequently:true}),r=navigationRendering(),scale=c.width/r.width,local={...state,x:-(r.offsetX||0)*scale,y:-(r.offsetY||0)*scale,scale};target.fillStyle='#101c25';target.fillRect(0,0,c.width,c.height);CrateMapArtwork.scene(target,local,state.data.rendering,{objects:$('objects').checked,objectOpacity:state.objectOpacity},{x:0,y:0,w:c.width,h:c.height});const a=actual.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let error=0,hash=2166136261;for(let i=0;i<a.length;i++){error+=Math.abs(a[i]-b[i]);hash=Math.imul(hash^a[i],16777619);}return {revision:entry.revision,expectedRevision:state.artworkRevision,meanError:error/a.length,hash:hash>>>0};};\n`;
  const overlayHook=`window.tileOverlay=()=>{const images=[],options={...mapOptions(),regionLayer:null,regionLabels:null,unitBuffLayer:null,players:false};for(const cached of [true,false]){const c=document.createElement('canvas');c.width=W*pixelRatio;c.height=H*pixelRatio;const target=c.getContext('2d',{willReadFrequently:true});target.setTransform(pixelRatio,0,0,pixelRatio,0,0);target.fillStyle='#101c25';target.fillRect(0,0,W,H);if(cached)mapViewCache.render(target,state,area,display,options);else CrateMapRenderer.render(target,state,area,display,options);images.push(target.getImageData(0,0,c.width,c.height).data);}let sum=0,large=0;for(let i=0;i<images[0].length;i++){const e=Math.abs(images[0][i]-images[1][i]);sum+=e;if(e>40)large++;}return {mean:sum/images[0].length,large:large/images[0].length};};\n`;
  body=body.replaceAll("small.getContext('2d')","small.getContext('2d',{willReadFrequently:true})");body=body.replace('  window.CrateMapViewer={state',overlayHook+hook+'  window.CrateMapViewer={state');await route.fulfill({response,body});
 });
 await p.route('**/api/maps/simulation-live/paint',async route=>{
  const response=await route.fetch(),body=await response.json();
  packets.push({plan:!!body.plan,requestedEcho:route.request().postDataJSON().planEcho,groundReused:body.groundReused,tileReused:body.tileReused,tiles:body.patches.length,mime:body.patches.map(t=>t.objects.slice(0,22))});
  if(!dropped&&body.plan&&body.patches.some(t=>t.groundKey&&t.ground)){for(const tile of body.patches)if(tile.groundKey)delete tile.ground;dropped=true;}
  await route.fulfill({response,json:body});
 });
 await p.goto((process.env.SIM_BASE||'http://127.0.0.1:8767/')+'maps.html');
 await p.locator('#version').evaluate(e=>e.value='yr');await p.locator('#mapFile').setInputFiles(fixture);
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&CrateMapViewer.state.data.metadata.filename==='flat-checkpoints.map'&&!CrateMapViewer.state.busy,null,{timeout:180000});await p.locator('#simulationPlaceTab').click();
 const ready=()=>p.waitForFunction(()=>{const v=CrateMapViewer;return v.state.liveEditing&&!v.simulation.waiting&&!v.simulation.computing&&!v.state.regionPending&&!v.state.unitBuffPending&&document.getElementById('mapBusy').hidden;},null,{timeout:120000});await ready();
 await p.locator('#simulationPlaceShape').selectOption('brush');await p.locator('#minimap').check();await p.locator('#objects').check();await p.locator('#map').scrollIntoViewIfNeeded();
 async function click(point){const xy=await p.evaluate(point=>{const v=CrateMapViewer,c=v.state.lookup.get(point.join(','));if(!c?.usable)throw Error('Missing fixture');v.state.scale=1.3;v.state.x=v.area.x+v.area.w/2-c.px*v.state.scale;v.state.y=v.area.y+v.area.h/2-c.py*v.state.scale;v.draw();const r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return [r.left+(v.area.x+v.area.w/2)*k,r.top+(v.area.y+v.area.h/2)*k];},point);await p.mouse.click(...xy);}
 const before=await p.evaluate(()=>{CrateMapViewer.draw();return tileMini();});
 const samples=[];
 for(const [label,point]of [['first',[80,80]],['next',[81,81]]]){
  await click(point);await ready();await p.evaluate(()=>CrateMapViewer.draw());const mini=await p.evaluate(()=>tileMini());
  assert.equal(mini.revision,mini.expectedRevision);assert(mini.meanError<.05,JSON.stringify(mini));assert.notEqual(mini.hash,before.hash);samples.push({label,...mini});
  const overlay=await p.evaluate(()=>tileOverlay());assert(overlay.mean<1.5&&overlay.large<.02,JSON.stringify(overlay));samples.at(-1).overlay=overlay;
 }
 assert(dropped,JSON.stringify({planMiss:await p.evaluate(()=>!!window.tilePlanMiss),packets}));assert(packets.some(p=>p.tileReused>0),'Retry returns a cached tile rather than repainting it');assert(packets.some(p=>p.groundReused>0),'Later edits acknowledge unchanged ground');
 assert(packets.some(p=>p.requestedEcho&&p.plan),'An expired client plan revision requests a complete plan');
 assert(packets.some(p=>!p.requestedEcho&&!p.plan),'Normal artwork packets omit the already-known complete plan');
 assert(packets.every(p=>p.mime.every(m=>m.startsWith('data:image/webp;'))));
 await p.locator('#minimapMinimize').click();
 for(const point of [[82,81],[83,81]]){await click(point);await ready();}
 await p.locator('#minimapMinimize').click();await p.evaluate(()=>CrateMapViewer.draw());
 const restored=await p.evaluate(()=>tileMini());assert.equal(restored.revision,restored.expectedRevision);assert(restored.meanError<.05,JSON.stringify(restored));samples.push({label:'restore-hidden-minimap',...restored});
 for(let i=0;i<4;i++){await p.locator('#simulationUndo').click();await ready();await p.evaluate(()=>CrateMapViewer.draw());const mini=await p.evaluate(()=>tileMini());assert.equal(mini.revision,mini.expectedRevision);assert(mini.meanError<.05);samples.push({label:'undo-'+i,...mini});}
 assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),0);assert.deepEqual(errors,[]);
 fs.mkdirSync('output/render-stage-qa',{recursive:true});fs.writeFileSync('output/render-stage-qa/tile-ui.json',JSON.stringify({status:'PASS',dropped,packets,samples},null,2));
 console.log('PASS native WebP, omitted-plan/ground recovery, same-revision replay cache, local minimap pixels and undo');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
