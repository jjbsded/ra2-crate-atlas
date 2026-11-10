/* Real large-region edit timings, with per-phase attribution and native input. */
'use strict';
const{chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
const map=process.env.SIM_MAP||'D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>{errors.push(e.stack);console.error(e.stack);});
 await p.addInitScript(()=>{window.regionQA={stage:null,calls:{},long:[],beat:0,maxBeat:0,add(name,ms){if(!this.stage)return;const e=this.calls[name]??={count:0,ms:0,max:0};e.count++;e.ms+=ms;e.max=Math.max(e.max,ms);},wrap(name,fn){return function(...args){const at=performance.now();try{return fn(...args);}finally{regionQA.add(name,performance.now()-at);}};}};new PerformanceObserver(list=>{if(regionQA.stage)regionQA.long.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask'});setInterval(()=>{const now=performance.now();if(regionQA.stage&&regionQA.beat)regionQA.maxBeat=Math.max(regionQA.maxBeat,now-regionQA.beat);regionQA.beat=now;},16);});
 await p.route('**/region-statistics.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nfor(const name of ['apply','fillKeys','encode','playerStyles'])CrateRegionStatistics[name]=regionQA.wrap(name,CrateRegionStatistics[name]);`});});
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch();let body=await response.text();body=body.replace('  return {load,beforeLoad:',`
  for(const name of ['applyKeys','refreshNow','membership','pickerOptions','paintMembership','paintLiveOverlay','updateBuffs','updateMetrics','preview']){
   const fn=eval(name);eval(name+' = regionQA.wrap(name,fn)');
  }
  const patchWork=patchGeometry;patchGeometry=function*(...args){const work=patchWork(...args);let part;do{const at=performance.now();part=work.next();regionQA.add('patchGeometry.next',performance.now()-at);if(!part.done)yield part.value;}while(!part.done);return part.value;};
  window.regionPerf={document:()=>JSON.parse(R.encode(doc)),status:()=>({...refreshQueue.status,...refreshWork,thumbnails:thumbnails.status}),current:()=>current().cells.size,
   select:id=>activate(id),cancel,previewCount:()=>stroke?.preview?.length||0,point:()=>{const c=lookup.get(current().cells.values().next().value);return c&&{x:c.x,y:c.y};},
   validate(){const regions=orderedRegions().filter(r=>r.cells.size),shapes=new Map();
    for(const region of regions){const iterator=buildGeometry(region,null,lookup,R.revision(region));let step;do{step=iterator.next();}while(!step.done);const actual=geometry(region),expected=step.value;
     if(actual.points.length!==expected.points.length||actual.keys.size!==expected.keys.size||[...expected.keys].some(k=>!actual.keys.has(k)))throw Error('Geometry membership mismatch');
     for(const [id,tile]of expected.tileMap){const other=actual.tileMap.get(id);if(!other||tile.keys.size!==other.keys.size||[...tile.keys].some(k=>!other.keys.has(k))||tile.edgeKeys.size!==other.edgeKeys.size||[...tile.edgeKeys].some(k=>!other.edgeKeys.has(k)))throw Error('Geometry tile mismatch');}
     const stats=statisticsFor(region),reference=R.statistics(region,lookup,getDisplay());for(const group of ['land','sea','all'])for(const field of ['count','n','total','average'])if(stats[group][field]!==reference[group][field])throw Error('Statistics mismatch');shapes.set(region,expected);
    }
    const r=state().data.rendering,clip={x:0,y:0,w:360,h:240};
    for(const scale of [Math.min(360/r.width,240/r.height),.3]){const center=geometry(current()).center||{x:r.width/2,y:r.height/2},view={x:180-center.x*scale,y:120-center.y*scale,scale},images=[];
     for(const direct of [true,false]){const cv=document.createElement('canvas');cv.width=360;cv.height=240;const ctx=cv.getContext('2d');if(direct)paintMembership(ctx,view,clip,regions);else for(const region of regions)paintGeometry(ctx,shapes.get(region),view,region.color,(1-mapTransparency/100)*(region.id===doc.active?1:.75),region.id===doc.active,clip);images.push(ctx.getImageData(0,0,360,240).data);}
     let sum=0,large=0;for(let i=0;i<images[0].length;i++){const d=Math.abs(images[0][i]-images[1][i]);sum+=d;if(d>40)large++;}if(sum/images[0].length>1||large/images[0].length>.01)throw Error('Membership pixels mismatch '+sum/images[0].length);
    }return true;
   },
   setup(){const r=doc.regions.find(r=>r.generatedName?.kind==='land'&&r.generatedName.number===1)||[...doc.regions].sort((a,b)=>b.cells.size-a.cells.size)[0];activate(r.id);const g=geometry(r),c=g.points[Math.floor(g.points.length/2)],s=state();s.scale=.3;s.x=area.x+area.w/2-c.px*s.scale;s.y=area.y+area.h/2-c.py*s.scale;schedule();return{id:r.id,count:r.cells.size,seed:{x:c.x,y:c.y},empty:doc.regions.find(r=>r!==doc.regions.find(r=>r.id===doc.active)&&!r.cells.size)?.id};},
   edit(keys,remove){checkpoint(regionEditLabel(remove));const changed=applyKeys(keys,remove);if(changed)dirty(true,true);return changed;},
   previewCell(c){const cell=lookup.get(R.key(c)),s=state();return{x:s.x+cell.px*s.scale,y:s.y+cell.py*s.scale};},
   fill(c){const cell=lookup.get(R.key(c)),s=state(),p={x:s.x+cell.px*s.scale,y:s.y+cell.py*s.scale};down(p);up();}
  };
  return {load,beforeLoad:`);await route.fulfill({response,body});});
 console.log('Opening region benchmark',base);await p.goto(base+(toy?'index.html':'maps.html'));
 if(toy)await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:180000});
 console.log('Importing map');await p.locator('#mapFile').setInputFiles(map);await p.waitForFunction(name=>window.CrateMapViewer?.state.data?.metadata.filename===name&&!CrateMapViewer.state.busy&&CrateMapViewer.simulation.model,path.basename(map),{timeout:180000});console.log('Map ready');
 await p.locator('#regionToggle').click();
 const ready=()=>p.waitForFunction(()=>{const s=CrateMapViewer.state;return !s.busy&&!s.regionPending&&!s.unitBuffPending&&!s.regionRecolorPending&&!regionPerf.status().thumbnails.pending;},null,{timeout:180000});
 await p.waitForFunction(()=>regionPerf.document().regions.some(r=>r.cells.length>20000),null,{timeout:180000}).catch(async error=>{console.log(await p.evaluate(()=>({regions:regionPerf.document().regions.map(r=>[r.name,r.cells.length]),auto:document.getElementById('regionAutoStatus').textContent,status:regionPerf.status()})));throw error;});await ready();
 const info=await p.evaluate(()=>regionPerf.setup());assert(info.count>20000&&info.empty,JSON.stringify(info));await ready();
 await p.locator('#map').scrollIntoViewIfNeeded();await p.locator('#regionTool').selectOption('brush-game');await p.locator('#regionWidth').fill('1');
 const rows=[];async function measure(name,action){await p.evaluate(name=>{regionQA.stage=name;regionQA.calls={};regionQA.long=[];regionQA.beat=performance.now();regionQA.maxBeat=0;regionQA.started=performance.now();},name);await action();await ready();await p.waitForTimeout(350);await ready();const row=await p.evaluate(()=>{regionQA.stage=null;return{ms:performance.now()-regionQA.started,calls:regionQA.calls,long:regionQA.long,maxBeat:regionQA.maxBeat,status:regionPerf.status(),counts:regionPerf.document().regions.map(r=>[r.id,r.cells.length])};});rows.push({name,...row});fs.mkdirSync('output/region-edit-performance',{recursive:true});fs.writeFileSync('output/region-edit-performance/'+(toy?'toy':'full')+'-'+(process.env.REGION_STAGE||'current')+'.json',JSON.stringify({info,rows},null,2));console.log(name,JSON.stringify({ms:row.ms,maxBeat:row.maxBeat,long:row.long,top:Object.entries(row.calls).sort((a,b)=>b[1].ms-a[1].ms).slice(0,9),geometry:row.status}));}
 const key=info.seed.x*1024+info.seed.y;
 await measure('remove one',()=>p.evaluate(key=>regionPerf.edit([key],true),key));
 await measure('add one',()=>p.evaluate(key=>regionPerf.edit([key],false),key));
 await p.locator('#regionOperation').selectOption('remove');await p.locator('#map').scrollIntoViewIfNeeded();
 await measure('native brush stroke',async()=>{
  const point=await p.evaluate(seed=>{const v=CrateMapViewer,b=document.getElementById('map').getBoundingClientRect(),p=regionPerf.previewCell(seed),k=b.width/v.viewport.width;return{x:b.x+p.x*k,y:b.y+p.y*k};},info.seed);
  await p.mouse.move(point.x,point.y);await p.mouse.down();await p.mouse.move(point.x+45,point.y,{steps:18});await p.mouse.up();
 });assert(await p.evaluate(()=>regionPerf.current())<info.count);
 await measure('undo brush stroke',()=>p.locator('#regionUndo').click());assert.equal(await p.evaluate(()=>regionPerf.current()),info.count);
 await p.locator('#regionOperation').selectOption('add');
 await p.locator('#regionTool').selectOption('fill');await p.evaluate(id=>regionPerf.select(id),info.empty);await ready();
 await measure('fill land to empty',()=>p.evaluate(seed=>regionPerf.fill(seed),info.seed));
 assert.equal(await p.evaluate(()=>regionPerf.current()),info.count);
 assert(await p.evaluate(()=>regionPerf.validate()),'Patched geometry, exact sums and temporary overlay match a full rebuild');
 await p.locator('#regionOperation').selectOption('remove');await measure('fill remove land',()=>p.evaluate(seed=>regionPerf.fill(seed),info.seed));
 assert.equal(await p.evaluate(()=>regionPerf.current()),0);
 await measure('undo fill remove',()=>p.locator('#regionUndo').click());assert.equal(await p.evaluate(()=>regionPerf.current()),info.count);
 await measure('clear region',()=>p.locator('#regionClear').click());assert.equal(await p.evaluate(()=>regionPerf.current()),0);
 await measure('undo clear',()=>p.locator('#regionUndo').click());assert.equal(await p.evaluate(()=>regionPerf.current()),info.count);
 assert(await p.evaluate(()=>regionPerf.validate()));
 const regionCount=await p.evaluate(()=>regionPerf.document().regions.length);
 await measure('delete region',()=>p.locator('#regionDelete').click());assert.equal(await p.evaluate(()=>regionPerf.document().regions.length),regionCount-1);
 await measure('undo delete region',()=>p.locator('#regionUndo').click());
 assert.equal(await p.evaluate(id=>regionPerf.document().regions.find(r=>r.id===id)?.cells.length,info.empty),info.count);
 await p.evaluate(id=>regionPerf.select(id),info.empty);await ready();
 await p.locator('#regionTool').selectOption('box-screen');await p.evaluate(()=>CrateMapViewer.frame());await p.locator('#map').scrollIntoViewIfNeeded();
 await measure('large box preview',async()=>{
  const box=await p.evaluate(()=>{const v=CrateMapViewer,a=v.area,b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return{x:b.x+(a.x+2)*k,y:b.y+(a.y+2)*k,r:b.x+(a.x+a.w-2)*k,bt:b.y+(a.y+a.h-2)*k};});
  await p.mouse.move(box.x,box.y);await p.mouse.down();await p.mouse.move(box.r,box.bt,{steps:12});await p.waitForTimeout(100);
  assert(await p.evaluate(()=>regionPerf.previewCount())>20000);await p.evaluate(()=>regionPerf.cancel());await p.mouse.up();
 });assert.equal(await p.evaluate(()=>regionPerf.current()),info.count);
 assert.deepEqual(errors,[]);console.log('PASS region large fill/remove, local edits, clear and exact undo',toy?'Toy':'Full');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
