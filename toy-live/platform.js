/* Experimental local-file adapter. Does not intercept fetch or contact an API. */
(function(root){
 'use strict';
 const base=root.CrateMapPlatform,original={...base},records=new Map(),results=new Map();let worker=null,workerRecord=null,sourceSerial=0,serial=0,pending=null;
 const local=url=>/\/live-results\//.test(new URL(url,document.baseURI).pathname),canonical=url=>new URL(url,document.baseURI).href;
 function changed(){root.dispatchEvent(new Event('crate-live-busy'));}
 function cancel(){if(!pending)return;worker?.terminate();worker=null;workerRecord=null;const job=pending;pending=null;changed();job.reject(new DOMException('已取消 / Cancelled','AbortError'));}
 function compute(record,minerals,onProgress,plan=null,force=false){
  const stateKey=plan?JSON.stringify(plan):String(minerals);
  if(!force&&record.states.has(stateKey))return Promise.resolve(record.states.get(stateKey));
  if(pending)return Promise.reject(Error('已有计算进行中 / An analysis is already running'));
  if(!worker){
   worker=new Worker(new URL('live/worker.js?v='+root.CrateWebConfig.liveVersion,document.baseURI));
   worker.onerror=()=>{const job=pending;pending=null;worker?.terminate();worker=null;workerRecord=null;changed();job?.reject(Error('浏览器计算线程异常 / Analysis worker failed'));};
   worker.onmessage=({data})=>{
    const job=pending;if(!job||data.id!==job.id)return;
    if(data.progress!==undefined){job.onProgress?.({...data,message:root.CrateI18n?.message(data.message)||data.message});return;}
    try{data=root.CrateLiveReportTransfer.receive(job,data);if(!data)return;}
    catch(error){pending=null;changed();job.reject(error);return;}
    pending=null;changed();if(data.error){root.dispatchEvent(new CustomEvent('crate-live-error',{detail:data.errorDetails||{message:data.error}}));job.reject(Error(data.error));return;}
    const path=`live-results/${data.report.metadata.sourceSha256}-${job.record.version}/${job.plan?'simulation-'+job.id:job.minerals?'ore':'clear'}/result.json`;
    data.report.precomputed={search:'search.bin'};
    if(data.source)job.record.source=data.source;delete data.source;job.record.states.set(job.stateKey,path);records.set(canonical(path),job.record);results.set(canonical(path),data);if(!job.plan)job.record.originalUrl=canonical(path);
    const kept=[...results.keys()].filter(url=>records.get(url)===job.record&&url!==job.record.originalUrl);
    while(kept.length>8){const old=kept.shift();results.delete(old);records.delete(old);for(const[k,v]of job.record.states)if(canonical(v)===old)job.record.states.delete(k);}
    job.resolve(path);
   };
  }
  return new Promise((resolve,reject)=>{const id=++serial;pending={id,record,minerals,resolve,reject,onProgress,plan,stateKey};changed();const copy=record.source?null:record.bytes?.slice(),sendSource=workerRecord!==record;record.analysisKey??=++sourceSerial;workerRecord=record;root.CrateLiveReportTransfer.postSource((data,transfer)=>worker.postMessage(data,transfer),{id,bytes:copy?.buffer,version:record.version,minerals,filename:record.filename,source:sendSource?record.source:null,sourceContext:record.source&&{simulationAssets:record.source.simulationAssets,allowOre:record.source.allowOre},analysisSourceKey:record.analysisKey,omitSource:!!record.source&&!!plan,chunkedReport:true,plan,force},{valid:()=>pending?.id===id,transfer:copy?[copy.buffer]:[]}).catch(error=>{if(pending?.id===id){pending=null;changed();reject(error);}});});
 }
 async function simulationSource(url){const known=records.get(canonical(url));if(known?.source)return known.source;const report=await original.readJSON(url),m=report.metadata;
  const [recipe,stock]=await Promise.all([original.readJSON(new URL('live/simulation/'+m.sourceSha256+'-'+m.version+'.json.gz',document.baseURI).href),original.readJSON(new URL('live/stock-'+m.version+'.json.gz',document.baseURI).href)]);
  const rules={...stock.rules};for(const[section,patch]of Object.entries(recipe.rules))rules[section]={...stock.rules[section],...patch};
  const source={schema:1,sourceSha256:m.sourceSha256,version:m.version,map:{...recipe.map,WAYPOINTS:recipe.map.WAYPOINTS||m.waypoints||{}},rules,art:stock.art,cells:report.cells};records.set(canonical(url),{source,version:m.version,filename:m.filename,states:new Map()});return source;
 }
 Object.assign(base,{
  live:true,preload:false,
  simulationSource,
  regionNavigation:async(state,signal)=>{
   const source=await simulationSource(state.prepared?.url||state.baseUrl+'result.json');signal?.throwIfAborted();
   return new Promise((resolve,reject)=>{const task=new Worker(new URL('live/worker.js?v='+root.CrateWebConfig.liveVersion,document.baseURI));
    const finish=(fn,value)=>{signal?.removeEventListener('abort',abort);task.terminate();fn(value);},abort=()=>finish(reject,signal.reason||new DOMException('Cancelled','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});task.onerror=e=>finish(reject,Error(e.message));
    task.onmessage=({data})=>data.error?finish(reject,Error(data.error)):finish(resolve,data.navigation);
    task.postMessage({navigationOnly:true,cells:state.data.cells,rules:source.rules,metadata:state.data.metadata});
   });
  },
  simulate:async(url,plan,onProgress,force=false)=>{await simulationSource(url);return compute(records.get(canonical(url)),true,onProgress,plan,force);},
  terrain3dPatch:(context,options)=>context.data.metadata.liveComputed?root.CrateLiveArtwork.patch(context.data,context.cell,options):original.terrain3dPatch(context,options),
  upload:async(file,version,minerals,onProgress)=>{cancel();if(!/\.(map|yrm|mpr)$/i.test(file.name)||file.size>16*1024*1024)throw Error('请选择 16 MB 以内的 .map/.yrm/.mpr / Choose a text map under 16 MB');if(!['ra2','yr'].includes(version))version=/\.mpr$/i.test(file.name)?'ra2':'yr';const record={bytes:new Uint8Array(await file.arrayBuffer()),filename:file.name,version,states:new Map()};const result=await compute(record,minerals,onProgress);
   // Keep only this custom map's paired layouts. The viewer retains its active
   // prepared result during a failure; successful new imports release old data.
   for(const[url,value]of records)if(value!==record){records.delete(url);results.delete(url);}return result;},
  readJSON:async(url,options)=>{options?.signal?.throwIfAborted();if(!local(url))return original.readJSON(url,options);const item=results.get(canonical(url));if(!item)throw Error('本地地图尚未载入，请重新选择文件 / Select the local map again');return item.report;},
  readBinary:async(url,options)=>{options?.signal?.throwIfAborted();if(!local(url))return original.readBinary(url,options);const item=results.get(canonical(url.replace(/search\.bin$/,'result.json')));if(!item)throw Error('Local origin records unavailable');return item.search;},
  minerals:async(source,enabled,onProgress)=>{if(!local(source))return original.minerals(source,enabled,onProgress);const record=records.get(canonical(source));if(!record)throw Error('请重新选择地图 / Select the map again');return compute(record,enabled,onProgress);},
  initial:search=>{const requested=new URLSearchParams(search).get('result');if(requested&&local(requested)){sessionStorage.setItem('crate-live-reselect','1');return original.initial('');}return original.initial(search);},
  dispose:()=>{cancel();worker?.terminate();worker=null;workerRecord=null;records.clear();results.clear();original.dispose();},cancel
 });
 root.CrateLivePlatform={cancel,get busy(){return !!pending;}};
})(globalThis);
