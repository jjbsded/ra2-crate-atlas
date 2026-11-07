/* Toy supports both the official catalog and browser-local map imports. */
(function(){
 'use strict';const $=id=>document.getElementById(id),en=CrateI18n.language==='en',say=(zh,english)=>en?english:zh;
 document.title=document.querySelector('h1').textContent=CrateI18n.t('红警2地图箱子概率计算器');
 document.querySelector('.app-header p').hidden=true;document.querySelector('.app-header .eyebrow').hidden=true;
 const drop=$('dropzone');drop.querySelector('div').hidden=false;drop.querySelector('.file-label').hidden=false;$('version').closest('label').hidden=false;
 $('version').replaceChildren(...[['yr',say('尤里的复仇 1.001','Yuri’s Revenge 1.001')],['ra2',say('红色警戒 2 · 1.006','Red Alert 2 · 1.006')]].map(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;return option;}));
 const label=drop.querySelector('.file-label');label.firstChild.textContent=say('选择自定义地图 ','Choose custom map ');drop.querySelector('p').textContent=say('.map / .yrm / .mpr · 只读','.map / .yrm / .mpr · Read-only');
 const cancel=document.createElement('button');cancel.id='liveCancel';cancel.type='button';cancel.hidden=true;cancel.textContent=say('取消计算','Cancel analysis');cancel.onclick=()=>CrateLivePlatform.cancel();drop.append(cancel);
 window.addEventListener('crate-live-busy',()=>{cancel.hidden=!CrateLivePlatform.busy;});
 const errorDetails=document.createElement('details'),errorSummary=document.createElement('summary'),errorBody=document.createElement('pre');errorDetails.id='liveErrorDetails';errorDetails.hidden=true;errorSummary.textContent=say('错误详情','Error details');errorBody.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:22rem;overflow:auto';errorDetails.append(errorSummary,errorBody);drop.after(errorDetails);
 window.addEventListener('crate-live-error',({detail})=>{errorDetails.hidden=false;errorDetails.open=true;const keys=[['filename','文件','File'],['version','资源版本','Game version'],['stage','处理阶段','Stage'],['section','区块','Section'],['record','记录','Record'],['message','原因','Reason']];errorBody.textContent=keys.filter(([k])=>detail[k]!==undefined).map(([k,zh,eng])=>`${say(zh,eng)}: ${detail[k]}`).join('\n')+(detail.stack?'\n\n'+say('技术信息（用于排查）','Technical details')+'\n'+detail.stack:'');});
 window.addEventListener('crate-live-busy',()=>{if(CrateLivePlatform.busy)errorDetails.hidden=true;});
 $('terrain3dDialog').querySelector('.eyebrow').textContent='TOY / 3D';
 $('terrain3dLoading').textContent=say('正在生成附近地形…','Generating nearby terrain…');
 document.querySelector('footer').hidden=true;
 if(sessionStorage.getItem('crate-live-reselect')){sessionStorage.removeItem('crate-live-reselect');const hint=document.createElement('p');hint.textContent=say('请重新选择上次的地图。','Reselect your previous map.');drop.after(hint);}
})();
