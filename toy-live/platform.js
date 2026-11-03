/* Experimental local-file adapter. Does not intercept fetch or contact an API. */
(function(root){
 'use strict';
 const base=root.CrateMapPlatform,original={...base},records=new Map(),results=new Map();let worker=null,serial=0,pending=null;
 const local=url=>/\/live-results\//.test(new URL(url,document.baseURI).pathname),canonical=url=>new URL(url,document.baseURI).href;
 function changed(){root.dispatchEvent(new Event('crate-live-busy'));}
 function cancel(){if(!pending)return;worker?.terminate();worker=null;const job=pending;pending=null;changed();job.reject(new DOMException('已取消 / Cancelled','AbortError'));}
 function compute(record,minerals,onProgress){
  if(record.states.has(minerals))return Promise.resolve(record.states.get(minerals));
  if(pending)return Promise.reject(Error('已有计算进行中 / An analysis is already running'));
  if(!worker){
   worker=new Worker(new URL('live/worker.js?v='+root.CrateWebConfig.liveVersion,document.baseURI));
   worker.onerror=()=>{const job=pending;pending=null;worker?.terminate();worker=null;changed();job?.reject(Error('浏览器计算线程异常 / Analysis worker failed'));};
   worker.onmessage=({data})=>{
    const job=pending;if(!job||data.id!==job.id)return;
    if(data.progress!==undefined){job.onProgress?.(data);return;}
    pending=null;changed();if(data.error){root.dispatchEvent(new CustomEvent('crate-live-error',{detail:data.errorDetails||{message:data.error}}));job.reject(Error(data.error));return;}
    const path=`live-results/${data.report.metadata.sourceSha256}-${job.record.version}/${job.minerals?'ore':'clear'}/result.json`;
    data.report.precomputed={search:'search.bin'};
    job.record.states.set(job.minerals,path);records.set(canonical(path),job.record);results.set(canonical(path),data);job.resolve(path);
   };
  }
  return new Promise((resolve,reject)=>{const id=++serial;pending={id,record,minerals,resolve,reject,onProgress};changed();const copy=record.bytes.slice();worker.postMessage({id,bytes:copy.buffer,version:record.version,minerals,filename:record.filename},[copy.buffer]);});
 }
 Object.assign(base,{
  live:true,preload:false,
  terrain3dPatch:(context,options)=>context.data.metadata.liveComputed?root.CrateLiveArtwork.patch(context.data,context.cell,options):original.terrain3dPatch(context,options),
  upload:async(file,version,minerals,onProgress)=>{if(!/\.(map|yrm|mpr)$/i.test(file.name)||file.size>16*1024*1024)throw Error('请选择 16 MB 以内的 .map/.yrm/.mpr / Choose a text map under 16 MB');if(!['ra2','yr'].includes(version))version=/\.mpr$/i.test(file.name)?'ra2':'yr';const record={bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,version,states:new Map()};const result=await compute(record,minerals,onProgress);
   // Keep only this custom map's paired layouts. The viewer retains its active
   // prepared result during a failure; successful new imports release old data.
   for(const[url,value]of records)if(value!==record){records.delete(url);results.delete(url);}return result;},
  readJSON:async(url,options)=>{options?.signal?.throwIfAborted();if(!local(url))return original.readJSON(url,options);const item=results.get(canonical(url));if(!item)throw Error('本地地图尚未载入，请重新选择文件 / Select the local map again');return item.report;},
  readBinary:async(url,options)=>{options?.signal?.throwIfAborted();if(!local(url))return original.readBinary(url,options);const item=results.get(canonical(url.replace(/search\.bin$/,'result.json')));if(!item)throw Error('Local origin records unavailable');return item.search;},
  minerals:async(source,enabled,onProgress)=>{if(!local(source))return original.minerals(source,enabled,onProgress);const record=records.get(canonical(source));if(!record)throw Error('请重新选择地图 / Select the map again');return compute(record,enabled,onProgress);},
  initial:search=>{const requested=new URLSearchParams(search).get('result');if(requested&&local(requested)){sessionStorage.setItem('crate-live-reselect','1');return original.initial('');}return original.initial(search);},
  dispose:()=>{cancel();worker?.terminate();worker=null;records.clear();results.clear();original.dispose();},cancel
 });
 root.CrateLivePlatform={cancel,get busy(){return !!pending;}};
})(globalThis);
