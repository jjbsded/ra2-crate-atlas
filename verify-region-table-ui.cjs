'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',english=process.env.UI_LANG==='en',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',qa=path.resolve('output/region-table-qa');
(async()=>{fs.mkdirSync(qa,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[],jobs=[];let capture=false;
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(capture&&r.method()==='POST'&&/\/api\/maps\/(analyze|simulation|recompute)/.test(new URL(r.url()).pathname))jobs.push(r.url());});
 await p.route('**/language-settings.js*',r=>r.fulfill({contentType:'application/javascript',body:'globalThis.CrateLanguageSettings={saved:'+JSON.stringify(english?'en':'zh-CN')+'};'}));
 await p.addInitScript(lang=>{localStorage.removeItem('crate-atlas.region-table.v1');localStorage.setItem('crate-atlas.language.v1',lang);},english?'en':'zh-CN');
 await p.goto(base+(toy?'maps.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 assert(await p.locator('#regionSummary').isVisible());
 for(const [id,mode,pattern]of [['simulationPlaceTab','place',english?/Left-drag to draw/:/左键绘制/],['regionToggle','region',english?/assign regions/:/左键划分/],['viewMode',null,english?/Click to select/:/点击选格/]]){
  await p.locator('#'+id).click();assert.equal(await p.evaluate(()=>CrateMapViewer.state.editMode),mode);assert(await p.locator('#mapInteractionHint').isVisible());assert.match(await p.locator('#mapInteractionHint').innerText(),pattern);assert(await p.locator('#regionSummary').isVisible());
 }
 assert(await p.locator('#cellAside').isVisible());assert(await p.locator('#regionAsideTabs').isHidden());
 await p.waitForFunction(()=>document.getElementById('regionRows').children.length>2&&!CrateMapViewer.state.regionPending&&!CrateMapViewer.state.unitBuffPending&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.evaluate(()=>new Promise(resolve=>requestIdleCallback(resolve,{timeout:500})));capture=true;
 const header=p.locator('#regionTable thead');
 const labels=await header.locator('[data-column-group] .region-column-sort>span:first-child').allTextContents();assert.deepEqual(labels,english?['Land','Water','Land & water','Grizzly buff','Sea Scorpion buff','Hover Transport buff']:['陆地','海洋','海陆','灰熊buff','海蝎buff','气垫船buff']);
 assert.deepEqual(await header.locator('[data-column="name"] .region-column-sort>span:first-child').allTextContents(),english?['No.','Name','Area']:['编号','名称','面积']);
 const aligned=()=>header.locator('[data-column="name"] .region-column-sort>span:first-child').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().left));let headingLeft=await aligned();assert(headingLeft.every(x=>Math.abs(x-headingLeft[0])<.5));
 const sortLabels=await p.locator('#regionSort option').allTextContents();assert.deepEqual(await p.locator('#regionRankSort option').allTextContents(),sortLabels);assert.equal(sortLabels[0],english?'Land & water · Total multiplier':'海陆 · 总倍率');assert.equal(sortLabels.at(-1),english?'Name':'名称');
 assert.deepEqual(await header.locator('tr:first-child>th').evaluateAll(nodes=>nodes.slice(0,2).map(e=>e.dataset.column)),['preview','name']);
 assert.match(await p.locator('.region-column-picker>summary').innerText(),english?/Visible columns/:/显示项目/);
 await p.waitForFunction(()=>localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256));
 const creation=await p.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)).regions);
 const orderButton=header.locator('[data-sort-metric="order"]');await orderButton.click();assert.equal(await p.locator('#regionSort').inputValue(),'order');assert.equal(await p.locator('#regionRankSort').inputValue(),'order');
 const rowIds=()=>p.locator('#regionRows>tr').evaluateAll(nodes=>nodes.map(n=>n.dataset.regionId));assert(await p.locator('#regionAscending').isChecked());assert.deepEqual(await rowIds(),creation.map(r=>r.id));
 await orderButton.click();assert(!(await p.locator('#regionAscending').isChecked()));assert.deepEqual(await rowIds(),creation.map(r=>r.id).reverse());await orderButton.click();assert.equal(await p.locator('#regionRows>tr').first().locator('td').count(),14,'No duplicate number column is added');
 await p.locator('#regionToggle').click();await p.locator('#regionRankingTab').click();
 const names=await p.evaluate(regions=>regions.filter(r=>r.cells.length).map(r=>CrateRegionStatistics.displayName(r)),creation),rankNames=()=>p.locator('#regionRankRows tr td:first-child').allTextContents();
 assert.deepEqual(await rankNames(),names);assert.equal(await p.locator('#regionRankHead th').count(),1);
 await p.locator('#regionRankSort').selectOption('name');assert(await p.locator('#regionAscending').isChecked());await p.locator('#regionRankSort').selectOption('sea.total');assert(!(await p.locator('#regionAscending').isChecked()));await p.locator('#regionRankSort').selectOption('order');assert(await p.locator('#regionAscending').isChecked());
 await p.locator('#regionAscending').uncheck();assert.deepEqual(await rankNames(),names.slice().reverse());await p.locator('#viewMode').click();
 await p.evaluate(()=>{window.tableData=CrateMapViewer.state.data;window.tableCanvases=Array.from(document.querySelectorAll('#regionRows canvas'));});
 const sort=async(metric,asc=false)=>{await header.locator('[data-column="'+metric+'"] button').click();assert.equal(await p.locator('#regionSort').inputValue(),metric);assert.equal(await p.locator('#regionAscending').isChecked(),asc);};
 await sort('sea.total');assert.equal(await header.locator('[data-column="sea.total"]').getAttribute('aria-sort'),'descending');
 const rowValues=()=>p.locator('#regionRows>tr').evaluateAll(rows=>rows.map(r=>Number(r.querySelector('[data-metric="sea.total"] .region-number-content').childNodes[0].textContent.replace(/[^\d.]/g,''))));
 let values=await rowValues();assert(values.every((v,i)=>!i||v<=values[i-1]));const descending=await p.locator('#regionRows>tr').first().getAttribute('data-region-id');
 await sort('sea.total',true);values=await rowValues();assert(values.every((v,i)=>!i||v>=values[i-1]));
 await p.locator('#regionTotalsVisible').uncheck();assert.equal(await p.locator('#regionTable tbody [data-column$=".total"]:visible').count(),0);
 const single=await header.evaluate(head=>Array.from(head.querySelectorAll('[data-column-group]')).map(group=>({group:group.getBoundingClientRect().width,leaf:head.querySelector('[data-column="'+group.dataset.columnGroup+'.average"]').getBoundingClientRect().width})));assert(single.every(w=>Math.abs(w.group-w.leaf)<1));
 await p.locator('.region-column-picker>summary').click();
 const choice=k=>p.locator('[data-column-choice="'+k+'"]');await choice('sea.total').check();
 assert(await p.locator('#regionTotalsVisible').evaluate(e=>e.indeterminate));assert(await choice('land').evaluate(e=>e.indeterminate));
 await choice('sea.average').uncheck();assert(await choice('sea').evaluate(e=>e.indeterminate));
 assert.equal(await p.locator('#regionTable tbody [data-column="sea.total"]:visible').count(),await p.locator('#regionRows>tr').count());
 await choice('sea').check();assert(await choice('sea.total').isChecked());assert(await choice('sea.average').isChecked());
 await choice('sea').uncheck();assert.equal(await header.locator('[data-column-group="sea"]').count(),0);
 await choice('sea.average').check();await p.locator('.region-column-picker>summary').click();
 await header.locator('[data-column-group="sea"] button').click();assert.equal(await p.locator('#regionSort').inputValue(),'sea.average');assert.equal(await p.locator('#regionRankSort').inputValue(),'sea.average');assert(!(await p.locator('#regionAscending').isChecked()));
 await p.locator('#regionTotalsVisible').check();await p.locator('#regionAveragesVisible').check();assert(!(await p.locator('#regionTotalsVisible').evaluate(e=>e.indeterminate)));
 await p.locator('.region-column-picker>summary').click();
 await choice('preview').uncheck();assert.equal(await p.locator('.region-preview:visible').count(),0);await choice('preview').check();
 await p.locator('.region-column-picker>summary').click();
 await p.locator('#regionCompact').check();assert(await p.locator('#regionTable').evaluate(e=>e.classList.contains('region-table-compact')));
 headingLeft=await aligned();assert(headingLeft.every(x=>Math.abs(x-headingLeft[0])<.5),'Header text stays aligned in compact mode');
 const before=await header.locator('[data-column]').evaluateAll(nodes=>nodes.map(e=>e.dataset.column));
 // Native HTML drag swaps the two fixed columns, then moves an entire metric group.
 await header.locator('[data-drag-column="preview"]').dragTo(header.locator('[data-drag-column="name"]'));
 assert.deepEqual(await header.locator('tr:first-child>th').evaluateAll(nodes=>nodes.slice(0,2).map(e=>e.dataset.column)),['name','preview']);
 await header.locator('[data-drag-column="group:sea"]').dragTo(header.locator('[data-drag-column="group:land"]'));
 assert.deepEqual(await header.locator('[data-column-group]').evaluateAll(nodes=>nodes.slice(0,2).map(e=>e.dataset.columnGroup)),['sea','land']);
 // Individual metric columns can move independently; cell/header alignment follows.
 await header.locator('[data-drag-column="sea.average"]').dragTo(header.locator('[data-drag-column="land.average"]'));
 const order=await p.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.region-table.v1')).order);
 assert.deepEqual(await p.locator('#regionRows>tr').first().locator('td').evaluateAll(nodes=>nodes.map(e=>e.dataset.column)),order);
 assert.notDeepEqual(order,before);const retained=await p.evaluate(()=>({retained:tableCanvases.filter(c=>c.isConnected).length,total:tableCanvases.length,sameData:CrateMapViewer.state.data===tableData,pending:CrateMapViewer.state.regionPending}));assert(retained.retained===retained.total&&retained.sameData,JSON.stringify(retained));
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const alignment=await p.locator('#regionRows [data-column="all.total"]').evaluateAll(cells=>cells.map(cell=>{const a=cell.getBoundingClientRect(),b=cell.querySelector('.region-number').getBoundingClientRect(),c=cell.querySelector('.region-number-content').getBoundingClientRect();return {center:(a.left+a.right-b.left-b.right)/2,right:c.right};}));assert(alignment.every(v=>Math.abs(v.center)<1&&Math.abs(v.right-alignment[0].right)<1),JSON.stringify(alignment));
 const aspect=await p.locator('#regionRows>tr').first().locator('canvas').evaluateAll(nodes=>nodes.map(e=>{const b=e.getBoundingClientRect();return b.width/b.height;}));assert(aspect.every(r=>Math.abs(r-16/9)<.01));
 assert.equal(await p.locator('#regionOverviewLock').getAttribute('aria-pressed'),'true');await p.locator('#regionOverviewWidth').fill('');await p.locator('#regionOverviewWidth').pressSequentially('150');assert.equal(await p.locator('#regionOverviewHeight').inputValue(),'150');
 await p.locator('#regionOverviewLock').click();await p.locator('#regionOverviewWidth').fill('200');await p.locator('#regionOverviewHeight').fill('75');assert.equal(await p.locator('#regionOverviewWidth').inputValue(),'200');
 await p.waitForFunction(()=>Array.from(document.querySelectorAll('#regionRows .region-preview canvas')).every(cv=>cv.regionSizeKey==='2,0.75'));
 const sizes=await p.locator('#regionRows>tr').first().locator('.region-preview canvas').evaluateAll(nodes=>nodes.map(e=>{const b=e.getBoundingClientRect();return {width:b.width,height:b.height,pixels:e.width};}));assert.equal(sizes.length,2);assert(sizes.every(b=>Math.abs(b.width-432)<1&&Math.abs(b.height-91.125)<1&&b.pixels>=432),'Both terrain crop and location image share the scale: '+JSON.stringify(sizes));
 // Superseded size changes collapse to the last value instead of queuing renders.
 await p.locator('#regionOverviewHeight').fill('100');await p.locator('#regionOverviewWidth').evaluate(e=>{for(const value of [110,160,220,100]){e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}});await p.locator('#regionOverviewLock').click();
 await p.waitForFunction(()=>Array.from(document.querySelectorAll('#regionRows .region-preview canvas')).every(cv=>cv.regionSizeKey==='1,1'));
 // Controls stay in place while shown columns change and native wheel scrolling remains available.
 await p.locator('.region-column-picker>summary').click();await choice('hover.average').uncheck();
 const saved=await p.evaluate(()=>localStorage.getItem('crate-atlas.region-table.v1'));assert(JSON.parse(saved).hidden.includes('hover.average'));
 await p.keyboard.press('Escape');assert(!(await p.locator('.region-column-picker').evaluate(e=>e.open)));
 assert.deepEqual(jobs,[]);assert.deepEqual(errors,[]);
 await p.locator('#regionSummary').evaluate(e=>e.scrollIntoView({block:'start'}));await p.screenshot({path:path.join(qa,(toy?'toy':'full')+(english?'-en':'-zh')+'.png')});
 // Recreate the presentation against retained rows to verify preferences restore without reanalysis.
 assert(await p.evaluate(()=>{const original=document.getElementById('regionTable'),table=original.cloneNode(true),host=document.createElement('div');document.body.append(table,host);const ui=CrateRegionTableControls.create({table,body:table.tBodies[0],host,sort:document.getElementById('regionSort'),ascending:document.getElementById('regionAscending'),onSort(){}});ui.applyRows();const okay=table.classList.contains('region-table-compact')&&table.tBodies[0].querySelector('[data-column="hover.average"]').hidden&&table.tBodies[0].rows[0].cells[0].dataset.column==='name';table.remove();host.remove();return okay;}));
 await p.setViewportSize({width:440,height:900});await p.locator('.region-column-picker>summary').click();const box=await p.locator('.region-column-options').boundingBox();await p.screenshot({path:path.join(qa,(toy?'toy':'full')+'-mobile.png')});assert(box.x>=0&&box.x+box.width<=440,JSON.stringify(box));await p.locator('.region-column-picker>summary').click();
 fs.writeFileSync(path.join(qa,(toy?'toy':'full')+'.json'),JSON.stringify({status:'PASS',language:english?'en':'zh-CN',columns:order,retainedCanvases:true,noAnalysisJobs:true,descending,errors},null,2));
 console.log('PASS',toy?'Toy':'Full',english?'English':'Chinese','click sorting, drag reorder, independent/tri-state visibility, compact layout, preferences and retained canvases');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
