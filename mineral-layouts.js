/* Keep only the current map's two layouts, including decoded artwork.
 * Background and foreground callers share the same in-flight computation. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const localAPI=typeof module!=='undefined'?require('./local-api.js'):root.CrateLocalAPI;
 function create({request,read,load=null,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let context=null;
  const enabled=entry=>entry.data.metadata.mineralsEnabled!==false;
  const matches=(entry,value)=>enabled(entry)===value&&(entry.data.metadata.treesEnabled!==false)===value&&(value||entry.data.metadata.terrainRemovalVersion===1);
  function use(entry,{reset=false}={}){
   if(reset||!context)context={source:entry.url,metadata:entry.data.metadata,ready:new Map(),pending:new Map()};
   if(matches(entry,enabled(entry)))context.ready.set(enabled(entry),entry);
  }
  function get(value,onProgress,{background=false}={}){
   const current=context;
   if(!current)return Promise.reject(Error(_t('请先打开地图')));
   if(current.ready.has(value)){
    onProgress?.({message:_t('正在应用已缓存的布局'),progress:100});
    return Promise.resolve(current.ready.get(value));
   }
   let pending=current.pending.get(value);
   if(!pending){
    pending={listeners:new Set(),status:{message:_t('准备读取地图'),progress:0}};
    current.pending.set(value,pending);
    const update=status=>{pending.status=status;for(const listener of pending.listeners)listener(status);};
    pending.promise=(async()=>{
     let url;
     if(load)url=await load(current.source,value,update);
     else{const job=await request('/api/maps/minerals',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({result:current.source,enabled:value,background})});
      url=await localAPI.waitForMapJob(job,{request,wait,onProgress:update});}
     update({message:_t('正在加载地图画面'),progress:100});
     const entry=await read(url);
     if(!matches(entry,value)||entry.data.metadata.sourceSha256!==current.metadata.sourceSha256||
        entry.data.metadata.version!==current.metadata.version)throw Error(_t('矿石/树木布局与当前地图不匹配，请重新分析地图'));
     // A late background result belongs only to its original map context.
     current.ready.set(value,entry);
     return entry;
    })().finally(()=>{current.pending.delete(value);pending.listeners.clear();});
   }
   if(onProgress){pending.listeners.add(onProgress);onProgress(pending.status);}
   return pending.promise;
  }
  return {use,get,has:value=>!!context?.ready.has(value),pending:value=>!!context?.pending.has(value)};
 }
 const api={create};root.CrateMineralLayouts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
