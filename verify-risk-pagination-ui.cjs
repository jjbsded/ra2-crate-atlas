/* Real sidebar pagination: height, controls, selection and large risk reports. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',out=path.resolve('output/risk-pagination-qa');
const {pageNumbers}=require('./risk-pagination.js');
assert.deepEqual(pageNumbers(100,9999),[1,98,99,100,101,102,9999]);
assert.deepEqual(pageNumbers(1,4,true),[1,2,3,4]);
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[],measures=[];
  p.on('pageerror',error=>errors.push(error.stack));
  if(process.env.SIM_LANGUAGE==='en'){
   await p.addInitScript(()=>localStorage.setItem('crate-atlas.language.v1','en'));
   await p.route('**/language-settings.js*',route=>route.fulfill({contentType:'application/javascript',body:'globalThis.CrateLanguageSettings={saved:"en"};'}));
  }
  await p.route('**/map-details.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n{const create=CrateMapDetails.create;CrateMapDetails.create=(...args)=>window.riskDetailsQA=create(...args);}'});});
  await p.goto(base+'maps.html?result='+(process.env.SIM_RESULT||(toy?'data/1557d2f6b8e380c95042-yr/ore/result.json.gz':'/output/map-f554bd7efa5b/result.json')));
  await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
  if(await p.locator('#selectionTuning').isVisible())await p.locator('#selectionTuning .region-title-tuning-header button').click();
  await p.locator('#viewMode').click();await p.locator('#blockedCellsTab').click();await p.locator('#mapAside').scrollIntoViewIfNeeded();await p.evaluate(()=>document.fonts.ready);
  await p.evaluate(()=>{
   const v=CrateMapViewer,s=v.state;
   window.riskQA={source:s.data,context:s.prepared,lookup:s.lookup,display:v.display};
   riskQA.set=(count,potential=0)=>{
    const data={...riskQA.source,markers:s.cells.slice(0,count).map(c=>[c.x,c.y]),potentialMarkers:s.cells.slice(0,potential).map(c=>[c.x,c.y])};
    if(data.markers.length!==count||data.potentialMarkers.length!==potential)throw Error('Fixture map has too few cells');
    const at=performance.now();riskDetailsQA.report({...riskQA.context,data},riskQA.display,{lookup:riskQA.lookup,onFocus:c=>{riskQA.focus=c;}});riskQA.data=data;return performance.now()-at;
   };
  });
  const settle=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  const snapshot=()=>p.evaluate(()=>{
   const aside=document.getElementById('mapAside');return {pages:riskDetailsQA.riskPages,overflow:aside.scrollHeight-aside.clientHeight,horizontal:aside.scrollWidth-aside.clientWidth,
    pagers:[...document.querySelectorAll('#riskLists .risk-pager')].map(nav=>({hidden:nav.hidden,input:!nav.querySelector('form').hidden,values:[...nav.querySelectorAll('[data-page]')].map(b=>Number(b.dataset.page)),width:nav.scrollWidth-nav.clientWidth})),nodes:document.getElementById('coordinateLists').querySelectorAll('*').length};
  });
  const noOverflow=async label=>{const s=await snapshot();if(s.overflow>1){await p.locator('#mapAside').screenshot({path:path.join(out,'overflow.png')});console.log(label,s,await p.evaluate(()=>({aside:document.getElementById('mapAside').clientHeight,host:document.getElementById('cellAside').getBoundingClientRect().height,info:document.getElementById('cellInfo').getBoundingClientRect().height,risk:document.getElementById('riskLists').getBoundingClientRect().height})));}assert(s.overflow<=1,label+': vertical overflow '+s.overflow);assert(s.horizontal<=1,label+': horizontal overflow');for(const n of s.pagers)assert(n.width<=1,label+': pager overflow');return s;};
  const set=async(n,potential=0)=>{const ms=await p.evaluate(([n,potential])=>riskQA.set(n,potential),[n,potential]);await settle();return ms;};
  const pager=p.locator('#markerList + .risk-pager');
  await set(2);let s=await noOverflow('Short list');assert.equal(s.pages[0].pages,1);assert(s.pagers[0].hidden);
  await set(38);s=await noOverflow('38 cells');assert(s.pages[0].pages>1);assert(s.pages[0].nodes<38);assert.equal(s.pagers[0].input,!s.pages[0].allPages);if(s.pages[0].allPages)assert.equal(s.pagers[0].values.length,s.pages[0].pages);
  await pager.locator('[data-direction="1"]').click();await settle();s=await noOverflow('Next page');assert.equal(s.pages[0].page,2);
  const key=await p.locator('#markerList button').first().getAttribute('data-key');await p.locator('#markerList button').first().click();assert.equal(await p.evaluate(()=>riskQA.focus.x+','+riskQA.focus.y),key);
  await pager.locator('[data-page="1"]').click();await settle();assert.equal((await snapshot()).pages[0].page,1);
  await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+'-38.png')});
  for(const n of [5000,20000]){
   const reportMs=await set(n,n);s=await noOverflow(n+' current + potential');
   assert(s.pages.every(c=>c.total===n&&c.nodes<=c.size&&c.nodes<50));assert(s.pagers.every(c=>!c.hidden&&c.input));assert(s.nodes<180,'DOM count must be independent of report size');
   const input=pager.locator('input');await input.fill('100');await input.press('Enter');await settle();s=await noOverflow('Middle page');assert.equal(s.pages[0].page,100);
   assert.deepEqual(s.pagers[0].values,pageNumbers(100,s.pages[0].pages));
   // Drafts survive asynchronous layout / selection work; no input-time cap.
   await input.fill('');await p.evaluate(()=>riskDetailsQA.transfer(null));await settle();assert.equal(await input.inputValue(),'');
   await input.fill('999999');assert.equal(await input.inputValue(),'999999');await input.press('Enter');s=await snapshot();assert.equal(await input.inputValue(),String(s.pages[0].page));
   const last=s.pages[0].pages;await pager.locator(`[data-page="${last}"]`).click();await settle();s=await noOverflow('Last page');assert.equal(s.pages[0].page,s.pages[0].pages);assert(await pager.locator('[data-direction="1"]').isDisabled());
   // A selected off-page cell is revealed, while manual paging then stays put.
   await p.evaluate(()=>{const [x,y]=riskQA.data.markers[127];riskDetailsQA.cell(riskQA.lookup.get(x+','+y),riskQA.data,riskQA.display);});await settle();
   assert.equal(await p.locator('#markerList button.selected').count(),1);await noOverflow('Selected cell');
   await pager.locator('[data-page="1"]').click();await settle();assert.equal((await snapshot()).pages[0].page,1,'ResizeObserver must not restore an old selected page');
   await p.evaluate(()=>riskDetailsQA.clear());await settle();await noOverflow('Clear cell');
   const times=await p.evaluate(()=>{
    const d=riskDetailsQA,q=riskQA,updates=[],flips=[],selects=[];
    for(let i=0;i<30;i++){let at=performance.now();d.update({...q.context,data:q.data},q.display,{lookup:q.lookup,onFocus:c=>q.focus=c});updates.push(performance.now()-at);
     at=performance.now();document.querySelector('#markerList + .risk-pager [data-direction="1"]').click();flips.push(performance.now()-at);
     const[x,y]=q.data.markers[(i*43)%q.data.markers.length];at=performance.now();d.cell(q.lookup.get(x+','+y),q.data,q.display);selects.push(performance.now()-at);
    }d.clear();return {updates,flips,selects};
   });await settle();await noOverflow('Repeated updates');measures.push({cellsPerList:n,reportMs,...Object.fromEntries(Object.entries(times).map(([key,a])=>[key,{median:a.sort((a,b)=>a-b)[15],max:Math.max(...a)}])),nodes:(await snapshot()).nodes});
  }
  // Disclosure affects the row budget without losing the user's preference.
  await set(20000,0);await p.evaluate(()=>{const[x,y]=riskQA.data.markers[127];riskDetailsQA.cell(riskQA.lookup.get(x+','+y),riskQA.data,riskQA.display);});await settle();await noOverflow('One large selected list');
  await p.locator('#regionDetailsTab').click();await p.locator('#cellTechnicalDetails summary').click();assert(await p.locator('#cellTechnicalDetails').evaluate(e=>e.open));await p.locator('#blockedCellsTab').click();await settle();await noOverflow('Technical disclosure in another tab');
  await p.setViewportSize({width:1600,height:1100});await settle();await noOverflow('Desktop resize');
  await set(20000,20000);await settle();await noOverflow('Two large lists with hidden technical disclosure');await p.locator('#regionDetailsTab').click();await p.locator('#cellTechnicalDetails summary').click();await p.locator('#blockedCellsTab').click();await settle();
  await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+'-large.png')});
  // English controls remain constrained by the same real fonts / sidebar width.
  await p.evaluate(()=>CrateI18n.setLanguage('en'));await set(5000,5000);await noOverflow('English');assert.match(await pager.getAttribute('aria-label'),/Pages|分页/);assert.equal(await pager.locator('[data-direction="1"]').getAttribute('aria-label'),'Next page');
  await p.setViewportSize({width:440,height:850});await settle();s=await snapshot();assert(s.pages.every(c=>c.nodes<100));assert(s.pagers.every(c=>c.width<=1));
  const outside=await p.locator('#mapAside').evaluate(a=>{const b=a.getBoundingClientRect();return b.left<0||b.right>innerWidth+.5||a.scrollWidth>a.clientWidth;});assert.equal(outside,false,'Mobile sidebar and pagers fit the viewport');
  await p.locator('#mapAside').screenshot({path:path.join(out,(toy?'toy':'full')+'-mobile.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,(toy?'toy':'full')+'.json'),JSON.stringify({edition:toy?'Toy':'Full',measures,mobile:s},null,2));
  console.log('PASS',toy?'Toy':'Full','height-aware pagination, navigation/input/selection, resize, English/mobile, 2 × 20,000 coordinates',JSON.stringify(measures));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
