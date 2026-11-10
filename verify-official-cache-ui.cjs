/* Exercise rebuilt official data through the actual Full/Toy map picker. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8769/';
assert(process.env.CACHE_CASES,'Set CACHE_CASES to native-cache reference signatures');
const cases=JSON.parse(fs.readFileSync(process.env.CACHE_CASES,'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],rows=[],api=[];p.on('pageerror',e=>errors.push(e.stack));p.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))api.push(r.url());});
 const ready=()=>p.waitForFunction(()=>{const v=window.CrateMapViewer,s=v?.state;return v?.simulation.model&&!s.busy&&!v.simulation.waiting&&!v.simulation.computing&&!s.regionPending&&!s.unitBuffPending&&!v.buffExpectation.status.pending;},null,{timeout:180000});
 async function signature(){return p.evaluate(async()=>{const d=CrateMapViewer.state.data,e=d.probability.exact,hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(n=>n.toString(16).padStart(2,'0')).join('');return{terms:await hash(d.cells.map(c=>[c.x,c.y,c.terms])),exact:await hash([e.denominator,e.failureNumerator,e.ghostNumerator,e.exhaustedNumerator,e.coefficients.map(c=>[c.n,c.r,c.numerator])])};});}
 await p.goto(base+(toy?'index.html':'maps.html'));if(toy)await ready();
 for(const item of cases){
  await p.locator('#loadHeck').click();await p.locator('#officialMapMode').selectOption('standard');await p.locator('#officialMapVersion').selectOption(item.version);await p.locator('#officialMapSearch').fill(item.name);
  await p.locator('.official-map-row').first().click();if(await p.locator('#officialMapAnalysisVersion').isDisabled())assert.equal(await p.locator('#officialMapAnalysisVersion').inputValue(),item.version);else await p.locator('#officialMapAnalysisVersion').selectOption(item.version);
  const at=Date.now();await p.locator('#officialMapAnalyze').click();
  await p.waitForFunction(item=>{const s=window.CrateMapViewer?.state;return s?.data.metadata.officialMap?.id===item.id&&s.data.metadata.version===item.version&&!s.busy;},item,{timeout:180000});await ready();
  assert.deepEqual(await signature(),{terms:item.terms,exact:item.exact},item.id+' cached UI exact values');
  const info=await p.evaluate(()=>({source:CrateMapViewer.state.data.metadata.calculationSource?.kind,cells:CrateMapViewer.state.cells.length,preview:!!CrateMapViewer.state.data.metadata.previewOnly,approximate:!!CrateMapViewer.state.data.metadata.approximate,buff:CrateMapViewer.buffExpectation.maximum}));
  assert(!info.preview&&!info.approximate);assert(info.buff>0);assert(!(await p.locator('#simulationPlaceTab').isDisabled()));assert(!(await p.locator('#regionToggle').isDisabled()));
  if(!toy)assert(['official-precomputed','local-cache'].includes(info.source),JSON.stringify(info));
  while(await p.locator('#probabilityToggle').getAttribute('data-mode')!=='buff')await p.locator('#probabilityToggle').click();await ready();assert.deepEqual(await signature(),{terms:item.terms,exact:item.exact},'Buff view preserves cache numbers');
  rows.push({id:item.id,version:item.version,theater:item.theater,ms:Date.now()-at,...info});
 }
 const initial=await signature();await p.locator('#simulationPlaceTab').click();await p.locator('#minimap').uncheck();await p.locator('#simulationPlaceShape').selectOption('brush',{force:true});
 const point=await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,c=v.simulation.model.source.cells.find(c=>v.simulation.model.placement('MTNK',c.x,c.y).allowed);s.scale=1.2;s.x=v.area.x+v.area.w/2-s.lookup.get(c.x+','+c.y).px*s.scale;s.y=v.area.y+v.area.h/2-s.lookup.get(c.x+','+c.y).py*s.scale;v.draw();return{x:c.x,y:c.y};});
 await p.locator('#map').scrollIntoViewIfNeeded();const xy=await p.evaluate(c=>{const v=CrateMapViewer,s=v.state,r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width,p=s.lookup.get(c.x+','+c.y);return[r.x+(s.x+p.px*s.scale)*k,r.y+(s.y+p.py*s.scale)*k];},point);await p.mouse.click(...xy);
 await p.waitForFunction(()=>CrateMapViewer.simulation.model.plan.placements.length===1&&!CrateMapViewer.simulation.waiting&&!CrateMapViewer.simulation.computing);await ready();assert.notEqual((await signature()).terms,initial.terms);
 await p.locator('#simulationUndo').click();await ready();assert.deepEqual(await signature(),initial,'Official-map edits undo to the original exact cached values');assert.deepEqual(errors,[]);if(toy)assert.deepEqual(api,[],'Toy official data and editing never call an analysis API');
 const output=path.resolve('output/official-cache-rebuild-20261109');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,(toy?'toy':'full')+'-ui.json'),JSON.stringify({status:'PASS',rows,placementUndo:true,errors},null,2));console.log('PASS',toy?'Toy':'Full',rows.length,'official picker loads, native exact signatures, Buff precompute/view, enabled editors and placement/undo');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
