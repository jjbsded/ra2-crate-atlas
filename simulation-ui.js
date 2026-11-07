/* Simulation controls share the viewer's result lifecycle, 3D and exports. */
(function(root){
 'use strict';
 const I=root.CrateI18n,_t=I?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s),_msg=I?.message||(s=>s);
 const $=id=>document.getElementById(id),M=()=>root.CrateSimulationModel;
 function create({getState,loadResult,applyProbability,setBusy,message:notify,schedule,pick,pointer,hit,getArea,getRegionMembership,getRegionCursor,activateMode,isRegionPicker,finishRegionPicker,sampleRegion,selectRegion,onCtrlPicker,onSample,onInteractionEnd,onInteraction}){
  const message=(value,error)=>notify(_msg(value),error);
  const panel=document.createElement('section');panel.id='simulationPanel';panel.className='simulation-panel edit-toolbar';panel.setAttribute('role','group');panel.setAttribute('aria-labelledby','simulationPlaceTab');
  panel.innerHTML=`
   <div class="simulation-tools simulation-plan-actions">
    <p id="simulationHint" class="hint"></p>
    <button id="simulationImport">${_t('导入方案')}</button><input id="simulationImportFile" type="file" accept=".json" hidden><button id="simulationExport">${_t('导出方案')}</button>
   </div>
   <div class="simulation-tools simulation-quick-actions">
    <button id="simulationPlaceTab" type="button" aria-pressed="false">${_t('模拟放置')}</button>
    <div class="simulation-action-group"><button id="simulationMine">${_t('一键采矿')}</button><button id="simulationReset">${_t('全部恢复')}</button></div>
    <button id="simulationTrees">${_t('一键砍树')}</button><button id="simulationBuildings">${_t('拆除建筑 · 留废墟')}</button><button id="simulationChronoBuildings">${_t('拆除建筑 · 超时空')}</button><button id="simulationUnits">${_t('一键删除单位')}</button>
   </div>
   <div class="simulation-tools simulation-primary">
    <select id="simulationTool" aria-labelledby="simulationPlaceTab"><option value="place">${_t('放置')}</option><option value="normal">${_t('摧毁(留废墟)')}</option><option value="chrono">${_t('消除(无废墟)')}</option><option value="restore">${_t('恢复')}</option></select>
    <label id="simulationObjectLabel"><span>${_t('对象 ')}</span><select id="simulationObject"></select></label>
   </div>
   <div class="simulation-tools simulation-settings">
    <div class="simulation-drawing">
     <label id="simulationPlaceSizeLabel"><span>${_t('尺寸（对象） ')}</span><input id="simulationPlaceSize" type="number" min="1" max="15" step="1" value="1" aria-label="${_t('模拟笔刷尺寸')}"></label>
     <label id="simulationShapeLabel" hidden><span>${_t('覆盖形状 ')}</span><select id="simulationShape"><option value="square">${_t('方形')}</option><option value="circle">${_t('圆形')}</option></select></label>
    </div>
    <div class="simulation-action-group">
     <button id="simulationIgnoreLand" aria-pressed="false">${_t('忽略建筑海陆:关')}</button>
     <button id="simulationUndo" disabled><span aria-hidden="true">↶</span> ${_t('撤销')}</button>
     <button id="simulationRedo" disabled><span aria-hidden="true">↷</span> ${_t('重做')}</button>
    </div>
   </div>`;
  $('editTools').prepend(panel);
  $('simulationObjectLabel').after($('unitBuffRadiusLabel'));
  const drawingMethods=[['brush',_t('画笔')+' [W]'],['line',_t('直线')+' [Q]']];
  $('simulationShapeLabel').before(
   createPlacementControl('simulationPlaceShape',_t('绘制方式 '),drawingMethods),
   createPlacementControl('simulationPaintMethod',_t('绘制方式 '),drawingMethods)
  );
  $('simulationPlaceShape').value='line';
  $('simulationPaintMethod').value='line';
  const brushSize=()=>Math.max(1,Math.min(15,Math.round(Number($('simulationPlaceSize').value)||1)));
  $('simulationPlaceSize').oninput=()=>{schedule();syncCursor();};
  $('simulationPlaceSize').onchange=()=>{$('simulationPlaceSize').value=brushSize();schedule();syncCursor();};
  function createPlacementControl(id,label,options){
   const wrapper=document.createElement('label'),select=document.createElement('select'),caption=document.createElement('span');
   wrapper.id=id+'Label';
   select.id=id;
   for(const [value,text] of options)select.add(new Option(text,value));
   caption.textContent=label;wrapper.append(caption,select);
   return wrapper;
  }
  const banner=document.createElement('div');banner.id='simulationCache';banner.className='simulation-cache';banner.hidden=true;
  banner.setAttribute('role','group');banner.setAttribute('aria-labelledby','simulationCacheText');
  banner.innerHTML=`<span id="simulationCacheText" role="status"></span><button type="button" id="simulationRestoreCache">${_t('恢复编辑')}</button><button type="button" id="simulationDismissCache">${_t('暂不恢复')}</button>`;
  document.body.append(banner);
  let sourceUrl='',identity='',model=null,sourcePromise=null,baseline=null,edited=null,active=false,consider=true,ignoreLand=false,hover=null,stroke=null,loading=false,pendingCache=null,epoch=0;
  let revision=0,applied=0,probabilityApplied=0,timer=null,running=null,failed=false,forceQueued=false,rendered=new Set(),art=new Map(),artNotice='';
  let live=null,recoverLive=false,liveOpening=null,editedView=null;const pendingOpens=new Set();
  let styleStamp='[]',styleFrame=0;
  function colorAt(type,x,y,index=getRegionMembership?.()){
   const choice=model?.choice(type);if(!['E2','MTNK','HYD','YHVR'].includes(type)&&choice?.category!=='STRUCTURES')return '';
   if(choice?.category==='STRUCTURES'){const [dx,dy]=choice.footprint.reduce((a,b)=>b[0]+b[1]<a[0]+a[1]||b[0]+b[1]===a[0]+a[1]&&b[0]<a[0]?b:a);x+=dx;y+=dy;}
   return index?.get(root.CrateRegionStatistics.key({x,y}))?.[0]?.color.slice(1).toLowerCase()||'';
  }
  function styledPlan(){
   const plan=model.plan,index=getRegionMembership?.();
   for(const o of plan.placements){
    const color=colorAt(o.type,o.x,o.y,index);
    if(color)o.regionColor=color;
   }
   return plan;
  }
  const styleKey=plan=>JSON.stringify(plan.placements.filter(o=>o.regionColor).map(o=>[o.id,o.regionColor]));
  function refreshColors(){
   if(!model||styleFrame||!consider)return;
   const expected=epoch;
   styleFrame=requestAnimationFrame(()=>{
    styleFrame=0;
    if(expected!==epoch||!model||!consider||model.source.sourceSha256!==getState().data?.metadata.sourceSha256)return;
    const plan=styledPlan();
    if(styleKey(plan)!==styleStamp){changed(_t('更新单位阵营色'),plan);queue();}
   });
  }
  let dirtyRevision=-1,dirtyData=null,dirtyCells=new Set();
  const visuals=root.CrateSimulationVisual.create({getState,getArea,schedule,
   onPaint:plan=>{rendered=new Set(plan.placements.map(p=>p.id));},
   onProgress:progress=>{getState().liveArtworkProgress=progress;syncActivity();}
  });
  let modifiers={ctrl:false,alt:false,shift:false},pointerClient=null,lastPlacement=null;const temporary=()=>modifiers.ctrl?'eyedropper':modifiers.alt?'restore':modifiers.shift?'chrono':null,effectiveTool=()=>temporary()||$('simulationTool').value;
  const tooltip=document.createElement('div');tooltip.id='simulationCursorMode';tooltip.className='simulation-cursor-mode';tooltip.hidden=true;document.body.append(tooltip);
  const tooltipLabel=document.createElement('span');
  tooltip.append(tooltipLabel);
  const regionPreview=document.createElement('span');regionPreview.className='simulation-sample-region';regionPreview.hidden=true;
  const regionSwatch=document.createElement('i'),regionName=document.createElement('span');regionSwatch.className='region-swatch';regionPreview.append(regionSwatch,regionName);tooltip.append(regionPreview);
  let cursorIcon=null;
  const toolIcons=new Map();
  for(const tool of ['normal','chrono','restore'])root.CrateSimulationAssets.toolIcon(tool).then(value=>{
   if(!value)return;const box=document.createElement('span');box.className='simulation-choice-icon simulation-operation-icon';
   const img=document.createElement('img');img.alt='';img.src=value.image.src;box.append(img);toolIcons.set(tool,box);updateToolChoice();syncCursor();
  }).catch(()=>{});
  document.addEventListener('fullscreenchange',()=>{(document.fullscreenElement||document.body).append(tooltip,banner);syncCursor();});
  const picker=document.createElement('div');picker.className='simulation-picker';picker.innerHTML='<button type="button" id="simulationChoice" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="simulationChoices"></button><div id="simulationChoices" role="listbox" hidden></div>';$('simulationObject').after(picker);$('simulationObject').className='simulation-native-choice';$('simulationObject').tabIndex=-1;$('simulationObject').setAttribute('aria-hidden','true');
  function choiceLabel(choice){
   const localized=model.source.simulationAssets?.labels?.[choice.type]?.[I?.language||'zh-CN'];
   if(choice.category!=='STRUCTURES')return localized||_msg(choice.label);
   const [prefix,...parts]=choice.label.split(' · '),name=choice.type==='NACNST'?_t('苏军基地'):localized||_msg(parts.join(' · '));
   return prefix.replace('[Water]','['+_t('水面')+']').replace('[Land]','['+_t('陆地')+']')+' · '+name;
  }
  function choose(type){if(model?.choice(type)?.unplaceable)type='MTNK';const choice=model?.choice(type);if(choice&&!Array.from($('simulationObject').options).some(o=>o.value===type)){const option=document.createElement('option');option.value=type;option.textContent=choiceLabel(choice)+' · '+type;$('simulationObject').append(option);}$('simulationObject').value=type;$('simulationTool').value='place';updateChoice();sprite(type,hover?.level||0);sync();schedule();}
  function choiceIcon(type){
   const menuType=model?.choice(type)?.legacy?model.choices.find(c=>c.tree)?.type:type;
   return $('simulationChoices').querySelector(`[data-type="${menuType}"] .simulation-choice-icon`);
  }
  function updateChoice(){const choice=model?.choice($('simulationObject').value),button=$('simulationChoice');if(!choice)return;button.replaceChildren();const label=document.createElement('span');label.textContent=choiceLabel(choice)+(choice.legacy?' · '+choice.type:'');button.append(label);const icon=choiceIcon(choice.type);if(icon)button.append(icon.cloneNode(true));for(const node of $('simulationChoices').children)node.setAttribute('aria-selected',String(node.dataset.type===choice.type));updateToolChoice();}
  function closeChoices(){closeToolChoices();$('simulationChoices').hidden=true;$('simulationChoice').setAttribute('aria-expanded','false');}
  $('simulationChoice').onclick=()=>{const list=$('simulationChoices');list.hidden=!list.hidden;$('simulationChoice').setAttribute('aria-expanded',String(!list.hidden));if(!list.hidden)list.querySelector('[aria-selected="true"]')?.focus();};
  document.addEventListener('pointerdown',e=>{if(!picker.contains(e.target)&&!e.target.closest?.('.simulation-tool-picker'))closeChoices();});
  picker.addEventListener('keydown',e=>{const list=$('simulationChoices'),items=[...list.children];if(e.key==='Escape'){closeChoices();$('simulationChoice').focus();e.preventDefault();}else if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();list.hidden=false;$('simulationChoice').setAttribute('aria-expanded','true');const i=items.indexOf(document.activeElement),n=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowUp'?-1:1)+items.length)%items.length;items[n]?.focus();}});
  // Keep the native value/change contract; the visible picker supports real icons.
  const toolPicker=document.createElement('div');toolPicker.className='simulation-picker simulation-tool-picker';
  toolPicker.innerHTML='<button type="button" id="simulationToolChoice" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="simulationToolOptions"><span></span><span class="simulation-tool-arrow" aria-hidden="true">⌄</span></button><div id="simulationToolOptions" role="listbox" aria-labelledby="simulationPlaceTab" hidden></div>';
  $('simulationTool').after(toolPicker);$('simulationTool').className='simulation-native-choice';$('simulationTool').tabIndex=-1;$('simulationTool').setAttribute('aria-hidden','true');
  const toolOptions=new Map(),toolIconSources=new WeakMap();
  for(const option of $('simulationTool').options){
   const item=document.createElement('button');item.type='button';item.role='option';item.tabIndex=-1;item.dataset.tool=option.value;
   const label=document.createElement('span');label.textContent=option.textContent;item.append(label);$('simulationToolOptions').append(item);toolOptions.set(option.value,item);
   item.onclick=()=>{finishStroke();$('simulationTool').value=option.value;closeChoices();$('simulationTool').dispatchEvent(new Event('change',{bubbles:true}));$('simulationToolChoice').focus({preventScroll:true});};
  }
  function closeToolChoices(){if(!$('simulationToolOptions'))return;$('simulationToolOptions').hidden=true;$('simulationToolChoice').setAttribute('aria-expanded','false');}
  function assignToolIcon(target,icon){
   if(toolIconSources.get(target)===icon)return;target.querySelector('.simulation-choice-icon')?.remove();
   if(icon){const copy=icon.cloneNode(true);copy.dataset.zoom='1';const arrow=target.querySelector('.simulation-tool-arrow');target.insertBefore(copy,arrow);}
   toolIconSources.set(target,icon);
  }
  function updateToolChoice(){
   const selected=$('simulationTool').value,button=$('simulationToolChoice');if(!button)return;
   for(const [tool,item]of toolOptions){const icon=tool==='place'?choiceIcon($('simulationObject').value):toolIcons.get(tool);assignToolIcon(item,icon);item.setAttribute('aria-selected',String(tool===selected));
    if(tool===selected){button.firstElementChild.textContent=item.firstElementChild.textContent;assignToolIcon(button,icon);}
   }
  }
  $('simulationToolChoice').onclick=()=>{const open=$('simulationToolOptions').hidden;closeChoices();$('simulationToolOptions').hidden=!open;$('simulationToolChoice').setAttribute('aria-expanded',String(open));if(open)toolOptions.get($('simulationTool').value)?.focus();};
  toolPicker.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const items=[...toolOptions.values()],index=items.indexOf(document.activeElement),fallback=items.indexOf(toolOptions.get($('simulationTool').value));$('simulationToolOptions').hidden=false;$('simulationToolChoice').setAttribute('aria-expanded','true');const next=e.key==='Home'?0:e.key==='End'?items.length-1:((index<0?fallback:index)+(e.key==='ArrowUp'?-1:1)+items.length)%items.length;items[next]?.focus();});
  toolPicker.addEventListener('focusout',()=>setTimeout(()=>{if(!toolPicker.contains(document.activeElement))closeToolChoices();},0));
  document.addEventListener('pointerdown',e=>{if(!toolPicker.contains(e.target))closeToolChoices();},true);
  function centerBaseIcon(box,image){
   const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,w,h).data;let left=w,top=h,right=-1,bottom=-1;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   if(right<left)return;const scale=Math.min(56/w,42/h)*2;
   box.style.setProperty('--simulation-icon-shift-x',((w-left-right-1)/2*scale/56*100)+'%');box.style.setProperty('--simulation-icon-shift-y',((h-top-bottom-1)/2*scale/42*100)+'%');
  }
  function appendChoiceIcon(item,value,type){item.querySelector('.simulation-choice-icon')?.remove();const box=document.createElement('span');box.className='simulation-choice-icon';box.dataset.zoom=type==='NACNST'?'2':'1';if(type==='NACNST')centerBaseIcon(box,value.image);const icon=document.createElement('img');icon.alt='';icon.src=value.image.src||value.image.toDataURL();box.append(icon);item.append(box);updateChoice();syncCursor();}
  async function populateChoices(){const token=epoch;const list=$('simulationChoices');list.replaceChildren();for(const choice of model.choices){const item=document.createElement('button');item.type='button';item.role='option';item.dataset.type=choice.type;item.tabIndex=-1;const text=document.createElement('span');text.textContent=choiceLabel(choice);item.append(text);item.onclick=()=>{choose(choice.type);closeChoices();$('simulationChoice').focus();};list.append(item);(async()=>{let art=await root.CrateSimulationAssets.get(model.source,choice,{icon:true});if(!art){sprite(choice.type,0);return;}if(epoch!==token)return;appendChoiceIcon(item,art,choice.type);})().catch(()=>{});}updateChoice();}
  const sampledBaselines=new WeakMap();
  const picking=()=>modifiers.ctrl||!!isRegionPicker?.();
  function sampledType(point,cell){
   if(!model||!cell)return null;
   if(!consider&&!sampledBaselines.has(model))sampledBaselines.set(model,model.current(M().empty(model.source)));
   return model.sample(cell.x,cell.y,{fallback:null,state:consider?model.current():sampledBaselines.get(model),hitObject:consider?pickPlaced(point,cell):null});
  }
  function takeSample(point,cell){
   const type=sampledType(point,cell);
   if(type){onSample?.('object');choose(type);finishRegionPicker?.();activateMode?.('place');}
   else if(selectRegion?.(cell)){onSample?.('region');activateMode?.('region');}
   syncCursor();schedule();
  }
  let layerPicking=false;
  function syncPickerLayer(){const value=!!(picking()&&pickerReady());if(value!==layerPicking){layerPicking=value;onCtrlPicker?.(value);}}
  function syncCursor(){
   syncPickerLayer();
   const region=!picking()&&!active?getRegionCursor?.():null;
   const tool=picking()?'eyedropper':active?effectiveTool():region?'region':null,shown=(tool==='eyedropper'||tool==='region'?pickerReady():enabled())&&!!hover&&!!pointerClient&&!!tool&&tool!=='place';
   tooltip.hidden=!shown;
   tooltip.classList.toggle('simulation-operation-tooltip',shown&&['normal','chrono','restore'].includes(tool));
   canvas.classList.toggle('simulation-eyedropper',shown&&tool==='eyedropper');
   if(!shown)return;
   const names={normal:_t('摧毁(留废墟)'),chrono:_t('消除(无废墟)'),restore:_t('恢复')};
   tooltipLabel.textContent=tool==='region'?region.label:tool==='eyedropper'?_t('滴管'):names[tool]+` · ${brushSize()}×${brushSize()}`;
   const type=tool==='eyedropper'?sampledType(pointer(pointerClient),hover):null;
   const sample=tool==='eyedropper'&&!type?sampleRegion?.(hover):region?.region;
   regionPreview.hidden=!sample;
   tooltip.dataset.sample=type?'object':sample?'region':'';
   if(sample){regionPreview.dataset.region=sample.id;regionName.textContent=tool==='region'&&!sample.empty?'':sample.name;regionSwatch.style.backgroundColor=sample.color;regionSwatch.classList.toggle('empty-region',sample.empty);}
   else{regionName.textContent='';delete regionPreview.dataset.region;}
   const hint=region?.hint||'';let instructions=tooltip.querySelector('.cursor-instructions');
   if(hint&&!instructions){instructions=document.createElement('small');instructions.className='cursor-instructions';tooltip.append(instructions);}
   if(instructions){instructions.hidden=!hint;instructions.textContent=hint;}
   const icon=type?choiceIcon(type):toolIcons.get(tool);
   if(icon!==cursorIcon){
    tooltip.querySelector('.simulation-choice-icon')?.remove();
    if(icon)tooltip.append(icon.cloneNode(true));
    cursorIcon=icon;
   }
   const x=pointerClient.clientX+28,y=pointerClient.clientY+20;
   tooltip.style.left=Math.max(4,Math.min(x,innerWidth-tooltip.offsetWidth-10))+'px';
   tooltip.style.top=Math.max(4,Math.min(y,innerHeight-tooltip.offsetHeight-10))+'px';
  }
  function updateModifiers(e){const next={ctrl:!!e.ctrlKey,alt:!!e.altKey,shift:!!e.shiftKey};if(JSON.stringify(next)!==JSON.stringify(modifiers)){if(stroke)finishStroke();modifiers=next;syncCursor();schedule();}}
  const status=document.createElement('span');status.id='simulationProgress';status.setAttribute('role','status');$('simulationStatus').append(status);
  const setStatus=text=>{if(status.textContent!==text)status.textContent=text;status.title=text;};
  const spinner=document.createElement('div');spinner.id='mapBusy';spinner.className='map-busy';spinner.hidden=true;spinner.setAttribute('role','status');spinner.innerHTML='<span class="map-busy-ring" aria-hidden="true"></span><span class="map-busy-description"></span>';$('canvasHost').append(spinner);
  const busyDescription=spinner.lastElementChild;
  let operation=null;
  const cacheKey=()=>`crate-simulation-v1:${identity}`,pending=()=>consider&&revision!==applied;
  const liveReady=()=>pending()&&live?.painted===revision&&probabilityApplied===revision;
  // A completed live image/probability pair is usable in every viewing mode.
  // Only an explicit data export needs the additional persisted full report.
  const deferReport=()=>liveReady();
  const waiting=()=>pending()&&!failed&&(!deferReport()||running?.revision===revision);
  const probabilityPending=()=>pending()&&!failed&&revision!==probabilityApplied;
  const supported=meta=>meta&&['ra2','yr','directory','shikong'].includes(meta.version)&&!meta.previewOnly;
  function syncActivity(){
   const s=getState(),artProgress=s.liveArtworkProgress;
   let description='';
   if(s.busy)description=_msg(s.activityText)||_t('正在加载或分析地图…');
   else if(loading)description=_t('正在准备模拟编辑…');
   else if(root.CrateResourceUI?.loading)description=_t('正在检查地图资源…');
   else if(waiting()){
    if(artProgress?.revision===revision&&artProgress.done<artProgress.total){
     description=_t`正在更新地图… ${Math.round(artProgress.done/artProgress.total*100)}%`;
    }else if(running?.revision===revision&&running.message)description=running.message;
    else if(probabilityPending())description=_t('正在更新概率…');
    else if(live?.painted===revision)description=_t('正在完成更新…');
    else description=_t('正在更新地图画面…');
    if(operation?.revision===revision)description=operation.label+' · '+description;
   }
   if(!description&&s.regionPending)description=_t('正在更新区域统计…');
   if(!description&&s.buffExpectationPending)description=_t('正在计算 Buff期望…');
   if(!description&&s.unitBuffPending)description=_t('正在更新 Buff期望…');
   if(busyDescription.textContent!==description)busyDescription.textContent=description;
   spinner.hidden=!description;spinner.title=description;
   $('canvasHost').setAttribute('aria-busy',String(!!description));
  }
  function sync(){const s=getState(),busy=s.busy||loading,available=supported(s.data?.metadata),reason=busy?_t('正在加载地图，请稍候。'):!s.data?_t('请先加载地图。'):!available?_t('当前结果没有可编辑布局，请重新分析地图。'):_t('模拟放置');
   $('unitBuffRadius').disabled=busy||!s.data||!!s.data.metadata.previewOnly;
   $('simulationConsider').title=reason;$('simulationConsider').setAttribute('aria-busy',String(busy));$('simulationConsider').disabled=!available||busy;
   $('simulationConsider').textContent=_t('模拟放置结果:')+(consider?_t('开'):_t('关'));$('simulationConsider').setAttribute('aria-pressed',String(consider));$('simulationPlaceTab').setAttribute('aria-pressed',String(s.editMode==='place'));$('simulationCount').textContent=_t`${model?.count||0} 格修改`;
   for(const control of panel.querySelectorAll('button,select,input[type=number]')){control.disabled=busy||!model;control.title=busy?_t('正在加载地图，请稍候。'):!model?_t('请先启用模拟放置。'):'';}
   $('simulationPlaceTab').disabled=!available||busy;$('simulationPlaceTab').title=reason;$('simulationPlaceTab').setAttribute('aria-busy',String(busy));
   if(artNotice&&!busy)$('simulationChoice').title=artNotice;
   $('simulationUndo').disabled=busy||!!stroke||!model?.canUndo;$('simulationRedo').disabled=busy||!!stroke||!model?.canRedo;
   if(!busy){$('simulationUndo').title=model?.canUndo?_t('撤销上一笔修改'):_t('没有可以撤销的修改');$('simulationRedo').title=model?.canRedo?_t('重做上一笔撤销'):_t('没有可以重做的修改');}
   updateToolChoice();if(busy||!model)closeToolChoices();
   const place=$('simulationTool').value==='place';$('simulationObjectLabel').hidden=!place;$('simulationShapeLabel').hidden=$('simulationPaintMethodLabel').hidden=place;
   $('simulationPlaceShapeLabel').hidden=!place;$('simulationPlaceSizeLabel').firstElementChild.textContent=place?_t('尺寸（对象） '):_t('尺寸（格） ');
   $('simulationIgnoreLand').textContent=_t('忽略建筑海陆:')+(ignoreLand?_t('开'):_t('关'));$('simulationIgnoreLand').setAttribute('aria-pressed',String(ignoreLand));$('simulationRestoreCache').disabled=busy;
   $('simulationHint').textContent=!consider?_t('当前显示默认地图；开启“模拟放置结果”后继续编辑。'):_t('Q 直线 · W 画笔 · Shift 消除 · Alt 恢复 · −/+ 调整尺寸');
   $('simulationHint').title=$('simulationHint').textContent;
   const text=pending()&&failed?_t('更新失败，请重新计算。'):'';
   setStatus(text);syncCursor();
   syncActivity();
   if(probabilityPending()&&model){if(dirtyRevision!==revision||dirtyData!==s.data){dirtyCells=model.changesSince(s.data?.metadata.simulationPlan,styledPlan());dirtyRevision=revision;dirtyData=s.data;}}else{dirtyCells=new Set();dirtyRevision=-1;dirtyData=null;}
   s.simulationDirtyCells=dirtyCells;
   document.body.classList.toggle('simulation-pending',probabilityPending());document.body.classList.toggle('simulation-rendering',waiting());s.simulationPending=probabilityPending();s.simulationWaiting=waiting();if(waiting())s.incoming=null;
   for(const link of document.querySelectorAll('.exports a')){if(waiting()){link.setAttribute('aria-disabled','true');link.tabIndex=-1;}else{link.removeAttribute('aria-disabled');link.removeAttribute('tabindex');}}
   // Terrain inspection reads the loaded patch independently of report export.
   for(const id of ['mapImageExport','screenshot','cellFraction']){
    const c=$(id);
    if(waiting()){
     if(!c.hasAttribute('data-simulation-title'))c.dataset.simulationTitle=c.title;
     c.disabled=true;c.title=_t('模拟布局与概率正在更新，完成后可使用。');
    }else if(c.hasAttribute('data-simulation-title')){
     c.disabled=busy||!s.data
       ||(id==='cellFraction'&&(!s.selected||!!s.data.metadata.previewOnly))
       ||(id==='mapImageExport'&&!!s.imageExporting);
     c.title=c.dataset.simulationTitle;delete c.dataset.simulationTitle;
    }
   }
  }
  function save(){try{if(model?.count)localStorage.setItem(cacheKey(),JSON.stringify(model.plan));else localStorage.removeItem(cacheKey());}catch{message(_t('编辑已应用，但浏览器存储空间不足，未能缓存。请导出增量方案。'),true);}}
  function sprite(type,level=0,frame=0,color=''){const key=type+':'+level+':'+frame+':'+color;if(art.has(key))return art.get(key).value;const expected=epoch,cache=art,choice=model?.choice(type);if(!choice)return;const entry={value:null};cache.set(key,entry);
   (async()=>{
    let value=color?null:await root.CrateSimulationAssets.get(model.source,choice,{frame});
    if(!value&&root.CrateLiveObjects?.preview)value=await root.CrateLiveObjects.preview(model.source,choice,level,color);
    else if(!value){const data=await CrateLocalAPI.json('/api/maps/simulation-art?'+new URLSearchParams({result:sourceUrl,type,level,color})),image=new Image();image.src=data.image;await image.decode();value={...data,image};}
    if(epoch===expected){
     entry.value=value;
     const option=$('simulationChoices').querySelector('[data-type="'+type+'"]');
     if(!color&&option&&!option.querySelector('img'))appendChoiceIcon(option,value,type);
     schedule();
    }
   })().catch(e=>{if(epoch===expected){artNotice=_t('预览素材暂不可用：')+_msg(e.message);sync();}});
   // Preserve failures as well, so an unavailable sprite cannot trigger one
   // request every animation frame. A new map/explicit retry resets this cache.
   while(cache.size>128)cache.delete(cache.keys().next().value);return null;
  }
  async function ensure(){if(model)return model;if(sourcePromise)return sourcePromise;loading=true;sync();const expected=epoch,url=sourceUrl;
   sourcePromise=(async()=>{
    const opening=openLive(url);
    const session=opening?await opening:null;
    if(epoch!==expected)throw Error(_t('地图已切换'));
    const source=root.CrateMapPlatform?.simulationSource?await root.CrateMapPlatform.simulationSource(url):session?.source||await CrateLocalAPI.json('/api/maps/simulation-source?'+new URLSearchParams({result:url}));
    if(epoch!==expected)throw Error(_t('地图已切换'));
    await root.CrateSimulationAssets.prepare(source);
    if(epoch!==expected)throw Error(_t('地图已切换'));
    model=M().create(source);model.current();
    if(session?.source)delete session.source; // The model owns its source; don't pin a second DTO in the warmup promise.
    if(session){live={id:session.session,plan:M().empty(source),probability:0,painted:0,plans:new Map()};getState().liveEditing=true;}
    $('simulationObject').replaceChildren(...model.choices.map(c=>{const o=document.createElement('option');o.value=c.type;o.textContent=choiceLabel(c);return o;}));
    populateChoices();sprite($('simulationObject').value,0);return model;
   })().finally(()=>{if(epoch===expected){loading=false;sourcePromise=null;sync();}});return sourcePromise;
  }
  function livePost(action,payload){
   const lease=action==='open'?(root.crypto?.randomUUID?.()||'live-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)):null;
   if(lease){pendingOpens.add(lease);payload={...payload,lease};}
   return CrateLocalAPI.json('/api/maps/simulation-live/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).finally(()=>{if(lease)pendingOpens.delete(lease);});
  }
  function openLive(result){
   if(root.CrateMapPlatform?.simulate)return null;
   if(liveOpening?.result===result)return liveOpening.promise;
   const promise=livePost('open',{result,includeSource:true}).catch(error=>{if(error.code!=='LIVE_OPEN_CANCELLED')console.warn('Live edit warmup:',error.message);return null;});
   liveOpening={result,promise};
   return promise;
  }
  function cancelWarmup(){
   for(const lease of pendingOpens)releaseLive(null,lease);
   liveOpening?.promise.then(value=>{if(value)releaseLive(value.session);});
   liveOpening=null;
  }
  function releaseLive(id,lease=null){
   if(!id&&!lease)return;
   const payload={session:id,...(lease?{lease}:{})},body=JSON.stringify(payload);
   if(root.navigator?.sendBeacon&&root.Blob&&root.navigator.sendBeacon('/api/maps/simulation-live/close',new root.Blob([body],{type:'application/json'})))return;
   livePost('close',payload).catch(()=>{});
  }
  root.addEventListener?.('pagehide',event=>{if(!event.persisted){cancelWarmup();stopLive();}});
  function stopLive(){
   releaseLive(live?.id);
   live=null;
   editedView=null;
   getState().liveEditing=false;
   getState().liveArtworkProgress=null;
  }
  function restartLive(result,base,plan){
   if(root.CrateMapPlatform?.simulate)return;
   const expected=epoch;
   livePost('open',{result,revision:base}).then(value=>{
    if(epoch!==expected||live||revision!==base||!consider||getState().prepared.url!==result){releaseLive(value.session);return;}
    live={id:value.session,plan,probability:base,painted:base,plans:new Map([[base,plan]])};
    getState().liveEditing=true;
    schedule();
   }).catch(error=>{if(error.code!=='LIVE_OPEN_CANCELLED')console.warn('Live edit warmup:',error.message);});
  }
  function planDelta(before,after){
   const table=items=>Object.fromEntries(items.map(item=>[item.id,item]));
   const delta=(a,b)=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])]
     .filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>[k,b[k]??null]));
   const old=table(before.placements),next=table(after.placements);
   const placements=delta(old,next),result={objects:delta(before.objects,after.objects),overlays:delta(before.overlays,after.overlays),placements};
   const merged=[...Object.keys(old).filter(id=>Object.hasOwn(next,id)),...Object.keys(next).filter(id=>!Object.hasOwn(old,id))];
   const order=after.placements.map(item=>item.id);
   if(merged.some((id,i)=>id!==order[i]))result.order=order;
   return result;
  }
  function liveValid(session){return live===session&&consider&&!getState().busy;}
  async function reconnectLive(session,error){
   if(!liveValid(session)||!(error.code==='LIVE_SESSION_EXPIRED'||/Live edit session expired/.test(error.message)))return false;
   if(session.reconnecting)return session.reconnecting;
   if(session.recoveredRevision===revision)return false;
   session.recoveredRevision=revision;
   const started=performance.now(),paintPlan=session.plans.get(session.painted)||(session.painted===session.probability?session.plan:session.painted===0?baseline.data.metadata.simulationPlan||M().empty(model.source):null);
   if(!paintPlan)return false;
   const progress=getState().liveArtworkProgress,partial=progress&&progress.done<progress.total&&progress.revision>session.painted?{revision:progress.revision,plan:session.plans.get(progress.revision)}:null;
   if(partial&&!partial.plan)return false;
   session.reconnecting=(async()=>{
    try{
     const value=await livePost('open',{result:sourceUrl,resume:{probability:session.probability,painted:session.painted,plan:session.plan,paintPlan,partial}});
     if(!liveValid(session)){releaseLive(value.session);return false;}
     session.id=value.session;delete session.paintFailed;visuals.clearGrounds();
     const s=getState();s.liveRecovery={count:(s.liveRecovery?.count||0)+1,ms:performance.now()-started,revision:session.probability,reason:error.reason||'unknown',timing:value.timing};return true;
    }catch(recoveryError){if(liveValid(session)&&recoveryError.code!=='LIVE_OPEN_CANCELLED')console.warn('Live reconnect:',recoveryError.message);return false;}
    finally{session.reconnecting=null;sync();}
   })();
   syncActivity();return session.reconnecting;
  }
  async function getSources(data){
   const session=live,version=revision;
   if(!session||!liveReady()||data!==getState().data)throw Error('Live source revision changed');
   if(session.sourceData!==data){
    session.sourceData=data;
    session.sources=livePost('sources',{session:session.id,revision:version}).then(packet=>{
     if(!liveValid(session)||packet.revision!==version||data!==getState().data)throw Error('Live source revision changed');
     const binary=Uint8Array.from(atob(packet.search),c=>c.charCodeAt(0));
     return root.CrateTransferOrigins.create(data,binary.buffer);
    }).catch(error=>{if(session.sourceData===data)session.sourceData=session.sources=null;throw error;});
   }
   return session.sources;
  }
  function liveFrame(){
   const session=live;
   if(!session||session.frame||session.editing)return;
   const token=session.frame={};const run=()=>{if(session.frame!==token)return;session.frame=0;updateLive(session);};
   if(root.queueMicrotask)root.queueMicrotask(run);else Promise.resolve().then(run);
  }
  function rememberPlan(session,revision,plan){
   session.plans.set(revision,plan);
   while(session.plans.size>16)session.plans.delete(session.plans.keys().next().value);
  }
  async function updateLive(session){
   if(session.reconnecting)await session.reconnecting;
   if(!liveValid(session)||session.editing||session.probability>=revision)return;
   const next=revision,plan=styledPlan(),s=getState(),started=performance.now(),sessionId=session.id;
   session.editing=true;
   try{
    rememberPlan(session,next,plan);
    const pendingPacket=livePost('edit',{session:session.id,from:session.probability,revision:next,
     baseRevision:s.data.probabilityRevision||s.prepared.url,delta:planDelta(session.plan,plan),planEcho:false,compact:true});
    session.target=next;paintLive(session);
    const packet=await pendingPacket;
    if(!liveValid(session)||session.reconnecting||session.id!==sessionId)return;
    if(packet.revision!==next)throw Error('Live probability base changed');
    if(!packet.sets.some(([path])=>path.join('.')==='metadata.simulationPlan'))packet.sets.push([['metadata','simulationPlan'],plan]);
    if(!applyProbability?.(packet))throw Error('Live probability base changed');
    session.plan=plan;session.probability=probabilityApplied=next;
    s.liveProbability.elapsedMs=performance.now()-started;
    sync();schedule();paintLive(session);
   }catch(error){
    const recovered=await reconnectLive(session,error);
    if(live===session&&session.id===sessionId&&!recovered){
     console.warn('Live probability:',error.message);
     recoverLive=true;
     stopLive();visuals.update(model,sourceUrl,revision,operation?.revision===revision,styledPlan());queue();
    }
   }finally{
    session.editing=false;
    if(liveValid(session)&&session.probability<revision)updateLive(session);
   }
  }
  async function paintLive(session){
   if(session.reconnecting)await session.reconnecting;
   if(!liveValid(session)||session.painting||session.painted>=session.target)return;
   session.painting=true;
   const s=getState(),started=performance.now();let requestSession=session.id;
   const area=getArea(),focus=[
    Math.round((area.x+area.w/2-s.x)/s.scale),Math.round((area.y+area.h/2-s.y)/s.scale)
   ].map(n=>Math.max(-65536,Math.min(65536,n)));
   try{
    let previous=null,flatTiles=0,paintMs=0;
    while(liveValid(session)){
     requestSession=session.id;
     const result=await livePost('paint',{session:requestSession,from:session.painted,target:session.target,
      limit:8,revision:previous?.revision,offset:previous?.done||0,focus,knownGrounds:visuals.groundKeys(),planEcho:!!session.needPlan});
     const plan=result.plan||session.plans.get(result.revision);
     if(!plan){const error=Error('Missing live artwork plan revision');error.code='ART_PLAN_MISSING';throw error;}
     rememberPlan(session,result.revision,plan);session.needPlan=false;
     const valid=()=>liveValid(session)&&!session.reconnecting&&session.id===requestSession&&result.revision>session.painted;
     if(!await visuals.installTiles({...result,plan},valid))return;
     if(!previous||result.revision!==previous.revision){flatTiles=0;paintMs=0;}
     flatTiles+=result.flatTiles;paintMs+=result.paintMs;
     s.liveArtworkProgress={revision:result.revision,done:result.done,total:result.total};
     if(result.done===result.total){
      session.painted=result.revision;
      for(const key of session.plans.keys())if(key<result.revision)session.plans.delete(key);
      s.liveArtwork={revision:result.revision,tiles:result.total,flatTiles,paintMs,elapsedMs:performance.now()-started};
      sync();
      return;
     }
     syncActivity();
     previous=result;
     // Give the installed tiles a frame before requesting the next batch.
     await new Promise(requestAnimationFrame);
    }
   }catch(error){
    const recovered=await reconnectLive(session,error);
    if(live===session&&session.id===requestSession&&!recovered){if(error.code==='ART_GROUND_MISSING'){visuals.clearGrounds();}else if(error.code==='ART_PLAN_MISSING'){session.needPlan=true;}else{console.warn('Live artwork:',error.message);session.paintFailed=session.target;queue();}}
   }finally{
    session.painting=false;
    if(liveValid(session)&&session.painted<session.target&&session.paintFailed!==session.target)paintLive(session);
   }
  }
  function queue(delay=live?650:120){clearTimeout(timer);timer=null;if(!pending()||failed||deferReport()||stroke||!model)return;timer=setTimeout(()=>{timer=null;compute();},delay);}
  function changed(label=null,plan=styledPlan()){
   editedView=null;
   styleStamp=styleKey(plan);
   revision++;failed=false;operation=label?{revision,label}:null;message('',true);sync();
   if(live)liveFrame();else visuals.update(model,sourceUrl,revision,!!label,plan);
   schedule();
  }
  async function compute(force=false,requested=false){if(!model||!consider||stroke||(!force&&!requested&&deferReport()))return;if(force){forceQueued=true;revision++;failed=false;artNotice='';for(const[k,v]of art)if(!v.value)art.delete(k);}clearTimeout(timer);timer=null;
   if(force)stopLive();
   if(live&&live.probability<revision){liveFrame();queue();return;}
   if(live?.painting&&live.target===revision&&!liveReady()){queue();return;}
   if(visuals.progressivePending&&!force){queue();return;}
   if(running){if(!root.CrateMapPlatform?.simulate&&running.probabilityReady&&running.revision!==revision){running.controller.abort();running=null;}else{sync();return running.promise;}}if(!pending())return;
   const fresh=forceQueued;forceQueued=false;const ticket={epoch,revision,plan:styledPlan(),controller:new AbortController()},valid=()=>ticket.epoch===epoch&&ticket.revision===revision&&consider&&!stroke&&!getState().busy;
   running=ticket;sync();
   ticket.promise=(async()=>{try{
    let url,prepared=null;const progress=async value=>{
     if(value.probabilityReady){ticket.probabilityReady=true;if(ticket.epoch===epoch&&ticket.revision!==revision&&!stroke)queue(0);}
     if(valid()&&value.probabilityUrl&&!ticket.probabilityLoaded&&probabilityApplied!==ticket.revision){
      try{let snapshot=await CrateLocalAPI.json(value.probabilityUrl,{signal:ticket.controller.signal});if(valid()){let accepted=applyProbability?.(snapshot);if(!accepted&&snapshot.probabilityPatch){snapshot=await CrateLocalAPI.json('/api/maps/probability/'+snapshot.probabilityRevision,{signal:ticket.controller.signal});accepted=valid()&&applyProbability?.(snapshot);}if(accepted){probabilityApplied=ticket.revision;ticket.probabilityLoaded=true;sync();schedule();}}}catch{/* Final report/retry still works when the intermediate response is unavailable. */}
     }
     if(ticket.epoch===epoch&&pending()){
      ticket.message=value.probabilityReady?_t('正在绘制地图…'):_t('正在计算概率…');
      syncActivity();
      setStatus('');
     }
    };
    if(model.count||fresh)url=root.CrateMapPlatform?.simulate?await root.CrateMapPlatform.simulate(sourceUrl,ticket.plan,progress,fresh):await CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/simulation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:sourceUrl,plan:ticket.plan,force:fresh,publishPreview:probabilityApplied!==ticket.revision,baseRevision:getState().data.probabilityRevision||getState().prepared.url})}),{onProgress:progress,signal:ticket.controller.signal,pollInterval:80});
    else {url=baseline.url;prepared=baseline;}
    if(!valid())return;
    const loaded=await loadResult(url,true,{keepSimulation:true,preserveView:true,prepared,commitIf:valid});
    if(loaded===false||!valid())return;
    applied=probabilityApplied=ticket.revision;rendered=new Set(ticket.plan.placements.map(p=>p.id));edited=getState().prepared;editedView=null;failed=false;message(_t('模拟布局与概率已更新。'));
    if(live)live.painted=ticket.revision;
    else if(fresh||recoverLive){recoverLive=false;restartLive(url,ticket.revision,ticket.plan);}
   }catch(error){
    if(error.name!=='AbortError'&&ticket.epoch===epoch&&ticket.revision===revision){
     failed=true;recoverLive=!!live||recoverLive;stopLive();
     const last=edited||baseline;
     if(last){
      try{await loadResult(last.url,true,{keepSimulation:true,preserveView:true,prepared:last,
       commitIf:()=>ticket.epoch===epoch&&ticket.revision===revision&&failed&&consider});}catch{}
     }
     if(ticket.epoch===epoch&&ticket.revision===revision&&failed){
      probabilityApplied=applied;message(error.message,true);
      message(_t('重算失败，已显示上次完整结果。编辑已保留，可点击“重新计算”重试。'));
     }
    }
   }
   finally{if(running===ticket){running=null;sync();schedule();if(pending()&&!failed)queue();}}})();return ticket.promise;
  }
  async function action(fn,label=null){if(getState().busy||loading||!consider||stroke)return;try{await ensure();if(!fn(model))return;changed(label);save();queue();}catch(error){message(error.message,true);sync();schedule();}}
  async function load(prepared,keepSimulation=false){const m=prepared.data.metadata,next=m.sourceSha256+':'+m.version;if(next===identity&&keepSimulation){visuals.reset(m.simulationPlan);rendered=new Set((m.simulationPlan?.placements||[]).map(p=>p.id));history.replaceState(null,'','maps.html?result='+encodeURIComponent(sourceUrl));return;}stopLive();visuals.reset();epoch++;clearTimeout(timer);timer=null;running?.controller.abort();running=null;revision=applied=probabilityApplied=0;failed=false;forceQueued=false;art=new Map();artNotice='';rendered=new Set();identity=next;sourceUrl=prepared.url;baseline=prepared;edited=null;sourcePromise=null;loading=false;model=null;stroke=null;hover=null;modifiers={ctrl:false,alt:false,shift:false};pointerClient=null;closeChoices();active=false;consider=true;pendingCache=null;lastPlacement=null;banner.hidden=true;
   if(liveOpening?.result!==prepared.url)cancelWarmup();recoverLive=false;operation=null;styleStamp='[]';
   try{const cached=localStorage.getItem(cacheKey());if(cached){pendingCache=JSON.parse(cached);$('simulationCacheText').textContent=_t('发现已保存的编辑，是否恢复？');banner.hidden=false;}}catch{message(_t('这张地图的编辑缓存无法读取，可重新导入增量方案。'),true);}sync();
   if(supported(m)){
    const expected=epoch;
    // Prepare choices and the edit model without changing the selected mode or
    // applying a saved plan. ensure() shares the same in-flight preparation.
    ensure().then(()=>{if(epoch===expected)schedule();}).catch(error=>{if(epoch===expected&&error.name!=='AbortError'){message(error.message,true);schedule();}});
   }
  }
  async function open(){
   if(getState().busy)return;
   try{
    await ensure();
    if(getState().editMode!=='place')return;
    active=true;getState().incoming=null;sync();schedule();
   }catch(e){message(e.message,true);}
  }
  $('simulationConsider').onclick=async()=>{if(getState().busy||loading)return;finishStroke();const expected=epoch;consider=!consider;
   if(!consider&&revision!==applied&&live){
    if(live?.painted===revision&&probabilityApplied===revision){const s=getState();editedView={revision,prepared:{...s.prepared,data:{...s.data,cells:s.data.cells.slice()},im:s.image.snapshot?.()||s.image,objectImage:s.objectImage?.snapshot?.()||s.objectImage}};}
    else{recoverLive=true;stopLive();}
   }
   getState().liveEditing=!!live&&consider;
   clearTimeout(timer);timer=null;hover=null;sync();
   try{if(!consider){await loadResult(baseline.url,true,{keepSimulation:true,preserveView:true,prepared:baseline,commitIf:()=>epoch===expected&&!consider});}
    else {const cached=edited&&revision===applied?edited:live&&editedView?.revision===revision?editedView.prepared:null;if(cached)await loadResult(cached.url,true,{keepSimulation:true,preserveView:true,prepared:cached,commitIf:()=>epoch===expected&&consider});else{applied=-1;queue(0);}refreshColors();}sync();schedule();}catch(e){message(e.message,true);}};
  $('simulationTool').onchange=()=>{hover=null;sync();schedule();};$('simulationObject').onchange=()=>{updateChoice();sprite($('simulationObject').value,hover?.level||0);schedule();};
  for(const id of ['simulationShape','simulationPlaceShape','simulationPaintMethod'])$(id).onchange=()=>{finishStroke();syncCursor();schedule();};
  $('simulationIgnoreLand').onclick=()=>{ignoreLand=!ignoreLand;sync();schedule();};
  $('simulationUndo').onclick=()=>action(m=>m.undo(),_t('撤销'));$('simulationRedo').onclick=()=>action(m=>m.redo(),_t('重做'));
  for(const [id,name,mode] of [
   ['simulationMine','mine','normal'],['simulationTrees','trees','normal'],
   ['simulationBuildings','buildings','normal'],['simulationChronoBuildings','buildings','chrono'],
   ['simulationUnits','units','delete']
  ])$(id).onclick=()=>action(m=>m.quick(name,mode),$(id).textContent);
  $('simulationReset').onclick=()=>action(m=>m.reset(),$('simulationReset').textContent);
  $('simulationImport').onclick=()=>$('simulationImportFile').click();$('simulationImportFile').onchange=async()=>{const file=$('simulationImportFile').files[0];if(!file)return;try{if(file.size>8*1024*1024)throw Error(_t('增量方案不能超过 8 MB'));const plan=JSON.parse(await file.text());await action(m=>m.import(plan));}catch(e){message(e.message,true);}finally{$('simulationImportFile').value='';}};
  $('simulationExport').onclick=()=>{if(!model)return;const url=URL.createObjectURL(new Blob([JSON.stringify(model.plan,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=(getState().data.metadata.filename||'map').replace(/\.[^.]+$/,'')+'.simulation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  $('simulationRestoreCache').onclick=async()=>{if(!pendingCache)return;await action(m=>m.import(pendingCache));if(model?.count){banner.hidden=true;pendingCache=null;activateMode?.();sync();}};
  $('simulationDismissCache').onclick=()=>{banner.hidden=true;pendingCache=null;};
  document.addEventListener('click',async e=>{
   const control=e.target.closest?.('.exports a');
   if(!control)return;
   if(waiting()){e.preventDefault();e.stopImmediatePropagation();return;}
   if(!deferReport()||failed)return;
   e.preventDefault();e.stopImmediatePropagation();
   const expected=epoch,target=revision;
   await compute(false,true);
   if(epoch===expected&&revision===target&&applied===target&&consider&&!failed)control.click();
  },true);
  document.addEventListener('keydown',e=>{if(!active||!consider||getState().busy||e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();finishStroke();const redo=e.key.toLowerCase()==='y'||e.shiftKey;action(m=>redo?m.redo():m.undo(),redo?_t('重做'):_t('撤销'));}});
  const canvas=$('map'),enabled=()=>active&&consider&&model&&!getState().busy&&!loading;
  const pickerReady=()=>model&&!getState().busy&&!loading&&!getState().data?.metadata.previewOnly;
  function shortcut(key){
   if(!active||!['q','w'].includes(key))return false;finishStroke();
   $('simulationPlaceShape').value=$('simulationPaintMethod').value=key==='q'?'line':'brush';syncCursor();schedule();return true;
  }
  function adjustSize(delta){
   if(!active||!model)return false;finishStroke();$('simulationPlaceSize').value=Math.max(1,Math.min(15,brushSize()+delta));syncCursor();schedule();return true;
  }
  function areaFor(cell){return model.brush(cell.x,cell.y,stroke?.size||brushSize(),stroke?.shape||(temporary()?'square':$('simulationShape').value));}
  function placementSettings(start){
   const type=$('simulationObject').value,choice=model.choice(type);
   if(!choice)return null;
   return {
    type,start,ignoreLand,size:brushSize(),line:$('simulationPlaceShape').value==='line',
    width:Math.max(...choice.footprint.map(([x])=>x))+1,
    height:Math.max(...choice.footprint.map(([,y])=>y))+1
   };
  }
  function* gridLine(start,end){
   const dx=end.x-start.x,dy=end.y-start.y,steps=Math.max(Math.abs(dx),Math.abs(dy));
   yield start;
   for(let i=1;i<=steps;i++)yield {x:start.x+Math.round(dx*i/steps),y:start.y+Math.round(dy*i/steps)};
  }
  function placementGridPoint(settings,cell){
   return {
    x:Math.round((cell.x-settings.start.x)/settings.width),
    y:Math.round((cell.y-settings.start.y)/settings.height)
   };
  }
  function* placementTargets(settings,first,last,seen=new Set()){
   const offset=Math.floor((settings.size-1)/2);
   for(const center of gridLine(first,last)){
    for(let dx=0;dx<settings.size;dx++)for(let dy=0;dy<settings.size;dy++){
     const x=settings.start.x+(center.x+dx-offset)*settings.width;
     const y=settings.start.y+(center.y+dy-offset)*settings.height;
     const position=`${x},${y}`;
     if(seen.has(position))continue;
     seen.add(position);
     yield {x,y};
    }
   }
  }
  function appendPlacements(settings,first,last){
   let added=false;
   for(const {x,y} of placementTargets(settings,first,last,settings.visited)){
    if(model.appendPlacement(settings.type,x,y,settings)){lastPlacement={x,y};added=true;}
   }
   if(added)onInteraction?.(lastPlacement);return added;
  }
  function addStroke(cell){
   if(stroke.tool==='place'){
    const end=placementGridPoint(stroke,cell);
    if(!stroke.line&&appendPlacements(stroke,stroke.last||end,end))changed();
    stroke.last=end;
    return;
   }
   if(stroke.last?.x===cell.x&&stroke.last?.y===cell.y)return;
   const fresh=[];
   if(stroke.line)stroke.area.clear();
   for(const center of gridLine(stroke.line?stroke.start:stroke.last||cell,cell)){
    for(const position of areaFor(center)){
     if(stroke.area.has(position))continue;
     stroke.area.add(position);
     if(!stroke.line)fresh.push(position);
    }
   }
   stroke.last=cell;
   if(!stroke.line&&fresh.length&&model.paint(fresh,stroke.tool)){onInteraction?.(cell);changed();}
  }
  function finishStroke(commitLine=false){
   if(!stroke)return;
   const done=stroke;
   if(done.line&&commitLine){
    if(done.tool==='place'){
     model.beginPlacement();
     if(appendPlacements(done,{x:0,y:0},done.last))changed();
    }else{
     model.beginPaint();
     if(done.area.size&&model.paint(done.area,done.tool)){onInteraction?.(done.last);changed();}
    }
   }
   stroke=null;
   if(canvas.hasPointerCapture(done.id))canvas.releasePointerCapture(done.id);
   const edited=done.tool==='place'?model.endPlacement():model.endPaint();
   if(edited)save();
   queue();
   sync();
   schedule();
   onInteractionEnd?.();
  }
  function consume(e){e.preventDefault();e.stopImmediatePropagation();}
  canvas.addEventListener('pointerdown',e=>{
   if(stroke?.line&&e.button===2){consume(e);finishStroke();return;}
   if(e.button!==0||stroke)return;
   updateModifiers(e);
   if(!enabled()&&!(pickerReady()&&picking()))return;
   pointerClient={clientX:e.clientX,clientY:e.clientY};
   const p=pointer(e),cell=hit(p)?pick(p):null;
   if(!cell)return;
   const tool=picking()?'eyedropper':effectiveTool();
   const settings=tool==='place'?placementSettings(cell):null;
   if(tool==='place'&&!settings)return;
   consume(e);
   hover=cell;
   if(tool==='eyedropper'){takeSample(p,cell);return;}
   clearTimeout(timer);
   timer=null;
   stroke={id:e.pointerId,tool,last:null};
   if(tool==='place'){
    Object.assign(stroke,settings,{visited:new Set()});
    if(!stroke.line)model.beginPlacement();
   }else{
    Object.assign(stroke,{start:cell,size:brushSize(),
     shape:temporary()?'square':$('simulationShape').value,line:!temporary()&&$('simulationPaintMethod').value==='line',area:new Set()});
    if(!stroke.line)model.beginPaint();
   }
   addStroke(cell);
   canvas.setPointerCapture(e.pointerId);
   sync();
   schedule();
  },true);
  canvas.addEventListener('pointermove',e=>{
   if(stroke&&stroke.id!==e.pointerId)return;
   if(stroke?.line&&(e.buttons&2)){consume(e);finishStroke();return;}
   updateModifiers(e);
   pointerClient={clientX:e.clientX,clientY:e.clientY};
   const p=pointer(e),cell=hit(p)?pick(p):null;
   const moved=hover?.x!==cell?.x||hover?.y!==cell?.y;
   hover=cell;
   if(stroke){consume(e);if(cell)addStroke(cell);}
   syncCursor();
   if((enabled()||pickerReady()&&picking())&&(moved||stroke?.line))schedule();
  },true);
  canvas.addEventListener('pointerup',e=>{
   if(!stroke||stroke.id!==e.pointerId)return;
   consume(e);
   const commitLine=stroke.line&&e.button===0&&!(e.buttons&2);
   if(commitLine){
    const p=pointer(e),cell=hit(p)?pick(p):null;
    if(cell)addStroke(cell);
   }
   finishStroke(commitLine);
  },true);
  canvas.addEventListener('contextmenu',e=>{if(stroke?.line){consume(e);finishStroke();}},true);
  canvas.addEventListener('dblclick',e=>{if(enabled()||pickerReady()&&picking()){e.preventDefault();e.stopImmediatePropagation();}},true);
  const cancel=()=>{finishStroke();hover=null;pointerClient=null;modifiers={ctrl:false,alt:false,shift:false};syncCursor();schedule();};canvas.addEventListener('pointercancel',cancel,true);canvas.addEventListener('lostpointercapture',()=>{if(stroke)cancel();},true);canvas.addEventListener('pointerleave',()=>{if(!stroke){hover=null;pointerClient=null;syncCursor();schedule();}});window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});window.addEventListener('pagehide',()=>{finishStroke();if(model)save();});
  const masks=new WeakMap(),pickOrder=new WeakMap();
  function placedInPickOrder(objects){
   const previous=pickOrder.get(objects);
   if(previous?.length===objects.length)return previous.ordered;
   const depth=o=>o.x+o.y+(o.category==='STRUCTURES'?Math.max(...o.footprint.map(p=>p[0]+p[1]))+.6:o.category==='OVERLAY'?.2:o.category==='TERRAIN'?.3:.6);
   const ordered=objects.filter(o=>o.placed).sort((a,b)=>(model.sampleObject(b)?.priority||0)-(model.sampleObject(a)?.priority||0)||depth(b)-depth(a)||b.x-a.x);
   pickOrder.set(objects,{length:objects.length,ordered});
   return ordered;
  }
  function pickPlaced(point,cell){const s=getState(),state=model.current(),ordered=placedInPickOrder(state.objects);
   for(const o of $('objects').checked?ordered:[]){const c=s.lookup.get(o.x+','+o.y);if(!c)continue;const frame=o.category==='OVERLAY'?state.cells.get(o.x+','+o.y).overlayData:0,v=sprite(o.type,c.level,frame);if(!v)continue;const [dx,dy]=spriteOffset(o);const x=Math.floor((point.x-s.x)/s.scale-c.px-v.x-dx),y=Math.floor((point.y-s.y)/s.scale-c.py-v.y-dy);if(x<0||y<0||x>=v.image.width||y>=v.image.height)continue;let alpha=masks.get(v.image);if(!alpha){const canvas=document.createElement('canvas');canvas.width=v.image.width;canvas.height=v.image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(v.image,0,0);alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data;masks.set(v.image,alpha);}if(alpha[(y*v.image.width+x)*4+3]>0)return o;}
   return ordered.find(o=>o.footprint.some(([dx,dy])=>o.x+dx===cell.x&&o.y+dy===cell.y));
  }
  function spriteOffset(item){
   const [dx,dy]=item.category==='INFANTRY'?M().infantryOffsets[item.subcell]||[0,0]:[0,0];
   return [dx,dy-(item.onBridge?60:0)];
  }
  function drawSprite(ctx,item,opacity){const s=getState(),c=s.lookup.get(`${item.x},${item.y}`);if(!c)return;const choice=model.choice(item.type),frame=choice?.category==='OVERLAY'?(choice.ore?11:model.current().cells.get(`${item.x},${item.y}`)?.overlayData||0):0,color=colorAt(item.type,item.x,item.y),value=sprite(item.type,c.level,frame,color)||(color?sprite(item.type,c.level,frame):null);if(!value)return;const [dx,dy]=spriteOffset(item),x=s.x+(c.px+value.x+dx)*s.scale,y=s.y+(c.py+value.y+dy)*s.scale;ctx.globalAlpha=opacity;ctx.drawImage(value.image,x,y,value.image.width*s.scale,value.image.height*s.scale);ctx.globalAlpha=1;}
  function drawFootprint(ctx,s,cells,tool,onBridge=false){
   for(const p of cells){
    const c=s.lookup.get(`${p.x},${p.y}`);
    if(!c)continue;
    const x=s.x+c.px*s.scale,y=s.y+(c.py-(onBridge?60:0))*s.scale,rx=30*s.scale,ry=15*s.scale;
    const vertices=[[x,y-ry],[x+rx,y],[x,y+ry],[x-rx,y]];
    const color=tool==='place'?(p.allowed?'#58ed8c':'#ff606b'):tool==='restore'?'#62c5ff':'#ffb861';
    ctx.beginPath();
    const radius=Math.min(5,rx*.15);
    for(let i=0;i<4;i++){
     const a=vertices[(i+3)%4],b=vertices[i],d=vertices[(i+1)%4],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
     if(!i)ctx.moveTo(b[0]+(a[0]-b[0])*radius/len,b[1]+(a[1]-b[1])*radius/len);
     ctx.arcTo(...b,...d,radius);
    }
    ctx.closePath();
    ctx.fillStyle=color+'30';
    ctx.fill();
    ctx.strokeStyle=color;
    ctx.lineWidth=2;
    ctx.stroke();
   }
  }
  function drawPlacementPreview(ctx,s){
   const settings=stroke||placementSettings(hover);
   if(!settings)return;
   const end=stroke?.last||{x:0,y:0},start=settings.line?{x:0,y:0}:end;
   const choice=model.choice(settings.type);
   for(const {x,y} of placementTargets(settings,start,end)){
    if(!settings.line&&stroke?.visited.has(`${x},${y}`))continue;
    const check=model.placement(settings.type,x,y,settings);
    drawSprite(ctx,{...choice,x,y,onBridge:check.onBridge,subcell:check.subcell},.38);
    drawFootprint(ctx,s,check.cells,'place',check.onBridge);
   }
  }
  function drawPicker(ctx){
   if(!hover||!consider)return;
   const s=getState(),area=getArea(),objects=model.current().objects.filter(o=>o.placed);
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   for(const o of objects){if(!rendered.has(o.id)&&$('objects').checked)drawSprite(ctx,o,s.objectOpacity??1);const c=s.lookup.get(o.x+','+o.y);if(c)sprite(o.type,c.level,o.category==='OVERLAY'?model.current().cells.get(o.x+','+o.y).overlayData:0);}
   ctx.fillStyle='rgba(105,225,255,.3)';ctx.strokeStyle='#8deeff';ctx.lineWidth=2;
   for(const o of objects)for(const[dx,dy]of o.footprint){const c=s.lookup.get(`${o.x+dx},${o.y+dy}`);if(!c)continue;const x=s.x+c.px*s.scale,y=s.y+c.py*s.scale;ctx.beginPath();ctx.moveTo(x,y-15*s.scale);ctx.lineTo(x+30*s.scale,y);ctx.lineTo(x,y+15*s.scale);ctx.lineTo(x-30*s.scale,y);ctx.closePath();ctx.fill();ctx.stroke();}
   ctx.restore();
  }
  function draw(ctx){if(!picking())syncCursor();else syncPickerLayer();if(pickerReady()&&picking()){drawPicker(ctx);return;}if(!model||!consider||failed)return;const s=getState(),area=getArea();ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.imageSmoothingEnabled=false;
   // Foreground-only marks do not invalidate the expensive cached map/heatmap.
   // Off-screen changes (e.g. bulk tree removal) need no drawing work.
   if(probabilityPending()){
    ctx.strokeStyle='#ffd074';ctx.fillStyle='rgba(255,208,116,.12)';ctx.lineWidth=2;ctx.setLineDash([4,3]);
    for(const key of dirtyCells){const c=s.lookup.get(key);if(!c)continue;const x=s.x+c.px*s.scale,y=s.y+c.py*s.scale,rx=30*s.scale,ry=15*s.scale;if(x+rx<area.x||x-rx>area.x+area.w||y+ry<area.y||y-ry>area.y+area.h)continue;ctx.beginPath();ctx.moveTo(x,y-ry);ctx.lineTo(x+rx,y);ctx.lineTo(x,y+ry);ctx.lineTo(x-rx,y);ctx.closePath();ctx.fill();ctx.stroke();}ctx.setLineDash([]);
   }
   const added=[];model.eachPlacement(p=>{if(!rendered.has(p.id))added.push(p);});added.sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x);if($('objects').checked)for(const item of added)drawSprite(ctx,item,s.objectOpacity??1);
   if(!enabled()||!hover&&!stroke?.line){ctx.restore();return;}const tool=stroke?.tool||effectiveTool();
   if(tool==='place')drawPlacementPreview(ctx,s);
   else{
    const cells=[...(stroke?.area||areaFor(hover))].map(p=>{const [x,y]=p.split(',').map(Number);return {x,y};});
    drawFootprint(ctx,s,cells,tool);
   }
   ctx.restore();
  }
  for(const name of ['keydown','keyup'])document.addEventListener(name,e=>{
   if(name==='keyup'&&['Control','Alt','Shift'].includes(e.key)){updateModifiers(e);return;}
   if(e.target.closest?.('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
   if(['Control','Alt','Shift'].includes(e.key)){if(e.key==='Alt')e.preventDefault();updateModifiers(e);}
  });
  sync();
  window.addEventListener('crate:resource-busy',sync);
  return {shortcut,adjustSize,refreshCursor:syncCursor,load,sync,syncActivity,draw,open,refreshColors,getSources,prewarm:(url,data)=>{if(supported(data.metadata))openLive(url);},cancelInteraction:()=>{closeChoices();cancel();},get liveReady(){return liveReady();},get pointerClient(){return pointerClient;},get lastPlacement(){return lastPlacement;},get waiting(){return waiting();},beforeLoad:()=>{finishStroke();cancelWarmup();stopLive();visuals.reset();epoch++;clearTimeout(timer);timer=null;running?.controller.abort();running=null;sourcePromise=null;loading=true;root.CrateLivePlatform?.cancel();sync();},loadFailed:()=>{cancelWarmup();loading=false;sync();queue();},close:()=>{active=false;closeChoices();finishStroke();sync();},get active(){return active;},get dragging(){return !!stroke;},get model(){return model;},get considered(){return consider;},get pending(){return pending();},get computing(){return !!running;},get previewReady(){return [...art.values()].some(v=>!!v.value);},recompute:async()=>{const meta=getState().data.metadata;if(!supported(meta)){setBusy(true);try{const url=await CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:getState().prepared.url})}));await loadResult(url,true,{keepSimulation:true,preserveView:true});return true;}finally{setBusy(false);}}finishStroke();await ensure();if(consider){await compute(true);return true;}if(running)await running.promise;setBusy(true);try{const progress=s=>message(_t('正在更新地图…')),url=root.CrateMapPlatform?.simulate?await root.CrateMapPlatform.simulate(sourceUrl,M().empty(model.source),progress,true):await CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:sourceUrl})}),{onProgress:progress});await loadResult(url,true,{keepSimulation:true,preserveView:true});baseline=getState().prepared;return true;}finally{setBusy(false);}}};
 }
 root.CrateSimulationUI={create};
})(globalThis);
