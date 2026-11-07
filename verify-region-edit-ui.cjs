/* Native edits of the real 24,902-cell land region and held-pan title settling. */
'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.addInitScript(()=>{window.editQA={record:false,geometry:[],frames:[],downAt:0,handlers:[],raf:[],follow:[]};const request=window.requestAnimationFrame;window.requestAnimationFrame=fn=>{const at=performance.now();return request.call(window,t=>{if(editQA.record)editQA.raf.push({at,run:performance.now()});fn(t);});};});
 await p.addInitScript(()=>document.addEventListener('pointermove',e=>{if(e.target.id==='map'&&(e.buttons&2))editQA.lastPanEvent=performance.now();},true));
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch(),body=await response.text();
  const hook=`
  const editGeometry=geometry;geometry=function(...args){const t=performance.now(),value=editGeometry(...args),ms=performance.now()-t;if(editQA.record&&ms>.1)editQA.geometry.push({ms,rebuilt:value.rebuiltTiles,total:value.tiles.length});return value;};
  const editLabels=labels;labels=function(ctx,view,viewport=area){const before=new Map([...titleMotion].map(([id,m])=>[id,{...m}])),value=editLabels(ctx,view,viewport);for(const [id,m]of titleMotion){const old=before.get(id);if(!old?.visible||!m.visible||old.appearedAt!==m.appearedAt)continue;const inside=old.x+old.halfWidth>=viewport.x&&old.x-old.halfWidth<=viewport.x+viewport.w&&old.y+old.halfHeight>=viewport.y&&old.y-old.halfHeight<=viewport.y+viewport.h;if(inside){const dt=Math.min(.05,Math.max(0,(m.frameAt-old.frameAt)/1000)),distance=Math.hypot(m.x-old.x,m.y-old.y);editQA.follow.push({dt,distance,camera:old.viewX!==m.viewX||old.viewY!==m.viewY||old.scale!==m.scale});}}return value;};
  window.editRegions={snapshot:()=>JSON.parse(R.encode(doc)),count:()=>current().cells.size,status:()=>({...refreshQueue?.status,...refreshWork}),motions:()=>[...titleMotion].map(([id,m])=>({id,...m,label:undefined})),leave:()=>{hover=null;},render,snapshotLayer,
   setup(scale){const r=doc.regions.find(r=>r.generatedName?.kind==='land'&&r.generatedName.number===1);if(!r)throw Error('Land 1 not found');activate(r.id);const points=geometry(r).points.filter(c=>!c.slope),c=points[Math.floor(points.length/3)],s=state();s.scale=scale;s.x=area.x+area.w/2-c.px*scale;s.y=area.y+area.h/2-c.py*scale;schedule();return {id:r.id,key:R.key(c),x:c.x,y:c.y,count:r.cells.size};}};\n`;
  await route.fulfill({response,body:body.replace('  return {load,beforeLoad:',hook+'  return {load,beforeLoad:')});
 });
 await p.route('**/realmap-ui.js*',async route=>{const response=await route.fetch(),body=await response.text(),needle='  window.CrateMapViewer={state';
  const hook=`if(!editQA.hooked){editQA.hooked=true;const editDraw=draw;draw=function(...args){const t=performance.now(),value=editDraw(...args);if(editQA.record)editQA.frames.push({at:t,end:performance.now(),count:editRegions.count(),pending:editRegions.status().pending});return value;};canvas.addEventListener('pointerdown',()=>{editQA.downAt=performance.now();},true);for(const name of ['pointerdown','pointermove','pointerup']){let at;canvas.addEventListener(name,()=>{at=performance.now();},true);canvas.addEventListener(name,()=>{editQA.handlers.push({name,ms:performance.now()-at});});}}\n`;
  await route.fulfill({response,body:body.replace(needle,hook+needle)});
 });
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 assert(await p.locator('#unitBuffRadius').evaluate(e=>!!e.closest('#simulationPanel .simulation-primary')),'Radius belongs beside the placement object');
 await p.locator('#regionToggle').click();await p.waitForFunction(()=>editRegions.snapshot().regions.some(r=>r.generatedName?.kind==='land'&&r.generatedName.number===1)&&!CrateMapViewer.state.regionPending,null,{timeout:120000});
 await p.locator('#regionTool').selectOption('brush-game');await p.locator('#regionWidth').fill('1');await p.locator('#regionHeight').evaluate(e=>e.value='1');
 const samples=[];
 for(const scale of [1,.3]){
  const info=await p.evaluate(scale=>editRegions.setup(scale),scale);assert(info.count>24000);
  await p.locator('#map').scrollIntoViewIfNeeded();await p.waitForTimeout(600);
  await p.waitForFunction(()=>!CrateMapViewer.state.regionPending&&editRegions.motions().every(m=>!m.visible||Math.hypot(m.targetX-m.x,m.targetY-m.y)<.25),null,{timeout:10000});
  const point=await p.evaluate(({x,y})=>{const v=CrateMapViewer,c=v.state.lookup.get(x+','+y),r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return [r.x+(v.state.x+c.px*v.state.scale)*k,r.y+(v.state.y+c.py*v.state.scale)*k];},info);
  for(let i=0;i<4;i++){
   await p.locator('#regionOperation').selectOption(i%2?'add':'remove');await p.locator('#map').scrollIntoViewIfNeeded();await p.mouse.move(...point);
   await p.evaluate(()=>{editQA.record=true;editQA.geometry=[];editQA.frames=[];editQA.raf=[];});await p.mouse.click(...point);
   const expected=info.count-(i%2?0:1);await p.waitForFunction(n=>editQA.frames.some(f=>f.count===n&&!f.pending),expected);
   const result=await p.evaluate(n=>{editQA.record=false;const frame=editQA.frames.find(f=>f.count===n&&!f.pending);return {latency:frame.end-editQA.downAt,geometry:editQA.geometry,count:editRegions.count(),queue:editRegions.status(),handlers:editQA.handlers,raf:editQA.raf.map(f=>({request:f.at-editQA.downAt,run:f.run-editQA.downAt})),frames:editQA.frames.map(f=>({delay:f.at-editQA.downAt,ms:f.end-f.at,pending:f.pending,count:f.count}))};},expected);
   assert.equal(result.count,expected);assert(result.latency<250,JSON.stringify(result));assert(result.geometry.every(g=>g.ms<100));
   assert(result.queue.rebuiltTiles<=5,'A one-cell edit only rebuilds its tile and neighboring boundary tiles: '+JSON.stringify(result));samples.push({scale,...result});
  }
 }
 await p.locator('#regionOperation').selectOption('remove');await p.locator('#map').scrollIntoViewIfNeeded();
 const burstStart=await p.evaluate(()=>{editQA.handlers=[];return editRegions.status();});
 const drag=await p.evaluate(()=>{const v=CrateMapViewer,a=v.area,b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return {x:b.x+(a.x+a.w/2)*k,y:b.y+(a.y+a.h/2)*k,step:30*v.state.scale*k};});
 await p.mouse.move(drag.x,drag.y);await p.mouse.down();
 for(let i=1;i<=32;i++){await p.mouse.move(drag.x+i*drag.step/4,drag.y);assert((await p.evaluate(()=>editRegions.status().queued))<=1);}
 await p.mouse.up();
 await p.waitForFunction(()=>!CrateMapViewer.state.regionPending);
 const burst=await p.evaluate(()=>({status:editRegions.status(),handlers:editQA.handlers,count:editRegions.count()}));
 assert(burst.count<24901);assert.equal(burst.status.queued,0);
 if(burst.status.merged>burstStart.merged)assert(burst.status.published-burstStart.published<burst.status.requests-burstStart.requests,'Queued operations collapse, while work that finishes between pointer events needs no merging');
 assert(Math.max(...burst.handlers.map(h=>h.ms))<20,'Region pointer handlers must not build geometry or summaries');
 await p.locator('#regionUndo').click();assert.equal(await p.evaluate(()=>editRegions.count()),24902,'A continuous stroke remains one undo step');await p.locator('#regionRedo').click();assert.equal(await p.evaluate(()=>editRegions.count()),burst.count);await p.locator('#regionUndo').click();await p.locator('#viewMode').click();
 for(const id of ['regionColorOverlay','regionShowTotals'])if(await p.locator('#'+id).getAttribute('aria-pressed')!=='true')await p.locator('#'+id).click();
 await p.waitForFunction(()=>!CrateMapViewer.state.regionPending);await p.waitForTimeout(600);
 const pixels=await p.evaluate(()=>{const v=CrateMapViewer,images=[],ratio=v.viewport.pixelRatio;for(const fn of [editRegions.render,editRegions.snapshotLayer()]){const cv=document.createElement('canvas');cv.width=v.viewport.width*ratio;cv.height=v.viewport.height*ratio;const ctx=cv.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);fn(ctx,v.state);images.push(ctx.getImageData(0,0,cv.width,cv.height).data);}let sum=0,large=0;for(let i=0;i<images[0].length;i++){const d=Math.abs(images[0][i]-images[1][i]);sum+=d;if(d>40)large++;}return {mean:sum/images[0].length,large:large/images[0].length};});
 assert(pixels.mean<1.5&&pixels.large<.02,JSON.stringify(pixels));
 const start=await p.evaluate(()=>{const v=CrateMapViewer,a=v.area,r=v.state.data.rendering;v.state.scale=a.w/(r.width*.75);v.state.x=a.x+a.w/2-r.width*v.state.scale/2;v.state.y=a.y+a.h/2-r.height*v.state.scale/2;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return [b.x+(a.x+a.w*.4)*k,b.y+(a.y+a.h*.5)*k];});
 await p.waitForTimeout(700);const before=await p.evaluate(()=>editRegions.motions().filter(m=>m.visible));assert(before.length>1);
 await p.mouse.move(...start);await p.mouse.down({button:'right'});let moved;
 for(let i=1;i<=3;i++){await p.mouse.move(start[0]+i*35,start[1]+i*8);await p.waitForTimeout(20);moved=await p.evaluate(()=>({at:performance.now(),lastPanEvent:editQA.lastPanEvent,motions:editRegions.motions().filter(m=>m.visible)}));for(const old of before){const current=moved.motions.find(m=>m.id===old.id);if(current&&moved.at-moved.lastPanEvent<50)assert.equal(current.targetAt,old.targetAt,'Moving camera must not search new anchors before the 50 ms stationary gate');}}
 await p.waitForTimeout(450);const settled=await p.evaluate(()=>({drag:CrateMapViewer.state.drag?.mode,motions:editRegions.motions().filter(m=>m.visible)}));assert.equal(settled.drag,'pan');
 assert(settled.motions.some(m=>m.targetAt>=moved.lastPanEvent+50),'Titles must settle even while the right button stays held');await p.mouse.up({button:'right'});
 const follow=await p.evaluate(()=>editQA.follow);assert(follow.some(f=>f.distance>0));assert(follow.filter(f=>!f.camera).every(f=>f.distance<=8000*f.dt+.21),'Relocations obey the speed cap; camera transport stays rigid');
 assert.deepEqual(errors,[]);const out=path.resolve('output/region-edit-qa');fs.mkdirSync(out,{recursive:true});
 await p.locator('#canvasHost').screenshot({path:path.join(out,toy?'toy.png':'full.png')});fs.writeFileSync(path.join(out,toy?'toy-native.json':'full-native.json'),JSON.stringify({status:'PASS',samples,pixels,burst,follow,heldRightSettled:true},null,2));
 console.log('PASS',toy?'Toy':'Full','Land 1 native add/remove, local tile rebuilding, undo/redo pixels and actual stillness while holding pan',JSON.stringify(samples.map(s=>s.latency)));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
