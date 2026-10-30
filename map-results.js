/* Report preparation is independent of the viewer DOM. Only the latest
 * foreground load may commit; each layout owns its reusable source index. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 function createReader({fetch=(...args)=>root.fetch(...args),Image=root.Image,readJSON=null,readBinary=null,
  createSources=(...args)=>root.CrateTransferOrigins.create(...args)}={}){
  return async function read(url,{signal}={}){
   let data;
   if(readJSON)data=await readJSON(url,{signal});
   else{const response=await fetch(url,{cache:'no-store',signal});
    if(!response.ok)throw Error(_t('分析结果无法读取，请重新分析地图'));
    data=await response.json();}
   const base=url.slice(0,url.lastIndexOf('/')+1);
   _i18n?.diagnostics(data);
   if(!data.metadata||!Array.isArray(data.cells)||(!data.rendering?.image&&!data.rendering?.simplified&&!data.rendering?.original))throw Error(_t('地图分析结果不完整，请重新分析地图'));
   async function picture(name){
    if(!name)return null;
    const image=new Image();image.src=base+name+'?v='+(data.rendering.version||1);
    await image.decode();return image;
   }
   let im,objectImage;
   if(data.rendering.original){
    if(!root.CrateToyOriginal||!readJSON)throw Error('Original Toy artwork loader is unavailable');
    ({im,objectImage}=await root.CrateToyOriginal.create(data,base,readJSON,{signal}));
   }else if(data.rendering.simplified){
    if(data.rendering.simplified.version!==1||!root.CrateToyTerrain)throw Error('Unsupported Toy artwork format');
    ({im,objectImage}=root.CrateToyTerrain.create(data));
   }else{
    const [ground,other]=await Promise.all([picture(data.rendering.image),data.rendering.objectImage===data.rendering.image?null:picture(data.rendering.objectImage)]);
    im=ground;objectImage=data.rendering.objectImage===data.rendering.image?im:other;
   }
   signal?.throwIfAborted();
   let sourceIndex=null;
   function getSources(){
    if(!sourceIndex)sourceIndex=(readBinary?readBinary(base+(data.precomputed?.search||'search.bin')):fetch(base+'search.bin').then(async response=>{
     if(!response.ok)throw Error(_t('来源记录无法读取，请重新分析地图。'));
     return response.arrayBuffer();
    })).then(buffer=>createSources(data,buffer)).catch(error=>{sourceIndex=null;throw error;});
    return sourceIndex;
   }
   return {url,data,base,im,objectImage,getSources};
  };
 }
 function createLoader(read){
  let revision=0,controller=null;
  function invalidate(){++revision;controller?.abort();controller=null;}
  function request(url,prepared=null){
   invalidate();const ticket=revision;controller=new AbortController();
   return {ready:prepared?Promise.resolve(prepared):read(url,{signal:controller.signal}),current:()=>ticket===revision};
  }
  return {request,invalidate};
 }
 const api={createReader,createLoader};root.CrateMapResults=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
