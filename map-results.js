/* Report preparation is independent of the viewer DOM. Only the latest
 * foreground load may commit; each layout owns its reusable source index. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 function createReader({fetch=(...args)=>root.fetch(...args),Image=root.Image,
  createSources=(...args)=>root.CrateTransferOrigins.create(...args)}={}){
  return async function read(url,{signal}={}){
   const response=await fetch(url,{cache:'no-store',signal});
   if(!response.ok)throw Error(_t('分析结果无法读取，请重新分析地图'));
   const data=await response.json(),base=url.slice(0,url.lastIndexOf('/')+1);
   _i18n?.diagnostics(data);
   if(!data.metadata||!Array.isArray(data.cells)||!data.rendering?.image)throw Error(_t('地图分析结果不完整，请重新分析地图'));
   async function picture(name){
    if(!name)return null;
    const image=new Image();image.src=base+name+'?v='+(data.rendering.version||1);
    await image.decode();return image;
   }
   const [im,objectImage]=await Promise.all([picture(data.rendering.image),picture(data.rendering.objectImage)]);
   signal?.throwIfAborted();
   let sourceIndex=null;
   function getSources(){
    if(!sourceIndex)sourceIndex=fetch(base+'search.bin').then(async response=>{
     if(!response.ok)throw Error(_t('来源记录无法读取，请重新分析地图。'));
     return createSources(data,await response.arrayBuffer());
    }).catch(error=>{sourceIndex=null;throw error;});
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
