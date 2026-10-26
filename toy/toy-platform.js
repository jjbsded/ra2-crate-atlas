/* Explicit static data source for the shared map workspace. No API emulation. */
(function(root){
 'use strict';
 function create({base=new URL('./',root.document.baseURI),fetch=(...args)=>root.fetch(...args),Worker=root.Worker}={}){
  const t=s=>root.CrateI18n?.t(s)||s;
  let catalogPromise=null,worker=null,sequence=0,workerUnavailable=false;
  const pending=new Map(),reports=new Map();
  function address(path){
   const url=new URL(path,base);
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error(t('此链接不属于当前静态地图包。'));
   return url.href;
  }
  async function raw(url,type,signal){
   const response=await fetch(url,{cache:'force-cache',signal});
   if(!response.ok)throw Error(t('静态地图文件读取失败，请重试。')+' ('+response.status+')');
   let bytes=await response.arrayBuffer();const header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
   if(header[0]===31&&header[1]===139){
    if(typeof root.DecompressionStream==='undefined')throw Error(t('浏览器版本过旧，无法读取压缩地图，请使用新版浏览器。'));
    bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('gzip'))).arrayBuffer();
   }
   signal?.throwIfAborted();
   return type==='json'?JSON.parse(new TextDecoder().decode(bytes)):bytes;
  }
  async function direct(url,type,signal){
   const value=await raw(url,type,signal),codec=root.CrateStaticCodec;
   if(!codec){if(value?._static)throw Error('CODEC_UNAVAILABLE');return value;}
   const result=type==='json'?await codec.report(value,path=>raw(address(new URL(path,url).href),'json',signal)):codec.search(value);
   signal?.throwIfAborted();return result;
  }
  function load(path,type,{signal}={}){
   signal?.throwIfAborted();const resource=new URL(address(path)),revision=root.CrateWebConfig?.catalogVersion;
   // Report filenames are stable across deployments. Keep ore caches within
   // one build, but do not pair a new renderer with a previous build's report.
   if(revision)resource.searchParams.set('build',revision);
   const url=resource.href;
   if(!Worker||workerUnavailable)return direct(url,type,signal);
   if(!worker){
    try{
     const version=root.CrateWebConfig?.workerVersion;
     worker=new Worker(address('data-worker.js'+(version?'?v='+encodeURIComponent(version):'')));
     worker.onmessage=({data})=>{
      const request=pending.get(data.id);if(!request)return;
      pending.delete(data.id);request.cleanup();
      if(data.error)request.reject(Error(data.error==='BROWSER_GZIP_UNAVAILABLE'?t('浏览器版本过旧，无法读取压缩地图，请使用新版浏览器。'):t('静态地图文件读取失败，请重试。')+' '+data.error));
      else request.resolve(data.value);
     };
     worker.onerror=()=>{
      workerUnavailable=true;worker?.terminate();worker=null;
      for(const request of pending.values()){request.cleanup();direct(request.url,request.type,request.signal).then(request.resolve,request.reject);}
      pending.clear();
     };
    }catch{workerUnavailable=true;return direct(url,type,signal);}
   }
   return new Promise((resolve,reject)=>{
    const id=++sequence;
    const abort=()=>{pending.delete(id);worker?.postMessage({id,cancel:true});reject(signal.reason);};
    pending.set(id,{resolve,reject,url,type,signal,cleanup:()=>signal?.removeEventListener('abort',abort)});
    signal?.addEventListener('abort',abort,{once:true});worker.postMessage({id,url,type});
   });
  }
  async function catalog(){
   if(!catalogPromise)catalogPromise=(async()=>{
    const version=root.CrateWebConfig?.catalogVersion;
    const response=await fetch(address('catalog.json'+(version?'?v='+encodeURIComponent(version):'')),{cache:'force-cache'});
    if(!response.ok)throw Error(t('地图目录未能加载，请重试。'));
    const data=await response.json();
    if(data.schemaVersion!==1||!data.precomputed||!data.maps?.length)throw Error(t('静态地图目录格式不正确。'));
    for(const entry of data.maps)for(const [version,variant]of Object.entries(entry.variants)){
     for(const [layout,path]of Object.entries(variant.reports))reports.set(address(path),{entry,version,variant,layout});
    }
    return data;
   })().catch(error=>{catalogPromise=null;throw error;});
   return catalogPromise;
  }
  async function official(id,version,minerals=true){
   const data=await catalog(),entry=data.maps.find(e=>e.id===id),variant=entry?.variants[version];
   if(!variant)throw Error(t('此地图版本不在当前预计算列表中。'));
   return variant.reports[minerals?'ore':'clear'];
  }
  async function initial(search){
   const data=await catalog(),requested=new URLSearchParams(search).get('result');
   if(requested){if(reports.has(address(requested)))return requested;throw Error(t('此结果不在当前预计算列表中，请重新选择地图。'));}
   const entry=data.maps.find(e=>e.id===data.default)||data.maps[0];
   return official(entry.id,entry.variants.yr?'yr':'ra2');
  }
  async function minerals(source,enabled,onProgress){
   await catalog();const current=reports.get(address(source));
   if(!current)throw Error(t('此结果不在当前预计算列表中，请重新选择地图。'));
   onProgress?.({message:t('正在下载预计算布局'),progress:30});
   return current.variant.reports[enabled?'ore':'clear'];
  }
  function dispose(){worker?.terminate();worker=null;for(const request of pending.values()){request.cleanup();request.reject(Error('Disposed'));}pending.clear();}
  return {static:true,terrain3d:true,terrain3dPatch:(context,options)=>root.CrateToyTerrain3D.patch(context.data,context.cell,options),preload:!(root.navigator?.connection?.saveData||root.matchMedia?.('(pointer: coarse)').matches),
   catalog,official,initial,minerals,readJSON:(path,options)=>load(path,'json',options),readBinary:(path,options)=>load(path,'binary',options),dispose};
 }
 const api={create};if(typeof module!=='undefined')module.exports=api;
 else{root.CrateMapPlatform=create();root.addEventListener('pagehide',()=>root.CrateMapPlatform.dispose());}
})(typeof globalThis!=='undefined'?globalThis:this);
