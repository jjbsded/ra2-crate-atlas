const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('output/terrain-shadow-verification-20261103');
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('about:blank');await p.addScriptTag({path:path.resolve('toy-live/mixed-painter.js')});
 const pixels=await p.evaluate(()=>{
  const image=(w,color)=>{const c=document.createElement('canvas');c.width=w;c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,1);return c;};
  const ground=image(5,'rgb(200,120,80)'),body=image(1,'rgb(210,30,60)'),shadow=image(5,'rgba(0,0,0,0.5019607843137255)');
  const scene={images:[ground,body,shadow],data:{assets:[[0,0,0,5,1],[1,0,0,1,1],[2,0,0,5,1],[0,0,0,1,1]]},commands:[
   {id:0,x:0,y:0,terrain:true,receiver:true,level:2},
   {id:1,x:1,y:0,solid:true,stencil:4},
   {id:3,x:2,y:0,terrain:true,receiver:false,level:2},
   {id:3,x:3,y:0,terrain:true,receiver:true,level:6},
   {id:2,x:0,y:0,shadow:true,level:2}]};
  const c=image(5,'transparent'),sequence=scene.commands.map((_,i)=>i);CrateLivePainter.create(scene)(c.getContext('2d'),sequence,sequence);
  return Array.from(c.getContext('2d').getImageData(0,0,5,1).data);
 });
 assert.deepEqual(pixels,[100,60,40,255,210,30,60,255,200,120,80,255,200,120,80,255,100,60,40,255]);
 await p.goto('http://127.0.0.1:8767/maps.html?result=/output/map-95c0caff6c7d/result.json');
 await p.waitForFunction(()=>window.CrateMapViewer?.state.objectImage&&!CrateMapViewer.state.busy,null,{timeout:120000});
 const info=await p.evaluate(()=>{const s=CrateMapViewer.state,r=s.data.rendering,c=document.createElement('canvas');c.width=900;c.height=460;c.getContext('2d').drawImage(s.objectImage,2100,390,900,460,0,0,900,460);return{version:r.version,scale:r.rasterScale,width:s.objectImage.naturalWidth,png:c.toDataURL().split(',')[1]};});
 assert.equal(info.version,17);assert.equal(info.scale,1);assert.equal(info.width,7380);fs.writeFileSync(path.join(out,'full-browser.png'),Buffer.from(info.png,'base64'));delete info.png;
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'full-browser.json'),JSON.stringify({status:'PASS',...info,shadowReceivers:'same level only; body/cliff/higher ground protected'},null,2));
 console.log('PASS full native raster and Toy shadow receiver compositor');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
