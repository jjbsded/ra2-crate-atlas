/* Explain local-service failures separately from missing game resources. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const help=_t('请重新运行“启动工具.cmd”并保持服务窗口开启，然后重试。官方地图和原版资源已内置，无需设置游戏目录。');
 async function json(url,options={}){
  let response;
  try{response=await fetch(url,options);}
  catch(error){if(options.signal?.aborted)throw error;throw Error(_t('无法连接本地工具服务或连接已中断。')+help);}
  let data;
  try{data=await response.json();}
  catch(error){
   if(options.signal?.aborted)throw error;
   if(response.status===404)throw Error(_t('当前服务未提供此功能，可能仍在运行旧版本。请关闭旧服务窗口，再运行“启动工具.cmd”并刷新页面。'));
   throw Error(_t('本地服务返回的内容不完整或格式不正确。')+help);
  }
  _i18n?.diagnostics(data);
  if(!response.ok){const error=Error(data.error||_t`本地服务请求失败（${response.status}）。请重试。`);error.status=response.status;throw error;}
  return data;
 }
 function pause(ms,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
   const timer=setTimeout(finish,ms);
   const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
   signal?.addEventListener('abort',abort,{once:true});
  });
 }
 async function waitForMapJob(job,{request=json,wait=pause,onProgress,signal}={}){
  if(job.url)return job.url;
  if(!job.id)throw Error(_t('分析任务缺少编号，请重新分析地图'));
  for(;;){
   signal?.throwIfAborted();
   const status=await request('/api/maps/job/'+job.id,{signal});
   if(status.error)throw Error(status.error);
   onProgress?.(status);
   if(status.done){if(!status.url)throw Error(_t('分析已结束，但结果记录缺失，请重新分析地图'));return status.url;}
   await wait(700,signal);
  }
 }
 const api={json,waitForMapJob};root.CrateLocalAPI=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
