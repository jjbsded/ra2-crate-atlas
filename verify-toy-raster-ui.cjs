'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto((process.env.SIM_BASE||'http://127.0.0.1:8788/toy/crate-atlas/')+'about.html');
 await p.addScriptTag({content:'globalThis.CrateWebConfig={liveVersion:"raster-qa"};'});
 for(const url of ['live/mixed-painter.js','live/raster.js','original-artwork.js'])await p.addScriptTag({url});
 const result=await p.evaluate(async()=>{
  function scene(color){
   const image=document.createElement('canvas');image.width=image.height=64;const c=image.getContext('2d');
   c.fillStyle=color;c.fillRect(0,0,64,64);c.clearRect(1,1,10,7);c.fillStyle='#20034080';c.fillRect(25,25,30,30);
   const commands=[];
   for(let y=0;y<600;y+=49)for(let x=0;x<1050;x+=53)commands.push({id:0,x,y,terrain:true,receiver:true,level:0});
   commands.push({id:0,x:480,y:40,solid:true,stencil:2,objects:true},{id:0,x:490,y:90,shadow:true,level:0,objects:true});
   return{data:{assets:[[0,0,0,64,64]],size:[1100,650]},commands,images:[image],layers:[commands.flatMap((c,i)=>c.objects?[]:[i]),commands.map((_,i)=>i)]};
  }
  let comparisons=0;
  for(const color of ['#ef8b33','#37abcf']){
   const s=scene(color),paint=CrateLivePainter.create(s);
   s.paint=paint;const thumbnailScene={...s,data:{...s.data,size:[11000,6500]}};
   for(const layer of [0,1])for(const [crop,size]of [[[19.4,34.5,590,401],[324,183]],[[470,35,181,230],[219,307]],[[0,0,1100,650],[800,300]]]){
    const image=await CrateLiveRaster.thumbnail(thumbnailScene,layer,crop,size),source=CrateToyOriginal.makeSource(thumbnailScene,layer);
    const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=size[0];a.height=b.height=size[1];
    const ac=a.getContext('2d',{willReadFrequently:true}),bc=b.getContext('2d',{willReadFrequently:true});
    source.draw(ac,...crop,0,0,...size);bc.drawImage(image,0,0);
    const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
    for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error('Thumbnail mismatch '+layer+' '+crop+' @'+i+': '+aa[i]+' / '+bb[i]);
    if(await CrateLiveRaster.thumbnail(thumbnailScene,layer,crop,size)!==image)throw Error('Thumbnail pixels not reused');
    comparisons++;
   }
   for(const box of [[0,0,512,512],[512,0,512,256],[0,512,512,120],[137,63,780,550]]){
    const actual=await CrateLiveRaster.tile(s,box);if(!actual)throw Error('Background raster unexpectedly fell back');
    for(const [layer,name]of [[0,'ground'],[1,'objects']]){
     const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=box[2];a.height=b.height=box[3];
     const ac=a.getContext('2d',{willReadFrequently:true}),bc=b.getContext('2d',{willReadFrequently:true});
     ac.translate(-box[0],-box[1]);paint(ac,s.layers[layer].keys(),s.layers[layer]);bc.drawImage(actual[name],0,0);
     const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
     for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error('Pixel mismatch '+name+' '+box+' @'+i+': '+aa[i]+' / '+bb[i]);
     actual[name].close();comparisons++;
    }
   }
   const scale=400/1100,overview=await CrateLiveRaster.overview(s,400,Math.ceil(650*scale),scale);
   for(const[layer,name]of [[0,'ground'],[1,'objects']]){
    const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=400;a.height=b.height=Math.ceil(650*scale);
    const ac=a.getContext('2d',{willReadFrequently:true}),bc=b.getContext('2d',{willReadFrequently:true});ac.scale(scale,scale);paint(ac,s.layers[layer].keys(),s.layers[layer]);bc.drawImage(overview[name],0,0);
    const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
    for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error('Overview mismatch '+name+' @'+i);
    overview[name].close();comparisons++;
   }
  }
  // Full exports use the final output pixel phase, rather than rescaling native
  // chunks. A separate owner must survive simultaneous edit-raster replacement.
  for(const scale of [.37,.42])for(const layer of [0,1]){
   const s=scene('#efa842');s.data.size=[7000,6000];s.paint=CrateLivePainter.create(s);s.export=(...args)=>CrateLiveRaster.export(s,...args);
   if(scale===.42){const ctx=s.images[0].getContext('2d');ctx.clearRect(0,0,64,64);for(let y=0;y<64;y++)for(let x=0;x<64;x++){ctx.fillStyle=`rgba(${x*17%256},${y*23%256},${(x*11+y*7)%256},${(x+y*3)%256/255})`;ctx.fillRect(x,y,1,1);}}
   const source=CrateToyOriginal.makeSource(s,layer),view={x:15.4,y:-20.7,scale},area={x:0,y:0,w:2700,h:2400};
   const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=area.w;a.height=b.height=area.h;
   const ac=a.getContext('2d',{willReadFrequently:true}),bc=b.getContext('2d',{willReadFrequently:true});
   for(const ctx of [ac,bc]){ctx.fillStyle='#183b29';ctx.fillRect(0,0,area.w,area.h);ctx.globalAlpha=.55;}
   source.draw(ac,view.x,view.y,s.data.size[0]*scale,s.data.size[1]*scale);
   const pending=source.renderExport(bc,view,area);CrateLiveRaster.reset();if(!await pending)throw Error('Export unexpectedly fell back');
   const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
   for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error('Export mismatch '+layer+' '+scale+' @'+i+': '+aa[i]+' / '+bb[i]);
   a.width=a.height=b.width=b.height=1;comparisons++;
  }
  for(const layer of [0,1]){
   const s=scene('#ef3842'),scale=.9662766011541853,view={x:123.456789,y:-20.7,scale,scaleX:7000*scale/7000,scaleY:6000*scale/6000},area={x:24,y:82,w:2600,h:2200};
   s.data.size=[7000,6000];const paint=CrateLivePainter.create(s),a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=2700;a.height=b.height=2400;
   const ac=a.getContext('2d',{willReadFrequently:true}),bc=b.getContext('2d',{willReadFrequently:true});
   for(const ctx of [ac,bc]){ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();}
   ac.translate(view.x,view.y);ac.scale(view.scaleX,view.scaleY);paint(ac,s.layers[layer].keys(),s.layers[layer]);
   if(!await CrateLiveRaster.export(s,layer,bc,view,area))throw Error('Fractional-phase export fell back');
   const aa=ac.getImageData(0,0,a.width,a.height).data,bb=bc.getImageData(0,0,b.width,b.height).data;
   for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])throw Error('Global output phase mismatch '+layer+' @'+i);
   a.width=a.height=b.width=b.height=1;comparisons++;
  }
  const old=CrateLiveRaster.tile(scene('#fff'),[0,0,512,512]).catch(e=>e.name);CrateLiveRaster.reset();
  if(await old!=='AbortError')throw Error('Obsolete raster was not cancelled');
  const abandoned=CrateLiveRaster.thumbnail(scene('#afe'),1,[0,0,900,600],[324,183]).catch(error=>error.name);
  CrateLiveRaster.dispose();if(await abandoned!=='AbortError')throw Error('Disposed thumbnail was not cancelled');
  return{comparisons};
 });
 assert.equal(result.comparisons,38);assert.deepEqual(errors,[]);
 await p.waitForTimeout(50);assert.equal(p.workers().length,0,'Disposal releases both raster owners');
 console.log('PASS 38 background/UI pixel-identical tiles, patches, overviews, thumbnails and streamed exports; fractional global output phase, independent lifetime and owner cleanup');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
