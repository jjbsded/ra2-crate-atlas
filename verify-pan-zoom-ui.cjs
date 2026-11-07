/* Native held-button zoom/pan continuity and the default placement gesture. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[],samples=[];
  p.on('pageerror',error=>errors.push(error.stack));
  await p.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/map-b88b83c9702a/result.json')));
  const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();
  if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();}
  await p.evaluate(()=>{
   const map=document.getElementById('map');window.navigationQA={wheels:0};
   const point=e=>{const v=CrateMapViewer,r=map.getBoundingClientRect(),k=Math.min(r.width/v.viewport.width,r.height/v.viewport.height);return {x:(e.clientX-r.x-(r.width-v.viewport.width*k)/2)/k,y:(e.clientY-r.y-(r.height-v.viewport.height*k)/2)/k};};
   map.addEventListener('wheel',e=>{navigationQA.wheels++;navigationQA.wheel=point(e);},{passive:true});
   map.addEventListener('pointermove',e=>{navigationQA.move=point(e);});
  });
  for(const mode of ['viewMode','regionToggle','simulationPlaceTab']){
   await p.locator('#'+mode).click();
   for(const alreadyMoved of [false,true]){
    await p.locator('#map').scrollIntoViewIfNeeded();
    const start=await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,a=v.area,r=s.data.rendering;s.scale=.8;s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return [b.x+(a.x+a.w*.4)*k,b.y+(a.y+a.h*.5)*k];});
    let [x,y]=start;await p.mouse.move(x,y);await p.mouse.down({button:'right'});
    if(alreadyMoved){x+=36;y-=18;await p.mouse.move(x,y);}
    for(const delta of [-140,100,-200,130]){
     const before=await p.evaluate(()=>({x:CrateMapViewer.state.x,y:CrateMapViewer.state.y,scale:CrateMapViewer.state.scale,wheels:navigationQA.wheels}));
     await p.mouse.wheel(0,delta);await p.waitForFunction(n=>navigationQA.wheels>n,before.wheels);
     const zoomed=await p.evaluate(()=>({x:CrateMapViewer.state.x,y:CrateMapViewer.state.y,scale:CrateMapViewer.state.scale,point:navigationQA.wheel}));
     for(const axis of ['x','y'])assert(Math.abs((zoomed.point[axis]-before[axis])/before.scale-(zoomed.point[axis]-zoomed[axis])/zoomed.scale)<1e-6,'Wheel zoom must keep its world anchor');
     x+=2;y+=1;await p.mouse.move(x,y);
     const moved=await p.evaluate(()=>({x:CrateMapViewer.state.x,y:CrateMapViewer.state.y,point:navigationQA.move}));
     const error=Math.hypot(moved.x-zoomed.x-(moved.point.x-zoomed.point.x),moved.y-zoomed.y-(moved.point.y-zoomed.point.y));
     assert(error<.001,`${mode}, moved=${alreadyMoved}: stale drag origin caused a ${error.toFixed(2)} px jump`);
     samples.push({mode,alreadyMoved,delta,error});
    }
    await p.mouse.up({button:'right'});assert.equal(await p.evaluate(()=>CrateMapViewer.state.drag),null);
   }
  }
  assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),0,'Right-button navigation must not place units');
  assert.equal(await p.locator('#simulationPlaceShape').inputValue(),'line');
  assert.equal(await p.locator('#simulationPaintMethod').inputValue(),'brush');
  await p.locator('#simulationObject').selectOption('MTNK');await p.locator('#map').scrollIntoViewIfNeeded();
  const ends=await p.evaluate(()=>{
   const v=CrateMapViewer,m=v.simulation.model;let row;
   for(const c of m.source.cells){if(c.level!==0)continue;const points=[0,1,2].map(i=>[c.x+i,c.y]);if(points.every(([x,y])=>m.placement('MTNK',x,y).allowed)&&Array.from({length:7},(_,i)=>i-2).every(dx=>[-1,0,1].every(dy=>m.baseline.get(`${c.x+dx},${c.y+dy}`)?.level===0))){row=points;break;}}
   if(!row)throw Error('No empty flat line for a native placement gesture');
   v.focus(v.state.lookup.get(row[1].join(',')));v.draw();
   const r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;
   return [row[0],row[2]].map(([x,y])=>{const c=v.state.lookup.get(`${x},${y}`);return [r.x+(v.state.x+c.px*v.state.scale)*k,r.y+(v.state.y+c.py*v.state.scale)*k];});
  });
  await p.mouse.move(...ends[0]);await p.mouse.down();await p.mouse.move(...ends[1],{steps:6});
  assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),0,'Default straight lines preview before committing');
  await p.mouse.up();await p.waitForFunction(()=>CrateMapViewer.simulation.model.plan.placements.length===3&&!CrateMapViewer.simulation.waiting&&!CrateMapViewer.unitBuffs.status.pending,null,{timeout:120000});
  const out=path.resolve('output/pan-zoom-qa');fs.mkdirSync(out,{recursive:true});
  await p.locator('#canvasHost').screenshot({path:path.join(out,toy?'toy.png':'full.png')});
  await p.locator('#simulationPlaceShape').selectOption('brush');await p.locator('#viewMode').click();await p.locator('#simulationPlaceTab').click();
  assert.equal(await p.locator('#simulationPlaceShape').inputValue(),'brush','Explicit drawing preferences must survive mode switches');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,toy?'toy.json':'full.json'),JSON.stringify({status:'PASS',samples,defaultLinePlacements:3},null,2));
  console.log('PASS',toy?'Toy':'Full','24 held-right-button zoom/micro-pan checks, all three modes, default line preview/commit and explicit brush choice');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
