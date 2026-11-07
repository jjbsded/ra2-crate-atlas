'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',out=path.resolve('output/player-focus-qa');
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.playerQA={calls:[],fixture:null};localStorage.setItem('crate-atlas.language.v1','zh-CN');});
 await p.route('**/language-settings.js*',r=>r.fulfill({contentType:'application/javascript',body:'globalThis.CrateLanguageSettings={saved:"zh-CN"};'}));
 await p.route('**/player-starts.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body+`\n{const draw=CratePlayerStarts.draw;CratePlayerStarts.draw=(ctx,state,view,options={})=>{const markers=draw(ctx,state,view,options);playerQA.calls.push({role:options.radius===8?'navigation':options.radius===7||options.radius===5.5?'thumbnail':'map',focus:options.focusPlayers||[],canvas:ctx.canvas.id,include:options.includePlayers,clip:options.clip,markers:markers.map(m=>({number:m.p.number,bounds:m.bounds,direction:m.direction}))});return markers;};}`});});
 await p.route('**/realmap-ui.js*',async route=>{const response=await route.fetch(),body=await response.text(),needle='  regions.load({preserve:!!previous});';assert(body.includes(needle));const fixture=`
  if(!playerQA.fixture||playerQA.fixture.sha!==data.metadata.sourceSha256){
   const good=state.cells.filter(c=>c.usable&&c.land!==2&&!c.occupied&&(c.cameraCoverage===undefined||c.cameraCoverage>0)),xs=[...new Set(good.map(c=>c.x))].sort((a,b)=>a-b),cut=xs[Math.floor(xs.length/2)];
   const a=good.find(c=>c.x===xs[Math.floor(xs.length/4)]),b=good.find(c=>c.x===xs[Math.floor(xs.length*3/4)]),none=good.find(c=>c.x===cut),doc=CrateRegionStatistics.defaults();
   doc.autoHandled=true;doc.active='r1';doc.regions[0].generatedName={kind:'player',number:1};doc.regions[1].generatedName={kind:'player',number:2};doc.regions[2].generatedName={kind:'land',number:3};
   for(const c of state.cells)doc.regions[c.x<cut?0:c.x>cut?1:2].cells.add(CrateRegionStatistics.key(c));
   localStorage.setItem('crate-atlas.regions.v1.'+data.metadata.sourceSha256,CrateRegionStatistics.encode(doc));playerQA.fixture={sha:data.metadata.sourceSha256,cut,a:[a.x,a.y],b:[b.x,b.y],none:[none.x,none.y],waypoints:{0:a.y*1000+a.x,1:b.y*1000+b.x}};
  }
  data.metadata.multiplayerOnly=true;data.metadata.waypoints=playerQA.fixture.waypoints;
`;await route.fulfill({response,body:body.replace(needle,fixture+needle)});});
 await p.goto(base+(toy?'maps.html':'maps.html?result=/output/map-22309489b5d3/result.json'));await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 await p.waitForFunction(()=>!CrateMapViewer.state.regionPending&&playerQA.calls.some(c=>c.role==='thumbnail'&&c.focus.includes(1))&&playerQA.calls.some(c=>c.role==='thumbnail'&&c.focus.includes(2)),null,{timeout:30000});
 const fixture=await p.evaluate(()=>playerQA.fixture);
 const thumbnails=await p.evaluate(()=>playerQA.calls.filter(c=>c.role==='thumbnail'));assert(thumbnails.some(c=>c.include?.length===1&&c.markers.length===1),'Left crop omits players completely outside the region');
 for(const call of thumbnails)for(const marker of call.markers){const b=marker.bounds,c=call.clip;assert(b.x>=c.x-1e-6&&b.y>=c.y-1e-6&&b.x+b.w<=c.x+c.w+1e-6&&b.y+b.h<=c.y+c.h+1e-6,'Thumbnail marker fits the image');if(call.include)assert(call.include.includes(marker.number));}
 await p.locator('#regionSummary').evaluate(e=>e.scrollIntoView({block:'start'}));await p.screenshot({path:path.join(out,(toy?'toy':'full')+'-location-images.png')});
 const goto=async xy=>{await p.locator('#gotoX').fill(String(xy[0]));await p.locator('#gotoY').fill(String(xy[1]));await p.locator('#goto').click();};
 await goto(fixture.a);assert.equal(await p.evaluate(()=>CrateMapViewer.state.lastPlayer),1);await goto(fixture.none);assert.equal(await p.evaluate(()=>CrateMapViewer.state.lastPlayer),1,'A non-player location retains the last player');
 const geometry=await p.evaluate(()=>{const v=CrateMapViewer,r=CrateMinimap.terrainRendering(v.state);v.draw();return {r,void:v.state.coordinateSpace.bounds,nav:playerQA.calls.filter(c=>c.role==='navigation').at(-1)};});assert.deepEqual(geometry.nav.focus,[1]);assert(geometry.r.width*geometry.r.height<geometry.void.w*geometry.void.h,'Navigator fits real terrain, not valid-coordinate exterior');
 await p.locator('#simulationPlaceTab').click();await p.waitForFunction(()=>CrateMapViewer.simulation.previewReady&&!CrateMapViewer.simulation.waiting,null,{timeout:30000});
 const point=await p.evaluate(()=>{const v=CrateMapViewer,m=v.simulation.model,c=m.source.cells.find(c=>c.x>playerQA.fixture.cut&&c.usable&&(c.cameraCoverage===undefined||c.cameraCoverage>0)&&m.placement('MTNK',c.x,c.y).allowed);return [c.x,c.y];});
 async function clickCell(xy){await p.locator('#map').scrollIntoViewIfNeeded();const at=await p.evaluate(xy=>{const v=CrateMapViewer,c=v.state.lookup.get(xy.join(','));v.state.scale=2;v.state.x=v.area.x+v.area.w/2-c.px*2;v.state.y=v.area.y+v.area.h/2-c.py*2;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return [b.left+(v.area.x+v.area.w/2)*k,b.top+(v.area.y+v.area.h/2)*k];},xy);await p.mouse.click(...at);}
 const placements=await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length);await clickCell(point);await p.waitForFunction(n=>CrateMapViewer.simulation.model.plan.placements.length>n,placements);assert.equal(await p.evaluate(()=>CrateMapViewer.state.lastPlayer),2,'Successful placement updates navigation priority');
 await p.locator('#regionToggle').click();await p.locator('#regionTool').selectOption('brush-game');await p.locator('#regionOperation').selectOption('remove');await p.locator('#regionWidth').fill('1');await p.locator('#regionHeight').fill('1');await clickCell(fixture.a);assert.equal(await p.evaluate(()=>CrateMapViewer.state.lastPlayer),1,'Removing a player region remembers its previous player');
 await p.locator('#viewMode').click();await goto(fixture.none);assert.equal(await p.evaluate(()=>CrateMapViewer.state.lastPlayer),1);
 assert.deepEqual(errors,[]);await p.locator('#map').screenshot({path:path.join(out,(toy?'toy':'full')+'.png')});fs.writeFileSync(path.join(out,(toy?'toy':'full')+'.json'),JSON.stringify({status:'PASS',selection:1,placement:2,regionRemoval:1,nonPlayerRetained:true,geometry},null,2));
 console.log('PASS',toy?'Toy':'Full','described-player thumbnails, selected/placed/edited player focus, non-player retention and terrain-only navigator');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
