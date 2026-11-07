/* Temporary, page-local controls for region-title relocation animations. */
(function(root){
 'use strict';
 const defaults={maxSpeed:8000,acceleration:20000};
 function create({host,onChange}){
  const t=root.CrateI18n?.t||(s=>s),settings={...defaults},fields=new Map();
  const panel=document.createElement('section');panel.id='regionTitleTuning';panel.className='region-title-tuning';panel.setAttribute('aria-label',t('标题动画 · 临时'));
  const header=document.createElement('div');header.className='region-title-tuning-header';
  const title=document.createElement('span');title.textContent=t('标题动画 · 临时');header.append(title);
  const toggle=document.createElement('button');toggle.type='button';toggle.textContent='−';toggle.setAttribute('aria-label',t('折叠面板'));toggle.setAttribute('aria-expanded','true');header.append(toggle);panel.append(header);
  const content=document.createElement('div');content.className='region-title-tuning-content';panel.append(content);
  for(const [key,label,unit,max]of [['maxSpeed','最大速度','px/s',20000],['acceleration','加速度','px/s²',50000]]){
   const row=document.createElement('label');row.className='region-title-tuning-row';
   const caption=document.createElement('span');caption.textContent=t(label);row.append(caption);
   const number=document.createElement('input');number.type='number';number.id=key==='maxSpeed'?'regionTitleMaxSpeed':'regionTitleAcceleration';number.min=1;number.max=max;number.step=1;number.value=settings[key];number.setAttribute('aria-label',t(label));row.append(number);
   const suffix=document.createElement('small');suffix.textContent=unit;row.append(suffix);content.append(row);
   const range=document.createElement('input');range.type='range';range.min=1;range.max=max;range.step=1;range.value=settings[key];range.setAttribute('aria-label',t(label));content.append(range);
   const update=input=>{
    if(input.value.trim()===''||!Number.isFinite(Number(input.value)))return;
    settings[key]=Math.min(max,Math.max(1,Math.round(Number(input.value))));
    number.value=range.value=settings[key];onChange();
   };
   number.oninput=()=>update(number);range.oninput=()=>update(range);number.onblur=()=>{number.value=settings[key];};fields.set(key,{number,range});
  }
  const footer=document.createElement('div');footer.className='region-title-tuning-footer';
  const note=document.createElement('small');note.textContent=t('本页有效');footer.append(note);
  const reset=document.createElement('button');reset.type='button';reset.id='regionTitleMotionReset';reset.textContent=t('恢复默认');reset.onclick=()=>{Object.assign(settings,defaults);for(const [key,{number,range}]of fields)number.value=range.value=settings[key];onChange();};footer.append(reset);content.append(footer);
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
