/* Presentation timing only: never changes game frames, scan order or probability. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const PHASES={origin:_t('初始坐标／重抽后的起点'),search:_t('附近搜索（每一圈）'),choose:_t('选择候选'),put:_t('最终放置检查'),retry:_t('准备重新抽取'),done:_t('生成成功'),exhausted:_t('重试耗尽'),heatmap:_t('概率总览')};
 function number(value,label,min,max){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(_t`${label}必须是 ${min}～${max} 的数值。`);
  return value;
 }
 function settings(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(_t('播放参数必须是对象。'));
  const phases=value.phases??{};
  if(!phases||typeof phases!=='object'||Array.isArray(phases))throw Error(_t('阶段参数必须是对象。'));
  const result={speed:number(value.speed??1,_t('整体速度'),.1,10),phases:{}};
  for(const [phase,entry] of Object.entries(phases)){
   if(!Object.hasOwn(PHASES,phase))throw Error(_t`未知播放阶段：${phase}`);
   if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error(_t`${PHASES[phase]}参数必须是对象。`);
   const clean={speed:number(entry.speed??1,_t`${PHASES[phase]}速度`,.1,10)};
   if(entry.seconds!==undefined&&entry.seconds!==null)clean.seconds=number(entry.seconds,_t`${PHASES[phase]}停留秒数`,.1,600);
   result.phases[phase]=clean;
  }
  return result;
 }
 function apply(trace,value={}){
  const timing=settings(value);let time=0;
  for(const [i,step] of trace.steps.entries()){
   const phase=timing.phases[step.phase]||{};
   // Keep source duration so editing timing repeatedly cannot compound the speed.
   step.baseDuration??=step.duration;
   step.duration=(phase.seconds??step.baseDuration)/(phase.speed??1)/timing.speed;
   step.i=i;step.start=time;time+=step.duration;step.end=time;
  }
  trace.duration=time;trace.timing=timing;return trace;
 }
 function fromQuery(query){
  const params=new URLSearchParams(query),value={phases:{}};
  if(params.has('speed'))value.speed=Number(params.get('speed'));
  for(const phase of Object.keys(PHASES)){
   const entry={};
   if(params.has(`${phase}Seconds`))entry.seconds=Number(params.get(`${phase}Seconds`));
   if(params.has(`${phase}Speed`))entry.speed=Number(params.get(`${phase}Speed`));
   if(Object.keys(entry).length)value.phases[phase]=entry;
  }
  return settings(value);
 }
 const api={PHASES,settings,apply,fromQuery};
 if(typeof module!=='undefined')module.exports=api;root.CrateTiming=api;
})(typeof globalThis!=='undefined'?globalThis:this);
