/* Simulation controls share the viewer's result lifecycle, 3D and exports. */
(function(root){
 'use strict';
 const I=root.CrateI18n,_t=I?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s),_msg=I?.message||(s=>s);
 const $=id=>document.getElementById(id),M=()=>root.CrateSimulationModel;
 function create({editHistory,getState,loadResult,applyProbability,setBusy,message:notify,schedule,pick,pointer,hit,getArea,getRegionMembership,getRegionCursor,hasRegionBrush,activateMode,isRegionPicker,finishRegionPicker,sampleRegion,selectRegion,onCtrlPicker,onSample,onInteractionEnd,onInteraction,onBlocked}){
  const message=(value,error)=>notify(_msg(value),error);
  const panel=document.createElement('section');panel.id='simulationPanel';panel.className='simulation-panel edit-toolbar';panel.setAttribute('role','group');panel.setAttribute('aria-labelledby','simulationPlaceTab');
  panel.innerHTML=`
   <div class="simulation-tools simulation-plan-actions">
    <p id="simulationHint" class="hint"></p>
    <button id="simulationImport">${_t('导入方案')}</button><input id="simulationImportFile" type="file" accept=".json" hidden><button id="simulationExport">${_t('导出方案')}</button>
   </div>
   <div class="simulation-tools simulation-quick-actions">
    <button id="simulationPlaceTab" type="button" aria-pressed="false">${_t('模拟放置')}</button>
    <div class="simulation-action-group"><button id="simulationMine">${_t('贫矿')}</button><button id="simulationReset">${_t('复原')}</button></div>
    <button id="simulationTrees">${_t('砍树')}</button><button id="simulationWalls">${_t('破墙')}</button><button id="simulationBridges">${_t('断桥')}</button><button id="simulationBuildings">${_t('拆建筑')}</button><button id="simulationChronoBuildings">${_t('消除建筑')}</button><button id="simulationUnits">${_t('删单位')}</button>
   </div>
   <div class="simulation-tools simulation-primary">
    <select id="simulationTool" aria-labelledby="simulationPlaceTab"><option value="place">${_t('放置')}</option><option value="normal">${_t('摧毁(留废墟)')}</option><option value="chrono">${_t('消除(无废墟)')}</option><option value="magnet">${_t('磁电抹除')}</option><option value="restore">${_t('恢复')}</option></select>
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
  const drawingMethods=[['brush','◇ '+_t('画笔')+' [Q]'],['box','▭ '+_t('长方形框选')+' [W]'],['box-game','▱ '+_t('平行四边形框选')+' [E]'],['line','╱ '+_t('直线')+' [R]']];
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
  const lifecycle=root.CrateSimulationSession.create();
  let active=false,ignoreLand=false,hover=null,stroke=null,pendingCache=null;
  let rendered=new Set(),art=new Map(),artNotice='',sceneUnits=null,artRevision=0,pendingForeground=null;
  let styleStamp='[]',styleFrame=0,styleRevision=0;
  function colorAt(type,x,y,index=getRegionMembership?.()){
   const choice=lifecycle.model?.choice(type);if(!['E2','MTNK','HYD','YHVR'].includes(type)&&choice?.category!=='STRUCTURES')return '';
   if(choice?.category==='STRUCTURES'){const [dx,dy]=choice.footprint.reduce((a,b)=>b[0]+b[1]<a[0]+a[1]||b[0]+b[1]===a[0]+a[1]&&b[0]<a[0]?b:a);x+=dx;y+=dy;}
   return index?.get(root.CrateRegionStatistics.key({x,y}))?.[0]?.color.slice(1).toLowerCase()||'';
  }
  function styledPlan(){
   const plan=lifecycle.model.plan,index=getRegionMembership?.();
   for(const o of plan.placements){
    const color=colorAt(o.type,o.x,o.y,index);
    if(color)o.regionColor=color;
   }
   return plan;
  }
  const styleKey=plan=>JSON.stringify(plan.placements.filter(o=>o.regionColor).map(o=>[o.id,o.regionColor]));
  function refreshColors(){
   if(!lifecycle.model||!lifecycle.consider)return;
   clearTimeout(styleFrame);
   const expected=lifecycle.epoch;
   styleFrame=setTimeout(()=>{
    styleFrame=0;
    if(expected!==lifecycle.epoch||!lifecycle.model||!lifecycle.consider||lifecycle.model.source.sourceSha256!==getState().data?.metadata.sourceSha256)return;
    if(lifecycle.waiting||stroke){refreshColors();return;}
    const plan=styledPlan(),stamp=styleKey(plan);
    if(stamp!==styleStamp){styleStamp=stamp;visuals.update(lifecycle.model,lifecycle.sourceUrl,'color-'+(++styleRevision),true,plan,true);}
   },100);
  }
  let dirtyRevision=-1,dirtyData=null,dirtyCells=new Set();
  const visuals=root.CrateSimulationVisual.create({getState,getArea,schedule,
   onPaint:plan=>{rendered=new Set(plan.placements.map(p=>p.id));refreshColors();},
   onAppearancePending:value=>{getState().regionRecolorPending=value;syncActivity();},
   onProgress:progress=>{getState().liveArtworkProgress=progress;syncActivity();}
  });
  let modifiers={ctrl:false,alt:false,shift:false},pointerClient=null,lastPlacement=null,pickerPress=null;
  const rangeTemporary=()=>modifiers.alt?'restore':modifiers.shift?'chrono':null;
  const temporary=()=>modifiers.ctrl&&!getState().ctrlResizing?'eyedropper':rangeTemporary(),effectiveTool=()=>temporary()||$('simulationTool').value;
  const selectedMethod=()=>$($('simulationTool').value==='place'?'simulationPlaceShape':'simulationPaintMethod').value;
  const drawingMethod=()=>temporary()?'brush':selectedMethod();
  // Ctrl starts as an eyedropper, but must not make an underlying box tool
  // eligible for sizing. Shift/Alt really do use a temporary brush.
  const sizeMethod=()=>modifiers.alt||modifiers.shift?'brush':selectedMethod();
  const isBox=method=>method==='box'||method==='box-game';
  const tooltip=document.createElement('div');tooltip.id='simulationCursorMode';tooltip.className='simulation-cursor-mode';tooltip.hidden=true;document.body.append(tooltip);
  const tooltipMain=document.createElement('div');tooltipMain.className='cursor-main';tooltip.append(tooltipMain);
  const tooltipLabel=document.createElement('span');tooltipLabel.className='cursor-mode-label';
  const selectionIcon=document.createElement('span');selectionIcon.className='cursor-selection-icon';selectionIcon.hidden=true;selectionIcon.setAttribute('aria-hidden','true');selectionIcon.innerHTML='<svg viewBox="0 0 32 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';tooltipMain.append(selectionIcon,tooltipLabel);
  const regionPreview=document.createElement('span');regionPreview.className='simulation-sample-region';regionPreview.hidden=true;
  const regionSwatch=document.createElement('i'),regionName=document.createElement('span');regionSwatch.className='region-swatch';regionPreview.append(regionSwatch,regionName);tooltipMain.append(regionPreview);
  let cursorIcon=null;
  const toolIcons=new Map();
  for(const tool of ['normal','chrono','magnet','restore'])root.CrateSimulationAssets.toolIcon(tool).then(value=>{
   if(!value)return;const box=document.createElement('span');box.className='simulation-choice-icon simulation-operation-icon';
   const img=document.createElement('img');img.alt='';img.src=value.image.src;box.append(img);toolIcons.set(tool,box);updateToolChoice();syncCursor();
  }).catch(()=>{});
  document.addEventListener('fullscreenchange',()=>{(document.fullscreenElement||document.body).append(tooltip,banner);syncCursor();});
  const picker=document.createElement('div');picker.className='simulation-picker';picker.innerHTML='<button type="button" id="simulationChoice" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="simulationChoices"></button><div id="simulationChoices" role="listbox" hidden></div>';$('simulationObject').after(picker);$('simulationObject').className='simulation-native-choice';$('simulationObject').tabIndex=-1;$('simulationObject').setAttribute('aria-hidden','true');
  function choiceLabel(choice){
   if(choice.rubble)return _t('油井废墟');
   const localized=lifecycle.model.source.simulationAssets?.labels?.[choice.type]?.[I?.language||'zh-CN'];
   if(choice.category!=='STRUCTURES')return localized||_msg(choice.label);
   const [prefix,...parts]=choice.label.split(' · '),name=choice.type==='NACNST'?_t('苏军基地'):localized||_msg(parts.join(' · '));
   return prefix.replace('[Water]','['+_t('水面')+']').replace('[Land]','['+_t('陆地')+']')+' · '+name;
  }
  function choose(type){if(lifecycle.model?.choice(type)?.unplaceable)type='MTNK';const choice=lifecycle.model?.choice(type);if(choice&&!Array.from($('simulationObject').options).some(o=>o.value===type)){const option=document.createElement('option');option.value=type;option.textContent=choiceLabel(choice)+' · '+type;$('simulationObject').append(option);}$('simulationObject').value=type;$('simulationTool').value='place';updateChoice();sprite(type,hover?.level||0);sync();schedule();}
  function choiceIcon(type){
   const menuType=lifecycle.model?.choice(type)?.legacy?lifecycle.model.choices.find(c=>c.tree)?.type:type;
   return $('simulationChoices').querySelector(`[data-type="${menuType}"] .simulation-choice-icon`);
  }
  function updateChoice(){const choice=lifecycle.model?.choice($('simulationObject').value),button=$('simulationChoice');if(!choice)return;button.replaceChildren();const label=document.createElement('span');label.textContent=choiceLabel(choice)+(choice.legacy?' · '+choice.type:'');button.append(label);const icon=choiceIcon(choice.type);if(icon)button.append(icon.cloneNode(true));for(const node of $('simulationChoices').children)node.setAttribute('aria-selected',String(node.dataset.type===choice.type));updateToolChoice();}
  function closeChoices(){closeToolChoices();$('simulationChoices').hidden=true;$('simulationChoice').setAttribute('aria-expanded','false');}
  $('simulationChoice').onclick=()=>{const list=$('simulationChoices');list.hidden=!list.hidden;$('simulationChoice').setAttribute('aria-expanded',String(!list.hidden));if(!list.hidden)list.querySelector('[aria-selected="true"]')?.focus();};
  document.addEventListener('pointerdown',e=>{if(!picker.contains(e.target)&&!e.target.closest?.('.simulation-tool-picker'))closeChoices();});
  picker.addEventListener('keydown',e=>{const list=$('simulationChoices'),items=[...list.children];if(e.key==='Escape'){closeChoices();$('simulationChoice').focus();e.preventDefault();}else if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();list.hidden=false;$('simulationChoice').setAttribute('aria-expanded','true');const i=items.indexOf(document.activeElement),n=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowUp'?-1:1)+items.length)%items.length;items[n]?.focus();}});
  // Keep the native value/change contract; the visible picker supports real icons.
  const toolPicker=document.createElement('div');toolPicker.className='simulation-picker simulation-tool-picker';
  toolPicker.innerHTML='<button type="button" id="simulationToolChoice" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="simulationToolOptions"><span></span><span class="simulation-tool-arrow" aria-hidden="true">⌄</span></button><div id="simulationToolOptions" role="listbox" aria-labelledby="simulationPlaceTab" hidden></div>';
  $('simulationTool').after(toolPicker);$('simulationTool').className='simulation-native-choice';$('simulationTool').tabIndex=-1;$('simulationTool').setAttribute('aria-hidden','true');
  const toolOptions=new Map(),toolIconSources=new WeakMap();
  // Reserve only the widest operation label plus icon/arrow. Keeping this
  // intrinsic width stable avoids shifting the neighbouring controls.
  const toolWidth=document.createElement('span');toolWidth.className='simulation-tool-width';toolWidth.setAttribute('aria-hidden','true');toolPicker.prepend(toolWidth);
  for(const option of $('simulationTool').options){
   const sizeLabel=document.createElement('span');sizeLabel.textContent=option.textContent;toolWidth.append(sizeLabel);
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
  async function populateChoices(){const token=lifecycle.epoch;const list=$('simulationChoices');list.replaceChildren();for(const choice of lifecycle.model.choices){const item=document.createElement('button');item.type='button';item.role='option';item.dataset.type=choice.type;item.tabIndex=-1;const text=document.createElement('span');text.textContent=choiceLabel(choice);item.append(text);item.onclick=()=>{choose(choice.type);closeChoices();$('simulationChoice').focus();};list.append(item);(async()=>{let art=await root.CrateSimulationAssets.get(lifecycle.model.source,choice,{icon:true});if(!art){sprite(choice.type,0);return;}if(lifecycle.epoch!==token)return;appendChoiceIcon(item,art,choice.type);})().catch(()=>{});}updateChoice();}
  const sampledBaselines=new WeakMap();
  const picking=()=>temporary()==='eyedropper'||!!isRegionPicker?.();
  const sizedCtrlPicker=()=>temporary()==='eyedropper'&&(active?canAdjustSize():!!hasRegionBrush?.());
  const pickerRangeVisible=()=>sizedCtrlPicker()&&!getState().ctrlPickerPreviewHidden;
  function cancelPicker(){
   const pending=pickerPress;pickerPress=null;getState().ctrlPickerPreviewHidden=false;
   if(pending&&canvas.hasPointerCapture(pending.id))canvas.releasePointerCapture(pending.id);
   syncCursor();schedule();
  }
  function visibleLayout(){
   if(lifecycle.consider)return lifecycle.model.current();
   if(!sampledBaselines.has(lifecycle.model))sampledBaselines.set(lifecycle.model,lifecycle.model.current(M().empty(lifecycle.model.source)));
   return sampledBaselines.get(lifecycle.model);
  }
  function sampledType(point,cell){
   if(!lifecycle.model||!root.CrateRegionStatistics.canSelect(cell,getState().data?.rendering)||cell.virtual)return null;
   return lifecycle.model.sample(cell.x,cell.y,{fallback:null,state:visibleLayout(),hitObject:lifecycle.consider?pickPlaced(point,cell):null});
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
   const method=drawingMethod(),box=isBox(method),line=method==='line';
   const tool=picking()?'eyedropper':active?effectiveTool():region?'region':null,shown=(tool==='eyedropper'||tool==='region'?pickerReady():previewEnabled())&&!!pointerClient&&(tool==='eyedropper'?hit(pointer(pointerClient)):!!hover)&&!!tool&&(tool!=='place'||method!=='brush');
   tooltip.hidden=!shown;
   tooltip.classList.toggle('simulation-operation-tooltip',shown&&['normal','chrono','magnet','restore'].includes(tool));
   canvas.classList.toggle('simulation-eyedropper',shown&&tool==='eyedropper');
   if(!shown)return;
   const shape=tool==='region'?region.shape:tool!=='eyedropper'&&(box||line)?method:null;selectionIcon.hidden=!shape;selectionIcon.dataset.shape=shape||'';selectionIcon.querySelector('path').setAttribute('d',shape==='line'?'M4 20L28 4':shape==='box-game'?'M3 19L10 5H29L22 19Z':'M3 5H29V19H3Z');
   const names={place:_t('放置'),normal:_t('摧毁(留废墟)'),chrono:_t('消除(无废墟)'),magnet:_t('磁电抹除'),restore:_t('恢复')};
   const selectedChoice=tool==='place'?lifecycle.model.choice($('simulationObject').value):null;
   tooltipLabel.textContent=tool==='region'?region.label:tool==='eyedropper'?_t('滴管'):names[tool]+(selectedChoice?' · '+choiceLabel(selectedChoice):'')+(box?' · '+_t(method==='box-game'?'平行四边形框选':'长方形框选'):(line?' · '+_t('直线'):'')+` · ${brushSize()}×${brushSize()}`);
   const type=tool==='eyedropper'?sampledType(pointer(pointerClient),hover):selectedChoice?.type;
   const sample=tool==='eyedropper'&&!type?sampleRegion?.(hover):region?.region;
   regionPreview.hidden=!sample;
   tooltip.dataset.sample=type?'object':sample?'region':'';
   if(sample){regionPreview.dataset.region=sample.id;regionName.textContent=tool==='region'&&!sample.empty?'':sample.name;regionSwatch.style.backgroundColor=sample.color;regionSwatch.classList.toggle('empty-region',sample.empty);}
   else{regionName.textContent='';delete regionPreview.dataset.region;}
   const hint=region?.hint||(!['region','eyedropper'].includes(tool)&&box?_t('拖动框选，松开应用；右键取消'):'');let instructions=tooltip.querySelector('.cursor-instructions');
   if(hint&&!instructions){instructions=document.createElement('small');instructions.className='cursor-instructions';tooltip.append(instructions);}
   if(instructions){instructions.hidden=!hint;instructions.textContent=hint;}
   const icon=type?choiceIcon(type):toolIcons.get(tool);
   if(icon!==cursorIcon){
    tooltip.querySelector('.simulation-choice-icon')?.remove();
    if(icon)tooltipMain.append(icon.cloneNode(true));
    cursorIcon=icon;
   }
   const x=pointerClient.clientX+28,y=pointerClient.clientY+20;
   tooltip.style.left=Math.max(4,Math.min(x,innerWidth-tooltip.offsetWidth-10))+'px';
   tooltip.style.top=Math.max(4,Math.min(y,innerHeight-tooltip.offsetHeight-10))+'px';
  }
  function updateModifiers(e){const next={ctrl:!!e.ctrlKey,alt:!!e.altKey,shift:!!e.shiftKey};if(JSON.stringify(next)!==JSON.stringify(modifiers)){if(stroke)finishStroke();modifiers=next;if(!next.ctrl&&(pickerPress||getState().ctrlPickerPreviewHidden))cancelPicker();syncSizeControls();syncCursor();schedule();}}
  const status=document.createElement('span');status.id='simulationProgress';status.setAttribute('role','status');$('simulationStatus').append(status);
  const setStatus=text=>{if(status.textContent!==text)status.textContent=text;status.title=text;};
  const spinner=document.createElement('div');spinner.id='mapBusy';spinner.className='map-busy';spinner.hidden=true;spinner.setAttribute('role','status');spinner.innerHTML='<span class="map-busy-ring" aria-hidden="true"></span><span class="map-busy-description"></span>';$('canvasHost').append(spinner);
  const busyDescription=spinner.lastElementChild;
  const publication=root.CrateSimulationPublication.create({
   session:lifecycle,getState,getArea,loadResult,applyProbability,visuals,getPlan:styledPlan,isDrawing:()=>!!stroke,
   sync,syncActivity,schedule,message,setStatus,setBusy,beforeRecompute:finishStroke,
   onPrepared(model){$('simulationObject').replaceChildren(...model.choices.map(c=>{const o=document.createElement('option');o.value=c.type;o.textContent=choiceLabel(c);return o;}));populateChoices();sprite($('simulationObject').value,0);},
   onCommitted:plan=>{rendered=new Set(plan.placements.map(p=>p.id));},
   onForced(){artNotice='';for(const [key,value]of art)if(!value.value)art.delete(key);},
   onEdited:plan=>{styleStamp=styleKey(plan);},onLayoutSwitch:()=>{hover=null;},onRestored:refreshColors
  });
  const {ensure,queue,compute,changed,getSources}=publication;
  const cacheKey=()=>`crate-simulation-v1:${lifecycle.identity}`,pending=()=>lifecycle.pending;
  const liveReady=()=>lifecycle.liveReady;
  // A completed live image/probability pair is usable in every viewing mode.
  // Only an explicit data export needs the additional persisted full report.
  const deferReport=()=>liveReady();
  const waiting=()=>lifecycle.waiting;
  const probabilityPending=()=>lifecycle.probabilityPending;
  const supported=root.CrateSimulationSession.supported;
  function syncActivity(){
   const s=getState(),artProgress=s.liveArtworkProgress;
   let description='';
   if(s.busy)description=_msg(s.activityText)||_t('正在加载或分析地图…');
   else if(lifecycle.loading)description=_t('正在准备模拟编辑…');
   else if(root.CrateResourceUI?.loading)description=_t('正在检查地图资源…');
   else if(waiting()){
    if(artProgress?.revision===lifecycle.revision&&artProgress.done<artProgress.total){
     description=_t`正在更新地图… ${Math.round(artProgress.done/artProgress.total*100)}%`;
    }else if(lifecycle.running?.revision===lifecycle.revision&&lifecycle.running.message)description=lifecycle.running.message;
    else if(probabilityPending())description=_t('正在更新概率…');
    else if(lifecycle.live?.painted===lifecycle.revision)description=_t('正在完成更新…');
    else description=_t('正在更新地图画面…');
    if(lifecycle.operation?.revision===lifecycle.revision)description=lifecycle.operation.label+' · '+description;
   }
   if(!description&&s.regionPending)description=_t('正在更新区域统计…');
   if(!description&&s.regionRecolorPending)description=_t('正在更新单位阵营色…');
   if(!description&&s.buffExpectationPending)description=_t(s.buffExpectationComputing?'正在计算 Buff期望…':'正在绘制 Buff期望图层…');
   if(!description&&s.unitBuffPending)description=_t('正在更新 Buff期望…');
   if(busyDescription.textContent!==description)busyDescription.textContent=description;
   spinner.hidden=!description;spinner.title=description;
   $('canvasHost').setAttribute('aria-busy',String(!!description));
  }
  function sync(){const s=getState(),busy=s.busy||lifecycle.loading,available=supported(s.data?.metadata),reason=busy?_t('正在加载地图，请稍候。'):!s.data?_t('请先加载地图。'):!available?_t('当前结果没有可编辑布局，请重新分析地图。'):_t('模拟放置');
   $('unitBuffRadius').disabled=busy||!s.data||!!s.data.metadata.previewOnly;
   $('simulationConsider').title=reason;$('simulationConsider').setAttribute('aria-busy',String(busy));$('simulationConsider').disabled=!available||busy;
   $('simulationConsider').textContent=_t('模拟放置结果:')+(lifecycle.consider?_t('开'):_t('关'));$('simulationConsider').setAttribute('aria-pressed',String(lifecycle.consider));$('simulationPlaceTab').setAttribute('aria-pressed',String(s.editMode==='place'));$('simulationCount').textContent=_t`${lifecycle.model?.count||0} 格修改`;
   for(const control of panel.querySelectorAll('button,select,input[type=number]')){control.disabled=busy||!lifecycle.model;control.title=busy?_t('正在加载地图，请稍候。'):!lifecycle.model?_t('请先启用模拟放置。'):'';}
   $('simulationPlaceTab').disabled=!available||busy;$('simulationPlaceTab').title=reason;$('simulationPlaceTab').setAttribute('aria-busy',String(busy));
   if(artNotice&&!busy)$('simulationChoice').title=artNotice;
   if(editHistory){editHistory.refresh();const h=editHistory.status;$('simulationUndo').disabled=!h.canUndo;$('simulationRedo').disabled=!h.canRedo;}
   else{$('simulationUndo').disabled=busy||!!stroke||!lifecycle.model?.canUndo;$('simulationRedo').disabled=busy||!!stroke||!lifecycle.model?.canRedo;}
   if(editHistory){const h=editHistory.status;$('simulationUndo').title=h.undoLabel?_t('撤销')+' · '+h.undoLabel:_t('没有可以撤销的修改');$('simulationRedo').title=h.redoLabel?_t('重做')+' · '+h.redoLabel:_t('没有可以重做的修改');}
   else if(!busy){$('simulationUndo').title=lifecycle.model?.canUndo?_t('撤销上一笔修改'):_t('没有可以撤销的修改');$('simulationRedo').title=lifecycle.model?.canRedo?_t('重做上一笔撤销'):_t('没有可以重做的修改');}
   updateToolChoice();if(busy||!lifecycle.model)closeToolChoices();
   const place=$('simulationTool').value==='place';$('simulationObjectLabel').hidden=!place;$('simulationPaintMethodLabel').hidden=place;
   $('simulationPlaceShapeLabel').hidden=!place;$('simulationPlaceSizeLabel').firstElementChild.textContent=place?_t('尺寸（对象） '):_t('尺寸（格） ');
   syncSizeControls();
   $('simulationIgnoreLand').textContent=_t('忽略建筑海陆:')+(ignoreLand?_t('开'):_t('关'));$('simulationIgnoreLand').setAttribute('aria-pressed',String(ignoreLand));$('simulationRestoreCache').disabled=busy;
   $('simulationHint').textContent=!lifecycle.consider?_t('当前显示默认地图；开启“模拟放置结果”后继续编辑。'):_t('Q 画笔 · W 长方形 · E 平行四边形 · R 直线 · Shift 消除 · Alt 恢复');
   $('simulationHint').title=$('simulationHint').textContent;
   const text=pending()&&lifecycle.failed?_t('更新失败，请重新计算。'):'';
   setStatus(text);syncCursor();
   syncActivity();
   if(probabilityPending()&&lifecycle.model){if(dirtyRevision!==lifecycle.revision||dirtyData!==s.data){dirtyCells=lifecycle.model.changesSince(s.data?.metadata.simulationPlan,styledPlan());dirtyRevision=lifecycle.revision;dirtyData=s.data;}}else{dirtyCells=new Set();dirtyRevision=-1;dirtyData=null;}
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
  function save(){try{if(lifecycle.model?.count)localStorage.setItem(cacheKey(),JSON.stringify(lifecycle.model.plan));else localStorage.removeItem(cacheKey());}catch{message(_t('编辑已应用，但浏览器存储空间不足，未能缓存。请导出增量方案。'),true);}}
  function sprite(type,level=0,frame=0,color=''){const key=type+':'+level+':'+frame+':'+color;if(art.has(key))return art.get(key).value;const expected=lifecycle.epoch,cache=art,choice=lifecycle.model?.choice(type);if(!choice)return;const entry={value:null};cache.set(key,entry);
   (async()=>{
    let value=color?null:await root.CrateSimulationAssets.get(lifecycle.model.source,choice,{frame});
    if(!value&&root.CrateLiveObjects?.preview)value=await root.CrateLiveObjects.preview(lifecycle.model.source,choice,level,color);
    else if(!value){const data=await CrateLocalAPI.json('/api/maps/simulation-art?'+new URLSearchParams({result:lifecycle.sourceUrl,type,level,color})),image=new Image();image.src=data.image;await image.decode();value={...data,image};}
    if(lifecycle.epoch===expected){
     entry.value=value;artRevision++;
     const option=$('simulationChoices').querySelector('[data-type="'+type+'"]');
     if(!color&&option&&!option.querySelector('img'))appendChoiceIcon(option,value,type);
     schedule();
    }
   })().catch(e=>{if(lifecycle.epoch===expected){artNotice=_t('预览素材暂不可用：')+_msg(e.message);sync();}});
   // Preserve failures as well, so an unavailable sprite cannot trigger one
   // request every animation frame. A new map/explicit retry resets this cache.
   while(cache.size>128)cache.delete(cache.keys().next().value);return null;
  }
  const sceneEnabled=()=>!getState().sceneMode||getState().sceneMode==='all';
  function blockedReasons(){
   const s=getState(),reasons=[];
   if(s.busy||lifecycle.loading)reasons.push(_t('正在加载地图，请稍候。'));
   if(!s.data)reasons.push(_t('请先加载地图。'));
   else if(!supported(s.data.metadata))reasons.push(_t('当前结果没有可编辑布局，请重新分析地图。'));
   if(!lifecycle.consider)reasons.push(_t('编辑需要打开“模拟放置结果”'));
   if(!sceneEnabled())reasons.push(_t('编辑需要将“场景”设为“开”'));
   if(stroke)reasons.push(_t('请先结束当前绘制。'));
   return reasons;
  }
  async function action(fn,label=null,remember=true){const reasons=blockedReasons();if(reasons.length){onBlocked?.(reasons);return false;}try{await ensure();if(!fn(lifecycle.model))return false;if(remember)editHistory?.record('simulation',label||_t('导入方案'));changed(label);save();queue();return true;}catch(error){message(error.message,true);sync();schedule();return false;}}
  async function load(prepared,keepSimulation=false){const m=prepared.data.metadata,next=m.sourceSha256+':'+m.version;if(next===lifecycle.identity&&keepSimulation){visuals.reset(m.simulationPlan);rendered=new Set((m.simulationPlan?.placements||[]).map(p=>p.id));history.replaceState(null,'','maps.html?result='+encodeURIComponent(lifecycle.sourceUrl));return;}publication.resetMap(prepared);sceneUnits=null;pendingForeground=null;art=new Map();artNotice='';rendered=new Set();stroke=null;hover=null;modifiers={ctrl:false,alt:false,shift:false};pointerClient=null;closeChoices();active=false;pendingCache=null;lastPlacement=null;banner.hidden=true;styleStamp='[]';
   try{const cached=localStorage.getItem(cacheKey());if(cached){pendingCache=JSON.parse(cached);$('simulationCacheText').textContent=_t('发现已保存的编辑，是否恢复？');banner.hidden=false;}}catch{message(_t('这张地图的编辑缓存无法读取，可重新导入增量方案。'),true);}sync();
   if(supported(m)){
    const expected=lifecycle.epoch;
    // Prepare choices and the edit model without changing the selected mode or
    // applying a saved plan. ensure() shares the same in-flight preparation.
    ensure().then(()=>{if(lifecycle.epoch===expected)schedule();}).catch(error=>{if(lifecycle.epoch===expected&&error.name!=='AbortError'){message(error.message,true);schedule();}});
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
  $('simulationConsider').onclick=async()=>{if(getState().busy||lifecycle.loading)return;finishStroke();await publication.toggleConsider();};
  $('simulationTool').onchange=()=>{hover=null;sync();schedule();};$('simulationObject').onchange=()=>{updateChoice();sprite($('simulationObject').value,hover?.level||0);schedule();};
  for(const id of ['simulationShape','simulationPlaceShape','simulationPaintMethod'])$(id).onchange=()=>{finishStroke();sync();schedule();};
  $('simulationIgnoreLand').onclick=()=>{ignoreLand=!ignoreLand;sync();schedule();};
  root.CrateDisplayModes?.reverseToggle($('simulationIgnoreLand'));
  if(editHistory){
   editHistory.register('simulation',{limit:100,prepare:()=>finishStroke(),ready:()=>!!lifecycle.model&&!getState().busy&&!lifecycle.loading&&lifecycle.consider&&sceneEnabled(),
    clearRedo:()=>lifecycle.model?.clearRedo(),undo:()=>action(m=>m.undo(),_t('撤销'),false),redo:()=>action(m=>m.redo(),_t('重做'),false)});
  }
  $('simulationUndo').onclick=()=>editHistory?editHistory.undo():action(m=>m.undo(),_t('撤销'),false);$('simulationRedo').onclick=()=>editHistory?editHistory.redo():action(m=>m.redo(),_t('重做'),false);
  for(const [id,name,mode] of [
   ['simulationMine','mine','normal'],['simulationTrees','trees','normal'],['simulationWalls','walls','normal'],['simulationBridges','bridges','normal'],
   ['simulationBuildings','buildings','normal'],['simulationChronoBuildings','buildings','chrono'],
   ['simulationUnits','units','delete']
  ])$(id).onclick=()=>action(m=>m.quick(name,mode),$(id).textContent);
  $('simulationReset').onclick=()=>action(m=>m.reset(),$('simulationReset').textContent);
  $('simulationImport').onclick=()=>$('simulationImportFile').click();$('simulationImportFile').onchange=async()=>{const file=$('simulationImportFile').files[0];if(!file)return;try{if(file.size>8*1024*1024)throw Error(_t('增量方案不能超过 8 MB'));const plan=JSON.parse(await file.text());await action(m=>m.import(plan));}catch(e){message(e.message,true);}finally{$('simulationImportFile').value='';}};
  $('simulationExport').onclick=()=>{if(!lifecycle.model)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lifecycle.model.plan,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=(getState().data.metadata.filename||'map').replace(/\.[^.]+$/,'')+'.simulation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  $('simulationRestoreCache').onclick=async()=>{if(!pendingCache)return;await action(m=>m.import(pendingCache));if(lifecycle.model?.count){banner.hidden=true;pendingCache=null;activateMode?.();sync();}};
  $('simulationDismissCache').onclick=()=>{banner.hidden=true;pendingCache=null;};
  document.addEventListener('click',async e=>{
   const control=e.target.closest?.('.exports a');
   if(!control)return;
   if(waiting()){e.preventDefault();e.stopImmediatePropagation();return;}
   if(!deferReport()||lifecycle.failed)return;
   e.preventDefault();e.stopImmediatePropagation();
   const expected=lifecycle.epoch,target=lifecycle.revision;
   await compute(false,true);
   if(lifecycle.epoch===expected&&lifecycle.revision===target&&lifecycle.applied===target&&lifecycle.consider&&!lifecycle.failed)control.click();
  },true);
  document.addEventListener('keydown',e=>{if(editHistory||!active||!lifecycle.consider||getState().busy||e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();finishStroke();const redo=e.key.toLowerCase()==='y'||e.shiftKey;action(m=>redo?m.redo():m.undo(),redo?_t('重做'):_t('撤销'),false);}});
  const canvas=$('map'),enabled=()=>active&&lifecycle.consider&&sceneEnabled()&&lifecycle.model&&!getState().busy&&!lifecycle.loading;
  const pickerReady=()=>lifecycle.model&&!getState().busy&&!lifecycle.loading&&!getState().data?.metadata.previewOnly;
  const previewEnabled=()=>active&&pickerReady();
  function shortcut(key){
   if(!active||!['q','w','e','r'].includes(key))return false;finishStroke();
   $('simulationPlaceShape').value=$('simulationPaintMethod').value={q:'brush',w:'box',e:'box-game',r:'line'}[key];sync();schedule();return true;
  }
  function adjustSize(delta){
   if(!canAdjustSize())return false;finishStroke();$('simulationPlaceSize').value=Math.max(1,Math.min(15,brushSize()+delta));syncCursor();schedule();return true;
  }
  function canAdjustSize(){return !!(active&&lifecycle.model&&!isBox(sizeMethod()));}
  function syncSizeControls(){
   const valid=!isBox(sizeMethod()),busy=getState().busy||lifecycle.loading;
   $('simulationPlaceSizeLabel').hidden=!valid;$('simulationPlaceSizeLabel').parentElement.dataset.resizable=String(valid);
   $('simulationPlaceSize').disabled=busy||!lifecycle.model||!valid;
   $('simulationShapeLabel').hidden=$('simulationTool').value==='place'||!valid;$('simulationShape').disabled=busy||!lifecycle.model||!valid;
  }
  function areaFor(cell,ignoreCtrl=false){return lifecycle.model.brush(cell.x,cell.y,stroke?.size||brushSize(),stroke?.shape||((ignoreCtrl?rangeTemporary():temporary())?'square':$('simulationShape').value));}
  function placementSettings(start){
   const type=$('simulationObject').value,choice=lifecycle.model.choice(type);
   if(!choice)return null;
   const method=$('simulationPlaceShape').value;
   return {
    type,start,ignoreLand,size:brushSize(),method,deferred:method!=='brush',
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
  function worldPoint(point){const s=getState();return {x:(point.x-s.x)/s.scale,y:(point.y-s.y)/s.scale};}
  function boxCells(start,end){
   const s=getState(),left=Math.min(start.x,end.x)-1e-6,top=Math.min(start.y,end.y)-1e-6,right=Math.max(start.x,end.x)+1e-6,bottom=Math.max(start.y,end.y)+1e-6;
   const candidates=s.spatialIndex?.query(left,top,right,bottom)||s.cells.filter(c=>c.px>=left&&c.px<=right&&c.py>=top&&c.py<=bottom);
   return candidates.filter(c=>lifecycle.model.baseline.has(`${c.x},${c.y}`));
  }
  const gameBoxIndices=new WeakMap();
  function selectionCells(settings){
   if(settings.method!=='box-game'){const cells=boxCells(settings.boxStart,settings.boxEnd),last=settings.boxCell;return cells.length?cells:last&&lifecycle.model.baseline.has(`${last.x},${last.y}`)?[last]:[];}
   let index=gameBoxIndices.get(lifecycle.model);if(!index){index=root.CrateRegionStatistics.createSelectionIndex(getState().cells);gameBoxIndices.set(lifecycle.model,index);}
   return index.selectedCells('box-game',{game:settings.start},{game:settings.boxLast||settings.start});
  }
  function* placementTargets(settings,first,last,seen=new Set()){
   if(isBox(settings.method)){
    if(!settings.boxStart){yield settings.start;return;}
    const choice=lifecycle.model.choice(settings.type),s=getState(),r=s.data.rendering,project=(x,y)=>{const c=s.lookup.get(`${x},${y}`);return c?{x:c.px,y:c.py}:{x:30*(x-y)+r.origin[0],y:15*(x+y-(settings.start.level||0))+r.origin[1]};};
    for(const c of root.CrateSimulationPlacement.boxTargets(settings,selectionCells(settings),{footprint:choice.footprint,building:choice.category==='STRUCTURES'||!!choice.rubble,project})){const p=`${c.x},${c.y}`;if(!seen.has(p)){seen.add(p);yield c;}}
    return;
   }
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
    if(lifecycle.model.appendPlacement(settings.type,x,y,settings)){lastPlacement={x,y};added=true;}
   }
   if(added)onInteraction?.(lastPlacement);return added;
  }
  function addStroke(cell,point){
   if(isBox(stroke.method)){
    stroke.boxEnd=worldPoint(point);stroke.last=cell||stroke.last;
    stroke.boxCell=cell;
    if(cell)stroke.boxLast=cell;else{const r=getState().data.rendering,u=(stroke.boxEnd.x-r.origin[0])/30,v=(stroke.boxEnd.y-r.origin[1])/15+(stroke.start.level||0);stroke.boxLast={x:Math.round((u+v)/2),y:Math.round((v-u)/2)};}
    if(stroke.tool!=='place')stroke.area=new Set(selectionCells(stroke).map(c=>`${c.x},${c.y}`));
    return;
   }
   if(stroke.tool==='place'){
    const end=placementGridPoint(stroke,cell);
    if(!stroke.deferred&&appendPlacements(stroke,stroke.last||end,end))changed();
    stroke.last=end;
    return;
   }
   if(stroke.last?.x===cell.x&&stroke.last?.y===cell.y)return;
   const fresh=[];
   if(stroke.deferred)stroke.area.clear();
   for(const center of gridLine(stroke.deferred?stroke.start:stroke.last||cell,cell)){
    for(const position of areaFor(center)){
     if(stroke.area.has(position))continue;
     stroke.area.add(position);
     if(!stroke.deferred)fresh.push(position);
    }
   }
   stroke.last=cell;
   if(!stroke.deferred&&fresh.length&&lifecycle.model.paint(fresh,stroke.tool)){onInteraction?.(cell);changed();}
  }
  function finishStroke(commitLine=false){
   if(!stroke)return;
   const done=stroke;
   if(done.deferred&&commitLine&&enabled()){
    if(done.tool==='place'){
     lifecycle.model.beginPlacement();
     if(appendPlacements(done,{x:0,y:0},done.last))changed();
    }else{
     lifecycle.model.beginPaint(done.tool);
     if(done.area.size&&lifecycle.model.paint(done.area,done.tool)){onInteraction?.(done.last);changed();}
    }
   }
   stroke=null;
   if(canvas.hasPointerCapture(done.id))canvas.releasePointerCapture(done.id);
   const edited=done.tool==='place'?lifecycle.model.endPlacement():lifecycle.model.endPaint();
   if(edited){const label=done.tool==='place'?_t('放置')+' · '+choiceLabel(lifecycle.model.choice(done.type)):_t({normal:'摧毁(留废墟)',chrono:'消除(无废墟)',magnet:'磁电抹除',restore:'恢复'}[done.tool]);editHistory?.record('simulation',label);save();}
   queue();
   sync();
   schedule();
   onInteractionEnd?.();
  }
  function consume(e){e.preventDefault();e.stopImmediatePropagation();}
  canvas.addEventListener('pointerdown',e=>{
   if(e.button===2&&temporary()==='eyedropper'&&(pickerPress||getState().ctrlPickerPreviewHidden)){consume(e);cancelPicker();return;}
   if(stroke?.deferred&&e.button===2){consume(e);finishStroke();return;}
   if(e.button!==0||stroke||pickerPress)return;
   updateModifiers(e);
   if(!enabled()&&!(pickerReady()&&picking()))return;
   pointerClient={clientX:e.clientX,clientY:e.clientY};
   const p=pointer(e),inside=hit(p),cell=inside?pick(p):null;
   const tool=picking()?'eyedropper':effectiveTool();
   if(!inside||!cell&&tool!=='eyedropper')return;
   const settings=tool==='place'?placementSettings(cell):null;
   if(tool==='place'&&!settings)return;
   consume(e);
   hover=cell;
   if(tool==='eyedropper'){
    if(sizedCtrlPicker()){
     pickerPress={id:e.pointerId,point:p,cell,clientX:e.clientX,clientY:e.clientY,moved:false};getState().ctrlPickerPreviewHidden=true;
     canvas.setPointerCapture(e.pointerId);syncCursor();schedule();
    }else takeSample(p,cell);
    return;
   }
   lifecycle.cancelTimer();
   stroke={id:e.pointerId,tool,last:null};
   if(tool==='place'){
    Object.assign(stroke,settings,{visited:new Set(),boxStart:worldPoint(p),boxEnd:worldPoint(p)});
    if(!stroke.deferred)lifecycle.model.beginPlacement();
   }else{
    Object.assign(stroke,{start:cell,size:brushSize(),
     shape:temporary()?'square':$('simulationShape').value,method:drawingMethod(),deferred:drawingMethod()!=='brush',boxStart:worldPoint(p),boxEnd:worldPoint(p),area:new Set()});
    if(!stroke.deferred)lifecycle.model.beginPaint(tool);
   }
   addStroke(cell,p);
   canvas.setPointerCapture(e.pointerId);
   sync();
   schedule();
  },true);
  canvas.addEventListener('pointermove',e=>{
   // A second mouse button changes buttons on pointermove; it does not emit
   // another pointerdown while the first button is still held.
   if((e.buttons&2)&&temporary()==='eyedropper'&&(pickerPress||getState().ctrlPickerPreviewHidden)){consume(e);cancelPicker();return;}
   if(pickerPress?.id===e.pointerId&&Math.hypot(e.clientX-pickerPress.clientX,e.clientY-pickerPress.clientY)>4)pickerPress.moved=true;
   if(stroke&&stroke.id!==e.pointerId)return;
   if(stroke?.deferred&&(e.buttons&2)){consume(e);finishStroke();return;}
   updateModifiers(e);
   pointerClient={clientX:e.clientX,clientY:e.clientY};
   const p=pointer(e),cell=hit(p)?pick(p):null;
   const moved=hover?.x!==cell?.x||hover?.y!==cell?.y;
   hover=cell;
   if(stroke){consume(e);if(cell||isBox(stroke.method))addStroke(cell,p);}
   syncCursor();
   if((previewEnabled()||pickerReady()&&picking())&&(moved||stroke?.deferred))schedule();
  },true);
  canvas.addEventListener('pointerup',e=>{
   if(pickerPress?.id===e.pointerId){
    consume(e);const pending=pickerPress;pickerPress=null;
    if(canvas.hasPointerCapture(pending.id))canvas.releasePointerCapture(pending.id);
    if(e.button===0&&!(e.buttons&2)&&!pending.moved&&temporary()==='eyedropper')takeSample(pending.point,pending.cell);
    else getState().ctrlPickerPreviewHidden=false;
    syncCursor();schedule();return;
   }
   if(!stroke||stroke.id!==e.pointerId)return;
   consume(e);
   const commitLine=stroke.deferred&&e.button===0&&!(e.buttons&2);
   if(commitLine){
    const p=pointer(e),cell=hit(p)?pick(p):null;
    if(cell||isBox(stroke.method))addStroke(cell,p);
   }
   finishStroke(commitLine);
  },true);
  canvas.addEventListener('contextmenu',e=>{if(stroke?.deferred){consume(e);finishStroke();}},true);
  canvas.addEventListener('dblclick',e=>{if(enabled()||pickerReady()&&picking()){e.preventDefault();e.stopImmediatePropagation();}},true);
  const cancel=()=>{finishStroke();hover=null;pointerClient=null;modifiers={ctrl:false,alt:false,shift:false};cancelPicker();syncCursor();schedule();};canvas.addEventListener('pointercancel',cancel,true);canvas.addEventListener('lostpointercapture',()=>{if(stroke||pickerPress)cancel();},true);canvas.addEventListener('pointerleave',()=>{if(!stroke&&!pickerPress){hover=null;pointerClient=null;syncCursor();schedule();}});window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});window.addEventListener('pagehide',()=>{finishStroke();if(lifecycle.model)save();});
  const masks=new WeakMap(),pickOrder=new WeakMap();
  function placedInPickOrder(objects){
   const previous=pickOrder.get(objects);
   if(previous?.length===objects.length)return previous.ordered;
   const depth=o=>o.x+o.y+(o.category==='STRUCTURES'?Math.max(...o.footprint.map(p=>p[0]+p[1]))+.6:o.category==='OVERLAY'?.2:o.category==='TERRAIN'?.3:.6);
   const ordered=objects.filter(o=>o.placed).sort((a,b)=>(lifecycle.model.sampleObject(b)?.priority||0)-(lifecycle.model.sampleObject(a)?.priority||0)||depth(b)-depth(a)||b.x-a.x);
   pickOrder.set(objects,{length:objects.length,ordered});
   return ordered;
  }
  function pickPlaced(point,cell){const s=getState(),state=lifecycle.model.current(),ordered=placedInPickOrder(state.objects);
   for(const o of $('objects').checked?ordered:[]){const c=s.lookup.get(o.x+','+o.y);if(!c)continue;const frame=o.category==='OVERLAY'?state.cells.get(o.x+','+o.y).overlayData:0,v=sprite(o.type,c.level,frame);if(!v)continue;const [dx,dy]=spriteOffset(o);const x=Math.floor((point.x-s.x)/s.scale-c.px-v.x-dx),y=Math.floor((point.y-s.y)/s.scale-c.py-v.y-dy);if(x<0||y<0||x>=v.image.width||y>=v.image.height)continue;let alpha=masks.get(v.image);if(!alpha){const canvas=document.createElement('canvas');canvas.width=v.image.width;canvas.height=v.image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(v.image,0,0);alpha=ctx.getImageData(0,0,canvas.width,canvas.height).data;masks.set(v.image,alpha);}if(alpha[(y*v.image.width+x)*4+3]>0)return o;}
   return ordered.find(o=>o.footprint.some(([dx,dy])=>o.x+dx===cell.x&&o.y+dy===cell.y));
  }
  function spriteOffset(item){
   const [dx,dy]=item.category==='INFANTRY'?M().infantryOffsets[item.subcell]||[0,0]:[0,0];
   return [dx,dy-(item.onBridge?60:0)];
  }
  function drawSprite(ctx,item,opacity,layout=null,s=getState()){const c=s.lookup.get(`${item.x},${item.y}`);if(!c)return;const choice=lifecycle.model.choice(item.type),frame=choice?.category==='OVERLAY'?(choice.ore?11:(layout||lifecycle.model.current()).cells.get(`${item.x},${item.y}`)?.overlayData||0):0,color=colorAt(item.type,item.x,item.y),value=sprite(item.type,c.level,frame,color)||(color?sprite(item.type,c.level,frame):null);if(!value)return;const [dx,dy]=spriteOffset(item),x=s.x+(c.px+value.x+dx)*s.scale,y=s.y+(c.py+value.y+dy)*s.scale;ctx.globalAlpha=opacity;ctx.drawImage(value.image,x,y,value.image.width*s.scale,value.image.height*s.scale);ctx.globalAlpha=1;}
  function drawScene(ctx,s,area){
   if(!lifecycle.model||!lifecycle.consider||lifecycle.failed||!$('objects').checked)return;
   if(sceneUnits?.model!==lifecycle.model||sceneUnits.revision!==lifecycle.revision){
    const items=[];lifecycle.model.eachPlacement(p=>{if(['MTNK','HYD','YHVR'].includes(p.type))items.push(p);});items.sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x);sceneUnits={model:lifecycle.model,revision:lifecycle.revision,items};
   }
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.imageSmoothingEnabled=false;
   for(const item of sceneUnits.items){const c=s.lookup.get(item.x+','+item.y);if(!c)continue;const x=s.x+c.px*s.scale,y=s.y+c.py*s.scale,margin=160*s.scale;if(x+margin<area.x||x-margin>area.x+area.w||y+margin<area.y||y-margin>area.y+area.h)continue;drawSprite(ctx,item,s.objectOpacity??1,null,s);}
   ctx.restore();
  }
  function drawPendingPlacements(ctx,s,area){
   if(!$('objects').checked){pendingForeground=null;return;}
   const density=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1;
   const stamp=[lifecycle.model,lifecycle.revision,rendered,artRevision,getRegionMembership?.(),s.x,s.y,s.scale,s.objectOpacity??1,area.x,area.y,area.w,area.h,density];
   if(!pendingForeground||stamp.some((v,i)=>v!==pendingForeground.stamp[i])){
    const previous=pendingForeground;
    let items=previous?.items;
    if(!previous||previous.stamp[0]!==stamp[0]||previous.stamp[1]!==stamp[1]||previous.stamp[2]!==stamp[2]){
     items=[];lifecycle.model.eachPlacement(p=>{if(!rendered.has(p.id))items.push(p);});
     items.sort((a,b)=>a.x+a.y-(a.category==='RUBBLE'?.4:0)-b.x-b.y+(b.category==='RUBBLE'?.4:0)||a.x-b.x);
    }
    if(!items.length){pendingForeground={stamp,items,image:null};return;}
    const image=previous?.image||document.createElement('canvas');
    image.width=Math.ceil(area.w*density);image.height=Math.ceil(area.h*density);
    const target=image.getContext('2d');target.setTransform(density,0,0,density,-area.x*density,-area.y*density);target.imageSmoothingEnabled=false;
    for(const item of items)drawSprite(target,item,s.objectOpacity??1,null,s);
    // This is only a viewport-sized transient preview, not another full-map
    // bitmap. Tile arrivals can reuse it until the displayed plan changes.
    pendingForeground={stamp,items,image};
   }
   if(pendingForeground.image)ctx.drawImage(pendingForeground.image,area.x,area.y,pendingForeground.image.width/density,pendingForeground.image.height/density);
  }
  function drawFootprint(ctx,s,cells,tool,onBridge=false){
   for(const p of cells){
    const c=s.lookup.get(`${p.x},${p.y}`);
    if(!c)continue;
    const x=s.x+c.px*s.scale,y=s.y+(c.py-(onBridge?60:0))*s.scale,rx=30*s.scale,ry=15*s.scale;
    const vertices=[[x,y-ry],[x+rx,y],[x,y+ry],[x-rx,y]];
    const color=tool==='place'?(p.allowed?'#58ed8c':'#ff606b'):tool==='restore'?'#62c5ff':tool==='magnet'?'#d989ff':'#ffb861';
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
   const end=stroke?.last||{x:0,y:0},start=settings.deferred?{x:0,y:0}:end;
   const choice=lifecycle.model.choice(settings.type),layout=visibleLayout();
   for(const {x,y} of placementTargets(settings,start,end)){
    if(!settings.deferred&&stroke?.visited.has(`${x},${y}`))continue;
    const check=lifecycle.model.placement(settings.type,x,y,{...settings,state:layout});
    drawSprite(ctx,{...choice,x,y,onBridge:check.onBridge,subcell:check.subcell},.38,layout);
    drawFootprint(ctx,s,check.cells,'place',check.onBridge);
   }
  }
  function drawSelectionBox(ctx,s){
   if(!stroke||!isBox(stroke.method))return;const a=stroke.boxStart,b=stroke.boxEnd;let points;
   if(stroke.method==='box-game'){
    const end=stroke.boxLast||stroke.start,x0=Math.min(stroke.start.x,end.x)-.5,x1=Math.max(stroke.start.x,end.x)+.5,y0=Math.min(stroke.start.y,end.y)-.5,y1=Math.max(stroke.start.y,end.y)+.5,r=s.data.rendering;
    points=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>[s.x+(30*(x-y)+r.origin[0])*s.scale,s.y+(15*(x+y-(stroke.start.level||0))+r.origin[1])*s.scale]);
   }else points=[[a.x,a.y],[b.x,a.y],[b.x,b.y],[a.x,b.y]].map(([x,y])=>[s.x+x*s.scale,s.y+y*s.scale]);
   const perimeter=points.reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[(i+1)%4][0],p[1]-points[(i+1)%4][1]),0);
   ctx.save();ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();const dash=Math.max(5,perimeter/96);ctx.setLineDash([dash,dash*.7]);ctx.strokeStyle='#050a0b';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle=stroke.tool==='restore'?'#62c5ff':stroke.tool==='magnet'?'#d989ff':'#ffd074';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  }
  function drawPicker(ctx){
   if(!hover||!lifecycle.consider)return;
   const s=getState(),area=getArea(),objects=lifecycle.model.current().objects.filter(o=>o.placed);
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   for(const o of objects){if((!s.sceneMode||s.sceneMode==='all')&&!rendered.has(o.id)&&$('objects').checked)drawSprite(ctx,o,s.objectOpacity??1);const c=s.lookup.get(o.x+','+o.y);if(c)sprite(o.type,c.level,o.category==='OVERLAY'?lifecycle.model.current().cells.get(o.x+','+o.y).overlayData:0);}
   ctx.fillStyle='rgba(105,225,255,.3)';ctx.strokeStyle='#8deeff';ctx.lineWidth=2;
   for(const o of objects)for(const[dx,dy]of o.footprint){const c=s.lookup.get(`${o.x+dx},${o.y+dy}`);if(!c)continue;const x=s.x+c.px*s.scale,y=s.y+c.py*s.scale;ctx.beginPath();ctx.moveTo(x,y-15*s.scale);ctx.lineTo(x+30*s.scale,y);ctx.lineTo(x,y+15*s.scale);ctx.lineTo(x-30*s.scale,y);ctx.closePath();ctx.fill();ctx.stroke();}
   ctx.restore();
  }
  function drawToolPreview(ctx,s,tool,method,ignoreCtrl=false){
   if(tool==='place')drawPlacementPreview(ctx,s);
   else{
    const cells=[...(stroke?.area||(isBox(method)?lifecycle.model.brush(hover.x,hover.y,1):areaFor(hover,ignoreCtrl)))].map(p=>{const [x,y]=p.split(',').map(Number);return {x,y};});
    drawFootprint(ctx,s,cells,tool);
   }
   drawSelectionBox(ctx,s);
  }
  function draw(ctx){if(!picking())syncCursor();else syncPickerLayer();
   if(pickerReady()&&picking()){
    drawPicker(ctx);
    if(active&&hover&&pickerRangeVisible()){
     const s=getState(),area=getArea();ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.imageSmoothingEnabled=false;
     drawToolPreview(ctx,s,rangeTemporary()||$('simulationTool').value,sizeMethod(),true);ctx.restore();
    }
    return;
   }
   if(!lifecycle.model||lifecycle.failed)return;const s=getState(),area=getArea();ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.imageSmoothingEnabled=false;
   // Foreground-only marks do not invalidate the expensive cached map/heatmap.
   // Off-screen changes (e.g. bulk tree removal) need no drawing work.
   if(lifecycle.consider&&probabilityPending()){
    ctx.strokeStyle='#ffd074';ctx.fillStyle='rgba(255,208,116,.12)';ctx.lineWidth=2;ctx.setLineDash([4,3]);
    for(const key of dirtyCells){const c=s.lookup.get(key);if(!c)continue;const x=s.x+c.px*s.scale,y=s.y+c.py*s.scale,rx=30*s.scale,ry=15*s.scale;if(x+rx<area.x||x-rx>area.x+area.w||y+ry<area.y||y-ry>area.y+area.h)continue;ctx.beginPath();ctx.moveTo(x,y-ry);ctx.lineTo(x+rx,y);ctx.lineTo(x,y+ry);ctx.lineTo(x-rx,y);ctx.closePath();ctx.fill();ctx.stroke();}ctx.setLineDash([]);
   }
   if(lifecycle.consider&&(!s.sceneMode||s.sceneMode==='all'))drawPendingPlacements(ctx,s,area);
   if(!previewEnabled()||!hover&&!stroke?.deferred){ctx.restore();return;}const tool=stroke?.tool||effectiveTool();
   drawToolPreview(ctx,s,tool,drawingMethod());
   ctx.restore();
  }
  for(const name of ['keydown','keyup'])document.addEventListener(name,e=>{
   if(name==='keyup'&&['Control','Alt','Shift'].includes(e.key)){updateModifiers(e);return;}
   if(e.target.closest?.('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
   if(['Control','Alt','Shift'].includes(e.key)){if(e.key==='Alt')e.preventDefault();updateModifiers(e);}
  });
  if(editHistory)editHistory.subscribe(sync);else sync();
  window.addEventListener('crate:resource-busy',sync);
  return {shortcut,adjustSize,cancelPicker,get canAdjustSize(){return canAdjustSize();},refreshCursor:syncCursor,load,sync,syncActivity,draw,drawScene,blockedReasons,open,refreshColors,getSources,prewarm:publication.prewarm,whenLayoutReady:publication.whenLayoutReady,cancelInteraction:()=>{closeChoices();cancel();},get liveReady(){return liveReady();},get pointerClient(){return pointerClient;},get lastPlacement(){return lastPlacement;},get waiting(){return waiting();},beforeLoad:()=>{cancelPicker();finishStroke();publication.beforeLoad();},loadFailed:publication.loadFailed,close:()=>{active=false;closeChoices();finishStroke();sync();},get active(){return active;},get dragging(){return !!stroke;},getSource:async()=>{await ensure();return lifecycle.model.source;},get model(){return lifecycle.model;},get considered(){return lifecycle.consider;},get pending(){return pending();},get computing(){return !!lifecycle.running;},get previewReady(){return [...art.values()].some(v=>!!v.value);},recompute:publication.recompute};
 }
 root.CrateSimulationUI={create};
})(globalThis);
