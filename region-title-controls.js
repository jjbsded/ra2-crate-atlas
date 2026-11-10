/* Temporary, page-local controls for buffered region-title destinations. */
(function(root){
 'use strict';
 const defaults=root.CrateRegionLabelLayout.defaults;
 function create({host,onChange,enabled=false}){
  const t=root.CrateI18n?.t||(s=>s),settings={...defaults},fields=new Map();
  if(!enabled)return {settings,element:null};
  const panel=document.createElement('section');panel.id='regionTitleTuning';panel.className='region-title-tuning';panel.setAttribute('aria-label',t('标题定位缓冲 · 调试'));
  const header=document.createElement('div');header.className='region-title-tuning-header';
  const title=document.createElement('span');title.textContent=t('标题定位缓冲 · 调试');header.append(title);
  const toggle=document.createElement('button');toggle.type='button';toggle.textContent='−';toggle.setAttribute('aria-label',t('折叠面板'));toggle.setAttribute('aria-expanded','true');header.append(toggle);panel.append(header);
  const content=document.createElement('div');content.className='region-title-tuning-content';panel.append(content);
  const checks=new Map();
  const centerHelp='按本区域在当前视野内的可见范围计算；只影响新位置，不影响字号。';
  const help={insetEnabled:'只在重新选点时优先使用本区域可见范围的中心部分；Lazy 保持、回中或边缘例外时不会强制内移。',insetWidth:centerHelp,insetHeight:centerHelp,sizeTime:'用于无位置移动时的字号变化；平移字号按行程同步，抵达时完成。',returnMargin:'标题外框到视野四边的余量，分别按视野宽、高计算。',returnVisible:'视野内可见的本区域格数 ÷ 本区域总格数；达到后可免除额外回中余量。',edgeOnlyEnabled:'仅在视野边缘可见的区域跳过中心范围，使用正常定位；不改变字号。',edgeBand:'按视野宽、高计算四边条带；区域可见部分全部落在其中某一边时按边缘区域处理。'};
  for(const[key,id,label]of [['insetEnabled','regionTitleInsetEnabled','提前向内定位'],['lazy','regionTitleLazy','Lazy 模式'],['edgeOnlyEnabled','regionTitleEdgeOnly','边缘区域跳过中心范围']]){
   const row=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.id=id;input.checked=settings[key];if(help[key])row.title=t(help[key]);input.onchange=()=>{settings[key]=input.checked;onChange();};row.append(input,' '+t(label));content.append(row);checks.set(key,input);
  }
  for(const [key,id,label,factor=100,unit='%']of [['insetWidth','regionTitleInsetWidth','中心范围宽度'],['insetHeight','regionTitleInsetHeight','中心范围高度'],['returnMargin','regionTitleReturnMargin','回中边缘余量'],['returnVisible','regionTitleReturnVisible','回中可见比例'],['edgeBand','regionTitleEdgeBand','边缘判定范围'],['maxShrink','regionTitleMaxShrink','最大缩小幅度'],['sizeTime','regionTitleSizeTime','静止字号平滑时间',1,'ms']]){
   const row=document.createElement('label');row.className='region-title-tuning-row';
   const caption=document.createElement('span');caption.textContent=t(label);row.append(caption);
   const number=document.createElement('input');number.type='number';number.id=id;number.step='any';number.dataset.factor=factor;number.value=String(settings[key]*factor);number.setAttribute('aria-label',t(label));if(help[key])number.title=t(help[key]);row.append(number);
   const suffix=document.createElement('small');suffix.textContent=unit;row.append(suffix);content.append(row);
   root.CrateNumericInput.bind(number,{get:()=>settings[key]*factor,set:value=>{settings[key]=value/factor;onChange();},valid:value=>key.startsWith('inset')?value>0:['maxShrink','sizeTime','edgeBand'].includes(key)?value>=0:true});fields.set(key,number);
  }
  const footer=document.createElement('div');footer.className='region-title-tuning-footer';
  const explanation=document.createElement('small');explanation.textContent=t('中心范围按本区可见范围；回中余量按视野；可见比例按本区总格数。');content.append(explanation);
  const note=document.createElement('small');note.textContent=t('缩小幅度 0% 为关闭')+' · '+t('本页有效');footer.append(note);
  const reset=document.createElement('button');reset.type='button';reset.id='regionTitleMotionReset';reset.textContent=t('恢复默认');reset.onclick=()=>{Object.assign(settings,defaults);for(const[key,input]of fields){input.value=String(settings[key]*Number(input.dataset.factor));input.setCustomValidity('');}for(const[key,input]of checks)input.checked=settings[key];onChange();};footer.append(reset);content.append(footer);
  toggle.onclick=()=>{content.hidden=!content.hidden;toggle.textContent=content.hidden?'+':'−';toggle.setAttribute('aria-expanded',String(!content.hidden));toggle.setAttribute('aria-label',t(content.hidden?'展开面板':'折叠面板'));};
  let drag=null;
  const position=(x,y,w,h)=>{panel.style.left=Math.max(0,Math.min(x,innerWidth-w))+'px';panel.style.top=Math.max(0,Math.min(y,innerHeight-h))+'px';panel.style.bottom='auto';};
  header.onpointerdown=e=>{if(e.button!==0||e.target.closest('button'))return;const box=panel.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:box.left,top:box.top,w:box.width,h:box.height};header.setPointerCapture(e.pointerId);e.preventDefault();};
  header.onpointermove=e=>{if(drag?.id===e.pointerId)position(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y,drag.w,drag.h);};
  for(const event of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(event,()=>{drag=null;});
  root.addEventListener('resize',()=>{const box=panel.getBoundingClientRect();position(box.left,box.top,box.width,box.height);});
  host.append(panel);return {settings,element:panel};
 }
 root.CrateRegionTitleControls={create};
})(globalThis);
