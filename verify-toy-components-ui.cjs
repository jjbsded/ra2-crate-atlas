const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.env.TOY_QA_OUT||'output/toy-components-20261104'),base=process.env.TOY_BASE||'http://127.0.0.1:8795/toy/crate-atlas/';
const data=JSON.parse(fs.readFileSync(path.join(out,'cases.json')));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],apis=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()!=='GET'||r.url().includes('/api/'))apis.push(r.url());});
 const ready=()=>p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.goto(base+'index.html');await ready();
 await p.locator('#mapFile').setInputFiles(path.join(out,'combinations.yrm'));await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.liveComputed&&!CrateMapViewer.state.busy,null,{timeout:120000});
 assert.equal(await p.locator('#error').textContent(),'');
 const scene=await p.evaluate(()=>{const s=CrateMapViewer.state,r=s.data,c=document.createElement('canvas');c.width=r.rendering.width;c.height=r.rendering.height;s.objectImage.draw(c.getContext('2d'),0,0,c.width,c.height,0,0,c.width,c.height);return{width:c.width,height:c.height,origin:r.rendering.origin,hybrid:r.rendering.hybrid,metas:r.rendering.visualObjects,png:c.toDataURL().split(',')[1]};});
 assert.equal(scene.hybrid.fallbackObjects,0);assert.equal(scene.hybrid.originalObjects,Object.keys(data.mapKeys).length);
 for(const meta of scene.metas)assert.equal(meta.key,data.mapKeys[meta.type]);
 fs.writeFileSync(path.join(out,'browser-scene.png'),Buffer.from(scene.png,'base64'));delete scene.png;
 const samples=data.cases.filter(c=>c.scope==='yr/TEMPERATE'&&JSON.parse(c.meta.key)[4]===64&&JSON.parse(c.meta.key)[3]===2);
 const actual=await p.evaluate(async metas=>{const prepared=await CrateLiveObjects.prepare({metadata:{version:'yr',theater:'TEMPERATE'},rendering:{visualObjects:metas}},()=>true,{baseLibrary:{refs:[]}});const result=[];
  for(const meta of metas){const row=[];for(const part of prepared.get(meta)){const bytes=part.image.getContext('2d').getImageData(0,0,part.image.width,part.image.height).data;
   const hash=await crypto.subtle.digest('SHA-256',bytes);row.push({x:part.x,y:part.y,width:part.image.width,height:part.image.height,shadow:part.shadow,sha256:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')});}result.push(row);}return result;
 },samples.map(c=>c.meta));
 assert.deepEqual(actual,samples.map(c=>c.expected.map(({file,...part})=>part)),'Edge canvas pixels/anchors');
 await p.evaluate(()=>CrateMapViewer.focus(CrateMapViewer.state.lookup.get('20,20')));
 await p.locator('#terrain3dOpen').click();await p.waitForFunction(()=>!document.getElementById('terrain3dStage').classList.contains('is-loading'),null,{timeout:30000});assert.equal(await p.locator('#terrain3dError').textContent(),'');
 await p.locator('#terrain3dDialog').screenshot({path:path.join(out,'browser-3d.png')});await p.locator('#terrain3dClose').click();
 for(const id of ['mapImageExport','jsonDownload']){const download=p.waitForEvent('download');await p.locator('#'+id).click();const d=await download;await d.saveAs(path.join(out,d.suggestedFilename()));assert.ok(fs.statSync(await d.path()).size>1000);}
 await p.locator('#mineralToggle').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.rendering.hybrid.fallbackObjects),0);
 await p.locator('#mineralToggle').click();await ready();assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.rendering.hybrid.fallbackObjects),0);
 assert.deepEqual(errors,[]);assert.deepEqual(apis,[]);
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({status:'PASS',preparedStates:samples.length,...scene},null,2));console.log('PASS browser import, original components, pixel parity, 3D, exports and both cached layouts');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
