/* Keep only the current map's two layouts, including decoded artwork.
 * Background and foreground callers share the same in-flight computation. */
(function(root){
 'use strict';
 const localAPI=typeof module!=='undefined'?require('./local-api.js'):root.CrateLocalAPI;
 function create({request,read,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let context=null;
  const enabled=entry=>entry.data.metadata.mineralsEnabled!==false;
  function use(entry,{reset=false}={}){
   if(reset||!context)context={source:entry.url,metadata:entry.data.metadata,ready:new Map(),pending:new Map()};
   context.ready.set(enabled(entry),entry);
  }
  function get(value,onProgress,{background=false}={}){
   const current=context;
   if(!current)return Promise.reject(Error('请先打开地图'));
   if(current.ready.has(value)){
    onProgress?.({message:'正在应用已缓存的布局',progress:100});
    return Promise.resolve(current.ready.get(value));
   }
   let pending=current.pending.get(value);
   if(!pending){
    pending={listeners:new Set(),status:{message:'准备读取地图',progress:0}};
    current.pending.set(value,pending);
    const update=status=>{pending.status=status;for(const listener of pending.listeners)listener(status);};
    pending.promise=(async()=>{
     const job=await request('/api/maps/minerals',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({result:current.source,enabled:value,background})});
     const url=await localAPI.waitForMapJob(job,{request,wait,onProgress:update});
     update({message:'正在加载地图画面',progress:100});
     const entry=await read(url);
     if(enabled(entry)!==value||entry.data.metadata.sourceSha256!==current.metadata.sourceSha256||
        entry.data.metadata.version!==current.metadata.version)throw Error('矿石布局与当前地图不匹配，请重新分析地图');
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
