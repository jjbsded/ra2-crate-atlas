const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.TOY_BASE||'http://127.0.0.1:8793/toy/crate-atlas/',out=path.resolve('output/terrain-shadow-verification-20261103');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],apis=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')||r.method()!=='GET')apis.push(r.url());});
 await page.goto(base+'index.html');await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await page.locator('#mapFile').setInputFiles(path.join(out,'source.map'));
 await page.waitForFunction(()=>CrateMapViewer.state.data?.metadata.liveComputed&&!CrateMapViewer.state.busy,null,{timeout:120000});
 assert.equal(await page.locator('#error').textContent(),'');
 const result=await page.evaluate(async()=>{
  const state=CrateMapViewer.state,r=state.data,scene=CrateToyOriginal.get(r);
  const tiles=Object.keys(scene.data.tiles).filter(k=>/^clear01[a-g]?\.urb\/0$/.test(k));
  const shadows=scene.commands.filter(c=>c.shadow);
  const c=document.createElement('canvas');c.width=900;c.height=460;state.objectImage.draw(c.getContext('2d'),2100,390,900,460,0,0,900,460);
  const patch=await CrateLiveArtwork.patch(r,state.lookup.get('54,95'),{radius:4});
  return{tiles,shadows:shadows.length,shadowLevels:[...new Set(shadows.map(c=>c.level))],hybrid:r.rendering.hybrid,threeDTextures:new Set(patch.cells.map(c=>JSON.stringify([c.texture,c.textureRect]))).size,png:c.toDataURL().split(',')[1]};
 });
 assert.equal(result.tiles.length,8);assert.ok(result.shadows>100);assert.ok(result.threeDTextures>=8);assert.ok(result.hybrid.originalObjects>500);
 fs.writeFileSync(path.join(out,'toy-custom.png'),Buffer.from(result.png,'base64'));delete result.png;assert.deepEqual(errors,[]);assert.deepEqual(apis,[]);
 fs.writeFileSync(path.join(out,'toy-browser.json'),JSON.stringify({status:'PASS',...result},null,2));console.log('PASS Toy custom map:',result.shadows,'shadow parts,',result.tiles.length,'ground variants,',result.threeDTextures,'3D textures');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
