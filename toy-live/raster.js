/* One replaceable raster owner. Atlas bitmaps transfer once per layout. */
(function(root){'use strict';
 function create(exactCanvases=false){
 let worker=null,owner=null,ready=null,serial=0,generation=0,disabled=false;
 const pending=new Map();
 function reset(){generation++;worker?.terminate();worker=owner=ready=null;for(const job of pending.values())job.reject(new DOMException('Superseded raster','AbortError'));pending.clear();}
 function request(data,transfer=[]){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});try{worker.postMessage({id,...data},transfer);}catch(error){pending.delete(id);reject(error);}});}
 function current(scene,token){if(token!==generation||owner!==scene)throw new DOMException('Superseded raster','AbortError');}
 async function prepare(scene){
  if(owner===scene)return ready;
  reset();owner=scene;const token=generation;
  worker=new Worker(new URL('live/raster-worker.js?v='+root.CrateWebConfig.liveVersion,document.baseURI));
  worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job){for(const image of data.images||[])image.close();return;}pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data);};
  worker.onerror=()=>{if(token===generation){disabled=true;reset();}};
  ready=(async()=>{
   const images=[],pixelPages={};let slice=performance.now();
   try{
    for(let i=0;i<scene.images.length;i++){
     if(token!==generation)throw new DOMException('Superseded raster','AbortError');
     const image=scene.images[i];
     if(exactCanvases&&image&&typeof image.getContext==='function'){
      // Match the UI painter's Canvas readback. Some generated translucent
      // sprites round one channel differently when read by OffscreenCanvas.
      const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;
      try{const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);pixelPages[i]={width:copy.width,data:ctx.getImageData(0,0,copy.width,copy.height).data};}
      finally{copy.width=copy.height=1;}
      images[i]=null;
     }else images[i]=image?await createImageBitmap(image):null;
     if(exactCanvases&&performance.now()-slice>3){await new Promise(resolve=>setTimeout(resolve,0));slice=performance.now();}
    }
    if(token!==generation)throw new DOMException('Superseded raster','AbortError');
    await request({scene:{data:{assets:scene.data.assets,size:scene.data.size},commands:scene.commands,layers:scene.layers,images,pixelPages}},[...images.filter(Boolean),...Object.values(pixelPages).map(p=>p.data.buffer)]);
    current(scene,token);return token;
   }catch(error){for(const image of images)image?.close();throw error;}
  })();return ready;
 }
 async function tile(scene,box,overview=false){
  if(disabled||typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')return null;
  try{const token=await prepare(scene);current(scene,token);const data=await request({box,overview});if(token!==generation||owner!==scene){for(const image of data.images)image.close();current(scene,token);}return{box,ground:data.images[0],objects:data.images[1]};}
  catch(error){if(error.name==='AbortError'&&!disabled)throw error;disabled=true;reset();console.warn('Background raster unavailable:',error.message);return null;}
 }
 async function thumbnail(scene,layer,crop,size){
  if(disabled||typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')return null;
  try{const token=await prepare(scene);current(scene,token);const data=await request({thumbnail:{layer,crop,size}});if(token!==generation||owner!==scene){for(const image of data.images)image.close();current(scene,token);}return data.images[0];}
  catch(error){if(error.name==='AbortError'&&!disabled)throw error;disabled=true;reset();console.warn('Background thumbnail unavailable:',error.message);return null;}
 }
 async function output(scene,layer,ctx,view,area){
  if(disabled||typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')return false;
  const scratch=document.createElement('canvas');scratch.width=scratch.height=512;const part=scratch.getContext('2d');
  try{
   const token=await prepare(scene);current(scene,token);
   const scaleX=view.scaleX??view.scale,scaleY=view.scaleY??view.scale,left=Math.max(Math.floor(area.x),Math.floor(view.x)),top=Math.max(Math.floor(area.y),Math.floor(view.y)),right=Math.min(Math.ceil(area.x+area.w),Math.ceil(view.x+scene.data.size[0]*scaleX)),bottom=Math.min(Math.ceil(area.y+area.h),Math.ceil(view.y+scene.data.size[1]*scaleY));
   for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
    current(scene,token);
    const data=await request({output:{layer,box:[x,y,Math.min(512,right-x),Math.min(512,bottom-y)],view}}),pixels=data.pixels;
    current(scene,token);
    if(pixels){part.putImageData(new ImageData(pixels.data,pixels.width,pixels.height),0,0);ctx.drawImage(scratch,0,0,pixels.width,pixels.height,x,y,pixels.width,pixels.height);}
   }
   return true;
  }catch(error){console.warn('Background export unavailable:',error.message);return false;}
  finally{scratch.width=scratch.height=1;}
 }
 return {tile,thumbnail,output,overview:(scene,w,h,scale=true)=>tile(scene,[0,0,w,h],scale),reset,release:scene=>{if(owner===scene)reset();}};
 }
 const raster=create(),thumbnails=create(),cache=new Map();let idle=null,users=0,source=null,pixels=0;
 root.CrateLiveRaster={...raster,async export(scene,...args){
  // Export owns an immutable scene independently of edit/thumbnail workers.
  // Only one output tile is in flight; no second full-size image is allocated.
  const owner=create(true);try{return await owner.output(scene,...args);}finally{owner.reset();}
 },dispose(){
  clearTimeout(idle);raster.reset();thumbnails.reset();for(const item of cache.values())item.image?.close();cache.clear();source=null;pixels=0;
 },async thumbnail(...args){
  const [scene,layer,crop,size]=args,key=[layer,...crop,...size].join(',');
  if(source!==scene){for(const item of cache.values())item.image?.close();cache.clear();pixels=0;source=scene;}
  if(cache.has(key)){const item=cache.get(key);cache.delete(key);cache.set(key,item);return item.ready;}
  const item={image:null,ready:null};cache.set(key,item);
  clearTimeout(idle);users++;
  item.ready=(async()=>{try{
   const image=await thumbnails.thumbnail(...args);
   if(source!==scene){image?.close();throw new DOMException('Superseded thumbnail','AbortError');}
   if(image){item.image=image;pixels+=image.width*image.height;
    for(const [k,old]of cache){if(pixels<=4*1048576&&cache.size<=128)break;if(old===item||!old.image)continue;
     pixels-=old.image.width*old.image.height;old.image.close();cache.delete(k);}
   }else cache.delete(key);
   return image;
  }catch(error){if(cache.get(key)===item)cache.delete(key);throw error;}
  finally{if(!--users)idle=setTimeout(()=>thumbnails.reset(),1000);}})();
  return item.ready;
 }};
})(globalThis);
