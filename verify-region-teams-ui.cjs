/* Full app + static Toy + phone: team controls, applied state and all drawings. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{chromium,devices}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),out=path.resolve('output/region-teams-qa'),results=[];await fs.mkdir(out,{recursive:true});
 try{for(const [name,url,mobile,locale]of [
  ['desktop','http://127.0.0.1:8767/maps.html?result=/output/map-8b9caa6619a1/result.json',false,'zh-CN'],
  ['toy','http://127.0.0.1:8787/toy/crate-atlas/maps.html?result=data%2Ff1d9bb89e2eb07cdb7af-yr%2Fore%2Fresult.json.gz',false,'en-US'],
  ['toy-mobile','http://127.0.0.1:8787/toy/crate-atlas/maps.html?result=data%2Ff1d9bb89e2eb07cdb7af-yr%2Fore%2Fresult.json.gz',true,'zh-CN']]){
  const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1440,height:1000}},locale}),page=await context.newPage(),errors=[],apis=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))apis.push(r.url());});
  const ready=()=>page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)));
  await page.goto(url);await ready();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)||'null')?.autoHandled,null,{timeout:120000});
  const initial=await read(),starts=await page.evaluate(()=>CratePlayerStarts.positions(CrateMapViewer.state));assert.ok(starts.length>=3);
  assert.deepEqual(initial.appliedTeams,{});assert.deepEqual(initial.autoOptions.teams,{});
  assert.equal(await page.locator('.language-control span[aria-hidden=true]').textContent(),'🌐');
  await page.evaluate(()=>{window.qaPlayers=[];window.qaLabels=[];const original=CratePlayerStarts.draw;CratePlayerStarts.draw=(ctx,state,view,options)=>{qaPlayers.push({canvas:ctx.canvas.id||'thumbnail',styles:options?.regionStyles||null});return original(ctx,state,view,options);};const stroke=CanvasRenderingContext2D.prototype.strokeText;CanvasRenderingContext2D.prototype.strokeText=function(text,...args){if(this.canvas.id==='map'&&(/%$|:$/.test(String(text)))){const m=this.measureText(text);qaLabels.push({text,stroke:this.strokeStyle,width:this.lineWidth,size:parseFloat(this.font.split(' ')[1]),centerY:args[1]-(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2});}return stroke.call(this,text,...args);};});
  await page.locator('#regionToggle').click();await page.locator('#regionAutoSettings').evaluate(e=>e.open=true);
  assert.equal(await page.locator('#regionAutoTeams select').count(),starts.length);
  for(const p of starts)assert.equal(await page.locator('#regionTeam'+p.number).inputValue(),'neutral');
  const one=page.locator('#regionTeam'+starts[0].number),two=page.locator('#regionTeam'+starts[1].number),empty=page.locator('#regionTeam'+starts[2].number);
  await one.selectOption('A');await two.selectOption('A');await empty.selectOption('empty');await page.waitForTimeout(400);
  const pending=await read();assert.deepEqual(pending.regions,initial.regions,'Editing parameters does not replace existing regions before Run');assert.deepEqual(pending.appliedTeams,{});
  const row=await Promise.all([one.boundingBox(),two.boundingBox()]);assert.ok(Math.abs(row[0].y-row[1].y)<2,'Two player controls fit on one row');
  assert.ok(await page.locator('#regionAutoFields').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Long translated labels fit the parameter panel');
  const began=Date.now();await page.locator('#regionAutoRun').click();await page.waitForFunction(n=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)||'null')?.appliedTeams[n]==='A',starts[0].number,{timeout:120000});
  const elapsed=Date.now()-began,after=await read(),team=after.regions.find(r=>r.generatedName?.team==='A');assert.ok(team?.cells.length);assert.ok(!after.regions.some(r=>r.generatedName?.kind==='player'&&r.generatedName.number===starts[2].number));
  const keys=after.regions.flatMap(r=>r.cells);assert.equal(new Set(keys).size,keys.length);
  await page.locator('#regionUndo').click();await page.waitForTimeout(400);assert.deepEqual((await read()).appliedTeams,{});assert.deepEqual((await read()).regions,pending.regions);
  await page.locator('#regionRedo').click();await page.waitForTimeout(400);assert.deepEqual((await read()).regions,after.regions);
  await page.evaluate(()=>{document.getElementById('minimap').checked=true;qaPlayers=[];CrateMapViewer.draw();});
  const marks=await page.evaluate(()=>qaPlayers.find(p=>p.canvas==='map')?.styles);assert.equal(marks[starts[0].number].team,'A');assert.equal(marks[starts[0].number].color,marks[starts[1].number].color);assert.equal(marks[starts[2].number].empty,true);
  assert.ok(await page.evaluate(()=>qaPlayers.filter(p=>p.canvas==='map'&&p.styles).length>=2),'Map and minimap use the same team state');
  const labels=await page.evaluate(()=>{qaLabels=[];CrateMapViewer.draw();return qaLabels;});assert.ok(labels.some(l=>l.text.includes(locale==='en-US'?'Team A:':'小队A:')));
  const firstName=labels.findIndex(l=>l.text.endsWith(':')),nameLabel=labels[firstName],probabilityLabel=labels[firstName+2];assert.match(probabilityLabel.text,/%$/);assert.ok(Math.abs(nameLabel.size/probabilityLabel.size-.7)<1e-4,'Region names use 70% of probability size');assert.ok(Math.abs(nameLabel.centerY-probabilityLabel.centerY)<1e-6,'Actual glyph bounds are vertically centered');
  await page.locator('#regionName').fill('Alpha');await page.locator('#regionName').blur();
  for(const [color,outer,inner]of [['#ffff00','#ffffff','#050a0b'],['#121b4c','#ffffff','#050a0b']]){
   await page.locator('#regionColor').fill(color);await page.locator('#regionColor').dispatchEvent('input');
   const painted=await page.evaluate(()=>{qaLabels=[];qaPlayers=[];CrateMapViewer.draw();return qaLabels.filter(l=>l.text.startsWith('Alpha:'));});assert.ok(painted.length>=2);assert.equal(painted[0].stroke,outer);assert.equal(painted[1].stroke,inner);assert.ok(painted[0].width>painted[1].width);
  }
  await page.locator('#regionColor').dispatchEvent('change');await page.waitForTimeout(400);
  await page.locator('#regionAutoSettings').screenshot({path:path.join(out,name+'-teams.png')});
  await page.locator('#regionAutoSettings').evaluate(e=>e.open=false);await page.locator('#canvasHost').screenshot({path:path.join(out,name+'-map.png')});
  await page.evaluate(()=>{qaPlayers=[];});const download=page.waitForEvent('download');await page.locator('#mapImageExport').click();await(await download).saveAs(path.join(out,name+'-map.jpg'));
  assert.ok(await page.evaluate(()=>qaPlayers.some(p=>p.canvas==='thumbnail'&&p.styles&&Object.values(p.styles).some(p=>p.empty))),'Export retains the inactive start marker');
  const saved=await read();await page.locator('#mineralToggle').click();await page.waitForFunction(()=>!CrateMapViewer.state.busy&&CrateMapViewer.state.data.metadata.treesEnabled===false,null,{timeout:120000});assert.deepEqual((await read()).appliedTeams,saved.appliedTeams);assert.deepEqual((await read()).regions,saved.regions);
  await page.locator('#regionToggle').click();assert.ok(await page.evaluate(()=>{qaPlayers=[];CrateMapViewer.draw();return qaPlayers.filter(p=>p.canvas==='map').every(p=>p.styles===null);}),'Normal view keeps original player marks');
  await page.reload();await ready();await page.waitForTimeout(400);assert.deepEqual((await read()).regions,saved.regions);assert.deepEqual((await read()).appliedTeams,saved.appliedTeams);
  if(mobile){await page.locator('#regionToggle').click();await page.setViewportSize({width:844,height:390});await page.locator('#regionAutoSettings').evaluate(e=>e.open=true);await page.locator('#regionAutoSettings').screenshot({path:path.join(out,'mobile-landscape-settings.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.deepEqual(errors,[]);if(name.startsWith('toy'))assert.deepEqual(apis,[]);results.push({name,starts:starts.length,partitionMs:elapsed,groups:after.regions.filter(r=>r.generatedName?.kind==='team').length});await context.close();console.log('PASS team UI',name);
 }}finally{await browser.close();}
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
