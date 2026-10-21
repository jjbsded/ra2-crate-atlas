/* UI-only localization. IDs, probability inputs and user-entered names stay unchanged. */
(function(root){
 'use strict';
 const messages=typeof module!=='undefined'?require('./i18n-en.js'):root.CrateEnglish||{};
 const storageKey='crate-atlas.language.v1';
 const normalize=value=>/^zh(?:[-_]|$)/i.test(String(value))?'zh-CN':'en';
 function initial({saved,system,browser,stored}={}){
  return ['zh-CN','en'].includes(saved)?saved:system?normalize(system):['zh-CN','en'].includes(stored)?stored:normalize(browser||'en');
 }
 let stored=null;try{stored=root.localStorage?.getItem(storageKey);}catch{}
 let language=initial({saved:root.CrateLanguageSettings?.saved,system:root.CrateLanguageSettings?.system,
  browser:root.navigator?.language,stored});
 // Standalone Node modules retain the historical Chinese text unless an export
 // explicitly chooses a language. Do not let a CI host locale alter model tests.
 if(typeof module!=='undefined')language='zh-CN';
 function t(source,...values){
  const tagged=Array.isArray(source),key=tagged?source.reduce((s,part,i)=>s+(i?'{'+(i-1)+'}':'')+part,''):String(source);
  const value=language==='en'?(messages[key]??key):key;
  return tagged?value.replace(/\{(\d+)\}/g,(_,i)=>String(values[Number(i)])):value;
 }
 let patterns,fragments;
 const cache=new Map();
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 function message(value,depth=0){
  if(typeof value!=='string'||language!=='en'||!/[\u3400-\u9fff]/u.test(value))return value;
  if(Object.hasOwn(messages,value))return messages[value];
  if(depth===0&&cache.has(value))return cache.get(value);
  patterns??=Object.entries(messages).filter(([s])=>/\{\d+\}/.test(s)).map(([source,target])=>{
   const ids=[],parts=source.split(/(\{\d+\})/g),literal=parts.filter(p=>!/^\{\d+\}$/.test(p)).join('');
   return {target,ids,literalLength:literal.length,regex:new RegExp('^'+parts.map(p=>/^\{\d+\}$/.test(p)?(ids.push(Number(p.slice(1,-1))),'([\\s\\S]*?)'):escape(p)).join('')+'$')};
  }).sort((a,b)=>b.literalLength-a.literalLength);
  let result=value;
  if(depth<5)for(const p of patterns){const match=p.regex.exec(value);if(!match)continue;
   const args=new Map(p.ids.map((id,i)=>[id,message(match[i+1],depth+1)]));
   result=p.target.replace(/\{(\d+)\}/g,(_,i)=>args.get(Number(i))??'');break;
  }
  // Only diagnostic text enters this function. Split compound legacy warnings;
  // filenames, map names and custom region names never pass through it.
  if(result===value&&depth<5){
   fragments??=Object.keys(messages).filter(s=>s.length>=4&&!/\{\d+\}/.test(s)).sort((a,b)=>b.length-a.length);
   for(const key of fragments){
    if(value.startsWith(key)){result=messages[key]+message(value.slice(key.length),depth+1);break;}
    if(value.endsWith(key)){result=message(value.slice(0,-key.length),depth+1)+messages[key];break;}
   }
  }
  if(result===value&&/[\n；]/.test(value)&&depth<5)result=value.split(/([\n；])/).map(s=>s==='；'?'; ':message(s,depth+1)).join('');
  if(depth===0){if(cache.size>=512)cache.clear();cache.set(value,result);}return result;
 }
 function setLanguage(value){if(!['zh-CN','en'].includes(value))throw Error('Unsupported language');language=value;cache.clear();}
 function officialLabel(entry){
  if(!entry)return '';
  if(language!=='en')return entry.label;
  const version=entry.shared?'':`[${entry.version==='ra2'||entry.variants?.ra2?'RA2':'YR'}]`;
  return t(entry.name)+version+'['+t(entry.modeName)+']';
 }
 function mapName(metadata){return metadata.officialMap?officialLabel(metadata.officialMap):metadata.displayName||metadata.filename;}
 function diagnostics(value){
  if(language!=='en'||!value||typeof value!=='object')return value;
  // Translate known human-readable fields only. Do not recurse through numeric
  // probability arrays, object IDs, paths, filenames or user-defined names.
  for(const field of ['error','message','reason','analysisError','description','sourceDescription','bridgeNote','terrainError','scope'])if(typeof value[field]==='string')value[field]=message(value[field]);
  for(const field of ['warnings','assumptions','retryAssumptions'])if(Array.isArray(value[field]))value[field]=value[field].map(v=>typeof v==='string'?message(v):diagnostics(v));
  for(const field of ['metadata','approximation','clearance','rendering','objects','mod','probability'])diagnostics(value[field]);
  for(const field of ['loadIssues','missing'])if(Array.isArray(value[field]))value[field].forEach(diagnostics);
  if(value.files)Object.values(value.files).forEach(diagnostics);
  if(Array.isArray(value.cells))for(const cell of value.cells)if(cell.terrainError||cell.retryAssumptions)diagnostics(cell);
  return value;
 }
 function documentText(doc){
  doc.documentElement.lang=language;
  const walk=doc.createTreeWalker(doc.documentElement,4);let node;
  while((node=walk.nextNode())){
   if(node.parentElement?.closest('script,style,[data-no-i18n]'))continue;
   const raw=node.nodeValue,trimmed=raw.trim();if(Object.hasOwn(messages,trimmed))node.nodeValue=raw.replace(trimmed,t(trimmed));
  }
  for(const el of doc.querySelectorAll('[title],[aria-label],[placeholder],[alt]'))for(const attr of ['title','aria-label','placeholder','alt']){
   if(el.hasAttribute(attr))el.setAttribute(attr,t(el.getAttribute(attr)));
  }
  for(const link of doc.querySelectorAll('[data-doc-en]'))if(language==='en')link.href=link.dataset.docEn;
 }
 const busy=new Set();let selector;
 function setBusy(owner,value){value?busy.add(owner):busy.delete(owner);if(selector)selector.disabled=busy.size>0;}
 function mount(doc=root.document){
  documentText(doc);
  if(root.location.protocol==='file:')try{root.localStorage?.setItem(storageKey,language);}catch{}
  const host=doc.querySelector('.page-links')||doc.querySelector('header');if(!host)return;
  const label=doc.createElement('label');label.className='language-control';label.append('中文 / English ');
  selector=doc.createElement('select');selector.id='languageSelect';selector.setAttribute('aria-label','Language / 界面语言');
  for(const [value,text] of [['zh-CN','简体中文'],['en','English']]){const o=doc.createElement('option');o.value=value;o.textContent=text;selector.append(o);}
  selector.value=language;selector.title=t('切换语言后重新载入页面，保留当前地图与已保存的区域划分。');label.append(selector);host.append(label);
  const error=doc.createElement('span');error.className='language-error';error.setAttribute('role','alert');host.append(error);
  selector.onchange=async()=>{
   const next=selector.value;selector.disabled=true;error.textContent='';
   try{
    if(root.location.protocol!=='file:'){
     const response=await root.fetch('/api/preferences/language',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:next})});
     if(!response.ok)throw Error(t('语言设置未保存，请重试。'));
    }
    try{root.localStorage?.setItem(storageKey,next);}catch{if(root.location.protocol==='file:')throw Error(t('浏览器不允许保存语言设置。'));}
    root.dispatchEvent(new Event('crate:language-before-reload'));
    root.location.reload();
   }catch(e){error.textContent=message(e.message);selector.value=language;selector.disabled=busy.size>0;}
  };
 }
 const api={t,message,diagnostics,officialLabel,mapName,initial,normalize,setLanguage,mount,setBusy,get language(){return language;},messages};
 root.CrateI18n=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
