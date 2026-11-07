/* A dense read-only placement fixture and native rapid number-input stepping. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],requests=[];
  p.on('pageerror',e=>errors.push(e.stack));p.on('request',r=>{if(r.method()==='POST'&&/\/api\/maps\/(simulation|recompute)(?:\?|$)/.test(r.url()))requests.push(r.url());});
  await p.goto(base+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/map-22309489b5d3/result.json')));
  await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
  if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
  await p.locator('#regionToggle').click();await p.waitForFunction(()=>document.getElementById('regionAutoStatus').textContent.includes('自动划分完成'),null,{timeout:120000});
  await p.evaluate(()=>{
   const v=CrateMapViewer,s=v.state,placements=s.cells.filter(c=>c.usable).slice(0,5000).map((c,i)=>({id:'radius-qa-'+i,type:i%3?'MTNK':'E2',x:c.x,y:c.y,subcell:i%3,onBridge:false}));
   // This fixture changes the numerical input only; it never edits the map or calls a simulation endpoint.
   s.data={...s.data,metadata:{...s.data.metadata,simulationPlan:{placements}}};v.unitBuffs.refresh();
  });
  await p.waitForFunction(()=>!CrateMapViewer.unitBuffs.status.pending&&CrateMapViewer.unitBuffs.status.appliedRadius===3,null,{timeout:30000});
  await p.waitForTimeout(600);await p.locator('#unitBuffRadius').scrollIntoViewIfNeeded();
  const before=await p.evaluate(()=>{
   window.radiusQA={events:[],commits:[],frames:[],record:true,last:performance.now()};
   const input=document.getElementById('unitBuffRadius');let started;
   input.addEventListener('input',()=>{started=performance.now();},true);
   input.addEventListener('input',()=>radiusQA.events.push({value:input.value,ms:performance.now()-started}));
   new MutationObserver(()=>{if(input.getAttribute('aria-busy')==='false')radiusQA.commits.push(CrateMapViewer.unitBuffs.status.appliedRadius);}).observe(input,{attributes:true,attributeFilter:['aria-busy']});
   function frame(now){if(!radiusQA.record)return;radiusQA.frames.push(now-radiusQA.last);radiusQA.last=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
   return CrateMapViewer.unitBuffs.status;
  });
  await p.locator('#unitBuffRadius').focus();
  for(let i=0;i<14;i++)await p.keyboard.press('ArrowUp');
  for(let i=0;i<13;i++)await p.keyboard.press('ArrowDown');
  assert.equal(await p.locator('#unitBuffRadius').inputValue(),'4');
  await p.waitForFunction(()=>!CrateMapViewer.unitBuffs.status.pending&&CrateMapViewer.unitBuffs.status.appliedRadius===4,null,{timeout:30000});
  const result=await p.evaluate(()=>{radiusQA.record=false;return {...radiusQA,after:CrateMapViewer.unitBuffs.status};});
  assert.equal(result.events.length,27);assert.equal(result.after.completed-before.completed,1,'Superseded radii must not publish intermediate statistics');
  assert.deepEqual(result.commits,[4]);assert.equal(result.after.indexBuilds,before.indexBuilds,'Radius changes reuse the probability index');
  assert(result.after.cancelled-before.cancelled>=20);assert(Math.max(...result.events.map(e=>e.ms))<12,'Input handling must not calculate the dense layout');
  assert(await p.locator('#unitBuffRadius').isEnabled());assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  const out=path.resolve('output/unit-buff-radius-qa');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,toy?'toy.json':'full.json'),JSON.stringify({status:'PASS',units:5000,before,...result},null,2));
  console.log('PASS',toy?'Toy':'Full','5000 units, 27 native +/- inputs, only radius 4 published; max handler ms',Math.max(...result.events.map(e=>e.ms)).toFixed(2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
