/* Real pointer strokes on the user's 28,680-cell map, both product editions. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.SIM_BASE,toy=process.env.SIM_EDITION==='toy',edition=toy?'toy':'full',qa=path.resolve(process.env.SIM_QA);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 // These checks exercise full-report jobs and the fallback publication path.
 if(!toy)await p.route('**/api/maps/simulation-live/open',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA fallback path"}'}));
 await p.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/simulation-drag-base/result.json')));
 const ready=()=>p.waitForFunction(()=>globalThis.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy&&!CrateMapViewer.simulation.pending&&!CrateMapViewer.simulation.computing,null,{timeout:180000}).catch(async e=>{console.log(await p.evaluate(()=>({status:document.getElementById('status').textContent,error:document.getElementById('error').textContent,pending:CrateMapViewer?.simulation.pending,computing:CrateMapViewer?.simulation.computing})));throw e;});await ready();
 if(toy){await p.locator('#mapFile').setInputFiles(path.resolve('output/availability-20261104/user.map'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='user.map'&&!CrateMapViewer.state.busy,null,{timeout:180000});}
 await p.locator('#simulationPlaceTab').click();await p.waitForFunction(()=>CrateMapViewer.simulation.model&&CrateMapViewer.simulation.previewReady,null,{timeout:60000});
 await p.locator('#simulationPlaceShape').selectOption('brush');
 await p.locator('#minimap').uncheck();await p.locator('#heatmap').uncheck();await p.locator('#values').uncheck();await p.locator('#map').scrollIntoViewIfNeeded();
 const coords=await p.evaluate(()=>{const v=CrateMapViewer,m=v.simulation.model;let row;
  for(const c of m.source.cells){if(c.level!==0)continue;const points=Array.from({length:30},(_,i)=>[c.x+i,c.y]);if(points.every(([x,y])=>m.baseline.get(`${x},${y}`)?.level===0&&m.placement('MTNK',x,y).allowed)){row=points;break;}}
  if(!row)throw Error('No 30-cell test row');window.row=row;const middle=v.state.lookup.get(row[14].join(','));v.state.scale=1;v.state.x=v.area.x+v.area.w/2-middle.px;v.state.y=v.area.y+v.area.h/2-middle.py;v.draw();
  const canvas=document.getElementById('map'),r=canvas.getBoundingClientRect(),k=Math.min(r.width/v.viewport.width,r.height/v.viewport.height),point=([x,y])=>{const c=v.state.lookup.get(`${x},${y}`);return{x:r.left+(r.width-v.viewport.width*k)/2+(v.state.x+c.px*v.state.scale)*k,y:r.top+(r.height-v.viewport.height*k)/2+(v.state.y+c.py*v.state.scale)*k};};
  window.metrics={placements:[],frames:[],jobs:0};const append=m.appendPlacement;m.appendPlacement=(...args)=>{const start=performance.now(),value=append(...args);metrics.placements.push(performance.now()-start);return value;};
  const provider=globalThis.CrateMapPlatform||CrateLocalAPI,method=globalThis.CrateMapPlatform?'simulate':'json',call=provider[method];provider[method]=function(...args){if(method==='simulate'||args[0]==='/api/maps/simulation')metrics.jobs++;return call.apply(this,args);};
  let previous=performance.now();window.sampling=true;function tick(now){if(!sampling)return;metrics.frames.push(now-previous);previous=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);return row.map(point);
 });
 await p.mouse.move(coords[0].x,coords[0].y);await p.waitForTimeout(200);await p.locator('#canvasHost').screenshot({path:path.join(qa,edition+'-ghost.png')});
 await p.mouse.down();for(const point of coords.slice(1))await p.mouse.move(point.x,point.y);
 const during=await p.evaluate(()=>({count:CrateMapViewer.simulation.model.plan.placements.length,jobs:metrics.jobs,disabled:document.getElementById('simulationPlaceTab').disabled,pending:CrateMapViewer.simulation.pending}));
 assert.equal(during.count,30);assert.equal(during.jobs,0);assert.equal(during.disabled,false);assert.equal(during.pending,true);
 await p.locator('#canvasHost').screenshot({path:path.join(qa,edition+'-row-during-stroke.png')});
 const start=Date.now();await p.mouse.up();await ready();const calculation=Date.now()-start;
 const measured=await p.evaluate(()=>{sampling=false;return {...metrics,cells:CrateMapViewer.state.cells.length,count:CrateMapViewer.simulation.model.plan.placements.length,occupied:row.every(p=>CrateMapViewer.state.lookup.get(p.join(',')).occupied)};});
 assert.equal(measured.jobs,1);assert(measured.occupied);assert.equal(measured.count,30);
 await p.locator('#simulationUndo').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),0);
 await p.locator('#simulationRedo').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),30);
 await p.locator('#canvasHost').screenshot({path:path.join(qa,edition+'-row-complete.png')});
 // Hold an old result, add another stroke, then release it. It must never
 // overwrite the newer plan and the queue must issue only one successor job.
 await p.evaluate(()=>{const provider=globalThis.CrateMapPlatform||CrateLocalAPI,method=globalThis.CrateMapPlatform?'simulate':'waitForMapJob',original=provider[method];window.gateReached=false;provider[method]=async function(...args){const result=await original.apply(this,args);provider[method]=original;gateReached=true;await new Promise(r=>window.releaseOldResult=r);return result;};});
 await p.locator('#recompute').click();await p.waitForFunction(()=>gateReached,null,{timeout:180000});await p.locator('#simulationUndo').click();await p.evaluate(()=>releaseOldResult());await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),0);await p.locator('#simulationRedo').click();await ready();
 // Ghost must also support a multi-cell military building at native scale.
 await p.locator('#simulationObject').selectOption({index:2});await p.mouse.move(coords[10].x,coords[10].y+70);await p.waitForTimeout(1800);await p.locator('#canvasHost').screenshot({path:path.join(qa,edition+'-building-ghost.png')});
 const previews=await p.evaluate(async toy=>{const m=CrateMapViewer.simulation.model,results=[];
  for(const choice of m.choices){let value=await CrateSimulationAssets.get(m.source,choice,{frame:choice.ore?11:0});if(!value){if(toy)value=await CrateLiveObjects.preview(m.source,choice,0);else{const result=new URL(location.href).searchParams.get('result'),data=await CrateLocalAPI.json('/api/maps/simulation-art?'+new URLSearchParams({result,type:choice.type,level:0})),image=new Image();image.src=data.image;await image.decode();value={...data,image};}}const canvas=document.createElement('canvas');canvas.width=canvas.height=700;const ctx=canvas.getContext('2d');ctx.drawImage(value.image,350+value.x,350+value.y);const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data,hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');results.push({type:choice.type,x:value.x,y:value.y,w:canvas.width,h:canvas.height,sha256:hash});}return results;},toy);
 fs.writeFileSync(path.join(qa,edition+'-previews.json'),JSON.stringify(previews,null,2));
 // Switching maps invalidates background results before the new report loads.
 await p.evaluate(()=>{const provider=globalThis.CrateMapPlatform||CrateLocalAPI,method=globalThis.CrateMapPlatform?'simulate':'waitForMapJob',original=provider[method];window.gateReached=false;provider[method]=async function(...args){const result=await original.apply(this,args);provider[method]=original;gateReached=true;await new Promise(r=>window.releaseOldResult=r);return result;};});
 await p.locator('#recompute').click();await p.waitForFunction(()=>gateReached,null,{timeout:180000});
 await p.evaluate(async()=>{const url=new URL(location.href).searchParams.get('result');await CrateMapViewer.loadResult(url);releaseOldResult();});await p.waitForTimeout(600);await ready();assert.equal(await p.evaluate(()=>!!CrateMapViewer.simulation.model),true);assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),0);
 assert.deepEqual(errors,[]);const percentile=(a,n)=>a.sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*n))];
 const result={status:'PASS',edition,cells:measured.cells,tanks:30,calculationJobs:measured.jobs,strokeAtomicUndo:true,staleResultRejected:true,placementP95Ms:percentile(measured.placements,.95),placementMaxMs:Math.max(...measured.placements),frameP95Ms:percentile(measured.frames,.95),backgroundCalculationMs:calculation};
 fs.writeFileSync(path.join(qa,edition+'-drag.json'),JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
