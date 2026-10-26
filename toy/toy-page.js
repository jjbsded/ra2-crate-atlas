/* Presentation changes only. The shared model and workspace remain authoritative. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),t=s=>CrateI18n.t(s),maps=!!$('map');
 document.body.classList.add('toy');
 for(const link of document.querySelectorAll('a[data-doc-en]')){link.href='about.html';link.removeAttribute('data-doc-en');}
 const nav=document.querySelector('.page-links'),help=document.createElement('a');help.href='about.html';help.textContent=t('网页版说明');nav?.prepend(help);
 if(maps){
  document.title=t('官方地图概率图集 · 低清简化版（非完整版）')+' · Crate Atlas';
  document.querySelector('.eyebrow').textContent='CRATE ATLAS / WEB EDITION';
  document.querySelector('h1').textContent=t('官方地图概率图集 · 低清简化版');
  document.querySelector('.app-header p').textContent=t('低清简化版，非完整版 · 底图降低清晰度，保留模型内精确概率与初始静态布局');
  $('version').value='yr';
  for(const selector of ['#dropzone .file-label','#dropzone>div','#dropzone>label','#resourcesOpen','#resourceSummary'])document.querySelector(selector)?.setAttribute('hidden','');
  $('terrain3dRelief').closest('label').hidden=true;
  $('terrain3dDialog').querySelector('.eyebrow').textContent=t('TOY / 简化 3D');
  $('terrain3dLoading').textContent=t('正在生成附近的简化 3D 地形…');
  document.querySelector('.terrain3d-gesture').textContent=t('单指旋转 · 双指平移 / 缩放 · 轻点选格 · 滚轮缩放 · 右键平移');
  const decorationLabel=$('terrain3dDecorations').closest('label');
  for(const child of [...decorationLabel.childNodes])if(child.nodeType===3)child.textContent=t('桥梁 / 对象符号');
  const scope=$('terrain3dRiskScope').nextElementSibling;
  scope.textContent=t('蓝色仅示高差条件，未标色不代表可通行；外观为简化符号，不演示完整寻路。');
  // Collapsible controls/details preserve a useful viewport on narrow screens
  // and in phone landscape; desktop keeps both expanded.
  const compact3d=matchMedia('(max-width:760px), (pointer:coarse), (max-height:600px)').matches;
  for(const [selector,id,label]of [['.terrain3d-controls','toy3dControls','视角与图层'],['.terrain3d-footer','toy3dDetails','格子信息与判定']]){
   const content=document.querySelector(selector),wrapper=document.createElement('details'),summary=document.createElement('summary');
   wrapper.id=id;wrapper.className='toy-3d-panel';wrapper.open=!compact3d;summary.textContent=t(label);content.before(wrapper);wrapper.append(summary,content);
  }
  document.querySelector('.terrain3d-header').after($('terrain3dError'));
  $('reanalyzeResources').parentElement.hidden=true;
  $('officialMapAnalyze').textContent=t('打开预计算地图');
  document.querySelector('.official-maps-note').textContent=t('此列表仅含网页版已预计算的地图，并非完整官方地图目录。');
  CrateMapPlatform.catalog().then(data=>{
   if(data.scope?.completeModes&&data.scope.modes.length===2&&data.scope.modes.includes('standard')&&data.scope.modes.includes('teamgame'))document.querySelector('.official-maps-note').textContent=t('本版收录全部作战和小队联盟官方地图；其他模式未收录。');
   if(data.artwork?.compact){
    const note=document.createElement('p');note.className='hint';note.id='toyArtworkNote';
    note.textContent=t(data.artwork.style==='tiles'?'逐格简绘版：保留高度与坡形，共用简化地表和对象符号；概率、来源百分比和区域统计精度不变。':'50MB 轻量版：底图清晰度已降低，概率、来源百分比和区域统计精度不变。');
    document.querySelector('.official-maps-note').after(note);
    if(data.artwork.style==='tiles'){
     document.querySelector('.app-header p').textContent=t('低清简化版，非完整版 · 逐格拼接简化素材，保留模型内精确概率与初始静态布局');
     const legend=document.createElement('details'),summary=document.createElement('summary'),items=document.createElement('div'),hint=document.createElement('p');
     legend.id='toyArtworkLegend';summary.textContent=t('简化地图图例');items.className='toy-art-legend';
     for(const [kind,label]of [['tree','树木'],['drill','矿石钻井'],['scenery','其他地形物'],['oil','油井'],['repair','修桥小屋'],['hospital','医院'],['armory','科技兵营'],['lab','秘密实验室'],['tech','其他科技建筑'],['building','普通建筑'],['civilian','平民'],['animal','动物'],['soldier','步兵'],['vehicle','车辆'],['aircraft','飞机']]){
      const item=document.createElement('span'),canvas=document.createElement('canvas');canvas.width=84;canvas.height=88;canvas.setAttribute('aria-hidden','true');const context=canvas.getContext('2d');context.scale(2,2);CrateToySymbols.symbol(context,kind,21,40);item.append(canvas,document.createTextNode(t(label)));items.append(item);
     }
     hint.textContent=t('方块悬崖和对象符号仅示意高度与位置，不代表原贴图外形；通行、选格与遮挡标识仍按原地图数据判定。');hint.className='hint';legend.append(summary,items,hint);document.querySelector('.canvas-tools').before(legend);
    }
   }
  }).catch(()=>{});
  $('mapInteractionHint').textContent=t('单指拖动平移，轻点选格；双指缩放。编辑区域时可切换移动／画笔，双指始终移动缩放。');
  document.querySelector('.view-controls').nextElementSibling.textContent=t('矿石/树木开关读取两套预计算布局，切换后来源、区域统计和导出同步更新。');
  const toolbar=document.querySelector('.canvas-tools'),settings=document.createElement('details'),summary=document.createElement('summary');settings.id='toyDisplaySettings';summary.textContent=t('图层与显示设置');settings.append(summary);settings.open=!matchMedia('(max-width:760px), (pointer: coarse) and (max-width:1100px), (orientation:landscape) and (max-height:600px) and (max-width:1200px)').matches;
  const children=[...$('workspace').children],start=children.indexOf($('probabilityNote')),end=children.indexOf(toolbar);
  toolbar.before(settings);for(const child of children.slice(start,end))settings.append(child);
  const navigator=document.createElement('button');navigator.type='button';navigator.id='webNavigator';navigator.textContent=t('地图导航');navigator.onclick=()=>{$('minimap').click();};toolbar.insertBefore(navigator,$('fullscreen'));
  $('minimap').addEventListener('change',()=>navigator.setAttribute('aria-pressed',String($('minimap').checked)));
  if(matchMedia('(pointer: coarse)').matches)$('minimap').checked=false;
  navigator.setAttribute('aria-pressed',String($('minimap').checked));
 }else{
  document.title=t('概率演示 · 低清简化版（非完整版）')+' · Crate Atlas';
  document.querySelector('h1').textContent=t('概率演示 · 低清简化版（非完整版）');
  $('exportAll').hidden=$('exportCurrent').hidden=true;
  $('exportStatus').textContent=t('轻量网页版只读取预计算地图；自定义地图、Mod 和视频导出请使用本地完整版。');
  const info=$('exportAll').parentElement.nextElementSibling;if(info?.tagName==='P')info.hidden=true;
  document.querySelector('.page-switch strong').textContent=t('官方地图概率图集');
  document.querySelector('.page-switch').setAttribute('aria-label',t('官方地图概率图集'));
 }
 document.querySelector('footer').textContent=t('低清简化版，非完整版。只读取预计算地图，支持简化 3D；自定义地图、Mod、原贴图精细 3D 和视频导出请使用本地完整版。');
})();

