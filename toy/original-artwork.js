/* Original static map art, shared lossless atlas pages and bounded raster caches.
 * Draw commands were captured from the desktop painter, including bridge and
 * shadow masks. All callers (map, minimap, regions, exports) use this source. */
(function(root){
 'use strict';
 const maps=new Map(),pages=new Map(),scenes=new WeakMap();let cachedBytes=0;
 const mobile=()=>!!root.matchMedia?.('(pointer:coarse)').matches;
 function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
 function expand(values){let n=0;return values.map(v=>n+=v);}
 async function page(url,info){
  if(pages.has(url)){const item=pages.get(url);pages.delete(url);pages.set(url,item);return item.ready;}
  const item={bytes:info.width*info.height*4,ready:null};
  item.ready=(async()=>{const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw Error('Atlas HTTP '+response.status);const blob=await response.blob();
   if(root.createImageBitmap)return createImageBitmap(blob,{premultiplyAlpha:'premultiply'});
   const image=new Image(),address=URL.createObjectURL(blob);try{image.src=address;await image.decode();return image;}finally{URL.revokeObjectURL(address);}
  })().catch(error=>{if(pages.get(url)===item){pages.delete(url);cachedBytes-=item.bytes;}throw error;});
  pages.set(url,item);cachedBytes+=item.bytes;
  // Eviction drops cache ownership, not a bitmap still used by the current map.
  // Its last scene reference releases it through GC after map/layout changes.
  const limit=(mobile()?48:96)*1048576;
  for(const[key,value]of pages){if(cachedBytes<=limit)break;if(key===url)continue;pages.delete(key);cachedBytes-=value.bytes;}
  return item.ready;
 }
 async function bundle(url,readJSON){
  if(maps.has(url)){const p=maps.get(url);maps.delete(url);maps.set(url,p);return p;}
  const pending=(async()=>{
   const data=await (/\.bin\.gz(?:\?|$)/.test(url)?root.CrateMapPlatform.readArtwork(url):readJSON(url));if(data.version!==1)throw Error('Unsupported original artwork');
   const images=new Array(data.atlases.length);let next=0;
   await Promise.all(Array.from({length:Math.min(4,images.length)},async()=>{while(next<images.length){const i=next++;images[i]=await page(new URL(data.atlases[i].file,url).href,data.atlases[i]);}}));
   const columns=data.commands.map(expand),commands=columns[0].map((id,i)=>({id,x:columns[1][i],y:columns[2][i]}));
   return {data,images,commands,layers:data.layers.map(expand),url};
  })().catch(e=>{maps.delete(url);throw e;});
  maps.set(url,pending);while(maps.size>2)maps.delete(maps.keys().next().value);return pending;
 }
 function makeSource(scene,layer){
  const {data,commands,images}=scene,[width,height]=data.size,sequence=scene.layers[layer],buckets=new Map(),chunkSize=512,cache=new Map();let overview=null;
  for(let i=0;i<sequence.length;i++){const c=commands[sequence[i]],a=data.assets[c.id];
   for(let y=Math.floor(c.y/chunkSize);y<=Math.floor((c.y+a[4]-1)/chunkSize);y++)for(let x=Math.floor(c.x/chunkSize);x<=Math.floor((c.x+a[3]-1)/chunkSize);x++){
    const key=`${x},${y}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);
   }
  }
  function paint(ctx,indices){for(const i of indices){const c=commands[sequence[i]],a=data.assets[c.id];ctx.drawImage(images[a[0]],a[1],a[2],a[3],a[4],c.x,c.y,a[3],a[4]);}}
  function small(){if(!overview){const scale=Math.min(1,(mobile()?1280:2048)/Math.max(width,height));overview=canvas(Math.ceil(width*scale),Math.ceil(height*scale));const ctx=overview.getContext('2d');ctx.scale(scale,scale);paint(ctx,sequence.keys());}return overview;}
  function chunk(x,y){const key=`${x},${y}`;if(cache.has(key)){const c=cache.get(key);cache.delete(key);cache.set(key,c);return c;}
   const image=canvas(chunkSize,chunkSize),ctx=image.getContext('2d');ctx.translate(-x*chunkSize,-y*chunkSize);paint(ctx,buckets.get(key)||[]);cache.set(key,image);
   while(cache.size>(mobile()?24:48)){const key=cache.keys().next().value,old=cache.get(key);cache.delete(key);old.width=old.height=1;}return image;
  }
  return {width,height,original:true,...(scene.export?{async renderExport(ctx,view,area){
   const left=Math.max(0,(area.x-view.x)/view.scale),top=Math.max(0,(area.y-view.y)/view.scale),right=Math.min(width,(area.x+area.w-view.x)/view.scale),bottom=Math.min(height,(area.y+area.h-view.y)/view.scale);
   // Small exports retain the native-chunk resampling / warmed overview path.
   // Large exports previously replayed the whole mixed scene synchronously.
   if(view.scale<=Math.min(1,(mobile()?1280:2048)/Math.max(width,height))||(Math.ceil(right/chunkSize)-Math.floor(left/chunkSize))*(Math.ceil(bottom/chunkSize)-Math.floor(top/chunkSize))<=64)return false;
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.beginPath();ctx.rect(view.x,view.y,width*view.scale,height*view.scale);ctx.clip();
   const transform={...view,scaleX:(view.width??width*view.scale)/width,scaleY:(view.height??height*view.scale)/height};
   try{return await scene.export(layer,ctx,transform,area);}finally{ctx.restore();}
  }}:{}),draw(ctx,...args){
   let sx=0,sy=0,sw=width,sh=height,dx,dy,dw,dh;
   if(args.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=args;else [dx,dy,dw=width,dh=height]=args;
   if(!(sw>0&&sh>0&&dw>0&&dh>0))return;
   const transform=ctx.getTransform(),ratio=Math.hypot(transform.a,transform.b)*dw/sw;
   if(ratio<=Math.min(1,(mobile()?1280:2048)/Math.max(width,height))){const image=small();ctx.drawImage(image,sx*image.width/width,sy*image.height/height,sw*image.width/width,sh*image.height/height,dx,dy,dw,dh);return;}
   ctx.save();ctx.beginPath();ctx.rect(dx,dy,dw,dh);ctx.clip();ctx.translate(dx-sx*dw/sw,dy-sy*dh/sh);ctx.scale(dw/sw,dh/sh);ctx.imageSmoothingEnabled=ratio<1;
   const inv=ctx.getTransform().inverse(),corners=[[0,0],[ctx.canvas.width,0],[0,ctx.canvas.height],[ctx.canvas.width,ctx.canvas.height]].map(([x,y])=>[inv.a*x+inv.c*y+inv.e,inv.b*x+inv.d*y+inv.f]);
   const left=Math.max(0,sx,Math.min(...corners.map(p=>p[0]))),top=Math.max(0,sy,Math.min(...corners.map(p=>p[1]))),right=Math.min(width,sx+sw,Math.max(...corners.map(p=>p[0]))),bottom=Math.min(height,sy+sh,Math.max(...corners.map(p=>p[1])));
   const count=(Math.ceil(right/chunkSize)-Math.floor(left/chunkSize))*(Math.ceil(bottom/chunkSize)-Math.floor(top/chunkSize));
   // A preview tile already bounds the output to 260 physical pixels. Rasterize
   // its mixed scene at that size rather than building several full 512px source
   // chunks first. Exact views keep their original source-pixel chunk cache.
   if(count>64||ctx.cratePreviewTile&&scene.paint){const ids=new Set();for(let y=Math.floor(top/chunkSize);y<Math.ceil(bottom/chunkSize);y++)for(let x=Math.floor(left/chunkSize);x<Math.ceil(right/chunkSize);x++)for(const i of buckets.get(`${x},${y}`)||[])ids.add(i);paint(ctx,[...ids].sort((a,b)=>a-b));}
   else for(let y=Math.floor(top/chunkSize);y<Math.ceil(bottom/chunkSize);y++)for(let x=Math.floor(left/chunkSize);x<Math.ceil(right/chunkSize);x++)ctx.drawImage(chunk(x,y),x*chunkSize,y*chunkSize);
   ctx.restore();
  },prepareThumbnail(crop,size){
   if(!scene.thumbnail||size[0]/crop[2]<=Math.min(1,(mobile()?1280:2048)/Math.max(width,height)))return null;
   return scene.thumbnail(layer,crop,size);
  },setOverview:image=>{overview=image;},stats:()=>({chunks:cache.size,overviewPixels:overview?overview.width*overview.height:0,commands:sequence.length})};
 }
 async function create(report,base,readJSON,{signal}={}){
  const config=report.rendering.original,url=new URL(base+config.index,document.baseURI).href,shared=await bundle(url,readJSON);signal?.throwIfAborted();
  const scene={...shared,report};scenes.set(report,scene);
  const start=config.layout==='ore'?2:0,im=makeSource(scene,start),objectImage=makeSource(scene,start+1);
  scene.im=im;scene.objectImage=objectImage;
  return {im,objectImage};
 }
 function get(report,{optional=false}={}){const scene=scenes.get(report);if(!scene&&!optional)throw Error('Original map artwork is not ready');return scene;}
 function sprite(scene,ref){
  if(!ref)return null;const a=scene.data.assets[ref[0]],c=canvas(a[3],a[4]);c.getContext('2d').drawImage(scene.images[a[0]],a[1],a[2],a[3],a[4],0,0,a[3],a[4]);return c;
 }
 root.CrateToyOriginal={create,get,sprite,canvas,stats:()=>({cachedAtlasBytes:cachedBytes,cachedAtlases:pages.size,cachedMaps:maps.size})};
})(globalThis);
