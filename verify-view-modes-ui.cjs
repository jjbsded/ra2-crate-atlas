/* Real entry points for persistent modes, localized choices and cameos. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',qa=path.resolve('output/view-modes-qa');
(async()=>{
 fs.mkdirSync(qa,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const language of ['zh-CN','en']){
  const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  await p.addInitScript(language=>localStorage.setItem('crate-atlas.language.v1',language),language);
  if(!toy)await p.route('**/language-settings.js*',route=>route.fulfill({contentType:'text/javascript',body:'globalThis.CrateLanguageSettings='+JSON.stringify({saved:language})+';'}));
  await p.goto(process.env.SIM_BASE+(toy?'index.html':'maps.html?result='+encodeURIComponent('/output/map-2e6e335f9da7/result.json')));
  await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
  const file='D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-130952-917129.yrm';
  if(!toy)await p.locator('#version').selectOption('directory');
  await p.locator('#mapFile').setInputFiles(file);await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-130952-917129.yrm'&&!CrateMapViewer.state.busy,null,{timeout:120000});
  assert.equal(await p.evaluate(()=>CrateI18n.language),language);
  assert.equal(await p.locator('#simulationToggle').count(),0);
  const visible=async()=>{for(const id of ['simulationPanel','viewToolbar','regionToolbar'])assert(await p.locator('#'+id).isVisible(),id);};
  await visible();assert.equal(await p.locator('#viewMode').getAttribute('aria-pressed'),'true');
  await p.locator('#simulationPlaceTab').click();
  await p.waitForFunction(()=>CrateMapViewer.simulation.model&&CrateMapViewer.simulation.previewReady,null,{timeout:60000}).catch(async error=>{
   console.log('MODE STATE',await p.evaluate(()=>({mode:CrateMapViewer.state.editMode,model:!!CrateMapViewer.simulation.model,error:document.getElementById('error').textContent,status:document.getElementById('simulationProgress').textContent,active:CrateMapViewer.simulation.active})),errors);throw error;
  });
  await p.waitForFunction(()=>document.querySelector('#simulationChoice img')?.complete,null,{timeout:30000});
  const content=await p.evaluate(async()=>{
   const list=[...document.querySelectorAll('#simulationChoices [data-type]')].map(e=>({type:e.dataset.type,label:e.textContent}));
   const a=document.getElementById('simulationPlaceTab').getBoundingClientRect(),b=document.getElementById('simulationMine').getBoundingClientRect();
   const image=document.querySelector('#simulationChoice img'),box=image.getBoundingClientRect(),button=document.getElementById('simulationChoice').getBoundingClientRect();
   const catalog=await CrateSimulationAssets.catalog(),lang=CrateI18n.language;
   return {list,first:document.querySelector('.simulation-quick-actions').firstElementChild.id,sameRow:Math.abs(a.top-b.top)<1,
    icon:{topGap:box.top-button.top,bottomGap:button.bottom-box.bottom,height:box.height,file:image.src},
    expectedIcon:(lang==='en'?catalog.localizedIcons.en.yr:catalog.icons.yr).MTNK.file};
  });
  assert.equal(content.first,'simulationPlaceTab');assert(content.sameRow);
  assert(content.icon.topGap>=2&&content.icon.bottomGap>=2&&content.icon.height===38,JSON.stringify(content.icon));
  assert(content.icon.file.endsWith(content.expectedIcon));
  if(language==='zh-CN'){
   assert(content.list.find(c=>c.type==='GAYARD').label.includes('[水面]'));
   assert(content.list.find(c=>c.type==='NACNST').label.includes('[陆地]'));
   assert(content.list.find(c=>c.type==='GAPOWR').label.includes('发电厂'));
  }else assert(!content.list.some(c=>/[\u3400-\u9fff]/u.test(c.label)),JSON.stringify(content.list));
  await p.locator('#regionOperationHint').click();assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'region');await visible();
  await p.locator('#viewMode svg').click();assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),null);assert.equal(await p.locator('#regionSummary').isVisible(),true);await visible();
  await p.locator('#map').scrollIntoViewIfNeeded();
  const point=await p.evaluate(()=>{
   const v=CrateMapViewer,m=v.simulation.model,c=m.source.cells.find(c=>m.placement('MTNK',c.x,c.y).allowed),cell=v.state.lookup.get(`${c.x},${c.y}`),a=v.area;
   v.state.scale=1;v.state.x=a.x+a.w/2-cell.px;v.state.y=a.y+a.h/2-cell.py;v.draw();
   const rect=document.getElementById('map').getBoundingClientRect(),k=rect.width/v.viewport.width;
   return {x:rect.left+(a.x+a.w/2)*k,y:rect.top+(a.y+a.h/2)*k,count:m.count,key:[c.x,c.y]};
  });
  await p.mouse.click(point.x,point.y);
  assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.count),point.count);
  assert.deepEqual(await p.evaluate(()=>[CrateMapViewer.state.selected.x,CrateMapViewer.state.selected.y]),point.key);
  await p.locator('#simulationHint').click();assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),'place');await visible();
  await p.locator('#viewMode').click();
  await p.locator('#editTools').screenshot({path:path.join(qa,(toy?'toy':'full')+'-'+language+'.png')});
  for(const width of [1366,900,390]){
   await p.setViewportSize({width,height:1300});await visible();
   const bounds=await p.locator('#editTools').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});
   assert(bounds.left>=0&&bounds.right<=bounds.width,JSON.stringify(bounds));
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,(toy?'toy':'full')+'-'+language+'.json'),JSON.stringify(content,null,2));
  console.log('PASS persistent modes, read-only viewing, localized labels and icons',toy?'Toy':'Full',language);await p.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
