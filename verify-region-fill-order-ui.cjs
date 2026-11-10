/* Real Bering Strait terrain: navigation order must not follow painter order. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||(toy?'http://127.0.0.1:8789/toy/crate-atlas/':'http://127.0.0.1:8792/'),out=path.resolve('output/ramp-fill-qa');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],jobs=[];p.on('pageerror',e=>errors.push(e.stack));p.on('request',r=>{if(/simulation-(live|patch)|\/api\/maps\/simulation(?:\?|$)/.test(r.url()))jobs.push(r.url());});
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch(),body=await response.text(),hook=`
  const fillTrace=[],originalDown=down,originalUp=up,originalFill=fill;let lastPointerId=null;
  down=(...args)=>{lastPointerId=args[1]?.pointerId;const result=originalDown(...args);fillTrace.push(['down',result,stroke?.tool,automatic!==null]);return result;};
  up=(...args)=>{fillTrace.push(['up',stroke?.tool,stroke?.moved]);return originalUp(...args);};
  fill=async(...args)=>{const data=state().data,stamp=fillStamp();fillTrace.push(['fill',pick(args[0].point)?.x,pick(args[0].point)?.y]);await originalFill(...args);fillTrace.push(['done',state().data===data,fillStamp()===stamp,doc.regions[0].cells.size]);};
  window.fillOrderQA={pointerId:()=>lastPointerId,read:()=>({keys:[...doc.regions[0].cells],pending:!!filling,stroke:!!stroke,trace:JSON.stringify(fillTrace)}),async reset(x,y){
   cancelAuto(true);cancel();const next=R.defaults();next.autoHandled=true;next.active='r1';adoptDocument(next);refresh();schedule();
   const s=state(),navigation=await navigationFor(s,new AbortController().signal),cell=lookup.get(x*1024+y);
   const reference=R.fillKeys(next,cell,eligible,{cells:s.data.cells,navigation}),wrong=R.fillKeys(next,cell,new Map(eligible),{cells:s.cells,navigation});
   const bits=CrateRegionAuto.flags(navigation,s.data.cells.length),mask=new Map(s.data.cells.map((c,i)=>[R.key(c),bits[i]]));
   if(reference.some(k=>!(mask.get(k)&(1|8))||mask.get(k)&4))throw Error('Reference crossed a shore or blocked surface');
   return {keys:reference,wrong:wrong.length,slope:cell.slope,ordersDiffer:s.cells.some((c,i)=>R.key(c)!==R.key(s.data.cells[i]))};
  }};
 `;assert(body.includes('  return {load,beforeLoad:'));await route.fulfill({response,body:body.replace('  return {load,beforeLoad:',hook+'  return {load,beforeLoad:')});});
 await p.goto(base+(toy?'index.html':'maps.html'));
  await p.locator('#loadHeck').click();await p.locator('#officialMapMode').selectOption(toy?'standard':'navalwar');await p.locator('#officialMapVersion').selectOption('yr');await p.locator('#officialMapSearch').fill('白令海峡');await p.locator('.official-map-row').first().click();
 if(!(await p.locator('#officialMapAnalysisVersion').isDisabled()))await p.locator('#officialMapAnalysisVersion').selectOption('yr');await p.locator('#officialMapAnalyze').click();
  await p.waitForFunction(id=>{const v=window.CrateMapViewer;return v?.simulation.model&&v.state.data.metadata.officialMap?.id===id&&!v.state.busy;},toy?'1557d2f6b8e380c95042':'b4987fde81252cd0e583',{timeout:180000});
  await p.waitForFunction(()=>{const v=CrateMapViewer,s=v.state;return !v.simulation.waiting&&!v.simulation.computing&&!s.regionPending&&!s.unitBuffPending&&!v.buffExpectation.status.pending;},null,{timeout:120000});
 await p.locator('#minimap').uncheck();const rows=[],jobCount=jobs.length;
 const signature=()=>p.evaluate(()=>JSON.stringify(CrateMapViewer.state.data.probability.exact));const before=await signature();
 for(const [x,y]of [[103,66],[109,91]]){
  const reference=await p.evaluate(([x,y])=>fillOrderQA.reset(x,y),[x,y]);assert(reference.ordersDiffer);assert(reference.keys.length>5000);assert.equal(reference.wrong,0,'The old painter-order bug is reproduced at the user coordinate');
  await p.evaluate(()=>document.activeElement?.blur());await p.keyboard.press('3');if(await p.locator('#regionColorOverlay').getAttribute('aria-pressed')!=='true')await p.locator('#regionColorOverlay').click();await p.locator('#regionTool').selectOption('fill');await p.locator('#map').scrollIntoViewIfNeeded();
  const point=await p.evaluate(([x,y])=>{const v=CrateMapViewer,s=v.state,c=s.lookup.get(x+','+y),a=v.area;s.scale=1.5;s.x=a.x+a.w/2-c.px*s.scale;s.y=a.y+a.h/2-c.py*s.scale;v.draw();const rect=document.getElementById('map').getBoundingClientRect(),k=rect.width/v.viewport.width;return [rect.x+(a.x+a.w/2)*k,rect.y+(a.y+a.h/2)*k];},[x,y]);
  await p.mouse.click(...point);await p.waitForFunction(()=>!fillOrderQA.read().pending&&fillOrderQA.read().keys.length>0,null,{timeout:10000}).catch(async error=>{console.error('Fill UI diagnostics',await p.evaluate(()=>({read:fillOrderQA.read(),mode:CrateMapViewer.state.editMode,status:document.getElementById('regionActionStatus').textContent,tool:document.getElementById('regionTool').value,pressed:document.getElementById('regionColorOverlay').getAttribute('aria-pressed'),error:document.getElementById('error')?.textContent,errors:document.getElementById('status')?.textContent})));await p.screenshot({path:path.join(out,'failure-'+(toy?'toy':'full')+'.png')});throw error;});
  const actual=await p.evaluate(()=>fillOrderQA.read().keys);assert.deepEqual(actual.sort((a,b)=>a-b),reference.keys.sort((a,b)=>a-b));assert(actual.includes(103*1024+66)&&actual.includes(109*1024+91));
  await p.locator('#regionUndo').click();await p.waitForFunction(()=>fillOrderQA.read().keys.length===0);await p.locator('#regionRedo').click();await p.waitForFunction(n=>fillOrderQA.read().keys.length===n,actual.length);
  rows.push({x,y,slope:reference.slope,filled:actual.length,oldOrderFilled:reference.wrong});
 }
 // Unexpected capture loss before pointerup must still cancel an unfinished
 // gesture, whereas both large fills above survive the normal release.
 await p.evaluate(()=>fillOrderQA.reset(109,91));await p.locator('#map').scrollIntoViewIfNeeded();
 const cancelPoint=await p.evaluate(()=>{const v=CrateMapViewer,c=v.state.lookup.get('109,91'),r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return [r.x+(v.state.x+c.px*v.state.scale)*k,r.y+(v.state.y+c.py*v.state.scale)*k];});
 await p.mouse.move(...cancelPoint);await p.mouse.down();await p.mouse.move(cancelPoint[0]+1,cancelPoint[1]);await p.evaluate(()=>document.getElementById('map').releasePointerCapture(fillOrderQA.pointerId()));await p.mouse.move(cancelPoint[0]+2,cancelPoint[1]);await p.waitForFunction(()=>!fillOrderQA.read().stroke);await p.mouse.up();
 const cancelled=await p.evaluate(()=>fillOrderQA.read());assert(!cancelled.stroke&&!cancelled.pending);assert.equal(cancelled.keys.length,0,'Unexpected capture loss cannot commit a fill');
 assert.equal(await signature(),before,'Region fill must not change exact crate probabilities');assert.equal(jobs.length,jobCount);assert.deepEqual(errors,[]);
 await p.locator('#map').screenshot({path:path.join(out,(toy?'toy':'full')+'-bering.png')});fs.writeFileSync(path.join(out,(toy?'toy':'full')+'-bering.json'),JSON.stringify({edition:toy?'Toy':'Full',rows,undoRedo:true,probabilitiesUnchanged:true,errors},null,2));
 console.log('PASS',toy?'Toy Bering Strait terrain':'Full Bering Strait naval-war','report/painter-order fill, undo/redo, capture loss and unchanged probabilities',JSON.stringify(rows));
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
