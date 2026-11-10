/* Region workspace. Persistence is keyed by source bytes, never an analysis job URL. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const R=root.CrateRegionStatistics,$=id=>document.getElementById(id);
 const format=new Intl.NumberFormat(_i18n?.language||'zh-CN',{maximumFractionDigits:2});
 const amount=n=>n===null?'—':(n>0&&n<.01?n.toPrecision(2):format.format(n))+'×';
 const unitGroups=['tank','scorpion','hover'];
 const groups=['land','sea','all',...unitGroups],fields=['total','average'];
 const unitGroup=g=>unitGroups.includes(g);
 function create({editHistory,getState,getDisplay,schedule,schedulePreview,pick,area,onMode,onAside,loadNavigation,prepareNavigation,showOverlay,onRegionsChanged,getBuffs,revealMap,onPending,onError,onInteraction}){
  let doc=R.defaults(),lookup=new Map(),eligible=new Map(),stats=new Map(),storageKey='',active=false,summaryVisible=false,toolsVisible=false,stroke=null,hover=null,history=[],future=[],saveTimer=null,storageBlocked=false,nameEditing=false,colorEditing=false,opacityEditing=false;
  const overlayVisible=()=>showOverlay?.()??active;
  let selectionIndex=null,geometryCache=new WeakMap(),statisticsCache=new WeakMap(),labelCache=new WeakMap(),rasterCache=new Map(),rasterPixels=0;
  const titleMotion=new Map(),titleInterval=250,titleFade=200;
  const titleViewport=root.CrateRegionLabelLayout.createMotion();let titleWake=null,titleWakeAt=0,titleLayoutAt=-Infinity;
  const titleTuning=root.CrateRegionTitleControls.create({host:document.body,onChange:()=>{
   for(const motion of titleMotion.values())motion.viewKey='';titleLayoutAt=-Infinity;schedule();
  }});
  let pendingColor=null,colorTimer=null;
  function commitColor(){clearTimeout(colorTimer);colorTimer=null;if(!pendingColor)return;const {region,color}=pendingColor;pendingColor=null;if(!doc.regions.includes(region)||region.color===color)return;region.color=color;refresh();schedule();saveSoon();onRegionsChanged?.();}
  function resetTitleTracking(clear=true){if(clear)titleMotion.clear();titleViewport.reset();titleLayoutAt=-Infinity;clearTimeout(titleWake);titleWake=null;titleWakeAt=0;}
  function wakeTitles(now,delay){const due=now+Math.max(1,delay);if(titleWake!==null&&Math.abs(due-titleWakeAt)<1)return;clearTimeout(titleWake);titleWakeAt=due;titleWake=setTimeout(()=>{titleWake=null;schedule();},Math.max(1,delay));}
  const titleSprites=new Map();let titleSpritePixels=0;
  const mapOverlayCache=root.CrateRegionOverlayCache?.create(undefined,schedule);
  let mapOverlayDoc=null,mapTransparency=doc.transparency,mapOpacityTimer=null;
  // Keep resident color pixels while geometry/statistics catch up. Only these
  // small world-space tiles need authoritative membership drawing meanwhile.
  const liveOverlayTiles=new Map();let overlayRevision=0;
  let editJournal=new WeakMap();
  const labelVisibility=new WeakMap(),surfaceBoxes=new WeakMap(),visibleTitleBoxes=new WeakMap();
  const emptyRegion={id:R.EMPTY,color:'#526673',cells:new Set()},isEmpty=()=>doc.active===R.EMPTY;
  const current=()=>isEmpty()?emptyRegion:doc.regions.find(r=>r.id===doc.active),state=getState;
  let automatic=null,autoPreparing=null,autoEpoch=0,autoTimer=null;
  function autoButtons(running=false){for(const id of ['regionAutoRun','regionAutoQuick'])$(id).textContent=_t(running?'取消自动划分':'启动划分');}
  const navigationCache=new WeakMap();
  let filling=null;
  function cancelFill(){if(!filling)return;filling.abort();filling=null;if($('regionActionStatus').textContent===_t('正在填充…'))$('regionActionStatus').textContent='';}
  async function navigationFor(s,signal){
   const data=s.data;let navigation=navigationCache.get(data)||data.regionNavigation;
   if(navigation?.version!==root.CrateRegionAuto.navigationVersion)navigation=null;
   if(!navigation){
    if(loadNavigation)navigation=await loadNavigation(s,signal);
    else if(root.CrateWebConfig?.static)throw Error(_t('此网页版缺少自动划分通行数据，请更新网页包。'));
    else navigation=await root.CrateLocalAPI.json('/api/maps/region-navigation?'+new URLSearchParams({result:s.prepared?.url||s.baseUrl+'result.json'}),{signal});
    signal.throwIfAborted();navigationCache.set(data,navigation);
   }
   return navigation;
  }
  let memberDoc=null,memberStamp='',members=new Map(),notifiedMemberDoc=null,notifiedMemberStamp='';
  const rows=new Map(),numberRows=new Map(),inspection=new Map();
  let tableControls=null;
  let pendingThumbnails=false,rowsStamp='',hoverTimer=null;
  const thumbnails=root.CrateRegionThumbnails.create({
   getState:state,getDocument:()=>doc,getGeometry:geometry,paintRegion,
   getSettings:()=>({size:tableControls?.overview,objects:$('objects').checked,players:$('players').checked,playerStyles:playerMarks,playerStylesKey:playerMarksKey}),
   isVisible:()=>summaryVisible,isDrawing:()=>!!stroke,onDeferred:()=>{pendingThumbnails=true;}
  });
  const previewChanged=()=>schedulePreview?schedulePreview():schedule();
  let numbers=new Map(),ranks=new Map(),sideMode='details';
  const asynchronous=typeof root.requestAnimationFrame==='function'&&!!root.CrateRegionRefreshQueue;
  let publishing=false,terrainRevision=0,localRefreshes=0,lastLocalCells=0,refreshWork={rebuiltTiles:0,regions:0};
  const emptyStatistics={land:{count:0,n:0n,total:0,average:null},sea:{count:0,n:0n,total:0,average:null},all:{count:0,n:0n,total:0,average:null}};
  const emptyGeometry={revision:-1,fill:new Path2D(),edge:new Path2D(),tiles:[],tileMap:new Map(),points:[],keys:new Set(),center:null,bounds:null,reachX:0,reachY:0,rebuiltTiles:0};
  function refreshTarget(){return {doc,data:state().data,display:getDisplay(),lookup,terrainRevision,stamp:[terrainRevision,doc.active,doc.overlap,summaryVisible,$('objects').checked,$('players').checked,...doc.regions.flatMap(r=>[r.id,R.revision(r),r.color,r.name])].join('|')};}
  const refreshQueue=asynchronous?root.CrateRegionRefreshQueue.create({
   same:(a,b)=>a&&b&&a.doc===b.doc&&a.data===b.data&&a.display===b.display&&a.stamp===b.stamp,
   valid:t=>t.doc===doc&&t.data===state().data,
   capture:t=>({...t,regions:t.doc.regions.map(source=>{const journal=editJournal.get(source);return {source,revision:R.revision(source),region:{...source,cells:new Set(source.cells)},geometry:geometryCache.get(source),statistics:statisticsCache.get(source),changes:journal&&{since:journal.since,keys:new Map(journal.keys)}};})}),
   compute:prepareRefresh,publish(result){
    refreshWork={rebuiltTiles:result.reduce((n,e)=>n+e.rebuiltTiles,0),regions:result.filter(e=>e.rebuiltTiles>0).length};
    if(result.some(entry=>entry.rebuiltTiles&&!entry.local))overlayRevision++;
    for(const entry of result){geometryCache.set(entry.source,entry.geometry);statisticsCache.set(entry.source,entry.statistics);const journal=editJournal.get(entry.source);if(journal){for(const [key,revision]of journal.keys)if(revision<=entry.geometry.revision)journal.keys.delete(key);journal.since=entry.geometry.revision;}}
    if(doc.regions.every(r=>geometryCache.get(r)?.revision===R.revision(r)))liveOverlayTiles.clear();
    publishing=true;try{refreshNow();}finally{publishing=false;}schedule();
   },onPending:value=>onPending?.(value),onError:error=>onError?.(error)
  }):null;
  function statisticsFor(reg){
   let cached=statisticsCache.get(reg);
   if(!asynchronous&&(!cached||cached.revision!==R.revision(reg))){cached={revision:R.revision(reg),value:R.statistics(reg,lookup,getDisplay())};statisticsCache.set(reg,cached);}
   return cached?.value||emptyStatistics;
  }
  function flushRefresh(){commitColor();refreshQueue?.flush(refreshTarget());}
  function* prepareRefresh(target){
   const result=[];
   for(const entry of target.regions){
    if(entry.geometry?.terrainRevision===target.terrainRevision&&entry.geometry?.revision===entry.revision&&entry.statistics?.revision===entry.revision&&entry.statistics.display===target.display&&entry.statistics.data===target.data){result.push({source:entry.source,geometry:entry.geometry,statistics:entry.statistics,rebuiltTiles:0});continue;}
    const previous=entry.geometry?.terrainRevision===target.terrainRevision?entry.geometry:null;
    const sameRevision=previous?.revision===entry.revision;
    let sameCells=sameRevision||!entry.changes?.keys.size&&previous?.keys?.size===entry.region.cells.size;
    if(sameCells&&!sameRevision){let n=0;for(const k of entry.region.cells){if(!entry.geometry.keys.has(k)){sameCells=false;break;}if(++n%128===0)yield;}}
    const local=previous&&entry.changes&&entry.changes.since<=previous.revision;
    const geometry=sameRevision?previous:sameCells?{...previous,revision:entry.revision,rebuiltTiles:0,keys:entry.region.cells}:local?yield* patchGeometry(entry.region,previous,entry.changes.keys,target.lookup,entry.revision):yield* buildGeometry(entry.region,previous,target.lookup,entry.revision);
    geometry.terrainRevision=target.terrainRevision;
    const sameProbability=entry.statistics?.display===target.display&&entry.statistics.data===target.data;
    const value=sameCells&&sameProbability?entry.statistics.value:local&&sameProbability&&entry.statistics.revision===previous.revision?yield* R.patchStatisticsSteps(entry.region,previous.keys,entry.changes.keys,entry.statistics.value,target.lookup,target.display):yield* R.statisticsSteps(entry.region,target.lookup,target.display);
    const statistics={revision:entry.revision,display:target.display,data:target.data,value};
    result.push({source:entry.source,geometry,statistics,rebuiltTiles:sameRevision?0:geometry.rebuiltTiles,local});yield;
   }
   return result;
  }
  function adoptDocument(next){
   refreshQueue?.reset();
   editJournal=new WeakMap();liveOverlayTiles.clear();
   if(asynchronous){const previous=new Map(doc.regions.map(r=>[r.id,r]));for(const r of next.regions){const old=previous.get(r.id),g=old&&geometryCache.get(old),s=old&&statisticsCache.get(old);if(g)geometryCache.set(r,{...g,revision:-1});if(s)statisticsCache.set(r,{...s,revision:-1});}}
   doc=next;
  }
  function membership(){
   const stamp=doc.regions.map(r=>r.id+':'+R.revision(r)).join('|');
   if(memberDoc===doc&&memberStamp===stamp)return members;
   const next=new Map();
   for(const r of doc.regions)for(const key of r.cells){
    if(!next.has(key))next.set(key,[]);
    next.get(key).push(r);
   }
   memberDoc=doc;memberStamp=stamp;members=next;
   return members;
  }
  function updateBuffs(){
   if(!summaryVisible)return;
   if(refreshQueue?.status.pending&&!publishing)return;
   const buffs=getBuffs?.(),D=root.CrateProbabilityDisplay;
   numbers=new Map(doc.regions.map(r=>{
    const data={...(stats.get(r.id)||emptyStatistics)};
    for(const group of unitGroups){
     const value=buffs?.get(r.id)?.[group];
     data[group]=value?{...value,total:D.ratio(value.n,value.denominator),average:D.ratio(value.n,value.denominator*BigInt(value.count))}:{count:0,n:0n,total:0,average:null};
    }
    return [r.id,data];
   }));
   ranks=new Map(groups.flatMap(group=>fields.map(field=>[group+'.'+field,R.ranks(doc.regions,numbers,group,field)])));
   ranks.set('all.count',R.ranks(doc.regions,numbers,'all','count'));
   for(const [id,cells] of numberRows)if(numbers.has(id))for(const [group,field,node] of cells){
    const value=numbers.get(id)[group];
    node.textContent=field==='count'?_t`${value.count.toLocaleString()} 格`:amount(value[field]);
    if(field==='average')addNote(node,unitGroup(group)?_t`${value.count.toLocaleString()} 个单位`:_t`${value.count.toLocaleString()} 格`);
    addRank(node,id,group,field);
   }
   sortRows();schedule();
  }
  function addNote(node,text,className=''){
   const note=document.createElement('small');note.textContent=text;if(className)note.className=className;node.append(note);
  }
  function addRank(node,id,group,field){
   const rank=ranks.get(group+'.'+field)?.get(id);
   if(rank)addNote(node,'(No.'+rank+')','region-rank-number');
  }
  function sortRows(){
   if(!summaryVisible)return;
   const metric=$('regionSort').value||'all.total';
   const ordered=R.sorted(doc.regions,numbers,metric,$('regionAscending').checked).map(r=>rows.get(r.id)).filter(Boolean);
   const body=$('regionRows');
   if(ordered.length!==body.children.length||ordered.some((row,i)=>row!==body.children[i]))body.replaceChildren(...ordered);
   tableControls?.applyRows();tableControls?.syncSort();
   const rankSort=$('regionRankSort');
   if(!rankSort.children.length)for(const option of $('regionSort').options||[]){
    const item=document.createElement('option');item.value=option.value;item.textContent=option.textContent;rankSort.append(item);
   }
   rankSort.value=metric;
   if(sideMode==='ranking')renderRanking(metric);
  }
  function regionIdentity(node,region){
   const dot=document.createElement('i');dot.className='region-swatch';dot.style.backgroundColor=region.color;dot.setAttribute('aria-hidden','true');
   node.append(dot,document.createTextNode(R.displayName(region)));
  }
  function renderRanking(metric){
   const [group,field]=metric.split('.'),columns=['name','order'].includes(metric)?[]:field==='count'?['count']:fields;
   const header=document.createElement('tr');
   for(const title of [_t('名称'),...columns.map(col=>col==='count'?_t('格数'):col==='total'?_t('总倍率'):_t('平均倍率'))]){
    const th=document.createElement('th');th.scope='col';th.textContent=title;header.append(th);
   }
   $('regionRankHead').replaceChildren(header);
   const items=R.sorted(doc.regions.filter(r=>r.cells.size),numbers,metric,$('regionAscending').checked);
   const body=$('regionRankRows'),scroll=body.closest?.('.region-ranking-scroll'),top=scroll?.scrollTop||0;
   body.replaceChildren(...items.map(region=>{
    const row=document.createElement('tr'),name=document.createElement('td');regionIdentity(name,region);row.append(name);
    for(const col of columns){
     const node=document.createElement('td'),g=numbers.get(region.id)?.[group]||emptyStatistics.all;
     node.textContent=col==='count'?g.count.toLocaleString():amount(g[col]);
     addRank(node,region.id,group,col);row.append(node);
    }
    return row;
   }));
  if(scroll)scroll.scrollTop=top;
  }
  const asideTabs=[['regionDetailsTab','details'],['regionRankingTab','ranking'],['blockedCellsTab','blocked'],['seaLandCellsTab','connections']];
  const asidePositions=new Map();let shownAside=null,asideRestore=0;
  function saveAsidePosition(){
   if(!shownAside)return;
   const aside=$('mapAside'),nodes=[aside,...(aside.querySelectorAll?.('#cellAside,#regionEditor,.placement-region-details section,.region-ranking-scroll,#coordinateLists')||[])];
   asidePositions.set(shownAside,nodes.filter(node=>node.getClientRects?.().length).map(node=>({node,top:node.scrollTop,left:node.scrollLeft})));
  }
  function restoreAsidePosition(mode){
   const positions=asidePositions.get(mode)||[{node:$('mapAside'),top:0,left:0}],ticket=++asideRestore;
   const restore=()=>{if(ticket!==asideRestore||shownAside!==mode)return;for(const {node,top,left}of positions){node.scrollTop=top;node.scrollLeft=left;}};
   restore();root.requestAnimationFrame?.(()=>root.requestAnimationFrame(restore));
  }
  for(const event of ['wheel','pointerdown','touchstart'])$('mapAside').addEventListener?.(event,()=>{asideRestore++;},{passive:true});
  function updateAside(){
   const mode=!toolsVisible&&sideMode==='ranking'?'details':sideMode,ranking=mode==='ranking',coordinates=mode==='blocked'||mode==='connections',details=mode==='details';
   const changed=shownAside!==mode;if(changed)saveAsidePosition();
   $('regionAsideTabs').hidden=false;
   $('regionAsideTabs').classList.toggle('cell-tabs-only',!toolsVisible);
   $('mapAside').classList.toggle('region-aside-open',toolsVisible&&!coordinates);
   $('mapAside').classList.toggle('coordinate-lists-open',coordinates);
   $('regionRankingTab').hidden=!toolsVisible;
   for(const [id,value]of asideTabs){const button=$(id),selected=mode===value;button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
   $('regionRanking').hidden=!ranking;
   $('placementRegionDetails').hidden=!toolsVisible||active||!details;
   $('regionEditor').hidden=!active||!details;
   $('cellAside').hidden=toolsVisible||!details;
   $('coordinateLists').hidden=!coordinates;
   $('riskLists').hidden=mode!=='blocked';
   $('seaLandLists').hidden=mode!=='connections';
   onAside?.(mode);
   if(ranking)renderRanking($('regionSort').value||'all.total');
   shownAside=mode;if(changed)restoreAsidePosition(mode);
  }
  function renderPlacement(pointer,last){
   if($('placementRegionDetails').hidden)return;
   const members=membership(),denominator=BigInt(state().data.probability.exact.denominator),D=root.CrateProbabilityDisplay;
   for(const [id,cell,empty] of [['regionPointerDetails',pointer,_t('指针未指向地图格')],['regionLastDetails',last,_t('尚未放置')]]){
    const list=cell?members.get(R.key(cell)):null,key=cell?list?.map(r=>r.id).join(',')||'unassigned':'none';
    const previous=inspection.get(id);
    if(previous?.key===key&&previous.numbers===numbers)continue;
    inspection.set(id,{key,numbers});
    const host=$(id);host.replaceChildren();
    if(!list?.length){host.textContent=cell?_t('无区域'):empty;continue;}
    for(const region of list){
     const info=document.createElement('div');info.className='placement-region-card';
     const title=document.createElement('strong');regionIdentity(title,region);info.append(title);
     const stat=numbers.get(region.id)||{...emptyStatistics,...Object.fromEntries(unitGroups.map(g=>[g,{count:0,total:0,average:null}]))};
     const probability=document.createElement('div');probability.className='placement-region-probability';
     probability.textContent=_t`总概率 ${D.percent(D.ratio(stat.all.n,denominator))} · 平均概率 ${D.percent(D.ratio(stat.all.n,denominator*BigInt(stat.all.count)))}`;info.append(probability);
     const table=document.createElement('table');
     for(const [group,label] of [['tank',_t('灰熊坦克')],['scorpion',_t('海蝎')],['hover',_t('尤里气垫船')]]){
      const g=stat[group],row=document.createElement('tr');
      for(const [index,text] of [label,_t`${g.count.toLocaleString()} 个单位`,_t`总 ${amount(g.total)}`,_t`均 ${amount(g.average)}`].entries()){
       const node=document.createElement(index?'td':'th');if(!index)node.scope='row';node.textContent=text;row.append(node);
      }
      table.append(row);
     }
     info.append(table);host.append(info);
    }
   }
  }
  let playerMarks={},playerMarksKey='',teamRoster='',teamControls=new Map();
  function teamFields(starts){
   const roster=starts.map(p=>p.number).join(',');
   if(roster!==teamRoster){
    teamRoster=roster;teamControls=new Map();$('regionAutoTeams').replaceChildren();
    for(const p of starts){
     const label=document.createElement('label'),select=document.createElement('select');select.id='regionTeam'+p.number;
     label.append(document.createTextNode(_t`玩家${p.number}`));select.setAttribute('aria-label',_t`玩家${p.number}的队伍`);
     for(const [value,text]of [['A','A'],['B','B'],['C','C'],['D','D'],['neutral',_t('中立')],['empty',_t('空')]]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
     select.onchange=()=>{checkpoint(_t('玩家队伍设置'));doc.autoOptions=root.CrateRegionAuto.options({...doc.autoOptions,teams:{...doc.autoOptions.teams,[p.number]:select.value}});presentationChanged();$('regionAutoStatus').textContent=_t('队伍设置已保存，重新自动划分后生效。');};
     label.append(select);$('regionAutoTeams').append(label);teamControls.set(p.number,select);
    }
   }
   for(const[number,select]of teamControls)select.value=doc.autoOptions.teams[number]||'neutral';
  }
  function cancelAuto(quiet=false){
   ++autoEpoch;clearTimeout(autoTimer);autoTimer=null;automatic?.abort();automatic=null;autoPreparing=null;
   $('regionAutoFields').disabled=false;autoButtons();
   $('regionAutoProgress').hidden=true;
   if(!quiet)$('regionAutoStatus').textContent=_t('自动划分已取消。');
  }
  const tool=()=>$('regionTool').value;
  let lastTool=tool()||'brush-ellipse',shiftHeld=false,ctrlHeld=false;
  const picking=()=>stroke?stroke.tool==='picker':tool()==='picker'||ctrlHeld&&!state().ctrlResizing;
  const removing=()=>isEmpty()||Boolean(stroke?.baseRemove??($('regionOperation').value==='remove'))!==shiftHeld;
  function cursorInfo(){
   if(!active||!overlayVisible()||picking())return null;
   const empty=isEmpty(),r=current(),t=stroke?.tool||tool();
   return {label:empty?_t('操作:'):_t('操作:')+' '+(removing()?_t('移出'):_t('加入'))+' '+R.displayName(r),
    region:{id:r.id,name:empty?_t('消除区域'):R.displayName(r),color:r.color,empty},
    shape:t.startsWith('box')?t:null,hint:t==='fill'?_t('单击填充连通区域'):t.startsWith('box')?_t('按住左键拖动框选'):''};
  }
  function syncCursor(){document.getElementById('map').classList.toggle('region-fill-cursor',!!active&&overlayVisible()&&!picking()&&tool()==='fill'&&!!hover);}
  function interactionHint(){
   $('regionEyedropper').setAttribute('aria-pressed',String(tool()==='picker'));
   $('regionModifierStatus').textContent=!active?'':picking()?_t('滴管：点击对象或区域'):isEmpty()?_t('空：清除命中格的所有区域归属，Shift 不反转'):shiftHeld?_t`Shift · 临时${removing()?_t('取消选择'):_t('选择')}`:tool()==='fill'?_t('填充：点击连通部分，陆地不跨海岸线；已有区域可跨海陆'):'';
   $('regionModifierStatus').title=$('regionModifierStatus').textContent;
   syncCursor();
  }
  function modifiers(e={}){
   const shift=typeof e.shiftKey==='boolean'?e.shiftKey:shiftHeld,ctrl=typeof e.ctrlKey==='boolean'?e.ctrlKey:ctrlHeld;
   if(shift===shiftHeld&&ctrl===ctrlHeld)return;
   if(stroke&&stroke.tool.startsWith('brush')&&shift!==shiftHeld)stroke.gap=true;
   shiftHeld=shift;ctrlHeld=ctrl;if(stroke&&stroke.tool!=='picker')stroke.remove=removing();
   interactionHint();schedule();
  }
  const width=()=>Math.round(Math.max(1,Math.min(60,Number($('regionWidth').value)||1)));
  const height=()=>Math.round(Math.max(1,Math.min(60,Number($('regionHeight').value)||1)));
  const status=(value,error=false)=>{$('regionSave').textContent=value;$('regionSave').classList.toggle('error',error);};
  let regionChoices=[],toolbarChoices=[];const pickerStamps=new Map();
  function closePicker(focus=false,quick=false){
   for(const [list,button]of [['regionOptions','regionActive'],['regionToolbarOptions','regionToolbarActive']]){$(list).hidden=true;$(button).setAttribute('aria-expanded','false');}
   if(focus)$(quick?'regionToolbarActive':'regionActive').focus();
  }
  function openPicker(quick=false){
   const choices=quick?toolbarChoices:regionChoices;if(!choices.length)return;closePicker();
   $(quick?'regionToolbarOptions':'regionOptions').hidden=false;$(quick?'regionToolbarActive':'regionActive').setAttribute('aria-expanded','true');
   const option=choices.find(b=>b.value===doc.active)||choices[0];option.focus();option.scrollIntoView({block:'nearest'});
  }
  function pickerSelection(){
   const r=current();if(!r)return;
   $('regionActiveText').textContent=isEmpty()?_t('空 · 擦除'):_t`${R.displayName(r)} · ${r.cells.size} 格`;
   $('regionToolbarActiveText').textContent=isEmpty()?_t('消除区域'):R.displayName(r);
   for(const [button,swatch]of [['regionActive','regionActiveSwatch'],['regionToolbarActive','regionToolbarActiveSwatch']]){$(button).value=doc.active;$(swatch).style.backgroundColor=r.color;$(swatch).classList.toggle('empty-region',isEmpty());}
  }
  function pickerOptions(quick=false){
   const stamp=JSON.stringify([doc.active,...doc.regions.map(r=>[r.id,R.displayName(r),r.color,quick?null:r.cells.size])]);
   if(pickerStamps.get(quick)===stamp)return quick?toolbarChoices:regionChoices;
   pickerStamps.set(quick,stamp);closePicker();
   const container=$(quick?'regionToolbarOptions':'regionOptions'),choices=[];container.replaceChildren();
   for(const reg of [emptyRegion,...doc.regions]){
    const option=document.createElement('button');option.type='button';option.value=reg.id;option.className='region-option';option.tabIndex=-1;
    option.setAttribute('role','option');option.setAttribute('aria-selected',String(reg.id===doc.active));
    const dot=document.createElement('i');dot.className='region-swatch'+(reg.id===R.EMPTY?' empty-region':'');dot.style.backgroundColor=reg.color;dot.setAttribute('aria-hidden','true');
    const name=document.createElement('span');name.className='region-option-name';name.textContent=quick&&reg.id===R.EMPTY?_t('消除区域'):R.displayName(reg);
    option.append(dot,name);
    if(!quick){const count=document.createElement('small');count.textContent=reg.id===R.EMPTY?_t('擦除'):_t`${reg.cells.size} 格`;option.append(count);}
    option.onclick=()=>{closePicker(true,quick);activate(reg.id);};container.append(option);choices.push(option);
   }
   if(quick){const add=document.createElement('button');add.type='button';add.value='add';add.className='region-option region-option-add';add.tabIndex=-1;add.textContent=_t('新增+');add.setAttribute('role','option');add.setAttribute('aria-selected','false');add.disabled=doc.regions.length>=64;add.onclick=()=>{closePicker(true,true);addRegion();};container.append(add);choices.push(add);}
   return choices;
  }
  function persist(){
   commitColor();
   clearTimeout(saveTimer);saveTimer=null;if(!storageKey||storageBlocked)return;
   if(stroke){saveTimer=setTimeout(persist,300);return;}
   try{localStorage.setItem(storageKey,R.encode(doc));status(_t('已保存'));}
   catch{status(_t('自动保存失败：浏览器存储不可用或已满。请导出划分备份。'),true);}
  }
  function saveSoon(){if(storageBlocked)return;status(_t('正在自动保存…'));clearTimeout(saveTimer);saveTimer=setTimeout(persist,300);}
  function syncHistory(){const h=editHistory?.status;$('regionUndo').disabled=h?!h.canUndo:!history.length;$('regionRedo').disabled=h?!h.canRedo:!future.length;if(h){$('regionUndo').title=h.undoLabel?_t('撤销')+' · '+h.undoLabel:_t('没有可以撤销的修改');$('regionRedo').title=h.redoLabel?_t('重做')+' · '+h.redoLabel:_t('没有可以重做的修改');}}
  function remember(raw,label=_t('修改区域')){history.push(raw);if(history.length>20)history.shift();future=[];editHistory?.record('regions',label);}
  function checkpoint(label){commitColor();if(automatic)cancelAuto();doc.autoHandled=true;remember(R.encode(doc),label);}
  function restoreHistory(raw){
   const next=R.decode(raw,eligible);
   // View preferences and the current paint target are not region edits.
   next.showTotals=doc.showTotals;next.transparency=doc.transparency;
   if(doc.active===R.EMPTY||next.regions.some(r=>r.id===doc.active))next.active=doc.active;
   return next;
  }
  const regionEditLabel=remove=>isEmpty()?_t('消除区域'):_t(remove?'移出区域':'加入区域')+' · '+R.displayName(current());
  function dirty(save=true,local=false){if(!local){editJournal=new WeakMap();liveOverlayTiles.clear();overlayRevision++;}refresh();schedule();if(save)saveSoon();}
  function presentationChanged(){
   syncHistory();
   schedule();saveSoon();
  }
  function setMode(value,showTools=value){
   const wasVisible=summaryVisible;
   closePicker();
   cancel();hover=null;shiftHeld=ctrlHeld=false;active=!!value&&!state().data?.metadata.previewOnly;interactionHint();
   toolsVisible=!!showTools&&!state().data?.metadata.previewOnly;
   summaryVisible=!!state().data&&!state().data.metadata.previewOnly;
   if(!overlayVisible()){resetTitleTracking();mapOverlayCache?.cancelRefinement?.();}
   $('regionToggle').setAttribute('aria-pressed',String(active));
   $('regionSummary').hidden=!summaryVisible;
   $('map').classList.toggle('region-editing',active);
   $('mapInteractionHint').hidden=false;
   onMode(active);if(summaryVisible&&!wasVisible)refresh();updateAside();schedule();
  }
  function load({preserve=false,allowAuto=true}={}){
   cancelFill();
   refreshQueue?.reset();
   const s=state();
   summaryVisible=!!s.data&&!s.data.metadata.previewOnly;$('regionSummary').hidden=!summaryVisible;
   const nextKey=s.data.metadata.sourceSha256?'crate-atlas.regions.v1.'+s.data.metadata.sourceSha256:'';
   const keep=preserve&&storageKey&&storageKey===nextKey;
   const keepGeometry=keep&&lookup.size===s.cells.length&&s.cells.every(c=>{
    const old=lookup.get(R.key(c));return old&&old.px===c.px&&old.py===c.py&&old.level===c.level&&
     (old.visibleSurface===c.visibleSurface||JSON.stringify(old.visibleSurface)===JSON.stringify(c.visibleSurface))&&
     eligible.has(R.key(c))===R.canSelect(c,s.data.rendering);
   });
   if(!keepGeometry)terrainRevision++;
   // Synchronous consumers may refresh a display in place. Explicit reloads
   // must recalculate totals even when reusable terrain geometry is unchanged.
   if(!asynchronous){statisticsCache=new WeakMap();labelCache=new WeakMap();}
   lookup=new Map(s.cells.map(c=>[R.key(c),c]));eligible=new Map(s.cells.filter(c=>R.canSelect(c,s.data.rendering)).map(c=>[R.key(c),c]));
   selectionIndex=R.createSelectionIndex(s.cells,c=>eligible.has(R.key(c)));s.spatialIndex=selectionIndex.screen;
   if(!keepGeometry){
    geometryCache=new WeakMap();statisticsCache=new WeakMap();labelCache=new WeakMap();thumbnails.invalidate();rasterCache.clear();rasterPixels=0;mapOverlayCache?.clear();mapOverlayDoc=null;titleSprites.clear();titleSpritePixels=0;
    editJournal=new WeakMap();liveOverlayTiles.clear();overlayRevision++;
    resetTitleTracking(!keep);
   }
   clearTimeout(mapOpacityTimer);mapOpacityTimer=null;
   if(!keep){doc=R.defaults();history=[];future=[];editHistory?.clear('regions');titleMotion.clear();storageBlocked=false;$('regionAutoStatus').textContent='';}
   thumbnails.cancel();if(!keep)stats.clear();hover=null;shiftHeld=ctrlHeld=false;interactionHint();nameEditing=colorEditing=opacityEditing=false;
   if(!keep)rowsStamp='';pendingThumbnails=false;clearTimeout(hoverTimer);hoverTimer=null;
   storageKey=nextKey;
   if(keep){/* Recompute statistics/artwork while keeping selection and undo. */}
   else if(storageKey){
    try{const raw=localStorage.getItem(storageKey);if(raw){doc=R.decode(raw,eligible);const old=JSON.parse(raw),removed=old.regions.reduce((n,r)=>n+r.cells.filter(k=>!eligible.has(k)).length,0);status(_t('已恢复此地图的区域划分'));$('regionActionStatus').textContent=removed?_t`已排除 ${removed} 处可选边界外的格子归属。`:'';if(old.defaultRegionCount!==12||old.selectionBoundsVersion!==1||removed)saveSoon();}else status(_t('自动保存'));}
    catch{storageBlocked=true;status(_t('已有区域记录无法读取，暂不覆盖。可导出当前划分备份。'),true);}
   }else{storageBlocked=true;status(_t('结果缺少地图标识，无法自动保存；请重新分析。'),true);}
   thumbnails.reset();
   $('regionToggle').disabled=!!s.data.metadata.previewOnly;
   $('regionToggle').title=s.data.metadata.previewOnly?_t('外观预览没有概率，无法统计'):_t('划分地区并比较概率');
   if(s.data.metadata.previewOnly)setMode(false);else{refresh();updateAside();}schedule();
   if(doc.regions.some(r=>r.cells.size)){if(!doc.autoHandled){doc.autoHandled=true;saveSoon();}}
   else if(allowAuto&&!automatic&&!doc.autoHandled&&!storageBlocked&&!s.data.metadata.previewOnly&&root.CrateRegionAuto){
    autoTimer=setTimeout(()=>{autoTimer=null;runAuto(false);},0);
   }
  }
  function refresh(){
   if(!asynchronous)return refreshNow();
   if(!state().data||state().data.metadata.previewOnly)return;
   pickerSelection();
   syncHistory();
   refreshQueue.request(refreshTarget());
  }
  function refreshNow(){
   if(!state().data||state().data.metadata.previewOnly)return;
   const starts=root.CratePlayerStarts?.positions(state())||[];
   playerMarks=R.playerStyles(doc,starts);playerMarksKey=JSON.stringify(playerMarks);if(!automatic)teamFields(starts);
   const r=current();pickerSelection();regionChoices=pickerOptions();toolbarChoices=pickerOptions(true);
   $('regionEmptyHint').hidden=!isEmpty();
   if(document.activeElement!==$('regionName'))$('regionName').value=R.displayName(r);if(!pendingColor)$('regionColor').value=r.color;$('regionOverlap').checked=doc.overlap;
   $('regionName').disabled=$('regionColor').disabled=isEmpty();interactionHint();
   const titleToggle=$('regionShowTotals');titleToggle.setAttribute('aria-pressed',String(doc.showTotals));titleToggle.textContent=_t('区域标题:')+(doc.showTotals?_t('开'):_t('关'));
   if(!automatic){for(const[id,key]of [['regionAutoSea','maxSea'],['regionAutoStraight','maxStraight'],['regionAutoPath','maxPath']])if(document.activeElement!==$(id))$(id).value=doc.autoOptions[key];$('regionAutoExclusive').checked=doc.autoOptions.exclusive;$('regionAutoCorners').checked=doc.autoOptions.claimCorners;}
   syncHistory();$('regionClear').disabled=isEmpty()||!r.cells.size;$('regionDelete').disabled=isEmpty()||doc.regions.length<=1;$('regionAdd').disabled=doc.regions.length>=64;
   $('regionTransparency').value=doc.transparency;$('regionTransparencyValue').textContent=doc.transparency+'%';
   $('regionFocus').disabled=!r.cells.size;$('regionEditor').style.setProperty('--region-color',r.color);
   membership();
   // Rendering and buff reads can refresh the cache before this publication.
   // Track notification separately so those reads cannot consume a color edit.
   if(notifiedMemberDoc!==doc||notifiedMemberStamp!==memberStamp){notifiedMemberDoc=doc;notifiedMemberStamp=memberStamp;onRegionsChanged?.();}
   if(!summaryVisible)return;
   stats=new Map(doc.regions.map(r=>[r.id,statisticsFor(r)]));
   const nextRowsStamp=doc.regions.map(r=>[r.id,r.color,R.displayName(r),r.id===doc.active].join(':')).join('|');
   if(rowsStamp===nextRowsStamp){
    updateBuffs();updateMetrics();
    for(const reg of doc.regions)for(const button of thumbnails.buttonsFor(reg.id)||[])button.disabled=!reg.cells.size;
    if(stroke)pendingThumbnails=true;else thumbnails.request(true);
    return;
   }
   rowsStamp=nextRowsStamp;
   rows.clear();numberRows.clear();thumbnails.clearButtons();
   for(const reg of doc.regions){
    const tr=document.createElement('tr');tr.classList.toggle('active',reg.id===doc.active);
    tr.setAttribute('data-region-id',reg.id);
    const label=document.createElement('td'),button=document.createElement('button');button.className='region-row-name';
    label.setAttribute('data-column','name');label.className='region-name-cell';
    const dot=document.createElement('i');dot.style.backgroundColor=reg.color;button.append(dot,document.createTextNode(R.displayName(reg)));
    button.setAttribute('aria-pressed',String(reg.id===doc.active));button.onclick=()=>activate(reg.id);label.append(button);
    const count=document.createElement('small');count.setAttribute('data-metric','all.count');label.append(count);tr.append(label);
    const cells=[['all','count',count]];
    const preview=document.createElement('td'),buttons=[];preview.className='region-preview';
    preview.setAttribute('data-column','preview');
    for(const overview of [false,true]){
     const b=document.createElement('button');b.title=overview?_t('在全图中定位此区域'):_t('查看区域包围范围');b.setAttribute('aria-label',`${overview?_t('全图定位'):_t('查看地形')}：${R.displayName(reg)}`);b.disabled=!reg.cells.size;
     const cv=thumbnails.render(reg,overview);b.append(cv);b.onclick=()=>{activate(reg.id);focus();revealMap?.();};preview.append(b);buttons.push(b);
    }
    tr.append(preview);thumbnails.setButtons(reg.id,buttons);
    for(const group of groups)for(const field of fields){
     const td=document.createElement('td');td.setAttribute('data-metric',group+'.'+field);
     td.setAttribute('data-column',group+'.'+field);
     const block=document.createElement('span'),content=document.createElement('span');block.className='region-number';content.className='region-number-content';
     block.style.width='var(--region-number-'+group+'-'+field+', max-content)';block.append(content);td.append(block);
     const g=stats.get(reg.id)[group];
     if(g)td.title=_t`${state().data.metadata.approximate?_t('近似统计；'):''}${g.count} 格（含零概率格）${field==='average'?_t('；总倍率 ÷ 本类格数'):''}`;
     tr.append(td);cells.push([group,field,content]);
    }
    numberRows.set(reg.id,cells);rows.set(reg.id,tr);
   }
   updateBuffs();
   updateMetrics();
  }
  function updateMetrics(){
   const r=current();
   const selected=stats.get(doc.active),metric=$('regionLive');
   for(const [group,id]of [['land','regionLandTotal'],['sea','regionSeaTotal'],['all','regionAllTotal']]){
    $(id).textContent=selected?(state().data.metadata.approximate?'≈':'')+amount(selected[group].total):'—';
   }
   $('regionActiveTotals').title=isEmpty()?_t('空是擦除状态，不统计未划分格。'):_t('当前区域内各类格子倍率之和；总倍率为陆地与海洋之和。');
   metric.textContent=isEmpty()?_t('空：擦除命中格的所有区域归属'):_t`当前 ${r.cells.size.toLocaleString()} 格 · 综合 ${amount(selected.all.total)} · 平均 ${amount(selected.all.average)}`;
   metric.title=metric.textContent;
   $('regionCount').textContent=_t`${doc.regions.length} 个区域${doc.overlap?_t(' · 可重叠，各区独立统计'):_t(' · 不重叠')}`;
  }

  function updateProbability(change){
   if(!asynchronous||!change?.compatible||refreshQueue.status.pending)return false;
   const currentData=state().data,currentDisplay=getDisplay(),pending=[];
   for(const region of doc.regions){
    const cached=statisticsCache.get(region),g=geometryCache.get(region);
    if(!cached||cached.revision!==R.revision(region)||cached.data!==change.previousData||cached.display!==change.previousDisplay||g?.terrainRevision!==terrainRevision||g.revision!==R.revision(region))return false;
    pending.push([region,cached]);
   }
   const differences=new Map(),member=membership();
   for(const[before,after]of change.cells){
    const a=before?change.previousDisplay.get(before).numerator:0n,b=currentDisplay.get(after).numerator;
    if(a===b&&before?.land===after.land)continue;
    for(const region of member.get(R.key(after))||[]){
     let delta=differences.get(region.id);if(!delta)differences.set(region.id,delta={land:{count:0,n:0n},sea:{count:0,n:0n}});
     if(before){const g=before.land===2?delta.sea:delta.land;g.count--;g.n-=a;}
     const g=after.land===2?delta.sea:delta.land;g.count++;g.n+=b;
    }
   }
   const ratio=(n,d)=>d?Number(n*1000000000000n/d)/1e12:0;
   for(const[region,cached]of pending){
    const delta=differences.get(region.id);let value=cached.value;
    if(delta&&(delta.land.count||delta.sea.count||delta.land.n||delta.sea.n)){
     const land={count:value.land.count+delta.land.count,n:value.land.n+delta.land.n},sea={count:value.sea.count+delta.sea.count,n:value.sea.n+delta.sea.n};
     const all={count:land.count+sea.count,n:land.n+sea.n};
     for(const g of [land,sea,all]){g.total=ratio(g.n,currentDisplay.baselineNumerator);g.average=g.count?ratio(g.n,currentDisplay.baselineNumerator*BigInt(g.count)):null;}
     value={land,sea,all};
    }
    statisticsCache.set(region,{...cached,data:currentData,display:currentDisplay,value});
   }
   localRefreshes++;lastLocalCells=change.cells.length;
   if(summaryVisible){stats=new Map(doc.regions.map(r=>[r.id,statisticsFor(r)]));updateBuffs();updateMetrics();}
   schedule();return true;
  }
  function activate(id){commitColor();cancel();doc.active=id;nameEditing=colorEditing=false;hover=null;refresh();saveSoon();schedule();}
  function sampleRegion(cell){
   const members=cell&&eligible.has(R.key(cell))?doc.regions.filter(r=>r.cells.has(R.key(cell))):[],target=members.find(r=>r.id===doc.active)||members[members.length-1];
   return target?{id:target.id,name:R.displayName(target),color:target.color,empty:false}:{id:R.EMPTY,name:_t('消除区域'),color:emptyRegion.color,empty:true};
  }
  function selectSample(cell){
   const sampled=sampleRegion(cell);if(!sampled)return false;
   activate(sampled.id);finishPicking();$('regionActionStatus').textContent=_t('已取色：')+sampled.name;return true;
  }
  function finishPicking(){if(tool()==='picker'){$('regionTool').value=lastTool;controls();}}
  function focus(){
   const b=R.bounds(current(),lookup,CrateMapRenderer.surface);if(!b)return;
   const s=state();s.scale=Math.min(6,Math.max(.06,Math.min((area.w-120)/b.w,(area.h-120)/b.h)));
   s.x=area.x+area.w/2-(b.x+b.w/2)*s.scale;s.y=area.y+area.h/2-(b.y+b.h/2)*s.scale;schedule();
  }
  function path(ctx,c,view,whole=false){
   for(const ring of CrateMapRenderer.surface(c,whole)){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](view.x+(c.px+dx)*view.scale,view.y+(c.py+dy)*view.scale));ctx.closePath();}
  }
  function geometry(reg){
   let cached=geometryCache.get(reg);if(cached?.revision===R.revision(reg))return cached;
   if(asynchronous)return cached||emptyGeometry;
   const iterator=buildGeometry(reg,cached,lookup,R.revision(reg));let part;do{part=iterator.next();}while(!part.done);geometryCache.set(reg,part.value);return part.value;
  }
  function* buildGeometry(reg,cached,sourceLookup,revision){
   const fill=new Path2D(),edge=new Path2D(),points=[],tiles=new Map();let x=0,y=0,n=0,reachX=0,reachY=0;
   let steps=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(const k of reg.cells){const c=sourceLookup.get(k);if(!c)continue;
    x+=c.px;y+=c.py;n++;points.push(c);
    const key=Math.floor(c.px/480)+','+Math.floor(c.py/240);
    let tile=tiles.get(key);if(!tile){tile={keys:new Set(),edgeKeys:new Set(),points:[],sumX:0,sumY:0,wholeL:Infinity,wholeR:-Infinity,wholeT:Infinity,wholeB:-Infinity,l:Infinity,r:-Infinity,t:Infinity,b:-Infinity};tiles.set(key,tile);}tile.sumX+=c.px;tile.sumY+=c.py;
    tile.keys.add(k);tile.points.push(c);if([1024,-1024,1,-1].some(d=>!reg.cells.has(k+d)))tile.edgeKeys.add(k);
    const box=cellSurfaceBox(c);tile.l=Math.min(tile.l,box.l);tile.r=Math.max(tile.r,box.r);tile.t=Math.min(tile.t,box.t);tile.b=Math.max(tile.b,box.b);
    reachX=Math.max(reachX,c.px-box.l,box.r-c.px);reachY=Math.max(reachY,c.py-box.t,box.b-c.py);
    for(const ring of CrateMapRenderer.surface(c,true))for(const [dx,dy]of ring){left=Math.min(left,c.px+dx);right=Math.max(right,c.px+dx);top=Math.min(top,c.py+dy);bottom=Math.max(bottom,c.py+dy);tile.wholeL=Math.min(tile.wholeL,c.px+dx);tile.wholeR=Math.max(tile.wholeR,c.px+dx);tile.wholeT=Math.min(tile.wholeT,c.py+dy);tile.wholeB=Math.max(tile.wholeB,c.py+dy);}
    if(++steps%128===0)yield;
   }
   const equal=(a,b)=>a.size===b.size&&[...a].every(k=>b.has(k));
   let rebuiltTiles=0;
   for(const [key,tile]of tiles){
    const previous=cached?.tileMap?.get(key);
    if(previous&&equal(tile.keys,previous.keys)&&equal(tile.edgeKeys,previous.edgeKeys))tiles.set(key,previous);
    else{
     tile.fill=new Path2D();tile.edge=new Path2D();rebuiltTiles++;
     for(const c of tile.points){path(tile.fill,c,{x:0,y:0,scale:1});if(tile.edgeKeys.has(R.key(c)))path(tile.edge,c,{x:0,y:0,scale:1});if(++steps%64===0)yield;}
    }
    // Append bounded paths once per tile. Repeatedly growing a map-wide
    // Path2D one vertex at a time is quadratic in Chromium on large regions.
    const part=tiles.get(key);fill.addPath(part.fill);edge.addPath(part.edge);
    yield;
   }
   let center=null,score=Infinity;
   for(const k of reg.cells){const c=sourceLookup.get(k),ring=c&&CrateMapRenderer.surface(c)[0];if(!ring?.length)continue;const d=(c.px-x/n)**2+(c.py-y/n)**2;if(d<score){
    score=d;center={x:c.px+ring.reduce((sum,p)=>sum+p[0],0)/ring.length,y:c.py+ring.reduce((sum,p)=>sum+p[1],0)/ring.length};
   }if(++steps%128===0)yield;}
   const bounds=Number.isFinite(left)?{x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)}:null;
   return {revision,fill,edge,tiles:[...tiles.values()],tileMap:tiles,rebuiltTiles,center,points,keys:new Set(reg.cells),reachX,reachY,bounds};
  }
  function* patchGeometry(reg,previous,changes,sourceLookup,revision){
   const tiles=new Map(previous.tileMap),dirty=new Set(),changesByTile=new Map(),tileKey=c=>Math.floor(c.px/480)+','+Math.floor(c.py/240);let steps=0,reachX=previous.reachX,reachY=previous.reachY;
   // Partition once. A large fill used to scan every changed cell again for
   // every dirty tile, even when that tile contained only a handful of them.
   for(const key of changes.keys()){
    const c=sourceLookup.get(key);if(c){const id=tileKey(c);if(!changesByTile.has(id))changesByTile.set(id,[]);changesByTile.get(id).push(key);}
    for(const k of [key,key-1024,key+1024,key-1,key+1]){const c=sourceLookup.get(k);if(c)dirty.add(tileKey(c));}
    if(++steps%128===0)yield;
   }
   for(const id of dirty){const old=tiles.get(id),keys=new Set(old?.keys);
    for(const key of changesByTile.get(id)||[]){if(reg.cells.has(key))keys.add(key);else keys.delete(key);}
    if(!keys.size){tiles.delete(id);continue;}
    const tile={keys,edgeKeys:new Set(),points:[],fill:new Path2D(),edge:new Path2D(),sumX:0,sumY:0,wholeL:Infinity,wholeR:-Infinity,wholeT:Infinity,wholeB:-Infinity,l:Infinity,r:-Infinity,t:Infinity,b:-Infinity};
    for(const key of keys){const c=sourceLookup.get(key);if(!c)continue;tile.points.push(c);tile.sumX+=c.px;tile.sumY+=c.py;path(tile.fill,c,{x:0,y:0,scale:1});if([1024,-1024,1,-1].some(d=>!reg.cells.has(key+d))){tile.edgeKeys.add(key);path(tile.edge,c,{x:0,y:0,scale:1});}
     const box=cellSurfaceBox(c);tile.l=Math.min(tile.l,box.l);tile.r=Math.max(tile.r,box.r);tile.t=Math.min(tile.t,box.t);tile.b=Math.max(tile.b,box.b);reachX=Math.max(reachX,c.px-box.l,box.r-c.px);reachY=Math.max(reachY,c.py-box.t,box.b-c.py);
     for(const ring of CrateMapRenderer.surface(c,true))for(const [dx,dy]of ring){tile.wholeL=Math.min(tile.wholeL,c.px+dx);tile.wholeR=Math.max(tile.wholeR,c.px+dx);tile.wholeT=Math.min(tile.wholeT,c.py+dy);tile.wholeB=Math.max(tile.wholeB,c.py+dy);}if(++steps%64===0)yield;
    }tiles.set(id,tile);yield;
   }
   const fill=new Path2D(),edge=new Path2D(),points=[];let sumX=0,sumY=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(const tile of tiles.values()){fill.addPath(tile.fill);edge.addPath(tile.edge);sumX+=tile.sumX;sumY+=tile.sumY;left=Math.min(left,tile.wholeL);right=Math.max(right,tile.wholeR);top=Math.min(top,tile.wholeT);bottom=Math.max(bottom,tile.wholeB);for(const c of tile.points)points.push(c);if(++steps%32===0)yield;}
   let nearest=null,score=Infinity;const meanX=sumX/points.length,meanY=sumY/points.length;
   for(const c of points){const distance=(c.px-meanX)**2+(c.py-meanY)**2;if(distance<score){score=distance;nearest=c;}if(++steps%256===0)yield;}
   const ring=nearest&&CrateMapRenderer.surface(nearest)[0],center=ring?.length?{x:nearest.px+ring.reduce((n,p)=>n+p[0],0)/ring.length,y:nearest.py+ring.reduce((n,p)=>n+p[1],0)/ring.length}:null;
   const bounds=Number.isFinite(left)?{x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)}:null;
   return {revision,fill,edge,tiles:[...tiles.values()],tileMap:tiles,rebuiltTiles:dirty.size,center,points,keys:reg.cells,reachX,reachY,bounds};
  }
  function paintRegion(ctx,reg,view,alpha=.18,clip=null){
   if(!reg.cells.size)return;paintGeometry(ctx,geometry(reg),view,reg.color,alpha,reg.id===doc.active,clip);
  }
  function paintGeometry(ctx,g,view,color,alpha,selected,clip=null){
   let fill=g.fill,edge=g.edge;
   if(clip){
    const l=(clip.x-view.x-2)/view.scale,r=(clip.x+clip.w-view.x+2)/view.scale;
    const t=(clip.y-view.y-2)/view.scale,b=(clip.y+clip.h-view.y+2)/view.scale;
    const tiles=g.tiles.filter(tile=>tile.l<r&&tile.r>l&&tile.t<b&&tile.b>t);
    if(!tiles.length)return;
    // Edge-strip updates submit only nearby polygons to the rasterizer. A
    // viewport clip alone still tessellates a huge, map-wide Path2D in Chromium.
    if(tiles.length<g.tiles.length){fill=new Path2D();edge=new Path2D();for(const tile of tiles){fill.addPath(tile.fill);edge.addPath(tile.edge);}}
   }
   ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);
   if(alpha>0){ctx.fillStyle=color;ctx.globalAlpha=alpha;ctx.fill(fill,'evenodd');ctx.globalAlpha=1;}
   if(selected!==null&&view.scale>=.12){ctx.strokeStyle=color;ctx.lineWidth=(selected?1.4:.8)/view.scale;ctx.stroke(edge);}
   ctx.restore();
  }
  function cachedRegion(ctx,reg,view,clip,kind,alpha){
   if(!reg.cells.size)return;const g=geometry(reg),b=g.bounds;if(!b)return;
   // Only the minimap uses per-region masks. The main view caches the entire
   // composition so large/overlapping regions cannot evict each other's masks.
   const x=Math.max(Math.floor(view.x+b.x*view.scale-2),clip.x),y=Math.max(Math.floor(view.y+b.y*view.scale-2),clip.y);
   const right=Math.min(Math.ceil(view.x+(b.x+b.w)*view.scale+2),clip.x+clip.w),bottom=Math.min(Math.ceil(view.y+(b.y+b.h)*view.scale+2),clip.y+clip.h);
   const w=right-x,h=bottom-y;if(w<=0||h<=0)return;
   const offsetX=view.x-x,offsetY=view.y-y;
   const id=kind+reg.id,key=[g.revision,reg.color,reg.id===doc.active,view.scale,offsetX,offsetY,w,h].join('|');
   let cached=rasterCache.get(id);
   if(!cached||cached.region!==reg||cached.key!==key){
    if(cached){rasterPixels-=cached.pixels;rasterCache.delete(id);}
    const pixels=w*h;
    while((rasterPixels+pixels>16000000||rasterCache.size>=128)&&rasterCache.size){const oldest=rasterCache.keys().next().value;rasterPixels-=rasterCache.get(oldest).pixels;rasterCache.delete(oldest);}
    const fill=document.createElement('canvas');fill.width=w;fill.height=h;
    paintGeometry(fill.getContext('2d'),g,{x:offsetX,y:offsetY,scale:view.scale},reg.color,1,null);
    cached={region:reg,key,fill,pixels};
    rasterCache.set(id,cached);rasterPixels+=pixels;
   }else{rasterCache.delete(id);rasterCache.set(id,cached);}
   if(alpha>0){ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(cached.fill,x,y);ctx.restore();}
   paintGeometry(ctx,g,view,reg.color,0,reg.id===doc.active);
  }
  function mapPoint(p){
   const s=state(),x=(p.x-s.x)/s.scale,y=(p.y-s.y)/s.scale,t=stroke?.tool||tool(),c=(t.includes('game')||t==='box-screen')?pick(p):null,[ox,oy]=s.data.rendering.origin;
   // Picking accounts for cliffs. Keep a discrete anchor for game-coordinate tools.
   const game=c?{x:c.x,y:c.y}:{x:Math.round(((x-ox)/30+(y-oy)/15)/2),y:Math.round(((y-oy)/15-(x-ox)/30)/2)};
   return {x,y,game,level:c?.level||0,cell:c};
  }
  function boxPreview(t,a,b){
   const cells=selectionIndex.selectedCells(t,a,b);
   // Screen boxes keep their center-in-box rule. Only an empty result uses
   // the actual end pick, so the preview and release commit are identical.
   return cells.length||t!=='box-screen'?cells:b.cell&&eligible.has(R.key(b.cell))?[b.cell]:[];
  }
  const inside=p=>p.x>=area.x&&p.x<=area.x+area.w&&p.y>=area.y&&p.y<=area.y+area.h;
  function applyKeys(keys,remove){
   const starts=root.CratePlayerStarts?.positions(state())||[],beforePlayers=new Map(doc.regions.map(r=>[r.id,R.playersForRegion(doc,r,starts)]));let lastCell=null,activeCell=null,fallback=null;
   const tiles=new Map(),changedKeys=new Set(),changed=R.apply(doc,keys,remove,(reg,k)=>{
    const cell=lookup.get(k),players=beforePlayers.get(reg.id);if(cell){lastCell=cell;if(reg.id===doc.active)activeCell=cell;if(players?.length)fallback={cell,players};}
    let journal=editJournal.get(reg);if(!journal){journal={since:R.revision(reg),keys:new Map()};editJournal.set(reg,journal);}journal.keys.set(k,R.revision(reg)+1);
    changedKeys.add(k);
   });
   // Exclusive moves change two regions, and neighboring cells share borders.
   // Invalidate each surface/tile once instead of allocating it repeatedly.
   const surfaces=new Set();for(const k of changedKeys)for(const key of [k,k-1024,k+1024,k-1,k+1])surfaces.add(key);
   for(const key of surfaces){const c=lookup.get(key);if(!c)continue;const b=cellSurfaceBox(c);
    for(let y=Math.floor(b.t/120);y<=Math.floor(b.b/120);y++)for(let x=Math.floor(b.l/240);x<=Math.floor(b.r/240);x++){
     const id=x+','+y;if(tiles.has(id))continue;const rect={x:x*240-3,y:y*120-3,w:246,h:126};tiles.set(id,rect);liveOverlayTiles.set(id,rect);
    }
   }
   if(changed){mapOverlayCache?.invalidate([...tiles.values()]);const players=R.playersForRegion(doc,current(),starts);onInteraction?.(activeCell||lastCell,players.length?players:beforePlayers.get(doc.active)?.length?beforePlayers.get(doc.active):fallback?.players);}return changed;
  }
  function down(p,e={}){
   if(!active||!overlayVisible()||automatic||!inside(p))return false;
   cancelFill();
   modifiers(e);
   const q=mapPoint(p);
   if(picking()||tool()==='fill'){
    stroke={a:q,b:q,tool:picking()?'picker':'fill',point:p,client:{x:e.clientX??p.x,y:e.clientY??p.y},moved:false,baseRemove:$('regionOperation').value==='remove',remove:removing()};
    hover=q;interactionHint();schedule();return true;
   }
   doc.autoHandled=true;stroke={a:q,b:q,before:R.encode(doc),tool:tool(),width:width(),height:height(),baseRemove:$('regionOperation').value==='remove',remove:removing(),changed:false};
   if(stroke.tool.startsWith('brush'))brush(q);else stroke.preview=boxPreview(stroke.tool,q,q);
   hover=q;previewChanged();schedule();return true;
  }
  function brush(q){
   const d=stroke,keys=selectionIndex.selected(d.tool,d.b,q,d.width,d.height);
   const changed=applyKeys(keys,d.remove);d.changed=changed||d.changed;d.b=q;if(changed&&asynchronous)refresh();
  }
  function move(p,occluded=false,e={}){
   if(!active)return false;
   if(!overlayVisible()){if(stroke)up();hover=null;previewChanged();return false;}
   modifiers(e);
   if(occluded||!inside(p)){hover=null;if(stroke){stroke.gap=true;if(['picker','fill'].includes(stroke.tool))stroke.moved=true;}previewChanged();schedule();return !!stroke;}
   const q=mapPoint(p);hover=q;
   syncCursor();
   if(stroke){
    if(['picker','fill'].includes(stroke.tool)){stroke.b=q;stroke.point=p;if(Math.hypot((e.clientX??p.x)-stroke.client.x,(e.clientY??p.y)-stroke.client.y)>4)stroke.moved=true;}
    else if(stroke.tool.startsWith('brush')){if(stroke.gap)stroke.b=q;brush(q);}
    else{stroke.b=q;stroke.preview=boxPreview(stroke.tool,stroke.a,q);}
    stroke.gap=false;
   }
   previewChanged();
   if(stroke||!schedulePreview)schedule();else if(hoverTimer===null)hoverTimer=setTimeout(()=>{hoverTimer=null;schedule();},80);
   return !!stroke;
  }
  function hoverInfo(){
   if(!active||!hover)return null;
   // Pick once per drawn frame using the existing terrain-aware spatial index,
   // independently of the active brush/region. Membership stays live while painting.
   const s=state(),cell=pick({x:s.x+hover.x*s.scale,y:s.y+hover.y*s.scale});
   if(!cell)return {cell:null,regions:[]};
   const k=R.key(cell);
   return {cell,selectable:eligible.has(k),regions:doc.regions.filter(r=>r.cells.has(k))};
  }
  const fillStamp=()=>[doc.active,doc.overlap,...doc.regions.flatMap(r=>[r.id,R.revision(r)])].join('|');
  async function fill(d){
   const seed=pick(d.point);if(!seed||!eligible.has(R.key(seed))){$('regionActionStatus').textContent=_t('此处不在可选区域内。');return;}
   cancelFill();const controller=new AbortController(),s=state(),data=s.data,target=doc,stamp=fillStamp();filling=controller;
   const valid=()=>!controller.signal.aborted&&doc===target&&state().data===data&&fillStamp()===stamp;
   $('regionActionStatus').textContent=_t('正在填充…');
   try{
    const navigation=await navigationFor(s,controller.signal);if(!valid())return;
    // Navigation flags follow report order. The viewer's cells are sorted for
    // painting and must never be paired by index with this positional bitmap.
    const steps=R.fillSteps(doc,seed,eligible,{cells:data.cells,navigation,revision:data});let next,tick=performance.now();
    do{next=steps.next();if(!next.done&&performance.now()-tick>5){await new Promise(resolve=>setTimeout(resolve,0));if(!valid())return;tick=performance.now();}}while(!next.done);
    if(!valid())return;const keys=next.value;
    if(keys.length){
     doc.autoHandled=true;const before=R.encode(doc),changed=applyKeys(keys,d.remove);
     if(changed){remember(before,regionEditLabel(d.remove));dirty(true,true);$('regionActionStatus').textContent=isEmpty()?_t`已清除连通部分的所有区域归属（${keys.length} 格）；可撤销。`:d.remove?_t`已从当前区域移除连通部分（${keys.length} 格）；可撤销。`:_t`已将连通部分并入当前区域（${keys.length} 格）；可撤销。`;}
     else $('regionActionStatus').textContent=_t('该连通部分的归属无需更改。');
    }else $('regionActionStatus').textContent=_t('此处无法填充。');
   }catch(error){if(valid()){$('regionActionStatus').textContent=_t('填充失败：')+error.message;onError?.(error);}}
   finally{if(filling===controller){filling=null;if($('regionActionStatus').textContent===_t('正在填充…'))$('regionActionStatus').textContent='';}schedule();}
  }
  function up(){
   if(!stroke)return;const d=stroke;
   if(d.tool==='fill'){
    stroke=null;
    if(!d.moved)void fill(d);
    interactionHint();schedule();return;
   }
   if(d.tool==='picker'){
    stroke=null;
    if(!d.moved){
     selectSample(pick(d.point));
    }
    interactionHint();schedule();return;
   }
   if(d.tool.startsWith('box'))d.changed=applyKeys(d.preview.map(R.key),d.remove);
   stroke=null;interactionHint();previewChanged();if(pendingThumbnails){pendingThumbnails=false;thumbnails.request(true);}
   if(d.changed){remember(d.before,regionEditLabel(d.remove));dirty(true,true);}else schedule();
  }
  function cancel(){
   cancelFill();
   if(stroke){if(stroke.before)adoptDocument(restoreHistory(stroke.before));stroke=null;refresh();interactionHint();schedule();saveSoon();}
  }
  function preview(ctx,view){
   syncCursor();const d=stroke;if(!active||!overlayVisible()||!hover||state().ctrlPickerPreviewHidden)return;
   if(!picking()&&(d?.tool||tool())==='fill'){
    const x=view.x+hover.x*view.scale,y=view.y+hover.y*view.scale;
    ctx.save();ctx.beginPath();ctx.moveTo(x,y-9);ctx.lineTo(x+10,y);ctx.lineTo(x,y+9);ctx.lineTo(x-10,y);ctx.closePath();ctx.strokeStyle='#10232d';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle=removing()?'#ffb3a9':current().color;ctx.lineWidth=1.6;ctx.stroke();ctx.restore();return;
   }
   // A temporary Ctrl picker keeps a resizable brush until the first press;
   // the shared simulation picker still supplies the pointer and sample UI.
   if(picking()&&!(ctrlHeld&&!state().ctrlResizing&&tool().startsWith('brush')))return;
   const t=d?.tool||tool(),q=d?.b||hover,a=d?.a||q,w=d?.width||width(),h=d?.height||height(),remove=d?.remove??removing();
   const color=remove?'#ffb3a9':current().color;let perimeter=0;
   ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.6;ctx.beginPath();
   const screen=p=>[view.x+p.x*view.scale,view.y+p.y*view.scale];
   if(t.includes('game')){
    const gx=q.game.x+(w%2===0?.5:0),gy=q.game.y+(h%2===0?.5:0);
    const left=t.startsWith('box')?Math.min(a.game.x,q.game.x)-.5:gx-w/2;
    const right=t.startsWith('box')?Math.max(a.game.x,q.game.x)+.5:gx+w/2;
    const top=t.startsWith('box')?Math.min(a.game.y,q.game.y)-.5:gy-h/2;
    const bottom=t.startsWith('box')?Math.max(a.game.y,q.game.y)+.5:gy+h/2;
    const [ox,oy]=state().data.rendering.origin;
    [[left,top],[right,top],[right,bottom],[left,bottom]].forEach(([x,y],i)=>{const p=screen({x:30*(x-y)+ox,y:15*(x+y-q.level)+oy});ctx[i?'lineTo':'moveTo'](...p);});ctx.closePath();
    perimeter=2*((right-left)+(bottom-top))*Math.hypot(30,15)*view.scale;
   }else if(t==='brush-circle'||t==='brush-ellipse'){const [x,y]=screen(q),rx=w*30*view.scale,ry=w*(t==='brush-ellipse'?15:30)*view.scale;ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);perimeter=Math.PI*(3*(rx+ry)-Math.sqrt((3*rx+ry)*(rx+3*ry)));}
   else{const x=t.startsWith('box')?Math.min(a.x,q.x):q.x-w*30,y=t.startsWith('box')?Math.min(a.y,q.y):q.y-h*15;const p=screen({x,y}),rw=(t.startsWith('box')?Math.abs(q.x-a.x):w*60)*view.scale,rh=(t.startsWith('box')?Math.abs(q.y-a.y):h*30)*view.scale;ctx.rect(...p,rw,rh);perimeter=2*(rw+rh);}
   ctx.globalAlpha=.10;ctx.fill();ctx.globalAlpha=1;
   // At most 64 dashes around the outline, with a dark border on each dash.
   const period=Math.max(14,perimeter/64);ctx.setLineDash([period*.6,period*.4]);ctx.lineJoin=ctx.lineCap='round';ctx.strokeStyle='#03080d';ctx.lineWidth=4.6;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.stroke();ctx.restore();
   if(d?.tool.startsWith('box')){
    if(d.previewShapeCells!==d.preview){d.previewShapeCells=d.preview;d.previewShape=cellPaths(d.preview,{x:0,y:0,scale:1}).fill;}
    ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);ctx.fillStyle=remove?'#ffb3a9':current().color;ctx.globalAlpha=.25;ctx.fill(d.previewShape,'evenodd');ctx.restore();
   }
  }
  function clipCamera(ctx,view,camera){
   if(camera){ctx.beginPath();ctx.rect(view.x+camera[0]*view.scale,view.y+camera[1]*view.scale,camera[2]*view.scale,camera[3]*view.scale);ctx.clip();}
  }
  function orderedRegions(){return [...doc.regions].sort((a,b)=>Number(a.id===doc.active)-Number(b.id===doc.active));}
  function labelData(){
   const s=state(),denominator=s.data.probability?.exact?.denominator;
   if(!overlayVisible()||!doc.showTotals||!denominator)return [];
   const display=getDisplay(),D=root.CrateProbabilityDisplay;
   return orderedRegions().filter(r=>r.cells.size).map(r=>{
    const name=R.displayName(r),g=geometry(r),total=statisticsFor(r);let cached=labelCache.get(r);if(cached?.geometry===g&&cached.statistics===total&&cached.color===r.color&&cached.name===name)return cached.value;
    const p=D.ratio(total.all.n,BigInt(statisticsCache.get(r)?.data?.probability?.exact?.denominator||denominator));
    const value={id:r.id,center:g.center,bounds:g.bounds,boxes:cached?.geometry===g?cached.value.boxes:g.points.map(cellSurfaceBox),tiles:g.tileMap,reachX:g.reachX,reachY:g.reachY,color:r.color,strokes:R.labelStrokes(),name:name+':',probability:(s.data.metadata.approximate?'≈':'')+D.percent(p)};
    if(value.center&&!titleContains(value,{x:0,y:0,scale:1},value.center.x,value.center.y))value.center=labelAnchor(value,{x:0,y:0,scale:1},{l:g.bounds.x,r:g.bounds.x+g.bounds.w,t:g.bounds.y,b:g.bounds.y+g.bounds.h},g.points,value.center.x,value.center.y);
    labelCache.set(r,{geometry:g,statistics:total,color:r.color,name,value});return value;
   });
  }
  function clippedPolygon(points,clip){
   const sides=[[0,clip.l,1],[0,clip.r,-1],[1,clip.t,1],[1,clip.b,-1]];
   for(const [axis,edge,sign] of sides){
    if(!points.length)break;
    const input=points;points=[];
    let a=input.at(-1),insideA=sign*(a[axis]-edge)>=0;
    for(const b of input){
     const insideB=sign*(b[axis]-edge)>=0;
     if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
     if(insideB)points.push(b);
     a=b;insideA=insideB;
    }
   }
   return points;
  }
  function cellSurfaceBox(c){
   let box=surfaceBoxes.get(c);if(box)return box;
   const rings=CrateMapRenderer.surface(c),flat=[[0,-15],[30,0],[0,15],[-30,0]];
   box={cell:c,rings,l:Infinity,r:-Infinity,t:Infinity,b:-Infinity,
    diamond:rings.length===1&&rings[0].length===4&&rings[0].every((p,i)=>p[0]===flat[i][0]&&p[1]===flat[i][1])};
   for(const ring of rings)for(const [dx,dy]of ring){box.l=Math.min(box.l,c.px+dx);box.r=Math.max(box.r,c.px+dx);box.t=Math.min(box.t,c.py+dy);box.b=Math.max(box.b,c.py+dy);}
   surfaceBoxes.set(c,box);return box;
  }
  function visibleLabelCells(label,view,clip,source=null){
   const world={l:(clip.l-view.x)/view.scale,r:(clip.r-view.x)/view.scale,t:(clip.t-view.y)/view.scale,b:(clip.b-view.y)/view.scale};
   const key=[world.l,world.r,world.t,world.b].join('|'),cached=labelVisibility.get(label);
   if(cached?.has(key))return cached.get(key);
   const cells=[];
   for(const entry of source||label.boxes){
    const box=source?cellSurfaceBox(entry):entry;
    const c=box.cell;
    if(box.l>=world.r||box.r<=world.l||box.t>=world.b||box.b<=world.t)continue;
    if(box.l>=world.l&&box.r<=world.r&&box.t>=world.t&&box.b<=world.b){cells.push(c);continue;}
    if(box.diamond){
     const dx=Math.max(0,world.l-c.px,c.px-world.r),dy=Math.max(0,world.t-c.py,c.py-world.b);
     if(dx/30+dy/15<1)cells.push(c);
     continue;
    }
    // Partially visible terrain surfaces count once. Empty bounding-box
    // corners and cells that only touch the viewport boundary do not count.
    if(box.rings.some(ring=>{
     const points=clippedPolygon(ring.map(([dx,dy])=>[c.px+dx,c.py+dy]),world);
     let area=0;for(let i=0,j=points.length-1;i<points.length;j=i++)area+=points[j][0]*points[i][1]-points[i][0]*points[j][1];
     return Math.abs(area)>1e-7;
    }))cells.push(c);
   }
   const entries=cached||new Map();entries.set(key,cells);while(entries.size>2)entries.delete(entries.keys().next().value);
   labelVisibility.set(label,entries);return cells;
  }
  function labelAnchor(label,view,clip,cells,targetX,targetY){
   let anchor=null,best=Infinity;
   for(const c of cells){
    const cx=view.x+c.px*view.scale,cy=view.y+c.py*view.scale;
    const dx=Math.max(0,Math.abs(cx-targetX)-label.reachX*view.scale),dy=Math.max(0,Math.abs(cy-targetY)-label.reachY*view.scale);
    if(dx*dx+dy*dy>=best)continue;
    for(const ring of CrateMapRenderer.surface(c)){
     const polygon=ring.map(([dx,dy])=>[view.x+(c.px+dx)*view.scale,view.y+(c.py+dy)*view.scale]);
     const points=clippedPolygon(polygon,clip);
     if(points.length<3)continue;
     function contains(x,y){
      let inside=false;
      for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
       const a=polygon[j],b=polygon[i],dx=b[0]-a[0],dy=b[1]-a[1],cross=(x-a[0])*dy-(y-a[1])*dx;
       if(Math.abs(cross)<1e-6&&x>=Math.min(a[0],b[0])-1e-6&&x<=Math.max(a[0],b[0])+1e-6&&y>=Math.min(a[1],b[1])-1e-6&&y<=Math.max(a[1],b[1])+1e-6)return true;
       if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      }
      return inside;
     }
     if(targetX>=clip.l&&targetX<=clip.r&&targetY>=clip.t&&targetY<=clip.b&&contains(targetX,targetY))return {x:targetX,y:targetY};
     for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const fraction=Math.max(0,Math.min(1,((targetX-a[0])*dx+(targetY-a[1])*dy)/(dx*dx+dy*dy||1)));
      // Clipping a concave surface can join separate pieces along the clip
      // boundary. Check the source polygon before accepting an anchor there.
      for(const [x,y]of [[a[0]+dx*fraction,a[1]+dy*fraction],a]){
       const distance=(x-targetX)**2+(y-targetY)**2;
       if(distance<best&&contains(x,y)){anchor={x,y};best=distance;}
      }
     }
    }
   }
   return anchor;
  }
  function visibleTitleBounds(cells,view,clip){
   let bounds=visibleTitleBoxes.get(cells);
   if(!bounds){
    bounds={l:Infinity,r:-Infinity,t:Infinity,b:-Infinity};
    const world={l:(clip.l-view.x)/view.scale,r:(clip.r-view.x)/view.scale,t:(clip.t-view.y)/view.scale,b:(clip.b-view.y)/view.scale};
    const include=(x,y)=>{bounds.l=Math.min(bounds.l,x);bounds.r=Math.max(bounds.r,x);bounds.t=Math.min(bounds.t,y);bounds.b=Math.max(bounds.b,y);};
    for(const c of cells){const b=cellSurfaceBox(c);
     if(b.l>=world.l&&b.r<=world.r&&b.t>=world.t&&b.b<=world.b){include(b.l,b.t);include(b.r,b.b);continue;}
     for(const ring of b.rings){
      const points=clippedPolygon(ring.map(([x,y])=>[c.px+x,c.py+y]),world);
      let area=0;for(let i=0,j=points.length-1;i<points.length;j=i++)area+=points[j][0]*points[i][1]-points[i][0]*points[j][1];
      if(Math.abs(area)>1e-7)for(const [x,y]of points)include(x,y);
     }
    }
    visibleTitleBoxes.set(cells,bounds);
   }
   return {l:Math.max(clip.l,view.x+bounds.l*view.scale),r:Math.min(clip.r,view.x+bounds.r*view.scale),t:Math.max(clip.t,view.y+bounds.t*view.scale),b:Math.min(clip.b,view.y+bounds.b*view.scale)};
  }
  function titleContains(label,view,x,y){
   const wx=(x-view.x)/view.scale,wy=(y-view.y)/view.scale;
   for(let tx=Math.floor((wx-label.reachX)/480);tx<=Math.floor((wx+label.reachX)/480);tx++)for(let ty=Math.floor((wy-label.reachY)/240);ty<=Math.floor((wy+label.reachY)/240);ty++){
    const tile=label.tiles.get(tx+','+ty);if(!tile)continue;
    for(const c of tile.points){
     const box=cellSurfaceBox(c);if(wx<box.l-1e-6||wx>box.r+1e-6||wy<box.t-1e-6||wy>box.b+1e-6)continue;
     if(box.diamond){if(Math.abs(wx-c.px)/30+Math.abs(wy-c.py)/15<=1+1e-7)return true;continue;}
     for(const ring of box.rings){
      let inside=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
       const a=ring[j],b=ring[i],ax=c.px+a[0],ay=c.py+a[1],bx=c.px+b[0],by=c.py+b[1];
       if(Math.abs((wx-ax)*(by-ay)-(wy-ay)*(bx-ax))<1e-6&&wx>=Math.min(ax,bx)-1e-6&&wx<=Math.max(ax,bx)+1e-6&&wy>=Math.min(ay,by)-1e-6&&wy<=Math.max(ay,by)+1e-6)return true;
       if((ay>wy)!==(by>wy)&&wx<(bx-ax)*(wy-ay)/(by-ay)+ax)inside=!inside;
      }
      if(inside)return true;
     }
    }
   }
   return false;
  }
  function paintLabels(ctx,view,labels,viewport,camera,motions=null,dynamic=$('dynamicRegionTitles')?.checked!==false){
   if(!dynamic){motions?.clear();motions=null;}
   const clip={l:viewport.x,r:viewport.x+viewport.w,t:viewport.y,b:viewport.y+viewport.h};
   // The camera limits eligible anchor points. Text can use the entire viewport.
   const mapClip={...clip};
   if(camera){
    mapClip.l=Math.max(clip.l,view.x+camera[0]*view.scale);mapClip.r=Math.min(clip.r,view.x+(camera[0]+camera[2])*view.scale);
    mapClip.t=Math.max(clip.t,view.y+camera[1]*view.scale);mapClip.b=Math.min(clip.b,view.y+(camera[1]+camera[3])*view.scale);
   }
   if(clip.r-clip.l<12||clip.b-clip.t<12){motions?.clear();return;}
   const zoom=Math.log2(view.scale);
   const now=root.performance?.now()??Date.now(),seen=new Set();let animating=false;
   const stability=motions?titleViewport.observe(view,viewport,now):{settled:true,remaining:0};
   const viewKey=[view.x,view.y,view.scale,viewport.x,viewport.y,viewport.w,viewport.h,...(camera||[]),...Object.values(titleTuning.settings)].join('|');
   ctx.save();ctx.beginPath();ctx.rect(clip.l,clip.t,clip.r-clip.l,clip.b-clip.t);ctx.clip();
   ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
   const opacity=Math.max(.44,1-.22*Math.max(0,zoom));
   const prepared=[];let cameraChanged=false;
   for(const label of labels){
    const b=label.bounds;if(!b||!label.center)continue;
    const l=Math.max(mapClip.l,view.x+b.x*view.scale),r=Math.min(mapClip.r,view.x+(b.x+b.w)*view.scale);
    const t=Math.max(mapClip.t,view.y+b.y*view.scale),bottom=Math.min(mapClip.b,view.y+(b.y+b.h)*view.scale);
    if(l>=r||t>=bottom)continue;
    const cells=visibleLabelCells(label,view,mapClip);if(!cells.length)continue;
    const measure=size=>{
     const parts=[[label.name,size*.74],[label.probability,size]].map(([text,size])=>{
      const font=`700 ${size}px "Microsoft YaHei",sans-serif`;ctx.font=font;return {text,size,font,metrics:ctx.measureText(text)};
     });
     const gap=size*.12,pad=3+size*.11;
     return {parts,gap,halfWidth:(parts[0].metrics.width+gap+parts[1].metrics.width)/2,
      height:Math.max(...parts.map(({metrics:m})=>m.actualBoundingBoxAscent+m.actualBoundingBoxDescent))/2+pad,pad,size};
    };
    const fitFor=(samples,range)=>{
     const size=2*Math.min(34,14+Math.sqrt(samples.length)*.72);
     let fit=measure(size);
     const bounds={l:Math.max(l,range.l),r:Math.min(r,range.r),t:Math.max(t,range.t),b:Math.min(bottom,range.b)};
     const ratio=root.CrateRegionLabelLayout.fitRatio(fit,range,bounds);
     if(ratio<1)fit=measure(size*ratio*.95);return fit;
    };
    // The center rectangle selects a new anchor only. Normal final font size
    // always uses all visible cells and the real viewport's visible geometry.
    let fit=fitFor(cells,mapClip);
    if(fit.size<3||r-l<8||bottom-t<8)continue;
    let motion=motions?.get(label.id);
    if(motion?.visible){
     cameraChanged=root.CrateRegionLabelLayout.transport(motion,view)||cameraChanged;
    }
    const baseFit=fit;let shrinkHeld=false;
    if(motion?.visible&&!motion.hidden&&!root.CrateRegionLabelLayout.fullyVisible(motion.x,motion.y,fit.halfWidth+fit.pad,fit.height,clip)&&Math.hypot(motion.targetX-motion.x,motion.targetY-motion.y)<=.2&&motion.x>=mapClip.l&&motion.x<=mapClip.r&&motion.y>=mapClip.t&&motion.y<=mapClip.b&&titleContains(label,view,motion.x,motion.y)){
     const retained=root.CrateRegionLabelLayout.retainedFit(motion.x,motion.y,fit,clip,measure,titleTuning.settings);
     if(retained&&retained!==fit){fit=retained;shrinkHeld=true;}
    }
    prepared.push({label,fit,measure,cells,motion,changed:!motion||motion.hidden||motion.viewKey!==viewKey||motion.label!==label,baseFit,shrinkHeld});seen.add(label.id);
   }
   const dirty=prepared.some(p=>p.changed);
   const relocating=prepared.some(({motion})=>motion?.visible&&!motion.hidden&&Math.hypot(motion.targetX-motion.x,motion.targetY-motion.y)>.2);
   const layoutReady=!motions||stability.settled&&!cameraChanged&&!relocating&&now-titleLayoutAt>=titleInterval;
   if(!dynamic){
    for(const item of prepared)item.anchor={x:view.x+item.label.center.x*view.scale,y:view.y+item.label.center.y*view.scale};
   }else if(dirty&&layoutReady){
    const candidates=[];
    for(const item of prepared){
     const {label,cells,motion}=item;let {fit}=item,margin=fit.halfWidth+fit.pad;
     let x=view.x+label.center.x*view.scale,y=view.y+label.center.y*view.scale;
     const layout=root.CrateRegionLabelLayout,base=item.baseFit;
     const returnCenter=titleContains(label,view,x,y)&&layout.returnAllowed(x,y,base.halfWidth+base.pad,base.height,clip,cells.length/label.boxes.length,titleTuning.settings);
     const visibleBounds=titleTuning.settings.insetEnabled||titleTuning.settings.edgeOnlyEnabled?visibleTitleBounds(cells,view,mapClip):null;
     const atEdge=titleTuning.settings.edgeOnlyEnabled&&layout.edgeOnly(visibleBounds,clip,titleTuning.settings);
     const inset=titleTuning.settings.insetEnabled?layout.insetClip(visibleBounds,titleTuning.settings):mapClip;
     const innerClip={l:Math.max(mapClip.l,inset.l),r:Math.min(mapClip.r,inset.r),t:Math.max(mapClip.t,inset.t),b:Math.min(mapClip.b,inset.b)};
     const locked=!!((item.shrinkHeld||titleTuning.settings.lazy&&!returnCenter)&&motion?.visible&&!motion.hidden&&layout.fullyVisible(motion.x,motion.y,margin,fit.height,clip)&&titleContains(label,view,motion.x,motion.y));
     if(locked){x=motion.x;y=motion.y;}
     // Returning to the original center needs spare room, unless most of the
     // region is visible. A bounded shrink can avoid an edge-driven move.
     let range=locked||returnCenter||atEdge?mapClip:innerClip;
     const safeFor=range=>({l:Math.max(range.l,clip.l+margin),r:Math.min(range.r,clip.r-margin),t:Math.max(range.t,clip.t+fit.height),b:Math.min(range.b,clip.b-fit.height)});
     let safe=safeFor(range);
     let allowed=safe;
     if(x<safe.l||x>safe.r||y<safe.t||y>safe.b||!titleContains(label,view,x,y)){
      let anchor=safe.l<=safe.r&&safe.t<=safe.b?labelAnchor(label,view,safe,cells,x,y):null;
      // A region may only graze the center rectangle. Use its normal visible
      // anchor without changing the final font size.
      if(!anchor&&range!==mapClip){
       range=mapClip;allowed=safe=safeFor(range);
       anchor=safe.l<=safe.r&&safe.t<=safe.b?labelAnchor(label,view,safe,cells,x,y):null;
      }
      if(!anchor){allowed=mapClip;anchor=labelAnchor(label,view,mapClip,cells,x,y);}
      if(!anchor){if(motions)motions.set(label.id,item.motion={visible:false,viewKey,label,targetAt:now});continue;}
      ({x,y}=anchor);
     }
     item.anchor={x,y};
     candidates.push({id:label.id,locked,x:locked?x:motion?.visible?motion.targetX:x,y:locked?y:motion?.visible?motion.targetY:y,preferredX:x,preferredY:y,
      halfWidth:margin,halfHeight:fit.height,priority:label.boxes.length,
      contains:(x,y)=>x>=allowed.l-1e-6&&x<=allowed.r+1e-6&&y>=allowed.t-1e-6&&y<=allowed.b+1e-6&&titleContains(label,view,x,y)});
    }
    const solved=root.CrateRegionLabelLayout.avoid(candidates).positions;
    for(const item of prepared){const p=solved.get(item.label.id);if(!p)continue;if(!titleContains(item.label,view,p.x,p.y)){if(item.motion)item.motion.visible=false;continue;}item.anchor={x:p.x,y:p.y};
     if(motions){
      let motion=item.motion;if(!motion?.visible||motion.hidden)motion={x:p.x,y:p.y,targetX:p.x,targetY:p.y,frameAt:now,appearedAt:now,viewX:view.x,viewY:view.y,scale:view.scale};
      else if(Math.hypot(motion.targetX-p.x,motion.targetY-p.y)>.2){motion.frameAt=now;motion.vx=motion.vy=0;motion.sizeTravel=motion.destinationFit=null;motion.entryHalfWidth=motion.entryHalfHeight=undefined;}
      Object.assign(motion,{visible:true,hidden:false,fade:null,targetX:p.x,targetY:p.y,targetAt:now,viewKey,label:item.label});motions.set(item.label.id,motion);item.motion=motion;
     }
    }
    if(motions){titleLayoutAt=now;clearTimeout(titleWake);titleWake=null;}
   }else if(dirty&&motions){
    wakeTitles(now,stability.settled?Math.max(1,titleInterval-(now-titleLayoutAt)):stability.remaining);
    // New labels wait for their final constrained/collision-resolved anchor;
    // never display an intermediate center that would introduce another leg.
   }
   for(const {label,fit:targetFit,baseFit,measure,motion,anchor}of prepared){
    if(motions&&(!motion?.visible||motion.hidden)||!motions&&!anchor)continue;
    let fit=targetFit;
    let frames=[{x:anchor?.x,y:anchor?.y,alpha:1}];
    if(motion){
     const layout=root.CrateRegionLabelLayout,planned=!!motion.sizeTravel||Math.hypot(motion.x-motion.targetX,motion.y-motion.targetY)>.2;
     let goal;
     if(planned){
      const cached=motion.destinationFit;
      if(!cached||cached.viewKey!==viewKey||cached.label!==label||cached.x!==motion.targetX||cached.y!==motion.targetY)motion.destinationFit={viewKey,label,x:motion.targetX,y:motion.targetY,fit:layout.edgeFit(motion.targetX,motion.targetY,baseFit,clip,measure,titleTuning.settings)};
      goal=motion.destinationFit.fit;layout.prepareTravelSize(motion,goal.size);
     }else goal=layout.edgeFit(motion.x,motion.y,baseFit,clip,measure,titleTuning.settings);
     const moving=layout.advance(motion,clip,motion.halfWidth??fit.halfWidth+fit.pad,motion.halfHeight??fit.height,now,titleTuning.settings),alpha=Math.min(1,Math.max(0,(now-motion.appearedAt)/titleFade));
     const resizing=planned?layout.advanceTravelSize(motion,now,moving):layout.advanceSize(motion,goal.size,now,titleTuning.settings);
     if(planned&&!moving)motion.sizeTravel=motion.destinationFit=null;
     if(resizing){
      const factor=motion.displaySize/goal.size,pad=3+motion.displaySize*.11;
      const parts=goal.parts.map(p=>{const size=p.size*factor;return {...p,size,font:`700 ${size}px "Microsoft YaHei",sans-serif`,metrics:{width:p.metrics.width*factor,actualBoundingBoxAscent:p.metrics.actualBoundingBoxAscent*factor,actualBoundingBoxDescent:p.metrics.actualBoundingBoxDescent*factor}};});
      fit={...goal,parts,gap:goal.gap*factor,halfWidth:goal.halfWidth*factor,height:(goal.height-goal.pad)*factor+pad,pad,size:motion.displaySize};
     }else fit=goal;
     motion.halfWidth=fit.halfWidth+fit.pad;motion.halfHeight=fit.height;
     frames=alpha>0&&(moving||titleContains(label,view,motion.x,motion.y))?[{x:motion.x,y:motion.y,alpha}]:[];seen.add(label.id);animating=animating||moving||resizing||alpha<1;
    }
    function paintTitle(target,fit,x,y){
     let left=x-fit.halfWidth;
     for(const part of fit.parts){
      target.font=part.font;const m=part.metrics,baseline=y+(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2;
      target.strokeStyle=label.strokes.outer;target.lineWidth=Math.max(.8,part.size*.19);target.strokeText(part.text,left,baseline);
      target.strokeStyle=label.strokes.inner;target.lineWidth=Math.max(.35,part.size*.09);target.strokeText(part.text,left,baseline);
      target.fillStyle=label.color;target.fillText(part.text,left,baseline);left+=m.width+fit.gap;
     }
    }
    let sprite=null;
    if((view.navigating||animating)&&ctx.getTransform&&ctx.drawImage){
     const transform=ctx.getTransform(),ratio=Math.hypot(transform.a,transform.b)||1;
     sprite=titleSprites.get(label);
     if(sprite?.ratio!==ratio){
      if(sprite){titleSpritePixels-=sprite.pixels;titleSprites.delete(label);}
      const large=fit.size===68?fit:measure(68),w=Math.ceil(2*(large.halfWidth+large.pad+2)*ratio),h=Math.ceil(2*(large.height+2)*ratio),pixels=w*h;
      if(pixels<=2000000){
       while((titleSpritePixels+pixels>2000000||titleSprites.size>=64)&&titleSprites.size){const oldest=titleSprites.keys().next().value;titleSpritePixels-=titleSprites.get(oldest).pixels;titleSprites.delete(oldest);}
       const image=document.createElement('canvas');image.width=w;image.height=h;
       const target=image.getContext('2d');target.setTransform(ratio,0,0,ratio,0,0);target.textAlign='left';target.textBaseline='alphabetic';target.lineJoin='round';
       paintTitle(target,large,w/(2*ratio),h/(2*ratio));
       sprite={image,ratio,pixels};titleSprites.set(label,sprite);titleSpritePixels+=pixels;
      }else sprite=null;
     }else{titleSprites.delete(label);titleSprites.set(label,sprite);}
    }
    for(const{x,y,alpha}of frames){ctx.globalAlpha=opacity*alpha;if(sprite){
     // The 68 px master retains visible-cell sizing and the existing fade and
     // anchor animation without repeatedly stroking glyph paths while panning.
     const factor=fit.size/68,w=sprite.image.width/sprite.ratio*factor,h=sprite.image.height/sprite.ratio*factor;
     ctx.imageSmoothingEnabled=true;ctx.drawImage(sprite.image,x-w/2,y-h/2,w,h);
    }else{
     paintTitle(ctx,fit,x,y);
    }
    }
   }
   ctx.restore();
   if(motions){const known=new Set(labels.map(label=>label.id));for(const[id,motion]of motions)if(!seen.has(id)){if(!known.has(id)){motions.delete(id);continue;}if(motion.visible){root.CrateRegionLabelLayout.transport(motion,view);motion.x=motion.targetX;motion.y=motion.targetY;motion.vx=motion.vy=0;motion.hidden=true;motion.fade=null;}}if(animating)schedule();}
  }
  function labels(ctx,view,viewport=area){paintLabels(ctx,view,labelData(),viewport,state().data.rendering.cameraRect,view===state()?titleMotion:null);}
  function snapshotLayer(){
   flushRefresh();
   // Geometry paths are replaced on revision, never edited in place. Retaining
   // them freezes an export without copying every cell or rasterizing early.
   if(!overlayVisible())return ()=>{};
   const dynamic=$('dynamicRegionTitles')?.checked!==false,camera=state().data.rendering.cameraRect?.slice(),totals=labelData().map(l=>({...l})),layers=orderedRegions().filter(r=>r.cells.size).map(r=>({geometry:geometry(r),color:r.color,alpha:(1-doc.transparency/100)*(r.id===doc.active?1:.75),selected:r.id===doc.active}));
   const layer=(ctx,view)=>{
    ctx.save();clipCamera(ctx,view,camera);
    for(const layer of layers)paintGeometry(ctx,layer.geometry,view,layer.color,layer.alpha,layer.selected);
    ctx.restore();
   };
   layer.labels=(ctx,view,viewport=area)=>paintLabels(ctx,view,totals,viewport,camera,null,dynamic);return layer;
  }
  function render(ctx,view,visible){
   if(overlayVisible()){
    const regions=orderedRegions().filter(r=>r.cells.size),camera=state().data.rendering.cameraRect;
    ctx.save();clipCamera(ctx,view,camera);
    if(view===state()&&mapOverlayCache){
     if(mapOverlayDoc!==doc){mapOverlayCache.clear();mapOverlayDoc=doc;clearTimeout(mapOpacityTimer);mapOpacityTimer=null;mapTransparency=doc.transparency;}
     const rendering=state().data.rendering,bounds={x:0,y:0,w:rendering.width,h:rendering.height};
     const stamp=[overlayRevision,terrainRevision,doc.active,mapTransparency,view.scale>=.12,...(camera||[]),...doc.regions.flatMap(r=>[r.id,r.color])].join('|');
     mapOverlayCache.render(ctx,view,area,bounds,stamp,(target,local,clip,patch)=>{
      if(patch){paintMembership(target,local,clip,regions);return;}
      // Cache the full ordered composition, including opaque edges. One large
      // region must never fall back to submitting all its polygons every frame.
      for(const r of regions)paintRegion(target,r,local,(1-mapTransparency/100)*(r.id===doc.active?1:.75),clip);
      paintLiveOverlay(target,local,clip,regions);
     });
    }else for(const r of regions)paintRegion(ctx,r,view,(1-doc.transparency/100)*(r.id===doc.active?1:.75));
    ctx.restore();
   }
   if(!schedulePreview&&active&&view===state())preview(ctx,view);
  }
  function paintLiveOverlay(ctx,view,clip,regions){
   if(!liveOverlayTiles.size)return;
   const left=(clip.x-view.x)/view.scale,top=(clip.y-view.y)/view.scale,right=left+clip.w/view.scale,bottom=top+clip.h/view.scale;
   let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
   for(const rect of liveOverlayTiles.values()){
    if(rect.x>=right||rect.x+rect.w<=left||rect.y>=bottom||rect.y+rect.h<=top)continue;
    l=Math.min(l,Math.max(left,rect.x));t=Math.min(t,Math.max(top,rect.y));r=Math.max(r,Math.min(right,rect.x+rect.w));b=Math.max(b,Math.min(bottom,rect.y+rect.h));
   }
   if(r<=l||b<=t)return;const part={x:view.x+l*view.scale,y:view.y+t*view.scale,w:(r-l)*view.scale,h:(b-t)*view.scale};
   ctx.save();ctx.beginPath();ctx.rect(part.x,part.y,part.w,part.h);ctx.clip();ctx.clearRect(part.x,part.y,part.w,part.h);paintMembership(ctx,view,part,regions);ctx.restore();
  }
  function paintMembership(ctx,view,clip,regions){
   const l=(clip.x-view.x)/view.scale,t=(clip.y-view.y)/view.scale,r=l+clip.w/view.scale,b=t+clip.h/view.scale;
   const cells=selectionIndex.screen.query(l-120,t-300,r+120,b+300).filter(c=>{const box=cellSurfaceBox(c);return box.l<r+2/view.scale&&box.r>l-2/view.scale&&box.t<b+2/view.scale&&box.b>t-2/view.scale;});
   for(const reg of regions){const {fill,edge}=cellPaths(cells,view,reg.cells,true);
    ctx.fillStyle=reg.color;ctx.globalAlpha=(1-mapTransparency/100)*(reg.id===doc.active?1:.75);ctx.fill(fill,'evenodd');ctx.globalAlpha=1;
    if(view.scale>=.12){ctx.strokeStyle=reg.color;ctx.lineWidth=reg.id===doc.active?1.4:.8;ctx.stroke(edge);}
   }
  }
  function cellPaths(cells,view,members=null,outline=false){
   const fill=new Path2D(),edge=new Path2D();let part=new Path2D(),border=new Path2D(),count=0;
   // Chromium repeatedly copies a path's growing command buffer when appending
   // vertices. Small subpaths keep large fills and box previews linear, while
   // one final fill/stroke preserves opacity and joins across all cells.
   for(const c of cells){const k=R.key(c);if(members&&!members.has(k))continue;
    path(part,c,view);if(outline&&[1024,-1024,1,-1].some(d=>!members.has(k+d)))path(border,c,view);
    if(++count%64===0){fill.addPath(part);edge.addPath(border);part=new Path2D();border=new Path2D();}
   }
   if(count%64){fill.addPath(part);edge.addPath(border);}return {fill,edge};
  }
  function minimap(ctx,im){
   if(!overlayVisible())return;const view={x:-(im.worldX||0)*im.scale,y:-(im.worldY||0)*im.scale,scale:im.scale},clip={x:0,y:0,w:Math.ceil(im.w),h:Math.ceil(im.h)};
   ctx.save();ctx.translate(im.x,im.y);for(const r of doc.regions)cachedRegion(ctx,r,view,clip,'mini',1-doc.transparency/100);ctx.restore();
  }
  async function runAuto(manual=true){
   if(automatic){cancelAuto();return;}
   commitColor();
   if(!manual&&(doc.autoHandled||doc.regions.some(r=>r.cells.size)))return;
   if(state().busy||!state().data||state().data.metadata.previewOnly||!root.CrateRegionAuto)return;
   cancel();const s=state(),ticket=++autoEpoch,controller=new AbortController();automatic=autoPreparing=controller;
   $('regionAutoFields').disabled=true;autoButtons(true);
   const reportProgress=p=>{if(ticket===autoEpoch){const text=_t`正在自动划分… ${Math.round(p)}%`;$('regionAutoStatus').textContent=text;$('regionAutoProgress').textContent=text;$('regionAutoProgress').hidden=false;}};reportProgress(0);
   try{
    await prepareNavigation?.(controller.signal);controller.signal.throwIfAborted();
    if(autoPreparing===controller)autoPreparing=null;
    const data=s.data;
    const navigation=await navigationFor(s,controller.signal);
    controller.signal.throwIfAborted();
    const result=await root.CrateRegionAuto.partition({cells:data.cells,navigation,starts:root.CratePlayerStarts.positions(s),eligible:new Set(eligible.keys()),settings:doc.autoOptions,display:getDisplay()},{signal:controller.signal,onProgress:reportProgress});
    if(ticket!==autoEpoch||state().data!==data)return;
    automatic=null;doc.autoHandled=true;checkpoint(_t('自动划分区域'));
    doc.appliedTeams=root.CrateRegionAuto.teams(result.settings.teams);
    for(const r of doc.regions){r.cells.clear();if(r.generatedName){delete r.generatedName;if(!r.customName)r.name=_t`区域 ${r.id.slice(1)}`;}R.touch(r);}
    // Keep two unused, editable slots beyond the automatic assignments.
    // Twelve is the initial palette size, not a partition limit.
    while(doc.regions.length<result.regions.length+2){const n=doc.next++;doc.regions.push({id:'r'+n,name:_t`区域 ${n}`,color:R.nextColor(doc.regions),cells:new Set()});}
    for(let i=0;i<result.regions.length;i++){
     const part=result.regions[i];
     const r=doc.regions[i];r.generatedName=part.kind==='team'?{kind:'team',team:part.team}:{kind:part.kind,number:part.kind==='water'?Number(r.id.slice(1)):part.number};delete r.customName;r.name=R.displayName(r);r.cells=new Set(part.keys);R.touch(r);
    }
    dirty();persist();
    $('regionAutoStatus').textContent=_t`自动划分完成：${result.regions.length} 个区域`+(result.unreachablePlayers.length?_t`未找到可通行起点的玩家：${result.unreachablePlayers.join('、')}`:'');
   }catch(error){if(!controller.signal.aborted&&ticket===autoEpoch)$('regionAutoStatus').textContent=_t('自动划分失败：')+(/^REGION_NAVIGATION_/.test(error.message)?_t('自动划分通行数据不完整，请重新分析或更新网页包。'):error.message);}
   finally{if(autoPreparing===controller)autoPreparing=null;if(ticket===autoEpoch){automatic=null;$('regionAutoFields').disabled=false;autoButtons();$('regionAutoProgress').hidden=true;schedule();}}
  }
  $('regionAutoRun').onclick=()=>runAuto();
  $('regionAutoQuick').onclick=e=>{e.preventDefault();e.stopPropagation();runAuto();};
  for(const id of ['regionAutoSea','regionAutoExclusive','regionAutoCorners','regionAutoStraight','regionAutoPath'])$(id).onchange=()=>{
   checkpoint(_t('自动划分设置'));doc.autoOptions=root.CrateRegionAuto.options({...doc.autoOptions,maxSea:Number($('regionAutoSea').value),exclusive:$('regionAutoExclusive').checked,claimCorners:$('regionAutoCorners').checked,maxStraight:Number($('regionAutoStraight').value),maxPath:Number($('regionAutoPath').value)});presentationChanged();
  };
  $('regionShowTotals').onclick=()=>{doc.showTotals=!doc.showTotals;resetTitleTracking();const button=$('regionShowTotals');button.setAttribute('aria-pressed',String(doc.showTotals));button.textContent=_t('区域标题:')+(doc.showTotals?_t('开'):_t('关'));presentationChanged();};
  $('dynamicRegionTitles')?.addEventListener('change',()=>{resetTitleTracking();schedule();});
  function overlayChanged(){if(!overlayVisible()&&stroke)up();previewChanged();resetTitleTracking();if(!overlayVisible())mapOverlayCache?.cancelRefinement?.();else refresh();}
  $('regionColorOverlay').addEventListener('click',overlayChanged);
  for(const quick of [false,true]){
   const button=$(quick?'regionToolbarActive':'regionActive'),list=$(quick?'regionToolbarOptions':'regionOptions'),host=$(quick?'regionToolbarPicker':'regionPicker'),choices=()=>(quick?toolbarChoices:regionChoices).filter(b=>!b.disabled);
   button.onclick=()=>{list.hidden?openPicker(quick):closePicker();};
   button.onkeydown=e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();openPicker(quick);const items=choices();if(e.key==='Home'||e.key==='End')items[e.key==='Home'?0:items.length-1]?.focus();}};
   list.onkeydown=e=>{
    const items=choices(),index=items.indexOf(document.activeElement);let next=null;
    if(e.key==='ArrowDown')next=Math.min(items.length-1,index+1);if(e.key==='ArrowUp')next=Math.max(0,index-1);
    if(e.key==='Home')next=0;if(e.key==='End')next=items.length-1;
    if(next!==null){e.preventDefault();items[next]?.focus();}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePicker(true,quick);}
   };
   host.addEventListener('focusout',e=>{if(!host.contains(e.relatedTarget))closePicker();});
  }
  document.addEventListener('pointerdown',e=>{if(!$('regionPicker').contains(e.target)&&!$('regionToolbarPicker').contains(e.target))closePicker();});
  $('regionName').oninput=()=>{
   if(isEmpty())return;
   if(!nameEditing){checkpoint(_t('修改区域名称')+' · '+R.displayName(current()));nameEditing=true;}
   current().name=$('regionName').value.trim().slice(0,48)||_t('未命名区域');current().customName=true;dirty();
  };
  $('regionName').onblur=()=>{nameEditing=false;$('regionName').value=R.displayName(current());};
  $('regionColor').oninput=()=>{if(isEmpty())return;if(!colorEditing){checkpoint(_t('修改区域颜色')+' · '+R.displayName(current()));colorEditing=true;}pendingColor={region:current(),color:$('regionColor').value};$('regionActiveSwatch').style.backgroundColor=pendingColor.color;$('regionEditor').style.setProperty('--region-color',pendingColor.color);clearTimeout(colorTimer);colorTimer=setTimeout(commitColor,150);};
  $('regionColor').onchange=$('regionColor').onblur=()=>{commitColor();colorEditing=false;};
  $('regionOverlap').onchange=()=>{
   checkpoint(_t('区域重叠设置'));doc.overlap=$('regionOverlap').checked;const removed=doc.overlap?0:R.exclusive(doc);dirty();
   $('regionActionStatus').textContent=removed?_t`已移除 ${removed} 处重复归属，优先保留当前区域；可撤销。`:doc.overlap?_t('允许同一格归属多个区域。'):_t('同一格只属于一个区域。');
  };
  function addRegion(){if(doc.regions.length>=64)return;checkpoint(_t('新增区域'));const n=doc.next++;doc.regions.push({id:`r${n}`,name:_t`区域 ${n}`,color:R.nextColor(doc.regions),cells:new Set()});doc.active=`r${n}`;dirty();}
  $('regionAdd').onclick=addRegion;
  $('regionClear').onclick=()=>{if(isEmpty())return;checkpoint(_t('清空区域')+' · '+R.displayName(current()));current().cells.clear();R.touch(current());dirty();$('regionActionStatus').textContent=_t('已清空当前区域；可撤销。');};
  $('regionDelete').onclick=()=>{if(isEmpty()||doc.regions.length<=1)return;checkpoint(_t('删除区域')+' · '+R.displayName(current()));doc.regions=doc.regions.filter(r=>r.id!==doc.active);doc.active=doc.regions[0].id;dirty();$('regionActionStatus').textContent=_t('已删除区域；可撤销。');};
  function travel(redo){
   commitColor();
   if(automatic)cancelAuto();cancel();const stack=redo?future:history,raw=stack.pop();if(!raw)return false;
   const inverse=redo?history:future;
   if(typeof raw==='string'){
    inverse.push(R.encode(doc));adoptDocument(restoreHistory(raw));thumbnails.reset();dirty();
   }else{
    inverse.push({transparency:doc.transparency});doc.transparency=raw.transparency;syncTransparency();saveSoon();schedule();thumbnails.request();
   }
   commitMapTransparency();nameEditing=colorEditing=opacityEditing=false;$('regionActionStatus').textContent=redo?_t('已重做上一步。'):_t('已撤销上一步。');
   return true;
  }
  if(editHistory){editHistory.register('regions',{limit:20,prepare:up,ready:()=>!!state().data&&!state().busy&&!automatic,clearRedo:()=>{future=[];},undo:()=>travel(false),redo:()=>travel(true)});editHistory.subscribe(syncHistory);}
  $('regionUndo').onclick=()=>editHistory?editHistory.undo():travel(false);$('regionRedo').onclick=()=>editHistory?editHistory.redo():travel(true);
  function syncTransparency(){
   $('regionTransparency').value=doc.transparency;$('regionTransparencyValue').textContent=doc.transparency+'%';
   syncHistory();
  }
  function commitMapTransparency(){
   clearTimeout(mapOpacityTimer);mapOpacityTimer=null;mapTransparency=doc.transparency;schedule();
  }
  $('regionTransparency').oninput=()=>{
   const value=Math.max(0,Math.min(100,Number($('regionTransparency').value)||0));if(value===doc.transparency)return;
   if(!opacityEditing){
    if(automatic)cancelAuto();
    clearTimeout(saveTimer);saveTimer=null;doc.autoHandled=true;
    remember({transparency:doc.transparency},_t('区域图层透明度'));opacityEditing=true;
   }
   thumbnails.cancel();doc.transparency=value;syncTransparency();
   // The range thumb/value updates immediately. Recompose only the newest
   // opacity after a short pause, or on release; superseded states never queue.
   clearTimeout(mapOpacityTimer);mapOpacityTimer=setTimeout(commitMapTransparency,120);
  };
  $('regionTransparency').onchange=$('regionTransparency').onblur=()=>{if(opacityEditing){opacityEditing=false;commitMapTransparency();saveSoon();thumbnails.request();}};
  $('regionFocus').onclick=focus;
  tableControls=root.CrateRegionTableControls?.create({table:$('regionTable'),body:$('regionRows'),host:document.querySelector('.region-summary-header'),sort:$('regionSort'),ascending:$('regionAscending'),onSort:sortRows,onOverviewChanged:()=>{if(state().data)thumbnails.request(true);}});
  function sortSelectionChanged(){$('regionAscending').checked=['order','name'].includes($('regionSort').value);sortRows();}
  $('regionSort').onchange=sortSelectionChanged;$('regionAscending').onchange=()=>sortRows();
  $('regionRankSort').onchange=()=>{$('regionSort').value=$('regionRankSort').value;sortSelectionChanged();};
  for(const [id,mode] of asideTabs){
   $(id).onclick=()=>{sideMode=mode;updateAside();schedule();};
   $(id).onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=asideTabs.map(([key])=>$(key)).filter(b=>!b.hidden),at=buttons.indexOf(e.currentTarget),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;e.preventDefault();e.stopPropagation();buttons[next].click();buttons[next].focus();};
  }
  function controls(preserveHover=false){if(tool()!=='picker')lastTool=tool();const brush=tool().startsWith('brush'),round=['brush-circle','brush-ellipse'].includes(tool());$('regionSizes').hidden=!brush;$('regionHeightLabel').hidden=round;$('regionWidthText').textContent=tool()==='brush-circle'?_t('直径'):tool()==='brush-ellipse'?_t('横向直径'):_t('宽度');if(!preserveHover)hover=null;interactionHint();schedule();}
  function shortcut(key){const next={q:'brush-ellipse',w:'box-screen',e:'box-game',r:'fill'}[key];if(!active||!next)return false;up();$('regionTool').value=next;controls(true);return true;}
  function adjustSize(delta){if(!active||!tool().startsWith('brush'))return false;
   $('regionWidth').value=Math.max(1,Math.min(60,width()+delta));
   if(!['brush-circle','brush-ellipse'].includes(tool()))$('regionHeight').value=Math.max(1,Math.min(60,height()+delta));
   if(stroke?.tool.startsWith('brush')){stroke.width=width();stroke.height=height();stroke.gap=true;}
   interactionHint();previewChanged();schedule();return true;
  }
  $('regionTool').onchange=()=>{cancel();controls();};
  $('regionEyedropper').onclick=()=>{cancel();$('regionTool').value=tool()==='picker'?lastTool:'picker';controls();};
  $('regionOperation').onchange=()=>{interactionHint();schedule();};
  for(const id of ['regionWidth','regionHeight'])$(id).onchange=()=>{$(id).value=id==='regionWidth'?width():height();schedule();};
  $('regionBackup').onclick=()=>{
   commitColor();
   const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({mapSha256:state().data.metadata.sourceSha256,selection:JSON.parse(R.encode(doc))})],{type:'application/json'}));
   a.href=url;a.download=state().data.metadata.filename+_t('-区域划分.json');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('regionRestore').onchange=async()=>{
   const file=$('regionRestore').files[0];if(!file)return;
   try{
    if(file.size>128*1024*1024)throw Error(_t('备份文件过大（上限 128 MB）'));
    const data=JSON.parse(await file.text());if(data.mapSha256!==state().data.metadata.sourceSha256)throw Error(_t('备份属于另一张地图'));
    const restored=R.decode(JSON.stringify(data.selection),eligible);restored.autoHandled=true;checkpoint(_t('恢复区域备份'));adoptDocument(restored);thumbnails.reset();storageBlocked=false;dirty();$('regionActionStatus').textContent=_t('已恢复备份（自动排除可选边界外的格子）；可撤销。');
   }catch(e){$('regionActionStatus').textContent=_t('恢复失败：')+e.message;}
   $('regionRestore').value='';
  };
  $('objects').addEventListener('change',()=>{if(summaryVisible)refresh();});
  $('players').addEventListener('change',()=>{if(summaryVisible)refresh();});
  window.addEventListener('pagehide',()=>{cancel();if(saveTimer||opacityEditing||pendingColor)persist();});
  window.addEventListener('blur',()=>{cancel();hover=null;modifiers({shiftKey:false,ctrlKey:false});schedule();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();hover=null;modifiers({shiftKey:false,ctrlKey:false});schedule();}});
  // Do not silently overwrite an update made in another tab.
  window.addEventListener('storage',e=>{
   if(e.key!==storageKey||!e.newValue)return;
   if(automatic)cancelAuto(true);
   if(stroke||saveTimer||opacityEditing||pendingColor){storageBlocked=true;clearTimeout(saveTimer);saveTimer=null;status(_t('另一页面修改了此地图划分。已暂停保存，请导出备份后刷新。'),true);return;}
   try{adoptDocument(R.decode(e.newValue,eligible));thumbnails.reset();history=[];future=[];editHistory?.clear('regions');nameEditing=colorEditing=opacityEditing=false;dirty(false);status(_t('已同步另一页面的区域划分'));}catch{status(_t('另一页面的区域记录无法读取'),true);}
  });
  document.addEventListener('keydown',e=>{
   if(active&&(e.key==='Shift'||e.key==='Control')&&!document.querySelector('dialog[open]')&&(hover||stroke||!e.target?.closest('input,textarea,select,[contenteditable]')))modifiers(e);
   if(!active||e.target?.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
   if(e.key==='Escape'){if(stroke){e.preventDefault();cancel();}else if(tool()==='picker'){e.preventDefault();$('regionTool').value=lastTool;controls();}}
   if(!editHistory&&(e.ctrlKey||e.metaKey)){const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();$(k==='y'||e.shiftKey?'regionRedo':'regionUndo').click();}}
  });
  document.addEventListener('keyup',e=>{if(e.key==='Shift'||e.key==='Control')modifiers(e);});
  controls();
  return {*warmup(target){if(mapOverlayCache?.warmup)yield* mapOverlayCache.warmup(target);},load,beforeLoad:({preserveAuto=false}={})=>{commitColor();thumbnails.cancel();if(!preserveAuto||!autoPreparing)cancelAuto(true);cancel();refreshQueue?.reset();if(saveTimer||opacityEditing)persist();},render,preview,labels,snapshotLayer,minimap,overlayChanged,playerStyles:()=>overlayVisible()?playerMarks:null,hoverInfo,down,move,up,cancel,sampleRegion,selectSample,finishPicking,get picking(){return active&&tool()==='picker';},autoPartition:runAuto,membership,updateBuffs,renderPlacement,flush:flushRefresh,get refreshStatus(){return {...refreshQueue?.status,...refreshWork,localRefreshes,lastLocalCells,thumbnails:thumbnails.status,pending:!!refreshQueue?.status.pending};},
   updateCells(cells){
    let geometryChanged=false;
    for(const c of cells){
     const key=R.key(c),previous=lookup.get(key);lookup.set(key,c);
     if(!previous||previous.px!==c.px||previous.py!==c.py||previous.level!==c.level||
        previous.visibleSurface!==c.visibleSurface&&JSON.stringify(previous.visibleSurface)!==JSON.stringify(c.visibleSurface))geometryChanged=true;
    }
    if(geometryChanged){terrainRevision++;if(!asynchronous){geometryCache=new WeakMap();thumbnails.invalidate();rasterCache.clear();rasterPixels=0;mapOverlayCache?.clear();}}
    if(!asynchronous){statisticsCache=new WeakMap();labelCache=new WeakMap();titleSprites.clear();titleSpritePixels=0;}
   },
   probabilityChanged(change){if(summaryVisible||overlayVisible()){if(!updateProbability(change))refresh();}},
   playerAt:(cell,numbers)=>numbers?.length?R.nearestPlayer(cell,numbers,root.CratePlayerStarts?.positions(state())||[]):R.playerAt(doc,cell,root.CratePlayerStarts?.positions(state())||[]),
   shortcut,adjustSize,get canAdjustSize(){return active&&tool().startsWith('brush');},cursorInfo,get autoBusy(){return !!automatic;},leave:()=>{if(hover){hover=null;syncCursor();previewChanged();schedule();}},get active(){return active;},get dragging(){return !!stroke;},setMode};
 }
 root.CrateRegionStatisticsUI={create,thumbnailLayout:root.CrateRegionThumbnails.layout};
})(typeof globalThis!=='undefined'?globalThis:this);
