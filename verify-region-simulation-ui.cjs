/* Real UI actions followed immediately by automatic partition in both editions. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||(toy?'http://127.0.0.1:8789/toy/crate-atlas/':'http://127.0.0.1:8792/'),out=path.resolve('output/region-simulation-qa');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],rows=[];p.on('pageerror',e=>errors.push(e.stack));
 if(!toy){let edit=true,paint=true;for(const action of ['edit','paint'])await p.route('**/api/maps/simulation-live/'+action,async route=>{
  const delayed=action==='edit'?edit:paint;if(action==='edit')edit=false;else paint=false;
  if(!delayed)return route.continue();const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,action==='edit'?300:1500));await route.fulfill({response});
 });}
 await p.route('**/simulation-ui.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body.replace('  return {shortcut,adjustSize,','  window.simNavigationDebug=()=>({revision:lifecycle.revision,applied:lifecycle.applied,probabilityApplied:lifecycle.probabilityApplied,failed:lifecycle.failed,loading:lifecycle.loading,consider:lifecycle.consider,epoch:lifecycle.epoch,running:!!lifecycle.running,live:!!lifecycle.live});\n  return {shortcut,adjustSize,')});});
 await p.route('**/region-auto.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+`
 {const partition=CrateRegionAuto.partition;CrateRegionAuto.partition=async(...args)=>{const waiting=window.CrateMapViewer?.simulation.waiting,result=await partition(...args);window.regionSimPartition={result,waiting};return result;};}
 `});});
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/region-simulation-qa/result.json'));
 const ready=()=>p.waitForFunction(()=>{const v=window.CrateMapViewer;return v?.simulation.model&&!v.state.busy&&!v.simulation.computing&&!v.simulation.waiting;},null,{timeout:120000});await ready();
 if(toy){await p.locator('#version').selectOption('yr');await p.locator('#mapFile').setInputFiles(path.join(out,'source.yrm'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='source.yrm'&&!CrateMapViewer.state.busy,null,{timeout:120000});await ready();}
 await p.waitForFunction(()=>document.getElementById('regionAutoProgress').hidden,null,{timeout:120000});await p.locator('#minimap').uncheck();
 const run=async(label,{east,mine,hut})=>{
  if(await p.locator('#regionToggle').getAttribute('aria-pressed')!=='true')await p.locator('#regionToggle').click();
  await p.waitForFunction(()=>document.getElementById('regionAutoProgress').hidden);await p.evaluate(()=>window.regionSimPartition=null);await p.locator('#regionAutoQuick').click();
  await p.waitForFunction(()=>window.regionSimPartition&&document.getElementById('regionAutoProgress').hidden,null,{timeout:20000}).catch(async error=>{console.error(JSON.stringify(await p.evaluate(()=>({session:simNavigationDebug(),status:document.getElementById('status').textContent,error:document.getElementById('error').textContent,auto:document.getElementById('regionAutoStatus').textContent,progress:document.getElementById('regionAutoProgress').textContent,hidden:document.getElementById('regionAutoProgress').hidden,partition:!!window.regionSimPartition,data:CrateMapViewer.state.data.metadata.simulationPlan,model:CrateMapViewer.simulation.model.plan})),null,2));throw error;});
  const info=await p.evaluate(()=>{const value=regionSimPartition,player=value.result.regions.find(r=>r.kind==='player'&&r.number===1),owns=(x,y)=>!!player?.keys.includes(x*1024+y);return{east:owns(23,20),mine:owns(14,19),hut:owns(14,21),waiting:value.waiting};});
  assert.deepEqual({east:info.east,mine:info.mine,hut:info.hut},{east,mine,hut},label);rows.push({label,...info});console.log('Checked',toy?'Toy':'Full',label);
 };
 const original={east:true,mine:false,hut:false},broken={east:false,mine:false,hut:false},removed={east:true,mine:true,hut:true},combined={east:false,mine:true,hut:true};
 await run('original',original);
 await p.locator('#simulationPlaceTab').click();await p.locator('#simulationBridges').click();await run('broken bridge, immediately partition',broken);
 if(!toy)assert(rows.at(-1).waiting,'Automatic partition uses current probability/navigation before delayed art finishes');await ready();
 // Automatic partition and layout edits share history; first undo the partition.
 await p.locator('#simulationUndo').click();await p.locator('#simulationUndo').click();await run('undo bridge',original);
 const tool=async value=>{await p.locator('#simulationPlaceTab').click();await p.locator('#simulationTool').selectOption(value,{force:true});await p.locator('#simulationPlaceShape').selectOption('brush',{force:true});};
 const click=async(x,y)=>{await p.locator('#map').scrollIntoViewIfNeeded();const point=await p.evaluate(([x,y])=>{const v=CrateMapViewer,s=v.state,c=s.lookup.get(x+','+y),a=v.area;s.scale=2;s.x=a.x+a.w/2-c.px*2;s.y=a.y+a.h/2-c.py*2;v.draw();const r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return[r.x+(a.x+a.w/2)*k,r.y+(a.y+a.h/2)*k];},[x,y]);await p.mouse.click(...point);};
 await tool('magnet');await click(14,19);await run('magnetic drill removal',{east:true,mine:true,hut:false});
 await tool('magnet');await click(14,21);await run('magnetic immune hut removal',removed);
 await tool('restore');await click(14,19);await click(14,21);await run('restore original objects',original);
 const steps=JSON.parse(fs.readFileSync(path.join(out,'plans.json'))),plan={...steps.find(s=>s.name==='magnet-immune-hut').plan,overlays:steps.find(s=>s.name==='broken-bridge').plan.overlays};
 const imported=path.join(out,'combined.simulation.json');fs.writeFileSync(imported,JSON.stringify(plan));
 await p.locator('#simulationPlaceTab').click();await p.locator('#simulationImportFile').setInputFiles(imported);await run('import broken bridge plus magnetic removals',combined);
 await p.locator('#simulationConsider').click();await run('simulation result disabled',original);
 await p.locator('#simulationConsider').click();await run('simulation result enabled again',combined);
 await ready();
 if(toy){await p.goto(base+'index.html');await ready();await p.locator('#version').selectOption('yr');await p.locator('#mapFile').setInputFiles(path.join(out,'source.yrm'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='source.yrm'&&!CrateMapViewer.state.busy);}
 else await p.reload();
 await ready();await p.locator('#simulationRestoreCache').click();await run('restored editing cache',combined);
 await ready();assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,(toy?'toy':'full')+'-ui.json'),JSON.stringify({edition:toy?'Toy':'Full',rows,errors},null,2));console.log('PASS',toy?'Toy':'Full',JSON.stringify(rows));
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
