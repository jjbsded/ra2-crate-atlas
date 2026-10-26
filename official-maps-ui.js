/* Searchable, offline official maps. Shared entries retain both original files. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const names=typeof module!=='undefined'?require('./official-map-names.js'):root.CrateOfficialMapNames;
 // Search both languages independently of the currently displayed label.
 const english=_i18n?.messages||root.CrateEnglish||{};
 const versions={ra2:_t('原版'),yr:_t('尤里')};
 const climateNames={TEMPERATE:'温和',SNOW:'雪地',URBAN:'城市',NEWURBAN:'新城市',DESERT:'沙漠',LUNAR:'月球'};
 const climates=Object.fromEntries(Object.entries(climateNames).map(([id,name])=>[id,_t(name)]));
 const normalize=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('zh-CN').normalize('NFD').replace(/u\u0308/g,'v').replace(/\p{M}/gu,'').replace(/[’‘]/g,"'");
 const compact=value=>value.replace(/[\s'".,，。:：_\-–—]/g,'');
 const searchIndex=new WeakMap();
 function index(entry){
  if(!searchIndex.has(entry)){
   const text=normalize([entry.name,entry.label,english[entry.name],english[entry.modeName],entry.modeName,climateNames[entry.theater],english[climateNames[entry.theater]],...(names?.aliases.get(entry.name)||[]),...Object.entries(entry.variants).flatMap(([v,s])=>[s.file,v,versions[v],v==='yr'?'尤里 尤复 尤里的复仇 Yuri Revenge':'原版 红警2 Red Alert 2'])].join(' '));
   searchIndex.set(entry,{text,compact:compact(text)});
  }
  return searchIndex.get(entry);
 }
 const label=entry=>_i18n?.officialLabel(entry)||entry.label;
 const supported=(entry,version='all')=>Object.entries(entry.variants).some(([v,s])=>(!versions[version]||v===version)&&!s.unsupportedReason);
 function searchMaps(maps,{query='',version='all',mode='all',maxPlayers='all',theater='all',onlySupported=false}={}){
  const words=normalize(query).split(/\s+/).filter(Boolean);
  return maps.filter(e=>{
   if(version==='shared'&&!e.shared||versions[version]&&!e.variants[version]||mode!=='all'&&e.mode!==mode||onlySupported&&!supported(e,version))return false;
   if(maxPlayers!=='all'&&e.players[1]!==Number(maxPlayers)||theater!=='all'&&e.theater!==theater)return false;
   const haystack=index(e);
   return words.every(word=>haystack.text.includes(word)||compact(word)&&haystack.compact.includes(compact(word)));
  });
 }
 function preferredVersion(entry,preferred){return entry.variants[preferred]?preferred:entry.variants.yr?'yr':'ra2';}
 function create({onAnalyze,loadCatalog=()=>CrateLocalAPI.json('/api/maps/catalog',{cache:'no-store'}),precomputed=false}){
  const $=id=>document.getElementById(id),dialog=$('officialMapsDialog'),list=$('officialMapList');
  let data=null,pending=null,selected=null,visible=[],buttons=[],revision=0;
  function filter(){return {query:$('officialMapSearch').value,version:$('officialMapVersion').value,mode:$('officialMapMode').value,maxPlayers:$('officialMapPlayers').value,theater:$('officialMapTheater').value,onlySupported:$('officialMapSupported').checked};}
  function updateSelection(){
   $('officialMapAnalyze').disabled=!selected;
   $('officialMapAnalysisVersion').disabled=!selected||Object.keys(selected.variants).length<2;
   for(let i=0;i<buttons.length;i++){const active=visible[i]===selected;buttons[i].setAttribute('aria-selected',String(active));buttons[i].tabIndex=active||!visible.includes(selected)&&i===0?0:-1;}
   if(!selected){$('officialMapSelected').textContent=_t('选择一张地图');$('officialMapDetails').textContent='';return;}
   const version=$('officialMapAnalysisVersion').value,source=selected.variants[version];
   $('officialMapSelected').textContent=label(selected);
   $('officialMapAnalyze').disabled=!!source.unsupportedReason;
   $('officialMapDetails').classList.toggle('unavailable',!!source.unsupportedReason);
   $('officialMapDetails').textContent=precomputed?_t('预计算静态初始布局 · 选择后按需下载，不进行在线分析。'):
    source.unsupportedReason?_t('暂不能精确分析：')+(_i18n?.message(source.unsupportedReason)||source.unsupportedReason):
    _t`${source.file} · 将使用${versions[version]}规则分析初始布局。${selected.shared?_t('两版与箱子有关的静态内容相同；预览与 AI 差异不拆分。'):''}`;
  }
  function choose(entry,focus=false){
   const previous=selected&&$('officialMapAnalysisVersion').value;
   selected=entry;$('officialMapAnalysisVersion').replaceChildren();
   for(const [value,label]of Object.entries(versions))if(entry.variants[value]){const option=document.createElement('option');option.value=value;option.textContent=label;$('officialMapAnalysisVersion').append(option);}
   const versionFilter=$('officialMapVersion').value;
   $('officialMapAnalysisVersion').value=preferredVersion(entry,versions[versionFilter]?versionFilter:previous||$('version').value);
   updateSelection();
   if(focus){const button=buttons[visible.indexOf(entry)];button?.focus();button?.scrollIntoView({block:'nearest'});}
  }
  function render(){
   if(!data)return;
   const modeOrder=data.modes.map(m=>m.id);
   visible=searchMaps(data.maps,filter()).sort((a,b)=>label(a).localeCompare(label(b),_i18n?.language||'zh-CN')||modeOrder.indexOf(a.mode)-modeOrder.indexOf(b.mode)||Number(!!b.variants.ra2)-Number(!!a.variants.ra2));
   list.replaceChildren();buttons=[];
   if(selected&&!visible.includes(selected))selected=null;
   const fragment=document.createDocumentFragment();
   for(const entry of visible){
    const button=document.createElement('button');button.type='button';button.className='official-map-row';button.setAttribute('role','option');
    const name=document.createElement('strong');name.textContent=label(entry);
    const info=document.createElement('span');info.className='official-map-meta';
    const [minimum,maximum]=entry.players,files=Object.values(entry.variants).map(s=>s.file).join(' / ');
    info.textContent=_t`${minimum===maximum?maximum:minimum+'–'+maximum} 人 · ${climates[entry.theater]||entry.theater} · ${entry.size.join(' × ')} · ${files}`;
    const badge=document.createElement('span'),available=supported(entry,$('officialMapVersion').value);
    badge.className='official-map-badge'+(available?'':' unavailable');badge.textContent=available?(entry.shared?_t('两版相同'):versions[Object.keys(entry.variants)[0]]):_t('暂不支持概率');
    button.append(name,info,badge);button.onclick=()=>choose(entry);buttons.push(button);fragment.append(button);
   }
   list.append(fragment);$('officialMapEmpty').hidden=visible.length>0;
   $('officialMapCount').textContent=_t`${visible.length} / ${data.maps.length} 项 · 共 ${data.counts.files} 个官方地图文件`;
   updateSelection();
  }
  async function open(){
   const ticket=++revision;if(!dialog.open)dialog.showModal();
   $('officialMapSearch').focus();$('officialMapError').textContent='';$('officialMapRetry').hidden=true;
   if(data){render();return;}
   $('officialMapCount').textContent=_t('正在读取内置地图目录…');
   try{
    if(!pending)pending=loadCatalog().catch(error=>{pending=null;throw error;});
    data=await pending;
    const mode=$('officialMapMode');mode.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent=_t('全部模式');mode.append(all);
    for(const entry of data.modes){const option=document.createElement('option');option.value=entry.id;option.textContent=_t(entry.name);mode.append(option);}
    for(const [id,allLabel,entries]of [
     ['officialMapPlayers',_t('全部人数'),[...new Set(data.maps.map(e=>e.players[1]))].sort((a,b)=>a-b).map(n=>[n,n+_t(' 人')])],
     ['officialMapTheater',_t('全部气候'),Object.entries(climates).filter(([value])=>data.maps.some(e=>e.theater===value))]
    ]){
     const select=$(id);select.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent=allLabel;select.append(all);
     for(const [value,label]of entries){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
    }
    if(ticket===revision&&dialog.open)render();
   }catch(error){if(ticket!==revision||!dialog.open)return;$('officialMapCount').textContent=_t('目录未载入');$('officialMapError').textContent=error.message;$('officialMapRetry').hidden=false;}
  }
  $('loadHeck').onclick=open;$('officialMapClose').onclick=()=>dialog.close();$('officialMapRetry').onclick=open;
  dialog.addEventListener('close',()=>++revision);
  $('officialMapSearch').addEventListener('input',render);
  for(const id of ['officialMapVersion','officialMapMode','officialMapPlayers','officialMapTheater','officialMapSupported'])$(id).addEventListener('change',()=>{
   render();if(selected)choose(selected);
  });
  $('officialMapClear').onclick=()=>{$('officialMapSearch').value='';for(const id of ['officialMapVersion','officialMapMode','officialMapPlayers','officialMapTheater'])$(id).value='all';$('officialMapSupported').checked=false;render();$('officialMapSearch').focus();};
  $('officialMapAnalysisVersion').onchange=updateSelection;
  $('officialMapAnalyze').onclick=()=>{if(!selected||$('officialMapAnalyze').disabled)return;const choice={id:selected.id,version:$('officialMapAnalysisVersion').value};dialog.close();onAnalyze(choice);};
  $('officialMapSearch').addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&visible.length){event.preventDefault();choose(visible[0],true);}});
  list.addEventListener('keydown',event=>{
   const current=buttons.indexOf(document.activeElement);if(current<0)return;
   let next=current;if(event.key==='ArrowDown')next++;else if(event.key==='ArrowUp')next--;else if(event.key==='Home')next=0;else if(event.key==='End')next=visible.length-1;else return;
   event.preventDefault();choose(visible[Math.max(0,Math.min(visible.length-1,next))],true);
  });
  updateSelection();
 }
 const api={create,searchMaps,preferredVersion};if(typeof module!=='undefined')module.exports=api;else root.CrateOfficialMaps=api;
})(typeof globalThis!=='undefined'?globalThis:this);
