const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const base=process.env.TOY_BASE||'http://127.0.0.1:8787/toy/crate-atlas/',out=path.resolve(process.env.TOY_QA_OUT||'output/toy-live-qa');fs.mkdirSync(out,{recursive:true});
const map='output/toy-cache/5551e4aabce62d113d0522d0/source.map',large='output/toy-cache/8bbe9a2f890e41f3a58d3d95/source.map';
async function ready(p){await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});}
async function upload(p,file=map){await p.locator('#mapFile').setInputFiles(file);await ready(p);assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.liveComputed),true);assert.equal(await p.locator('#error').textContent(),'');}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const summary={};try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,locale:mobile?'en-US':'zh-CN',acceptDownloads:true}),p=await context.newPage(),errors=[],requests=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push({url:r.url(),method:r.method()}));const cdp=await context.newCDPSession(p);if(mobile)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await p.goto(base+'maps.html');await ready(p);assert.ok(await p.evaluate(()=>CrateMapViewer.state.data.rendering.original));
 assert.match(await p.title(),/^Toy · /);
 assert.doesNotMatch(await p.locator('body').innerText(),/现场版|实验版|Toy experiment|live-analysis experiment/i);
 const start=Date.now();await upload(p);const metrics={uploadMs:Date.now()-start,workerMs:await p.evaluate(()=>CrateMapViewer.state.data.metadata.elapsedSeconds*1000)};
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)||'null')?.autoHandled,null,{timeout:120000});
 await p.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.cells.find(c=>c.multiplier>3)));
 await p.waitForFunction(()=>CrateMapViewer.state.incoming?.sources.length>0,null,{timeout:10000});
 metrics.sources=await p.evaluate(()=>CrateMapViewer.state.incoming.sources.length);
 await p.locator('#simulationPlaceTab').click();await p.locator('#regionToggle').click();assert.ok(await p.locator('#regionRows canvas').count()>0);await p.locator('#regionTool').selectOption('brush-ellipse');
 const name=p.locator('#regionName');await name.fill('Live QA');await name.dispatchEvent('change');
 // Autosave is debounced by 300 ms; a fixed 350 ms sleep races CPU-throttled rendering.
 await p.waitForFunction(()=>localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256)?.includes('Live QA'),null,{timeout:10000});
 await p.locator('#viewMode').click();assert.ok(await p.locator('#heatmap').isChecked());
 await p.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.cells.find(c=>c.bridge?.kind==='high')));
 await p.locator('#terrain3dOpen').click();await p.waitForFunction(()=>!document.getElementById('terrain3dStage').classList.contains('is-loading'),null,{timeout:30000});assert.equal(await p.locator('#terrain3dError').textContent(),'');
 await p.locator('#terrain3dDialog').screenshot({path:path.join(out,mobile?'mobile-3d.png':'desktop-3d.png')});await p.locator('#terrain3dClose').click();
 const before=await p.evaluate(()=>[CrateMapViewer.state.x,CrateMapViewer.state.y,CrateMapViewer.state.scale]);
 await p.locator('#map').scrollIntoViewIfNeeded();let b=await p.locator('#map').boundingBox();const x=b.x+b.width*.45,y=b.y+Math.min(b.height*.4,180);
 await p.evaluate(()=>{window.qaFrames=[];let before=performance.now();window.qaRunning=true;const tick=t=>{qaFrames.push(t-before);before=t;if(qaRunning)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y,id:1},{x:x+20,y,id:2}]});for(let i=0;i<30;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-20-i,y,id:1},{x:x+20+i,y,id:2}]});await p.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await p.mouse.move(x,y);await p.mouse.down({button:'right'});for(let i=0;i<30;i++){await p.mouse.move(x+i*2,y+i);await p.waitForTimeout(16);}await p.mouse.up({button:'right'});}
 metrics.navigation=await p.evaluate(()=>{qaRunning=false;const a=qaFrames.slice(1).sort((a,b)=>a-b);return{fps:a.length*1000/a.reduce((s,x)=>s+x,0),p95:a[Math.floor(a.length*.95)]};});
 assert.notDeepEqual(await p.evaluate(()=>[CrateMapViewer.state.x,CrateMapViewer.state.y,CrateMapViewer.state.scale]),before);
 if(mobile){await p.setViewportSize({width:844,height:390});await p.locator('#map').scrollIntoViewIfNeeded();b=await p.locator('#map').boundingBox();assert.ok(b.width>700&&b.height>240);}
 await p.locator('#map').screenshot({path:path.join(out,mobile?'mobile-landscape.png':'desktop-map.png')});
 for(const id of ['screenshot','mapImageExport','jsonDownload']){const download=p.waitForEvent('download');await p.locator('#'+id).click();const d=await download;await d.saveAs(path.join(out,(mobile?'mobile-':'desktop-')+d.suggestedFilename()));assert.ok(fs.statSync(await d.path()).size>1000);}
 const first=Date.now();await p.locator('#mineralToggle').click();await ready(p);assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.mineralsEnabled),false);metrics.clearMs=Date.now()-first;
 const cached=Date.now();await p.locator('#mineralToggle').click();await ready(p);metrics.cachedMs=Date.now()-cached;assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.mineralsEnabled),true);
 const sha=await p.evaluate(()=>CrateMapViewer.state.data.metadata.sourceSha256);
 await p.locator('#mapFile').setInputFiles({name:'invalid.yrm',mimeType:'text/plain',buffer:Buffer.from('[Map]\nSize=0,0,8,8')});await ready(p);assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.sourceSha256),sha);assert.notEqual(await p.locator('#error').textContent(),'');
 await p.locator('#mapFile').setInputFiles(large);await p.locator('#liveCancel').waitFor({state:'visible'});await p.locator('#liveCancel').click();await ready(p);assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.sourceSha256),sha);
 await p.reload();await ready(p);await upload(p);assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.metadata.sourceSha256),sha);assert.ok(await p.evaluate(()=>localStorage.getItem('crate-atlas.regions.v1.'+CrateMapViewer.state.data.metadata.sourceSha256).includes('Live QA')));
 assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(r=>r.method!=='GET'||r.url.includes('/api/')),[]);metrics.requests=requests.length;
 console.log(mobile?'MOBILE':'DESKTOP',JSON.stringify(metrics));summary[mobile?'mobile-4xCPU':'desktop']=metrics;await context.close();
 }}finally{await browser.close();}fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(summary,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
