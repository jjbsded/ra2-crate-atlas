/* All displayed probabilities come from the integer backend result.
 * View state (filter, threshold, pan, zoom) never changes the probability model.
 */
(() => {
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const $=id=>document.getElementById(id), canvas=$('map'), ctx=canvas.getContext('2d');
 const platform=globalThis.CrateMapPlatform;
 const importVersion=CrateMapImportVersion.create($('version'));
 const desktopWidth=1600,desktopHeight=928,desktopArea={x:24,y:3,w:1552,h:878};
 const area={...desktopArea};let W=desktopWidth,H=desktopHeight,pixelRatio=1,compact=false;
 const occupancy=CrateOccupancyOverlay;
 const minimap=CrateMinimap;
 let selectionRevision=0,selectionKeyboard=null,badgePointerClient=null;
 const state={data:null,image:null,cells:[],lookup:new Map(),selected:null,scale:1,x:0,y:0,drag:null,baseUrl:'',busy:false,visible:0,scheduled:false,editMode:null,objectOpacity:1,coordinateSpace:null,sceneMode:'all'};
 let mapSwitchRevision=0;
 function positionMapSwitch(){const notice=$('mapSwitchNotice');if(notice.hidden)return;const w=canvas.clientWidth,h=canvas.clientHeight,k=Math.min(w/W,h/H);notice.style.left=canvas.offsetLeft+(w-W*k)/2+(area.x+area.w/2)*k+'px';notice.style.top=canvas.offsetTop+(h-H*k)/2+(area.y+area.h/2)*k+'px';}
 function beginMapSwitch(){const ticket=++mapSwitchRevision,notice=$('mapSwitchNotice');notice.querySelector('strong').textContent=_t('地图切换中');notice.hidden=false;positionMapSwitch();return()=>{if(ticket===mapSwitchRevision)notice.hidden=true;};}
 state.lastPlayer=null;
 const camera=CrateMapNavigation.create({getView:()=>state,getArea:()=>area,getBounds:()=>state.coordinateSpace?.bounds,getFitBounds:()=>state.data?frameBounds():null,onChange:()=>{navigationMotion();schedule();}});
 const readResult=CrateMapResults.createReader(platform?{readJSON:platform.readJSON,readBinary:platform.readBinary}:{upgrade:async(url,{signal})=>CrateLocalAPI.waitForMapJob(await CrateLocalAPI.json('/api/maps/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:url}),signal}),{signal,pollInterval:100,onProgress:value=>message(_t('正在加载地图…'))})}),resultLoader=CrateMapResults.createLoader(readResult);
 let simulation=null,applyingProbability=false;
 const historyNotice=CrateEditHistory.createNotices();
 const editHistory=CrateEditHistory.create({onTravel:({redo,label})=>historyNotice(_t(redo?'重做':'撤销')+' · '+label),onError:error=>message(error.message,true)});
 const dynamicTitleLabel=document.createElement('label'),dynamicTitleInput=document.createElement('input');
 dynamicTitleInput.type='checkbox';dynamicTitleInput.id='dynamicRegionTitles';dynamicTitleInput.checked=true;
 dynamicTitleLabel.append(dynamicTitleInput,' '+_t('动态区域标题'));$('autoRegionOverlay').parentElement.after(dynamicTitleLabel);
 const terrain3d=platform?.terrain3d===false?{open(){},close(){},select(){}}:CrateTerrain3D.create({loadPatch:platform?.terrain3dPatch,getContext:()=>state.selected?{cell:state.selected,data:state.data,result:state.baseUrl+'result.json',probability:state.data.metadata.previewOnly?null:{display,lookup:state.lookup,options:mapOptions(),buff:buffField,units:buffs,mode:probabilityMode}}:null,onSelect:(x,y)=>{const c=state.lookup.get(`${x},${y}`);if(c)select(c);}});
 $('terrain3dOpen').onclick=()=>terrain3d.open();
 const details=CrateMapDetails.create({onListFocus:kind=>{const input=$(kind==='connections'?'seaLandToggle':'markers');if(!input.checked){input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}}});
 const {previewLabel,failurePercent}=CrateMapDetails;
 let display;
 const miniState={position:null,minimized:false};
 const mapViewCache=CrateMapRenderer.createViewCache(undefined,schedule);let miniArtwork=null;
 let recoveryCanvas=null;
 function* warmViewport(){
  const data=state.data;if(!data)return;
  if(!recoveryCanvas){recoveryCanvas=document.createElement('canvas');recoveryCanvas.width=recoveryCanvas.height=64;}
  const target=recoveryCanvas.getContext('2d');target.setTransform(1,0,0,1,0,0);
  target.drawImage(canvas,0,0,64,64);yield;
  for(const owner of [mapViewCache,regions,buffField])if(owner.warmup){const iterator=owner.warmup(target);for(;;){if(state.data!==data){iterator.return?.();return;}const part=iterator.next();if(part.done)break;yield;}}
 }
 const interaction=window.CrateMapPriority;interaction.configure({warm:warmViewport,canWarm:()=>!!state.data&&!document.hidden&&!state.busy&&!state.drag&&!regions.dragging&&!simulation?.dragging});
 window.addEventListener('blur',e=>{if(e.target===window)interaction.leave();});
 window.addEventListener('focus',e=>{if(e.target===window&&!document.hidden)interaction.resume();});
 document.addEventListener('visibilitychange',()=>document.hidden?interaction.leave():interaction.resume());
 document.addEventListener('freeze',()=>interaction.leave());document.addEventListener('resume',()=>{if(!document.hidden)interaction.resume();});
 window.addEventListener('pageshow',()=>{if(!document.hidden)interaction.resume();});
 for(const type of ['pointerdown','wheel'])canvas.addEventListener(type,e=>{if(state.data&&minimap.contains(area,pointer(e))&&(type==='wheel'||e.button===2||e.button===0&&!state.editMode))interaction.input();},{capture:true,passive:true});
 canvas.addEventListener('pointermove',e=>{if(e.buttons)interaction.move();},{capture:true,passive:true});
 for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,()=>interaction.end(),{capture:true,passive:true});
 const navigationCanvas=document.createElement('canvas');navigationCanvas.id='mapNavigationCanvas';navigationCanvas.className='map-navigation-canvas';navigationCanvas.hidden=true;navigationCanvas.setAttribute('aria-hidden','true');$('canvasHost').append(navigationCanvas);
 const navigationContext=navigationCanvas.getContext('2d');
 let controlsKey='',navigationControlsKey='',legendCache=null;
 const layerButtons={regionColorOverlay:_t('区域图层:')};
 const layerOn=id=>id==='unitBuffOverlay'?$(id).checked:$(id).getAttribute('aria-pressed')==='true';
 const autoRegionLayer=()=>$('autoRegionOverlay').checked;
 let ctrlRegionPreview=null;
 function setLayer(id,value){
  const button=$(id);button.setAttribute('aria-pressed',String(value));button.textContent=layerButtons[id]+(value?_t('开'):_t('关'));
 }
 for(const id of Object.keys(layerButtons)){
  setLayer(id,false);$(id).onclick=()=>{setLayer(id,!layerOn(id));schedule();};
 }
 $('unitBuffOverlay').addEventListener('change',schedule);
 function applyUnitDisplay(){
  const mode=$('unitDisplay').value;$('objects').checked=mode!=='occupied';$('blocked').checked=mode.includes('occupied');state.objectOpacity=mode.startsWith('translucent')?.5:1;
  for(const id of ['objects','blocked'])$(id).dispatchEvent(new Event('change'));schedule();
 }
 $('unitDisplay').addEventListener('change',applyUnitDisplay);
 function ctrlPicker(held){
  if(held){if(ctrlRegionPreview||!state.data)return;ctrlRegionPreview={before:layerOn('regionColorOverlay'),picked:null};setLayer('regionColorOverlay',true);}
  else{if(!ctrlRegionPreview)return;const previous=ctrlRegionPreview;ctrlRegionPreview=null;if(previous.picked!=='region'&&(!previous.picked||!autoRegionLayer()))setLayer('regionColorOverlay',previous.before);}
  regions.overlayChanged();schedule();
 }
 const regionPreview=document.createElement('canvas');regionPreview.id='regionBrushPreview';regionPreview.setAttribute('aria-hidden','true');Object.assign(regionPreview.style,{position:'absolute',pointerEvents:'none',zIndex:'1'});canvas.after(regionPreview);
 const regionPreviewContext=regionPreview.getContext('2d');let regionPreviewScheduled=false;
 function scheduleRegionPreview(){if(regionPreviewScheduled)return;regionPreviewScheduled=true;requestAnimationFrame(()=>{regionPreviewScheduled=false;drawRegionPreview();});}
 function drawRegionPreview(){
  regionPreview.hidden=!regions.active||!layerOn('regionColorOverlay')||!state.data;if(regionPreview.hidden)return;
  if(regionPreview.width!==canvas.width||regionPreview.height!==canvas.height){regionPreview.width=canvas.width;regionPreview.height=canvas.height;}
  Object.assign(regionPreview.style,{left:canvas.offsetLeft+'px',top:canvas.offsetTop+'px',width:canvas.clientWidth+'px',height:canvas.clientHeight+'px',objectFit:getComputedStyle(canvas).objectFit});
  const target=regionPreviewContext;target.setTransform(pixelRatio,0,0,pixelRatio,0,0);target.clearRect(0,0,W,H);target.save();target.beginPath();target.rect(area.x,area.y,area.w,area.h);target.clip();regions.preview(target,state);target.restore();
 }
 const regions=CrateRegionStatisticsUI.create({editHistory,getState:()=>state,getDisplay:()=>display,schedule,schedulePreview:scheduleRegionPreview,pick,area,loadNavigation:platform?.regionNavigation,prepareNavigation:signal=>simulation?.whenLayoutReady(signal),
  onMode:enabled=>{if(enabled&&state.selected)deselect();},
  onAside:mode=>seaLand.setInspecting(mode==='connections'),
  showOverlay:()=>layerOn('regionColorOverlay'),
  revealMap:()=>$('canvasHost').scrollIntoView({block:'start',inline:'nearest'}),
  onRegionsChanged:()=>simulation?.refreshColors(),getBuffs:()=>buffs.statistics(),onInteraction:rememberPlayer,
  onPending:value=>{state.regionPending=value;simulation?.syncActivity();},onError:error=>message(error.message,true)
 });
 function rememberPlayer(cell,numbers){if(!cell||cell.virtual)return;const player=regions.playerAt(cell,numbers);if(player!==null&&player!==state.lastPlayer){state.lastPlayer=player;schedule();}}
 const buffs=CrateUnitBuff.create(()=>state,()=>display,()=>$('unitBuffRadius').value,regions.membership,{
  onChange:()=>{if(!applyingProbability)regions.updateBuffs();schedule();},
  onPending:value=>{state.unitBuffPending=value;$('unitBuffRadius').setAttribute('aria-busy',String(value));simulation?.syncActivity();},
  onError:error=>message(error.message,true)
 });
 const buffField=CrateBuffExpectationUI.create({getState:()=>state,getRadius:()=>$('unitBuffRadius').value,isEditing:()=>simulation?.dragging,schedule,onPending:(value,work)=>{state.buffExpectationPending=value;state.buffExpectationComputing=work?.calculating??value;simulation?.syncActivity();},onChange:()=>terrain3d.refresh?.(),onError:error=>message(error.message,true)});
 const displayTuning=CrateMapDisplayControls.create({host:document.body,onChange:settings=>{state.coordinateSpace?.configure(settings);miniArtwork=null;schedule();}});
 let probabilityMode='crate';
 const legendMaximum=()=>probabilityMode==='buff'?buffField.maximum:probabilityMode==='units'?buffs.maximum:display?.maxMultiplier||1;
 const paletteTuning=CrateMapDisplayControls.createPalette({host:document.body,visible:false,getMaximum:legendMaximum,onChange:(settings,key)=>{CrateProbability.configurePalette(settings);if(/^(cool|warm)/.test(key||''))$('palette').value=key.startsWith('cool')?'cool':'warm';schedule();}});
 const selectionTuning=CrateMapDisplayControls.create({host:document.body,visible:false,onChange:()=>schedule(),custom:{id:'selectionTuning',caption:'选中坐标提示 · 调试',defaults:CrateSelectionProbability.badgeDefaults,specs:[
  ['badgeOpacity','基础不透明度','number','%',100],['badgeNearOpacity','靠近时不透明度','number','%',100],['badgeFadeEnabled','鼠标靠近渐隐','checkbox'],['badgeFadeRadius','鼠标影响距离','number','px'],['badgeGap','距选中格间距','number','px'],['badgeAvoidance','标签避让间距','number','px']
 ]}});
 const seaLand=CrateSeaLandConnections.create({getState:()=>state,loadRules:async()=>(await simulation.getSource()).rules,schedule,onChange:value=>{details.connections(value);schedule();},onError:error=>message(error.message,true)});
 $('seaLandToggle').onchange=()=>{seaLand.setEnabled($('seaLandToggle').checked);syncSeaLand();schedule();};
 function syncSeaLand(){const input=$('seaLandToggle');input.disabled=!state.data;input.checked=seaLand.enabled;syncAsideLayers();}
 const asideLayers=[['blockedCellsOverlay','markers'],['seaLandOverlay','seaLandToggle']];
 function syncAsideLayers(){for(const [id,source]of asideLayers){$(id).checked=$(source).checked;$(id).disabled=$(source).disabled;}}
 for(const [id,source]of asideLayers){
  $(source).addEventListener('change',syncAsideLayers);
  $(id).addEventListener('change',()=>{$(source).checked=$(id).checked;$(source).dispatchEvent(new Event('change',{bubbles:true}));});
  // Both controls share one visible tab frame without nesting interactive HTML.
  $(id).parentElement.addEventListener('click',e=>{if(!e.target.closest('button,input'))$(id).parentElement.querySelector('button').click();});
 }
 syncAsideLayers();
 function setEditMode(next){
  hideEditNotice();
  const hint=$('mapInteractionHint');hint.hidden=false;hint.textContent=_t(next==='place'?'滚轮缩放 · 右键拖动平移 · 左键绘制 · 右键取消直线 · Ctrl 滴管':next==='region'?'滚轮缩放 · 右键拖动平移 · 左键划分 · Shift 反转选择 · Ctrl 滴管':'滚轮缩放 · 右键拖动平移 · 点击选格 · 再次点击取消');
  hint.title=hint.textContent;
  const previous=state.editMode;
  if(next===previous){if(next==='place'&&!simulation?.active)simulation?.open();return;}
  state.editMode=next;
  selectionKeyboard?.cancel();if(next&&state.selected)deselect();
  const tools=$('editTools');
  tools.dataset.activeTool=next||'view';
  $('viewMode').setAttribute('aria-pressed',String(!next));
  $('simulationPlaceTab').setAttribute('aria-pressed',String(next==='place'));
  if(next!=='place')simulation?.close();
  regions.setMode(next==='region',!!next);
  if(next==='place')simulation?.open();
  simulation?.sync();
  if(autoRegionLayer()&&(!previous||!next))for(const id of Object.keys(layerButtons))setLayer(id,!!next);
  if(ctrlRegionPreview)setLayer('regionColorOverlay',true);
  schedule();
 }
 function syncProbabilityToggle(){
  const any=!$('heatmap').disabled&&(probabilityMode==='units'?$('unitOnlyHeatmap').checked||$('unitOnlyValues').checked:$('heatmap').checked||$('values').checked);
  if($('heatmap').disabled||!any&&probabilityMode!=='units')probabilityMode='off';else if(any&&probabilityMode==='off')probabilityMode='crate';
  $('probabilityToggle').textContent=_t('视图:')+_t(CrateDisplayModes.names[probabilityMode]);
  $('probabilityToggle').dataset.mode=probabilityMode;
  $('probabilityToggle').setAttribute('aria-pressed',String(any));
  $('probabilityToggle').disabled=$('heatmap').disabled;
  buffField.setEnabled(probabilityMode==='buff'&&any);
 }
 CrateDisplayModes.bind($('probabilityToggle'),direction=>{probabilityMode=CrateDisplayModes.next(probabilityMode,direction);if(probabilityMode!=='units')$('heatmap').checked=$('values').checked=probabilityMode!=='off';syncProbabilityToggle();schedule();});
 function syncSceneToggle(){const button=$('sceneToggle');button.textContent=_t('场景:')+_t({all:'开',units:'仅模拟',off:'关'}[state.sceneMode]);button.dataset.mode=state.sceneMode;button.setAttribute('aria-pressed',String(state.sceneMode!=='off'));button.disabled=!state.data;}
 CrateDisplayModes.bind($('sceneToggle'),direction=>{simulation?.cancelInteraction();state.sceneMode=CrateDisplayModes.next(state.sceneMode,direction,['all','units','off']);syncSceneToggle();simulation?.sync();schedule();});
 syncSceneToggle();
 for(const id of ['unitOnlyHeatmap','unitOnlyValues','unitOnlyBaselineLayer','unitOnlyBaselineValues','unitOnlyColorText'])$(id).addEventListener('change',()=>{if(probabilityMode==='units')syncProbabilityToggle();schedule();});
 for(const id of ['regionColorOverlay','regionShowTotals','simulationConsider','minimapToggle'])CrateDisplayModes.reverseToggle($(id));
 function syncModeAvailability(){
  syncSceneToggle();
  const disabled=state.busy||!state.data||!!state.data.metadata.previewOnly;
  for(const id of ['regionAutoQuick','regionAutoRun'])$(id).disabled=disabled;
  $('regionToolbar').inert=disabled;
  $('regionToggle').disabled=disabled;
  $('regionToggle').title=state.busy?_t('正在加载地图，请稍候。'):!state.data?_t('请先加载地图。'):state.data.metadata.previewOnly?_t('外观预览没有概率，无法统计'):_t('划分地区并比较概率');
 }
 function setBusy(value){
  _i18n?.setBusy('analysis',value);
  document.body.classList.toggle('analysis-busy',value);
  state.busy=value;if(value)camera.stop();state.activityText='';$('loadHeck').disabled=$('mapFile').disabled=value;$('progress').hidden=!value;
  syncModeAvailability();
  globalThis.CrateResourceUI?.setAnalyzing(value);
  $('retryMod').disabled=value;
  $('resourcesOpen').disabled=$('version').disabled=value;
  $('reanalyzeResources').disabled=value||!state.data;
  if($('recompute'))$('recompute').disabled=value||!state.data;
  $('retryApprox').disabled=value;
  if(value)$('progress').value=0;
  simulation?.sync();
 }
 const jobResult=job=>CrateLocalAPI.waitForMapJob(job,{onProgress:status=>{message(status.done?_t('地图已加载'):status.progress>=80?_t('正在绘制地图…'):_t('正在分析地图…'));$('progress').value=status.progress;}});
 for(const id of ['heatmap','values'])$(id).addEventListener('change',syncProbabilityToggle);
 const fixed=n=>Number(n).toFixed(1), pct=CrateProbabilityDisplay.percent;
 function message(text,error=false){
  $(error?'error':'status').textContent=text;
  if(!error&&state.busy){state.activityText=text;simulation?.syncActivity();}
 }
 function schedule(){if(!state.scheduled){state.scheduled=true;requestAnimationFrame(()=>{state.scheduled=false;draw();});}}
 let navigationTimer=null;
 function navigationMotion(delay=140){
  state.navigating=true;clearTimeout(navigationTimer);
  navigationTimer=setTimeout(()=>{navigationTimer=null;state.navigating=false;if(!state.drag&&!regions.dragging&&!simulation?.dragging&&!camera.active)camera.settle();schedule();},delay);
 }
 function stopNavigation(){clearTimeout(navigationTimer);navigationTimer=null;state.navigating=false;}
 function diamond(x,y,rx,ry){ctx.beginPath();ctx.moveTo(x,y-ry);ctx.lineTo(x+rx,y);ctx.lineTo(x,y+ry);ctx.lineTo(x-rx,y);ctx.closePath();}
 function text(value,x,y,color='#dce9f1',size=16,align='left',maxWidth){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y,maxWidth??(align==='right'?x-26:align==='left'?W-x-26:W));}
 function numerator(c){return display.get(c).numerator;}
 function thresholdPass(c){return display.meetsThreshold(c,Number($('threshold').value)||0);}
 const multiplier=c=>display.get(c).multiplier;
 function frameBounds(){const r=minimap.terrainRendering(state);return {x:r.offsetX||0,y:r.offsetY||0,w:r.width,h:r.height};}
 function frame(){camera.stop();const b=frameBounds();state.scale=Math.min(area.w/b.w,area.h/b.h);state.x=area.x+area.w/2-(b.x+b.w/2)*state.scale;state.y=area.y+area.h/2-(b.y+b.h/2)*state.scale;camera.clamp();schedule();}
 function zoom(factor,px=area.x+area.w/2,py=area.y+area.h/2){
  camera.stop();const next=camera.zoom(state.scale*factor);navigationMotion(400);
  state.x=px-(px-state.x)*next/state.scale;state.y=py-(py-state.y)*next/state.scale;state.scale=next;
  const d=state.drag;
  // Continue panning from the zoomed camera, never from the pre-zoom origin.
  if(d&&(d.mode==='map'||d.mode==='pan'))Object.assign(d,{x:px,y:py,startX:state.x,startY:state.y,moved:true});
  Object.assign(state,camera.drag({x:state.x,y:state.y,scale:state.scale}));schedule();
 }
 function centerCell(c){camera.stop();state.x=area.x+area.w/2-c.px*state.scale;state.y=area.y+area.h/2-c.py*state.scale;camera.clamp();schedule();}
 function focus(c){if(!c)return;select(c);state.scale=Math.max(state.scale,2.5);centerCell(c);}
 function moveSelection(direction){
  if(!state.data)return;
  if(state.editMode){panKeyboard(direction);return;}
  const c=state.selected?neighbor(state.selected,direction):centerCandidate();if(!c)return;
  select(c);revealSelection(c);
 }
 function coordinateAt(x,y){return state.coordinateSpace?.get(x,y)||state.lookup.get(x+','+y)||null;}
 function neighbor(c,d){return c?coordinateAt(c.x+d.dx,c.y+d.dy):null;}
 function centerCandidate(){
  const r=canvas.getBoundingClientRect(),k=Math.min(r.width/W,r.height/H),left=r.left+(r.width-W*k)/2,top=r.top+(r.height-H*k)/2;
  const l=Math.max(0,left+area.x*k),right=Math.min(innerWidth,left+(area.x+area.w)*k),t=Math.max(0,top+area.y*k),bottom=Math.min(innerHeight,top+(area.y+area.h)*k);
  const p=l<right&&t<bottom?{x:((l+right)/2-left)/k,y:((t+bottom)/2-top)/k}:{x:area.x+area.w/2,y:area.y+area.h/2};
  return pick(p)||state.coordinateSpace?.point((p.x-state.x)/state.scale,(p.y-state.y)/state.scale,true)||state.cells[0];
 }
 function panKeyboard(d){
  const length=Math.hypot(d.col-1,d.row-1)||1,step=64;navigationMotion();
  Object.assign(state,camera.drag({x:state.x-(d.col-1)/length*step,y:state.y-(d.row-1)/length*step,scale:state.scale}));regions.leave();schedule();
 }
 function revealSelection(c){
  const margin=20,p={x:state.x+c.px*state.scale,y:state.y+c.py*state.scale},m=miniLayout();let dx=0,dy=0;
  if(p.x<area.x+margin)dx=area.x+margin-p.x;else if(p.x>area.x+area.w-margin)dx=area.x+area.w-margin-p.x;
  if(p.y<area.y+margin)dy=area.y+margin-p.y;else if(p.y>area.y+area.h-margin)dy=area.y+area.h-margin-p.y;
  if(m&&minimap.contains(m,{x:p.x+dx,y:p.y+dy})){const choices=[[m.x-margin-p.x-dx,0],[0,m.y-margin-p.y-dy]].filter(([x,y])=>p.x+dx+x>=area.x+margin&&p.y+dy+y>=area.y+margin);if(choices.length){const delta=choices.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b))[0];dx+=delta[0];dy+=delta[1];}}
  if(dx||dy){camera.stop();state.x+=dx;state.y+=dy;camera.clamp();}
  const r=canvas.getBoundingClientRect(),k=Math.min(r.width/W,r.height/H),x=r.left+(r.width-W*k)/2+(state.x+c.px*state.scale)*k,y=r.top+(r.height-H*k)/2+(state.y+c.py*state.scale)*k;
  const halfW=Math.min(30*state.scale*k,(innerWidth-24)/2),halfH=Math.min(15*state.scale*k,(innerHeight-24)/2);
  const sx=x-halfW<8?x-halfW-8:x+halfW>innerWidth-8?x+halfW-innerWidth+8:0,sy=y-halfH<8?y-halfH-8:y+halfH>innerHeight-8?y+halfH-innerHeight+8:0;
  if(sx||sy)window.scrollBy({left:sx,top:sy,behavior:'instant'});schedule();
 }
 const surface=CrateMapRenderer.surface;
 function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const[a,b]=ring[i],[u,v]=ring[j];if((b>y)!==(v>y)&&x<(u-a)*(y-b)/(v-b)+a)inside=!inside;}return inside;}
 function pointOnSurface(c,x,y){let inside=false;for(const ring of surface(c))if(pointInRing(x-c.px,y-c.py,ring))inside=!inside;return inside;}
 function navigationRendering(){return minimap.terrainRendering(state);}
 function miniLayout(){if(!state.data||!$('minimap').checked)return null;const r=navigationRendering(),m=minimap.layout(r,area,{...miniState,compact,players:$('players').checked});if(m.image){m.image.worldX=r.offsetX||0;m.image.worldY=r.offsetY||0;}return m;}
 function setMinimap(enabled){$('minimap').checked=enabled;for(const id of ['minimapToggle','webNavigator'])$(id)?.setAttribute('aria-pressed',String(enabled));if(enabled){miniState.position=null;miniState.minimized=false;}schedule();}
 function syncCanvasControls(m){
  const rect=canvas.getBoundingClientRect(),host=$('canvasHost'),hr=host.getBoundingClientRect();
  const scale=Math.min(rect.width/W,rect.height/H),x=rect.left-hr.left-host.clientLeft+(rect.width-W*scale)/2,y=rect.top-hr.top-host.clientTop+(rect.height-H*scale)/2;
  const key=JSON.stringify([x,y,scale,m?.x,m?.y,m?.w,m?.h,m?.minimized,state.baseUrl]),origin=state.selected,navKey=[origin?.x,origin?.y,state.editMode,state.busy,state.baseUrl].join('|');
  if(key===controlsKey&&navKey===navigationControlsKey)return;
  const moved=key!==controlsKey;controlsKey=key;navigationControlsKey=navKey;
  if(moved&&m)Object.assign(navigationCanvas.style,{left:x+m.x*scale+'px',top:y+m.y*scale+'px',width:m.w*scale+'px',height:m.h*scale+'px'});
  const spinner=$('mapBusy');if(spinner){
   Object.assign(spinner.style,{left:x+(area.x+area.w)*scale-12+'px',top:y+(area.y+area.h)*scale-12+'px'});
   spinner.style.setProperty('--map-busy-text-width',Math.max(0,area.w*scale-102)+'px');
  }
  const controls=[['minimapMinimize',m?.buttons.minimize],['minimapClose',m?.buttons.close],['navCenter',m?.buttons.center],...minimap.directions.map(d=>['nav'+d.id,m?.navigation?.find(n=>n.id===d.id)?.box])];
  for(const[id,box]of controls){
   const button=$(id);if(moved){button.hidden=!box;if(box)Object.assign(button.style,{left:x+box.x*scale+'px',top:y+box.y*scale+'px',width:box.w*scale+'px',height:box.h*scale+'px'});}
  }
  const action=miniState.minimized?_t('还原地图导航'):_t('最小化地图导航');$('minimapMinimize').setAttribute('aria-label',action);$('minimapMinimize').title=action;
  $('navCenter').disabled=state.busy||!state.data;
  for(const d of minimap.directions){const c=neighbor(origin,d),button=$('nav'+d.id);button.disabled=state.busy||!state.editMode&&!!origin&&!c;button.title=state.editMode?_t('移动视野'):!origin?_t('从中心选格'):c?`${d.name}：(${c.x}, ${c.y})`:_t('该方向已到坐标边缘');}
 }
 function miniPan(p){navigationMotion();regions.leave();Object.assign(state,camera.drag({...minimap.pan(miniLayout(),p,area,state.scale,navigationRendering()),scale:state.scale}));schedule();}
 function drawMinimap(dirty){
  const m=miniLayout();syncCanvasControls(m);navigationCanvas.hidden=!m;if(!m)return;
  const width=Math.ceil(m.w*pixelRatio),height=Math.ceil(m.h*pixelRatio);
  if(navigationCanvas.width!==width)navigationCanvas.width=width;if(navigationCanvas.height!==height)navigationCanvas.height=height;
  const ctx=navigationContext;if(ctx.reset)ctx.reset();else navigationCanvas.width=width;
  ctx.setTransform(pixelRatio,0,0,pixelRatio,-m.x*pixelRatio,-m.y*pixelRatio);
  function text(value,x,y,color='#dce9f1',size=16,align='left',maxWidth){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y,maxWidth??(align==='right'?x-26:align==='left'?W-x-26:W));}
  function canvasButton(box,label,active=false,disabled=false){
  ctx.fillStyle=disabled?'#11212b':active?'#2b4351':'#192c38';ctx.strokeStyle=disabled?'#293d4b':active?'#d8b66d':'#567184';ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(box.x,box.y,box.w,box.h,5);ctx.fill();ctx.stroke();
  text(label,box.x+box.w/2,box.y+box.h/2+5,disabled?'#49606e':active?'#f5ce80':'#dce9f1',label===_t('地图导航')?15:18,'center',box.w-12);
 }
  const r=navigationRendering(),im=m.image;ctx.save();ctx.beginPath();ctx.roundRect(m.x,m.y,m.w,m.h,9);ctx.fillStyle='rgba(10,24,34,.96)';ctx.fill();ctx.strokeStyle='#567180';ctx.lineWidth=1;ctx.stroke();
  if(!m.minimized)text(compact?_t('地图导航'):_t('地图导航 · 拖动移动'),m.x+10,m.y+(compact?29:23),'#dbe9f2',13,'left',m.w-(compact?96:20));
  canvasButton(m.buttons.minimize,m.minimized?'□':'−');canvasButton(m.buttons.close,'×');
  if(m.minimized){ctx.restore();return;}
  const mw=Math.ceil(im.w*pixelRatio),mh=Math.ceil(im.h*pixelRatio),style=[$('objects').checked,state.objectOpacity,r.offsetX,r.offsetY,r.width,r.height].join('|');
  const rebuild=!miniArtwork||miniArtwork.image.width!==mw||miniArtwork.image.height!==mh||miniArtwork.ground!==state.image||miniArtwork.objects!==state.objectImage||miniArtwork.style!==style;
  if(rebuild){const image=document.createElement('canvas');image.width=mw;image.height=mh;miniArtwork={image,ground:state.image,objects:state.objectImage,style};}
  const entry=miniArtwork,small=entry.image;
  if(rebuild||entry.revision!==state.artworkRevision){
   const target=small.getContext('2d'),scale=mw/r.width,local={...state,x:-(r.offsetX||0)*scale,y:-(r.offsetY||0)*scale,scale};
   const paint=box=>{target.save();target.beginPath();target.rect(box.x,box.y,box.w,box.h);target.clip();target.clearRect(box.x,box.y,box.w,box.h);target.fillStyle='#101c25';target.fillRect(box.x,box.y,box.w,box.h);CrateMapArtwork.scene(target,local,state.data.rendering,{objects:$('objects').checked,objectOpacity:state.objectOpacity},box);target.restore();};
   if(!rebuild&&entry.revision===state.artworkRevision-1&&dirty?.length){
    let l=mw,t=mh,right=0,bottom=0;
    for(const [x,y,w,h]of dirty){l=Math.min(l,Math.max(0,Math.floor((x-(r.offsetX||0))/r.width*mw)-1));t=Math.min(t,Math.max(0,Math.floor((y-(r.offsetY||0))/r.height*mh)-1));right=Math.max(right,Math.min(mw,Math.ceil((x+w-(r.offsetX||0))/r.width*mw)+1));bottom=Math.max(bottom,Math.min(mh,Math.ceil((y+h-(r.offsetY||0))/r.height*mh)+1));}
    const w=right-l,h=bottom-t;
    if(w>0&&h>0)paint({x:l,y:t,w,h});
   }else paint({x:0,y:0,w:mw,h:mh});
   entry.revision=state.artworkRevision;
  }
  ctx.drawImage(small,im.x,im.y,im.w,im.h);
  regions.minimap(ctx,im);
  for(const [coords,enabled,color]of [[state.data.markers,$('markers').checked,'#ff77c6'],[state.data.potentialMarkers||[],$('markers').checked,'#ed9dca']])if(enabled){ctx.fillStyle=color;for(const p of coords){const c=state.lookup.get(p.join(','));ctx.fillRect(im.x+(c.px-(r.offsetX||0))*im.scale-1.5,im.y+(c.py-(r.offsetY||0))*im.scale-1.5,3,3);}}
  const v=minimap.viewport(m,area,state,r);if(v){ctx.fillStyle='rgba(255,255,255,.12)';ctx.fillRect(v.x,v.y,v.w,v.h);ctx.strokeStyle='#0b1720';ctx.lineWidth=4;ctx.strokeRect(v.x,v.y,v.w,v.h);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(v.x,v.y,v.w,v.h);}
  if(state.selected&&!state.selected.virtual){ctx.beginPath();ctx.arc(im.x+(state.selected.px-(r.offsetX||0))*im.scale,im.y+(state.selected.py-(r.offsetY||0))*im.scale,3,0,Math.PI*2);ctx.fillStyle='#ffe18f';ctx.fill();ctx.strokeStyle='#332916';ctx.lineWidth=1;ctx.stroke();}
  if($('players').checked)CratePlayerStarts.draw(ctx,state,{...im,x:im.x-(r.offsetX||0)*im.scale,y:im.y-(r.offsetY||0)*im.scale},{radius:8,clip:m.markerClip||im,regionStyles:regions.playerStyles(),focusPlayers:state.lastPlayer===null?[]:[state.lastPlayer]});
  if(compact){ctx.restore();return;}
  ctx.beginPath();ctx.moveTo(m.x+12,m.y+195);ctx.lineTo(m.x+m.w-12,m.y+195);ctx.strokeStyle='#2c4453';ctx.lineWidth=1;ctx.stroke();
  text(state.editMode?_t('移动视野'):_t('移动选中格'),m.x+14,m.y+225,'#c9dbe7',13);
  text(state.selected?`(${state.selected.x}, ${state.selected.y})`:state.editMode?'↑↓←→':_t('从中心选格'),m.x+14,m.y+251,state.selected?'#ffe0a0':'#849eae',15);
  text(_t('方向键：可组合'),m.x+14,m.y+279,'#91a9b9',11);
  text(_t('◎：居中查看'),m.x+14,m.y+298,'#91a9b9',11);
  text(_t('长按连续移动'),m.x+14,m.y+316,'#708c9e',10);
  const origin=state.selected;
  for(const d of m.navigation)canvasButton(d.box,d.label,false,state.busy||!state.editMode&&!!origin&&!neighbor(origin,d));
  canvasButton(m.buttons.center,'◎',!!state.selected,state.busy);
  ctx.restore();
 }
 function mapOptions({snapshotRegions=false}={}){
  const options={scene:snapshotRegions?'all':state.sceneMode,filter:$('filter').value,palette:$('palette').value,paletteColors:CrateProbability.paletteSettings(),opacity:Number($('opacity').value)||0,threshold:Number($('threshold').value)||0,navigation:!snapshotRegions&&!!state.navigating};
  options.transferColumns=CrateTransferColumns.defaults;
  if(options.scene==='units')options.sceneLayer=simulation?.drawScene;
  options.opaqueLayers=options.scene!=='all';
  for(const key of ['heatmap','blocked','objects','grid','markers','coords','values','colorText','baselineLayer','baselineValues','zeroLayer','zeroValues','players'])options[key]=$(key).checked;
  options.selectionOutline=CrateSelectionProbability.defaults;options.selectionBadge={...selectionTuning.settings};
  if(state.selected&&!snapshotRegions){options.selectionPointer=badgePointerClient?canvasPoint(badgePointerClient):null;options.screenScale=(options.selectionPointer||canvasPoint({clientX:0,clientY:0})).screenScale;}
  if(seaLand.enabled)options.seaLandLayer=snapshotRegions?seaLand.snapshot():seaLand.paint;
  options.potentialMarkers=options.markers;
  options.labelCacheBusy=!!(state.busy||state.simulationPending||state.simulationWaiting||simulation?.dragging||regions.dragging);
  // Keep the last complete probability frame while the next revision computes.
  // Simulation draws edit markers separately, preserving the cached base layer.
  if(state.data?.metadata.previewOnly)for(const key of ['heatmap','values','baselineValues','markers','potentialMarkers'])options[key]=false;
  if(state.data?.metadata.approximate&&!state.data.metadata.riskPredictionVersion)options.markers=options.potentialMarkers=false;
  if(regions.active||layerOn('regionColorOverlay')){
   options.regionLayer=snapshotRegions?regions.snapshotLayer():regions.render;
   options.regionLabels=snapshotRegions?options.regionLayer.labels:regions.labels;options.playerRegionStyles=regions.playerStyles();
  }
  options.objectOpacity=state.objectOpacity;options.coordinateSpace=snapshotRegions?state.coordinateSpace?.snapshot():state.coordinateSpace;
  options.probabilityMode=probabilityMode;options.transfers=probabilityMode==='crate';
  options.unitOnly={heatmap:$('unitOnlyHeatmap').checked,values:$('unitOnlyValues').checked,baselineLayer:$('unitOnlyBaselineLayer').checked,baselineValues:$('unitOnlyBaselineValues').checked,colorText:$('unitOnlyColorText').checked};
  if(snapshotRegions&&(probabilityMode==='units'||probabilityMode==='crate'&&layerOn('unitBuffOverlay')))buffs.snapshot();
  options.legendMaximum=legendMaximum();
  if(layerOn('unitBuffOverlay')&&probabilityMode==='crate'){const style={...options,heatmap:false,baselineValues:true,fixedColor:'#39ff5f'};options.unitBuffLayer=snapshotRegions?buffs.snapshot(style):(ctx,view,area)=>buffs.paint(ctx,view,area,undefined,style);}
  if(probabilityMode==='units'&&!state.data?.metadata.previewOnly){const style={...options,...options.unitOnly},heatStyle={...style,values:false},labelStyle={...style,heatmap:false};options.buffFieldLayer=snapshotRegions?buffs.snapshot(heatStyle):(ctx,view,area)=>buffs.paint(ctx,view,area,undefined,heatStyle);options.buffFieldLabels=snapshotRegions?buffs.snapshot(labelStyle):(ctx,view,area)=>buffs.paint(ctx,view,area,undefined,labelStyle);options.heatmap=options.values=false;}
  if(probabilityMode==='buff'&&!state.data?.metadata.previewOnly){const fieldOptions={...options},heatOptions={...fieldOptions,values:false},labelOptions={...fieldOptions,heatmap:false,labelsOnly:true};options.buffFieldLayer=snapshotRegions?buffField.snapshot(heatOptions):(ctx,view,area)=>buffField.paint(ctx,view,area,heatOptions);options.buffFieldLabels=snapshotRegions?buffField.snapshot(labelOptions):(ctx,view,area)=>buffField.paint(ctx,view,area,labelOptions);options.heatmap=options.values=false;}
  if(probabilityMode==='off')options.heatmap=options.values=false;
  return options;
 }
 function drawRegionHover(y){
  const info=regions.hoverInfo(),cell=info?.cell;
  const right=W-26;
  if(!cell){text(info?_t('未指向地图格子'):_t('区域统计 · 指向格子查看区域'),right,y,'#9bb2c2',14,'right');return;}
  if(!info.regions.length){text(_t`指向 (${cell.x}, ${cell.y}) · ${info.selectable?_t('未划分区域'):_t('不可选区域')}`,right,y,'#b2c7d6',14,'right');return;}
  ctx.save();ctx.font='14px "Microsoft YaHei",sans-serif';
  const tokens=[{label:_t`指向 (${cell.x}, ${cell.y}) · 区域`,color:null},...info.regions.map(r=>({label:r.id.slice(1),color:r.color}))];
  const measure=t=>ctx.measureText(t.label).width+(t.color?23:0)+12;
  let width=tokens.reduce((sum,t)=>sum+measure(t),0);
  if(width>758){
   const reserve=measure({label:'+'+info.regions.length});
   let omitted=0;
   while(width+reserve>758&&tokens.length>1){width-=measure(tokens.pop());omitted++;}
   const tail={label:'+'+omitted};tokens.push(tail);width+=measure(tail);
  }
  let x=right-width+12;
  for(const t of tokens){
   if(t.color){ctx.beginPath();ctx.roundRect(x,y-11,12,12,3);ctx.fillStyle=t.color;ctx.fill();ctx.strokeStyle='#d8e8f266';ctx.lineWidth=1;ctx.stroke();}
   text(t.label,x+(t.color?20:0),y,'#e1ecef',14);x+=measure(t);
  }
  ctx.restore();
 }
 function draw(){
  paletteTuning.refresh();drawRegionPreview();
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#101c25';ctx.fillRect(0,0,W,H);if(!state.data)return;
  terrain3d.refresh?.();
  const artworkDirty=state.artworkDirty;
  try{
  if(!$('placementRegionDetails').hidden){
   const cursor=simulation?.pointerClient,p=cursor&&pointer(cursor);
   regions.renderPlacement(p&&mapHit(p)?pick(p):null,simulation?.lastPlacement);
  }
  if(compact){
   const result=mapViewCache.render(ctx,state,area,display,mapOptions());state.selectionBadge=result.selectionBadge||null;simulation?.draw(ctx);state.visible=result.colored;
   const info=$('mobileMapInfo');
   if(info){const c=state.selected;
    const value=(state.simulationPending?_t('概率待更新'):c?`(${c.x}, ${c.y}) · ${fixed(multiplier(c))}×`:'')+(state.incoming?_t` · ${state.incoming.sources.length} 个转入起点`:'');
    if(info.textContent!==value)info.textContent=value;}
   return;
  }
  const d=state.data,p=d.probability;
  const options=mapOptions(),minimum=options.threshold;
  const rendered=mapViewCache.render(ctx,state,area,display,options),{colored}=rendered;state.selectionBadge=rendered.selectionBadge||null;
  ctx.strokeStyle='#294151';ctx.lineWidth=1;ctx.strokeRect(area.x,area.y,area.w,area.h);
  simulation?.draw(ctx);
  const bottom=area.y+area.h,summaryY=bottom+19,hintY=bottom+37,right=W-26;
  if(d.metadata.previewOnly){text(previewLabel(d.metadata),26,summaryY,'#f1cf88',20);$('thresholdInfo').textContent='';return;}
  text(_t`生成成功 ${pct(p.finalSuccess)} · 生成失败 ${failurePercent(p)}`,right,summaryY,'#cbdbe6',15,'right');
  const legendX=26,legendY=bottom+6,legendWidth=740;
  const maximum=options.legendMaximum,legendKey=maximum+options.palette+JSON.stringify(CrateProbability.heatStyle(options.paletteColors));
  if(probabilityMode!=='off'){
  if(legendCache?.key!==legendKey){const image=document.createElement('canvas');image.width=legendWidth;image.height=12;const target=image.getContext('2d');
   for(let i=0;i<legendWidth;i++){const value=Math.expm1(Math.log1p(maximum)*i/legendWidth);target.fillStyle=CrateProbability.color(value,options.palette,maximum,options.paletteColors);target.fillRect(i,0,1,12);}legendCache={key:legendKey,image};}
  ctx.drawImage(legendCache.image,legendX,legendY);
  for(let i=0;i<=4;i++){const v=Math.expm1(Math.log1p(maximum)*i/4);text(fixed(v)+'×',legendX+legendWidth*i/4,hintY,'#a9becd',13,i===0?'left':i===4?'right':'center');}
  }
  const opacityText=_t('0% 不透明 · 100% 透明');if($('opacityInfo').textContent!==opacityText)$('opacityInfo').textContent=opacityText;
  const selectedValue=!state.selected||probabilityMode==='off'?undefined:probabilityMode==='buff'?buffField.get(state.selected.x,state.selected.y):probabilityMode==='units'?buffs.values().find(e=>e.unit.x===state.selected.x&&e.unit.y===state.selected.y)?.value:multiplier(state.selected);
  if(regions.active)drawRegionHover(hintY);else text(state.selected?_t`选中 (${state.selected.x},${state.selected.y})  高度 ${state.selected.level}`+(selectedValue===undefined?'':`  ${fixed(selectedValue)}×`)+(state.selected.marked?_t('  放箱后不可通行'):state.selected.potentialMarked?_t('  清空对象后潜在禁行'):''):_t('滚轮缩放 / 拖动平移'),right,hintY,'#b2c7d6',14,'right');
  state.visible=colored;
  const thresholdText=_t`当前显示 ${colored} 格`;if($('thresholdInfo').textContent!==thresholdText)$('thresholdInfo').textContent=thresholdText;
  }catch(error){
   state.renderFailures=[...(state.renderFailures||[]).slice(-2),{at:Date.now(),map:state.data?.metadata.filename,scale:state.scale,view:probabilityMode,message:error.message,stack:error.stack}];throw error;
  }finally{drawMinimap(artworkDirty);}
 }
 async function showSources(c){
  const revision=++selectionRevision,data=state.data;
  state.incoming=null;state.outgoing=null;details.transfer(null);
  if(simulation?.active||simulation?.pending&&!simulation?.liveReady||state.simulationPending||data.metadata.previewOnly)return;
  try{
   // Publish the selected cross before source lookup / preparation can consume
   // this frame. Superseded selections never start their deferred work.
   await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
   if(revision!==selectionRevision||data!==state.data||state.selected!==c)return;
   const index=await(simulation?.liveReady?simulation.getSources(data):state.prepared.getSources());
   if(simulation?.active||simulation?.pending&&!simulation?.liveReady||state.simulationPending||revision!==selectionRevision||data!==state.data||state.selected!==c)return;
   const incoming=index.get(c);state.incoming=incoming;state.outgoing=display.get(c)?.numerator===0n?index.outgoing(c):null;
   if(incoming){
    $('transferInfo').hidden=false;
    details.transfer(incoming);
   }
   schedule();
  }catch(e){
   if(revision!==selectionRevision||data!==state.data)return;
   details.transfer(null,e.message);schedule();
  }
 }
 function deselect(){
  selectionKeyboard?.cancel();
  terrain3d.close();$('terrain3dOpen').disabled=true;$('terrain3dOpen').title=_t('先在地图上选择一个格子');
  ++selectionRevision;state.selected=null;state.incoming=null;state.outgoing=null;state.selectionBadge=null;
  details.clear();
  schedule();
 }
 function select(c){
  if(c&&!c.virtual)c=state.lookup.get(c.x+','+c.y);
  if(state.editMode||!c)return;
  rememberPlayer(c);
  state.selected=c;$('gotoX').value=c.x;$('gotoY').value=c.y;$('selectedCoord').textContent=`${c.x}, ${c.y}`;
  $('terrain3dOpen').disabled=platform?.terrain3d===false||!!c.virtual;$('terrain3dOpen').title=c.virtual?_t('此坐标没有地形'):_t`以 (${c.x}, ${c.y}) 为中心查看附近地形`;if(!c.virtual)terrain3d.select(c);else terrain3d.close();
  showSources(c);
  details.cell(c,state.data,display);schedule();
 }
 function canvasPoint(e){const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/W,r.height/H);return{x:(e.clientX-r.left-(r.width-W*scale)/2)/scale,y:(e.clientY-r.top-(r.height-H*scale)/2)/scale,screenScale:scale};}
 function pointer(e){const {x,y}=canvasPoint(e);return {x,y};}
 function refreshBadgeOpacity(){if(!state.selected||!state.selectionBadge)return;const opacity=CrateSelectionProbability.badgeOpacity(state.selectionBadge,badgePointerClient?canvasPoint(badgePointerClient):null,selectionTuning.settings);if(Math.abs(opacity-state.selectionBadge.opacity)>.0001)schedule();}
 function trackBadgePointer(e){if(e.pointerType==='touch'){if(e.type==='pointerdown'){badgePointerClient=null;refreshBadgeOpacity();}return;}badgePointerClient={clientX:e.clientX,clientY:e.clientY};refreshBadgeOpacity();}
 document.addEventListener('pointermove',trackBadgePointer,{capture:true,passive:true});document.addEventListener('pointerdown',trackBadgePointer,{capture:true,passive:true});
 document.addEventListener('pointerout',e=>{if(!e.relatedTarget){badgePointerClient=null;refreshBadgeOpacity();}},{capture:true,passive:true});document.addEventListener('scroll',refreshBadgeOpacity,{capture:true,passive:true});
 let touchBrush=true,touchGesture=null,touchSuppressed=false;const touches=new Map();
 function touchPair(){const [a,b]=[...touches.values()].slice(0,2);return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))}:null;}
 function startPinch(){const p=touchPair();if(!p)return;regions.cancel();regions.leave();state.drag=null;touchSuppressed=true;touchGesture={...p,scale:state.scale,mapX:(p.x-state.x)/state.scale,mapY:(p.y-state.y)/state.scale};}
 if(platform){
  const button=document.createElement('button');button.id='touchMode';button.type='button';button.textContent=_t('触控：画笔');button.setAttribute('aria-pressed','true');
  button.onclick=()=>{touchBrush=!touchBrush;regions.cancel();button.textContent=_t(touchBrush?'触控：画笔':'触控：移动');button.setAttribute('aria-pressed',String(touchBrush));};CrateDisplayModes.reverseToggle(button);$('regionOperationHint').after(button);
  const info=document.createElement('div');info.id='mobileMapInfo';info.setAttribute('role','status');info.setAttribute('aria-live','polite');$('canvasHost').append(info);
 }
 function pick(pos){const x=(pos.x-state.x)/state.scale,y=(pos.y-state.y)/state.scale;
  return CrateMapCoordinates.hitTest(state,x,y,pointOnSurface);}
 const editNotice=document.createElement('div');editNotice.id='mapEditNotice';editNotice.className='map-edit-notice';editNotice.hidden=true;editNotice.setAttribute('role','status');document.body.append(editNotice);
 let editNoticeDelay=null,editNoticeEnd=null;
 function hideEditNotice(){clearTimeout(editNoticeDelay);clearTimeout(editNoticeEnd);editNotice.hidden=true;delete editNotice.dataset.fading;}
 function showEditNotice(e,text){
  hideEditNotice();editNotice.textContent=text;editNotice.hidden=false;
  const left=e.clientX+24,top=e.clientY+18;editNotice.style.left=Math.max(8,Math.min(left,innerWidth-editNotice.offsetWidth-8))+'px';editNotice.style.top=Math.max(8,Math.min(top,innerHeight-editNotice.offsetHeight-8))+'px';
  editNoticeDelay=setTimeout(()=>{editNotice.dataset.fading='true';editNoticeEnd=setTimeout(hideEditNotice,250);},3000);
 }
 document.addEventListener('fullscreenchange',()=>{(document.fullscreenElement||document.body).append(editNotice);});
 for(const id of ['regionColorOverlay','simulationConsider','sceneToggle'])$(id).addEventListener('click',hideEditNotice);
 const focusMap=e=>{if(state.data&&mapHit(pointer(e))&&(e.type==='wheel'||e.button===0||e.button===2)){canvas.focus({preventScroll:true});if(e.type==='pointerdown')camera.stop();}};
 canvas.addEventListener('pointerdown',focusMap,true);canvas.addEventListener('wheel',focusMap,{capture:true,passive:true});
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||!state.data||state.busy||e.ctrlKey||regions.picking||!mapHit(pointer(e)))return;
  const reasons=state.editMode==='place'?simulation?.blockedReasons()||[]:state.editMode==='region'&&!layerOn('regionColorOverlay')?[_t('编辑需要打开“区域图层”')]:[];
  if(!reasons.length)return;
  showEditNotice(e,reasons.join('\n'));canvas.style.cursor='crosshair';if(e.pointerType==='touch')return;e.preventDefault();e.stopImmediatePropagation();
 },true);
 canvas.addEventListener('wheel',e=>{
  if(!state.data)return;e.preventDefault();if(!e.deltaY)return;
  const p=pointer(e),m=miniLayout();if(m&&minimap.contains(m,p))return;
  const controller=state.editMode==='place'?simulation:state.editMode==='region'?regions:null;
  if(e.ctrlKey&&!state.busy&&controller?.canAdjustSize){
   // Keep the original tool for the rest of this Ctrl hold, including moves
   // between wheel events. Leaving the picker restores its temporary layers.
   state.ctrlResizing=true;simulation.cancelPicker();controller.adjustSize(e.deltaY<0?1:-1);simulation.refreshCursor();return;
  }
  if(regions.dragging)return;regions.leave();zoom(Math.exp(-e.deltaY*.0015),p.x,p.y);
 },{passive:false});
 canvas.addEventListener('contextmenu',e=>{if(state.data)e.preventDefault();});
 canvas.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch'&&state.data){
   e.preventDefault();touches.set(e.pointerId,pointer(e));canvas.setPointerCapture(e.pointerId);
   if(touches.size>=2){startPinch();return;}if(touchSuppressed)return;
  }
  if(!state.data||state.drag||(e.button!==0&&e.button!==2))return;const p=pointer(e),m=miniLayout();let mode='map';
  if(m&&minimap.contains(m,p))mode=m.minimized||p.y<m.y+34?'panel':minimap.contains(m.image,p)?'overview':'chrome';
  else if(!minimap.contains(area,p))return;
  if(mode==='map'){if(e.button===2)mode='pan';else if(regions.active){if(!e.altKey&&!(e.pointerType==='touch'&&!touchBrush)&&regions.down(p,e))mode='region';else mode='pan';}}
  camera.stop();state.drag={...p,pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,startX:state.x,startY:state.y,startMini:m,moved:false,mode};
  if(e.button===2)e.preventDefault();if(mode==='overview')miniPan(p);if(mode==='panel'||mode==='pan')canvas.style.cursor='grabbing';canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'&&touches.has(e.pointerId)){
   touches.set(e.pointerId,pointer(e));
   if(touchGesture){const p=touchPair();if(p){const scale=camera.zoom(touchGesture.scale*p.distance/touchGesture.distance);navigationMotion(400);Object.assign(state,camera.drag({scale,x:p.x-touchGesture.mapX*scale,y:p.y-touchGesture.mapY*scale}));schedule();}return;}
   if(touchSuppressed)return;
  }
  const p=pointer(e),d=state.drag,m=miniLayout();if(d&&d.pointerId!==e.pointerId)return;
  if(!d){if(m&&minimap.contains(m,p))regions.leave();else regions.move(p,false,e);canvas.style.cursor=m&&minimap.contains(m,p)&&(m.minimized||p.y<m.y+34)?'grab':'crosshair';return;}
  if(d.mode==='region'){regions.move(p,!!m&&minimap.contains(m,p),e);return;}
  if(d.mode==='overview'){miniPan(p);return;}if(Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)>4)d.moved=true;
  if(d.moved&&d.mode==='panel'){miniState.position=minimap.position(area,{x:d.startMini.x+p.x-d.x,y:d.startMini.y+p.y-d.y},m.w,m.h);schedule();}
  else if(d.moved&&(d.mode==='map'||d.mode==='pan')){navigationMotion();regions.leave();Object.assign(state,camera.drag({x:d.startX+p.x-d.x,y:d.startY+p.y-d.y,scale:state.scale}));schedule();}
 });
 canvas.addEventListener('pointerup',e=>{
  touches.delete(e.pointerId);
  if(e.pointerType==='touch'&&touchSuppressed){touchGesture=null;if(!touches.size)touchSuppressed=false;state.drag=null;camera.settle();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);return;}
  const d=state.drag;if(d&&d.pointerId!==e.pointerId)return;if(d?.mode==='region'){const p=pointer(e),m=miniLayout();regions.move(p,!!m&&minimap.contains(m,p),e);regions.up();}else if(e.button===0&&d?.mode==='map'&&!d.moved&&Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)<=4){const c=pick(pointer(e));if(c){if(c===state.selected)deselect();else select(c);}}state.drag=null;camera.settle();canvas.style.cursor='crosshair';if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointercancel',()=>{touches.clear();touchGesture=null;touchSuppressed=false;regions.cancel();state.drag=null;camera.settle();canvas.style.cursor='crosshair';});
 // Pointerup has already committed the stroke and cleared drag. Its normal
 // capture release must not cancel a cooperative fill still being calculated.
 canvas.addEventListener('lostpointercapture',()=>{if(state.drag||regions.dragging)regions.cancel();state.drag=null;});
 canvas.addEventListener('pointerleave',()=>regions.leave());
 window.addEventListener('blur',()=>{stopNavigation();badgePointerClient=null;state.drag=null;touches.clear();touchGesture=null;touchSuppressed=false;schedule();});
 canvas.addEventListener('dblclick',e=>{if(state.data)e.preventDefault();});
 $('minimapToggle').onclick=()=>setMinimap(!$('minimap').checked);
 $('minimapMinimize').onclick=()=>{miniState.minimized=!miniState.minimized;schedule();};
 $('minimapClose').onclick=()=>{setMinimap(false);$('minimapToggle').focus();};
 $('minimap').addEventListener('change',()=>setMinimap($('minimap').checked));
 for(const d of minimap.directions)$('nav'+d.id).onclick=()=>moveSelection(d);
 $('navCenter').onclick=()=>{const c=state.selected||centerCandidate();if(c){if(!state.editMode)select(c);centerCell(c);if(!state.editMode)revealSelection(c);}};
 const inputFocus=target=>target?.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="spinbutton"],[role="slider"]');
 const viewInputFocus=target=>{const field=target?.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="spinbutton"]');return field&&!(field.tagName==='INPUT'&&['checkbox','radio','button','submit','reset','range','color','file','image'].includes(field.type));};
 function keyboardEnabled(target=document.activeElement){
  const selectFocus=target?.closest?.('select,[role="combobox"],[role="listbox"],[role="tab"]');
  return !!state.data&&!state.busy&&!state.drag&&!regions.dragging&&!simulation?.dragging&&!inputFocus(target)&&!selectFocus&&!document.querySelector('dialog[open]')&&!document.hidden;
 }
 selectionKeyboard=CrateSelectionKeyboard.create({enabled:keyboardEnabled,move:({horizontal,vertical})=>{
  const direction=minimap.directions.find(d=>d.col===horizontal+1&&d.row===vertical+1);if(direction)moveSelection(direction);
 }});
 document.addEventListener('keydown',e=>{
  if(!CrateSelectionKeyboard.arrows.has(e.key))return;
  if(e.altKey||e.ctrlKey||e.metaKey||e.isComposing||!keyboardEnabled(e.target)){selectionKeyboard.cancel();return;}
  if(selectionKeyboard.down(e.key,e.repeat))e.preventDefault();
 },true);
 document.addEventListener('keyup',e=>{selectionKeyboard.up(e.key);});
 document.addEventListener('pointerdown',()=>selectionKeyboard.cancel(),true);
 document.addEventListener('focusin',e=>{if(!keyboardEnabled(e.target))selectionKeyboard.cancel();});
 window.addEventListener('blur',()=>selectionKeyboard.cancel());
 document.addEventListener('visibilitychange',()=>{if(document.hidden)selectionKeyboard.cancel();});
 function resizeViewport(){
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const nextCompact=!!platform&&matchMedia('(max-width:760px), (pointer: coarse) and (max-width:1100px), (orientation:landscape) and (max-height:600px) and (max-width:1200px)').matches,nextW=nextCompact?Math.round(rect.width):desktopWidth,nextH=nextCompact?Math.round(rect.height):desktopHeight;
  const ratio=Math.min(rect.width/nextW,rect.height/nextH)*(devicePixelRatio||1);
  if(nextW===W&&nextH===H&&compact===nextCompact&&pixelRatio===ratio){positionMapSwitch();schedule();return;}
  const center=state.data?{x:(area.x+area.w/2-state.x)/state.scale,y:(area.y+area.h/2-state.y)/state.scale}:null;
  const fittedBounds=state.data?frameBounds():null,oldFit=fittedBounds?Math.min(area.w/fittedBounds.w,area.h/fittedBounds.h):0;
  const fitted=oldFit>0&&Math.abs(state.scale/oldFit-1)<.01;
  const layoutChanged=nextW!==W||nextH!==H||compact!==nextCompact;
  W=nextW;H=nextH;compact=nextCompact;pixelRatio=ratio;canvas.width=Math.round(W*ratio);canvas.height=Math.round(H*ratio);
  Object.assign(area,compact?{x:8,y:8,w:W-16,h:H-16}:desktopArea);if(layoutChanged)miniState.position=null;controlsKey='';
  if(center){
   // A fitted overview follows the new viewport. Deliberately zoomed views keep
   // their scale and center when rotating or opening/closing full-screen view.
   if(fitted)state.scale=Math.min(area.w/fittedBounds.w,area.h/fittedBounds.h);
   state.x=area.x+area.w/2-center.x*state.scale;state.y=area.y+area.h/2-center.y*state.scale;camera.clamp();
  }
  positionMapSwitch();schedule();
 }
 new ResizeObserver(resizeViewport).observe(canvas);
 const canvasHost=$('canvasHost');
 new ResizeObserver(()=>{$('mapAside').style.setProperty('--map-aside-height',canvasHost.getBoundingClientRect().height+'px');positionMapSwitch();}).observe(canvasHost);
 window.addEventListener('resize',resizeViewport);
 // Moving between monitors can change DPR without resizing the CSS viewport.
 // Re-arm after every change: the old resolution query only describes one DPR.
 let resolutionQuery,watchedDPR;
 function pixelRatioChanged(){if(watchedDPR!==(devicePixelRatio||1)){resizeViewport();watchPixelRatio();}}
 function watchPixelRatio(){
  resolutionQuery?.removeEventListener('change',pixelRatioChanged);
  watchedDPR=devicePixelRatio||1;resolutionQuery=matchMedia(`(resolution: ${watchedDPR}dppx)`);
  resolutionQuery.addEventListener('change',pixelRatioChanged);
 }
 watchPixelRatio();
 // Some embedded Chromium environments update DPR without media-query events.
 // This inexpensive visible-page check also covers that case without repainting.
 setInterval(()=>{if(!document.hidden)pixelRatioChanged();},1000);
 $('fit').onclick=frame;$('zoomIn').onclick=()=>zoom(1.5);$('zoomOut').onclick=()=>zoom(1/1.5);
 $('goto').onclick=()=>{const c=coordinateAt(Number($('gotoX').value),Number($('gotoY').value));if(c){message('',true);if(state.editMode){state.scale=Math.max(state.scale,2.5);centerCell(c);}else focus(c);}else message(_t('该坐标不在完整地图内。'),true);};
 for(const id of ['heatmap','palette','filter','markers','blocked','objects','coords','values','colorText','baselineLayer','baselineValues','zeroLayer','zeroValues','grid','players'])$(id).addEventListener('change',schedule);
 $('unitBuffRadius').oninput=()=>{const input=$('unitBuffRadius'),value=Number(input.value);if(!input.value.trim()||!Number.isInteger(value)||value<1||value>32)return;buffs.refresh(90);buffField.refresh();};
 $('unitBuffRadius').onchange=()=>{
  $('unitBuffRadius').value=CrateUnitBuff.radius($('unitBuffRadius').value);
  buffs.refresh(90);
  buffField.refresh();
 };
 function sync(range,input,max){
  $(range).addEventListener('input',()=>{$(input).value=fixed(Number($(range).value));schedule();});
  $(input).addEventListener('input',()=>{const raw=$(input).value,v=Number(raw);if(!raw.trim()||!Number.isFinite(v)||v<0||v>max())return;$(range).value=v;schedule();});
  $(input).addEventListener('change',()=>{const v=Math.max(0,Math.min(max(),Number($(input).value)||0));$(input).value=fixed(v);$(range).value=v;schedule();});
 }
 sync('opacityRange','opacity',()=>100);sync('thresholdRange','threshold',()=>state.data?.probability.sampleCount||1);
 async function openPreview(){const host=$('canvasHost');host.classList.add('preview');document.body.classList.add('preview-open');$('exitFullscreen').hidden=false;try{await host.requestFullscreen();}catch{}schedule();}
 function closePreview(){if(document.fullscreenElement)document.exitFullscreen();$('canvasHost').classList.remove('preview');document.body.classList.remove('preview-open');$('exitFullscreen').hidden=true;}
 $('fullscreen').onclick=openPreview;$('exitFullscreen').onclick=closePreview;document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)closePreview();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('terrain3dDialog').open)closePreview();});
 CrateMapExports.bind({viewCanvas:()=>{
  if(navigationCanvas.hidden)return canvas;const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;const target=image.getContext('2d');target.drawImage(canvas,0,0);const m=miniLayout();if(m)target.drawImage(navigationCanvas,m.x*pixelRatio,m.y*pixelRatio,m.w*pixelRatio,m.h*pixelRatio);return image;
 },getContext:()=>({state,display}),canvas,draw:()=>{regions.flush();if(probabilityMode==='units'||probabilityMode==='crate'&&layerOn('unitBuffOverlay'))buffs.snapshot();stopNavigation();draw();},prepare:async()=>{if(probabilityMode==='buff'){buffField.refresh();await buffField.ready();}},mapOptions,message});
 let liveSlots=null;
 async function loadResult(url,fromJob=false,{preserveView=false,prepared=null,keepSimulation=false,commitIf=()=>true}={}){
  const finishSwitch=keepSimulation?null:beginMapSwitch(),paintSwitch=!keepSimulation&&state.data&&!document.hidden?new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>{clearTimeout(timer);setTimeout(resolve,0);});}):null;
  try{
  stopNavigation();
  if(!keepSimulation){setEditMode(null);simulation?.beforeLoad();}
  const request=resultLoader.request(url,prepared,{onMetadata:keepSimulation?null:(url,data)=>simulation?.prewarm(url,data)});
  try{prepared=await request.ready;if(paintSwitch)await paintSwitch;}catch(error){if(!request.current())return false;if(!keepSimulation)simulation?.loadFailed();throw error;}
  if(!request.current()||!commitIf())return false;
  const {data,base,im,objectImage}=prepared;
  if(!keepSimulation)editHistory.reset();
  url=prepared.url;
  const previous=preserveView&&state.data?.metadata.sourceSha256===data.metadata.sourceSha256?{x:state.x,y:state.y,scale:state.scale,selected:state.selected?[state.selected.x,state.selected.y]:null,threshold:$('threshold').value,position:miniState.position,minimized:miniState.minimized,threeD:$('terrain3dDialog').open}:null;
  liveSlots=null;state.artworkDirty=state.overlayDirty=null;
  camera.stop();regions.beforeLoad({preserveAuto:keepSimulation&&state.data?.metadata.sourceSha256===data.metadata.sourceSha256});state.objectImage=objectImage;$('objects').disabled=!objectImage;
  terrain3d.close();selectionKeyboard?.cancel();++selectionRevision;state.incoming=null;state.outgoing=null;state.prepared=prepared;
  if((state.data?.metadata.sourceSha256||state.data?.metadata.filename)!==(data.metadata.sourceSha256||data.metadata.filename))state.lastPlayer=null;
  state.data=data;state.baseUrl=base;state.image=im;state.selected=null;state.drag=null;miniState.position=null;miniState.minimized=false;state.lookup.clear();display=CrateProbabilityDisplay.map(data,display);
  const meta=data.metadata,title=_i18n?.mapName(meta)||meta.displayName||meta.filename;
  $('mapHeaderTitle').textContent=$('mapHeaderTitle').title=title;
  $('mapHeaderMetadata').textContent=`${meta.size[2]} × ${meta.size[3]} · ${meta.theater}`+(meta.previewOnly?' · '+previewLabel(meta):'');
  $('minimapToggle').setAttribute('aria-pressed',String($('minimap').checked));
  const[ox,oy]=data.rendering.origin;state.cells=[...data.cells].sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.x-b.x);
  for(const c of state.cells){c.px=30*(c.x-c.y)+ox;c.py=15*(c.x+c.y-c.level)+oy;state.lookup.set(`${c.x},${c.y}`,c);}
  state.coordinateSpace=CrateMapCoordinates.create(data,state.lookup);
  state.coordinateSpace?.configure(displayTuning.settings);
  regions.load({preserve:!!previous});
  $('workspace').hidden=false;$('thresholdRange').max=Math.max(Number(previous?.threshold)||0,Math.ceil(display.maxMultiplier*10)/10)||1;$('threshold').max=data.probability?.sampleCount||1;$('thresholdRange').value=previous?.threshold||'0.0';if(!previous||document.activeElement!==$('threshold'))$('threshold').value=previous?.threshold||'0.0';
  details.report(prepared,display,{busy:state.busy,lookup:state.lookup,onFocus:focus});
  syncProbabilityToggle();simulation?.sync();
  if($('recompute'))$('recompute').disabled=state.busy;
  if(previous){
   Object.assign(state,{x:previous.x,y:previous.y,scale:previous.scale});miniState.position=previous.position;miniState.minimized=previous.minimized;
   camera.clamp();const c=previous.selected&&coordinateAt(...previous.selected);if(c)select(c);else deselect();schedule();
   if(previous.threeD&&c&&!c.virtual&&!state.editMode)terrain3d.open();
  }else{resizeViewport();frame();const c=state.lookup.get('99,105')||state.cells.find(c=>c.marked)||state.cells[Math.floor(state.cells.length/2)];select(c);}
  history.replaceState(null,'','maps.html?result='+encodeURIComponent(url));
  if(data.metadata.previewOnly||data.metadata.approximate||!state.busy||fromJob)message(CrateMapDetails.completion(data));
  window.CrateMapViewer={state,draw,focus,frame,loadResult,numerator,thresholdPass,display,simulation,unitBuffs:buffs,buffExpectation:buffField,interaction,displayTuning,paletteTuning,selectionTuning,seaLand,get transferStatus(){return mapViewCache.transferStatus;},get regionRefresh(){return regions.refreshStatus;},get regionsActive(){return regions.active;},get area(){return area;},get viewport(){return {width:W,height:H,pixelRatio};}};
  simulation?.load(prepared,keepSimulation);syncSeaLand();seaLand.refresh();
  // Restoring a report through its URL does not run an analysis job or call
  // setBusy(false). Every committed result must release the initial inert gate.
  syncModeAvailability();
  buffField.refresh();
  }finally{finishSwitch?.();}
 }
 async function applyProbability(snapshot,valid=()=>true){
  const previous=state.data,previousDisplay=display,isPatch=snapshot.probabilityPatch===1;
  if(isPatch){
   if(snapshot.sourceSha256!==previous?.metadata.sourceSha256||snapshot.version!==previous.metadata.version||snapshot.cellCount!==state.cells.length||snapshot.baseRevision!==(previous.probabilityRevision||state.prepared.url))return false;
  }else if(snapshot.metadata?.sourceSha256!==previous?.metadata.sourceSha256||snapshot.metadata?.version!==previous.metadata.version||snapshot.cells?.length!==state.cells.length)return false;
  const incoming=new Map(snapshot.cells.map(c=>[`${c.x},${c.y}`,c]));if(incoming.size!==snapshot.cells.length||[...incoming.keys()].some(k=>!state.lookup.has(k)))return false;
  let data={...previous};
  if(isPatch){
   // Copy only containers on modified paths; baseline and undo reports remain immutable.
   const edit=(path,value,remove=false)=>{let at=data;for(let i=0;i<path.length;i++){const key=path[i];if(['__proto__','prototype','constructor'].includes(key))throw Error('Invalid probability patch');if(i===path.length-1){if(remove)delete at[key];else at[key]=value;}else{at[key]={...at[key]};at=at[key];}}};
   for(const[path,value]of snapshot.sets)edit(path,value);for(const path of snapshot.removed)edit(path,null,true);
   data.probabilityRevision=snapshot.probabilityRevision;
  }else data={...previous,...snapshot,metadata:{...previous.metadata,...snapshot.metadata},rendering:previous.rendering};
  const geometry=['px','py','surface','visibleSurface','surfaceVisibility','labelOffset','cameraCoverage','visibleBand'],changed=new Map();
  for(const[key,value]of incoming){const old=state.lookup.get(key),cell={...value};for(const field of geometry)if(field in old)cell[field]=old[field];changed.set(key,cell);}
  if(snapshot.reweighted){
   const source=previous.cells.map(c=>changed.get(`${c.x},${c.y}`)||c);
   const weighted=await CrateProbabilityDisplay.reweightAsync(source,data.probability,{valid:()=>valid()&&state.data===previous});
   if(!weighted)return false;
   for(const c of weighted)if(c!==state.lookup.get(`${c.x},${c.y}`))changed.set(`${c.x},${c.y}`,c);
  }
  if(!valid()||state.data!==previous)return false;
  if(snapshot.live){
   if(!liveSlots){
    const indices=cells=>{
     const values=new Int32Array(512*512);
     for(let i=0;i<cells.length;i++){const c=cells[i];values[c.y*512+c.x]=i;}
     return values;
    };
    liveSlots={report:indices(previous.cells),view:indices(state.cells)};
    data.cells=previous.cells.slice();state.cells=state.cells.slice();
   }
   for(const cell of changed.values()){
    const index=cell.y*512+cell.x;
    data.cells[liveSlots.report[index]]=cell;
    state.cells[liveSlots.view[index]]=cell;
   }
   const boxes=[];
   const pad=35/state.scale;
   if(!snapshot.reweighted)for(const cell of changed.values()){
    const xs=surface(cell,true).flat().map(p=>p[0]),ys=surface(cell,true).flat().map(p=>p[1]);
    const l=cell.px+Math.min(-30,...xs)-pad,r=cell.px+Math.max(30,...xs)+pad;
    const t=cell.py+Math.min(-15,...ys)-pad,b=cell.py+Math.max(15,...ys)+pad;
    boxes.push([l,t,r-l,b-t]);
   }
   // The view renderer already merges dirty rectangles into physical-pixel
   // tiles. Quantizing here too needlessly expands the same small edit twice.
   state.overlayDirty=snapshot.reweighted?null:(state.overlayDirty||[]).concat(boxes);
   state.liveProbability={revision:snapshot.revision,cells:changed.size,...snapshot.timing};
  }else{
   liveSlots=null;state.overlayDirty=null;
   data.cells=previous.cells.map(c=>changed.get(`${c.x},${c.y}`)||c);
   state.cells=state.cells.map(c=>changed.get(`${c.x},${c.y}`)||c);
  }
  const cellChanges=[...changed].map(([key,cell])=>[state.lookup.get(key),cell]);
  state.data=data;state.prepared={...state.prepared,data};
  for(const[key,cell]of changed)state.lookup.set(key,cell);
  if(state.selected)state.selected=coordinateAt(state.selected.x,state.selected.y);state.incoming=null;state.outgoing=null;++selectionRevision;
  display=CrateProbabilityDisplay.map(data,display,snapshot.live?[...changed.values()]:null,snapshot.maximumNumerator);
  if(snapshot.live){
   const change={cells:cellChanges,previousData:previous,previousDisplay,compatible:display._coeff===previousDisplay._coeff&&display.baselineNumerator===previousDisplay.baselineNumerator};
   applyingProbability=true;try{regions.updateCells(changed.values());buffs.updateCells(cellChanges,change);regions.probabilityChanged(change);}finally{applyingProbability=false;}
  }
  function updateDetails(){
   $('thresholdRange').max=Math.max(Number($('threshold').value)||0,Math.ceil(display.maxMultiplier*10)/10)||1;
   details.update(state.prepared,display,{busy:state.busy,lookup:state.lookup,onFocus:focus});
   if(state.selected)details.cell(state.selected,state.data,display);
  }
  if(snapshot.live)updateDetails();
  else{regions.beforeLoad({preserveAuto:true});regions.load({preserve:true,allowAuto:false});updateDetails();}
  if(window.CrateMapViewer)window.CrateMapViewer.display=display;
  // Warm the new numerical field only after exact crate data is installed.
  // Hidden views coalesce successive edits; the terrain raster is independent.
  buffField.update(previous,cellChanges,{geometryStable:true});schedule();return true;
 }

 function mapHit(p){const mini=miniLayout();return minimap.contains(area,p)&&!(mini&&minimap.contains(mini,p));}
 simulation=CrateSimulationUI.create({editHistory,applyProbability,onBlocked:reasons=>{const target=document.activeElement,box=target?.getBoundingClientRect?.(),point=target===canvas?simulation?.pointerClient:null;showEditNotice(point||{clientX:box?box.x+box.width/2:innerWidth/2,clientY:box?box.y+box.height/2:innerHeight/2},reasons.join("\n"));},getArea:()=>area,getRegionMembership:regions.membership,getRegionCursor:regions.cursorInfo,hasRegionBrush:()=>regions.canAdjustSize,activateMode:(mode='place')=>setEditMode(mode),onCtrlPicker:ctrlPicker,onSample:kind=>{if(ctrlRegionPreview)ctrlRegionPreview.picked=kind;if(kind==='region'){setLayer('regionColorOverlay',true);regions.overlayChanged();schedule();}},onInteractionEnd:()=>camera.settle(),onInteraction:rememberPlayer,isRegionPicker:()=>regions.picking,finishRegionPicker:regions.finishPicking,sampleRegion:regions.sampleRegion,selectRegion:regions.selectSample,getState:()=>state,loadResult,setBusy,message,schedule,pick,pointer,hit:mapHit});
 syncModeAvailability();
 $('simulationPlaceTab').onclick=()=>setEditMode('place');
 $('viewMode').onclick=()=>setEditMode(null);
 for(const [id,mode] of [['simulationPanel','place'],['viewToolbar',null],['regionToolbar','region']]){
  const toolbar=$(id);
  const activate=e=>{if(e.target.closest?.('#simulationUndo,#simulationRedo,#regionUndo,#regionRedo'))return;if((!mode||state.data&&!state.busy&&!state.data.metadata.previewOnly)&&(e.button===undefined||e.button===0))setEditMode(mode);};
  for(const type of ['pointerdown','click','change','focusin'])toolbar.addEventListener(type,activate,true);
 }
 document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey||!['z','y'].includes(e.key.toLowerCase())||e.target.closest?.('input,select,textarea,[contenteditable]')||document.querySelector('dialog[open]'))return;
  e.preventDefault();e.stopImmediatePropagation();void editHistory[e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo']();
 },true);
 for(const [id,button,key] of [['simulationPanel','simulationPlaceTab','1'],['viewToolbar','viewMode','2'],['regionToolbar','regionToggle','3']]){
  const mark=document.createElement('kbd');mark.className='mode-shortcut';mark.textContent=key;mark.setAttribute('aria-hidden','true');$(id).append(mark);$(button).setAttribute('aria-keyshortcuts',key);
 }
 document.addEventListener('keyup',e=>{if(e.key==='Control')state.ctrlResizing=false;});
 window.addEventListener('blur',()=>{state.ctrlResizing=false;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)state.ctrlResizing=false;});
 document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(e.key==='Control'&&!e.repeat)state.ctrlResizing=false;
  const dialog=document.querySelector('dialog[open]'),viewButton=dialog?.id==='terrain3dDialog'?$('terrain3dProbability'):!dialog?$('probabilityToggle'):null;
  if((e.code==='Space'||e.key===' ')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!viewInputFocus(e.target)&&viewButton&&!viewButton.disabled){
   e.preventDefault();e.stopImmediatePropagation();(dialog?$('terrain3dCanvas'):canvas).focus({preventScroll:true});if(!e.repeat){if(e.shiftKey)viewButton.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));else viewButton.click();}return;
  }
  if(dialog)return;
  if(e.key==='Escape'){
   e.preventDefault();e.stopImmediatePropagation();regions.cancel();regions.finishPicking();setEditMode(null);simulation.cancelInteraction();$('viewMode').focus({preventScroll:true});closePreview();return;
  }
  const sizeKey=['-','_','+','='].includes(e.key);
  if(e.ctrlKey||e.metaKey||(e.altKey||e.shiftKey)&&!sizeKey||inputFocus(e.target))return;
  const controller=state.editMode==='place'?simulation:state.editMode==='region'?regions:null;
  if(sizeKey&&state.data&&!state.busy){
   const delta=['-','_'].includes(e.key)?-1:1;
   e.preventDefault();e.stopImmediatePropagation();
   if(e.target===canvas||!controller?.adjustSize(delta)){canvas.focus({preventScroll:true});zoom(delta>0?1.5:1/1.5);}
   else simulation.refreshCursor();
   return;
  }
  const key=e.key.toLowerCase();
  if(controller&&state.data&&!state.busy){
   const handled=controller.shortcut(key);
   if(handled){e.preventDefault();e.stopImmediatePropagation();canvas.focus({preventScroll:true});simulation.refreshCursor();return;}
  }
  const modes={'1':'place','2':null,'3':'region'};
  if(e.repeat||!Object.hasOwn(modes,e.key)||!state.data||state.busy||state.data.metadata.previewOnly&&modes[e.key])return;
  e.preventDefault();e.stopImmediatePropagation();canvas.focus({preventScroll:true});setEditMode(modes[e.key]);
 },true);
 async function analyze(file,official=null){
  if(state.busy)return;const finishSwitch=beginMapSwitch();resultLoader.invalidate();setBusy(true);message('',true);message(_t('准备读取地图'));
  try{if(platform){
    if(file&&platform.upload){
     const version=importVersion.choice==='auto'?(importVersion.suggest(file.name)||'yr'):importVersion.choice;importVersion.show(version);
     await loadResult(await platform.upload(file,version,true,status=>{message(status.progress>=80?_t('正在绘制地图…'):_t('正在分析地图…'));$('progress').value=status.progress;}),true);return;
    }
    if(!official)throw Error(_t('此地图版本不在当前预计算列表中。'));
    importVersion.show(official.version);
    message(_t('正在加载地图…'));
    await loadResult(await platform.official(official.id,official.version,true),true);return;
   }
   const choice=official?.version||importVersion.choice,version=await CrateResourceUI.resolve(choice,importVersion.suggest(file?.name)||'yr');if(!version){message(_t('请检查资源提示后重新开始分析。'));return;}importVersion.show(version);const endpoint=official?'/api/maps/official?'+new URLSearchParams({version,id:official.id}):file?'/api/maps/analyze?version='+version+'&filename='+encodeURIComponent(file.name):'/api/maps/heck?version='+version;
   const job=await CrateLocalAPI.json(endpoint+'&minerals='+'1',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file||null});
   await loadResult(await jobResult(job),true);
  }catch(e){message(e.message,true);message(_t('分析未完成；之前的结果保留。'));}
  finally{finishSwitch();setBusy(false);$('mapFile').value='';}
 }
 CrateOfficialMaps.create({onAnalyze:official=>analyze(null,official),...(platform?{loadCatalog:platform.catalog,precomputed:true}:{})});
 if($('recompute')){
  let recomputing=false;
  $('recompute').hidden=false;
  $('recompute').onclick=async()=>{
   if(state.busy||!state.data||recomputing)return;
   recomputing=true;$('recompute').disabled=true;
   message('',true);
   try{await simulation.recompute();}catch(error){message(error.message,true);}
   finally{recomputing=false;$('recompute').disabled=state.busy||!state.data;}

  };
 }
 async function analyzeSaved(version){
  if(state.busy||!state.data)return;
  const finishSwitch=beginMapSwitch();setBusy(true);message('',true);
  try{
   const response=await fetch(state.baseUrl+'source.map');if(!response.ok)throw Error(_t('原地图记录无法读取，请重新导入地图。'));
   const file=new File([await response.blob()],state.data.metadata.filename);
   importVersion.use(version==='shikong'?'directory':version);
   setBusy(false);await analyze(file);
  }catch(error){message(error.message,true);}finally{finishSwitch();setBusy(false);}
 }
 $('retryMod').onclick=()=>analyzeSaved('directory');
 $('reanalyzeResources').onclick=()=>analyzeSaved($('version').value);
 if(globalThis.CrateResourceUI)CrateResourceUI.onApplied=(version,resources)=>{
  importVersion.use(version);
  const meta=state.data?.metadata;
  if(meta&&!meta.previewOnly&&version===meta.version&&(
   ['ra2','yr'].includes(version)||version==='directory'&&resources?.ready&&resources.fingerprint&&resources.fingerprint===meta.resourceFingerprint
  ))return;
  return analyzeSaved(version);
 };
 $('retryApprox').onclick=()=>analyzeSaved(state.data.metadata.version);
 $('mapFile').onchange=()=>{const file=$('mapFile').files[0];if(file)analyze(file);};
 const drop=$('dropzone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');const file=e.dataTransfer.files[0];if(file)analyze(file);});
 const existing=new URLSearchParams(location.search).get('result');
 if(platform){
  setBusy(true);message(_t('正在加载地图…'));
  platform.initial(location.search).then(url=>loadResult(url,true)).catch(error=>message(error.message,true)).finally(()=>setBusy(false));
 }else{
  if(existing&&/^\/output\/[a-zA-Z0-9_-]+\/result\.json$/.test(existing))loadResult(existing).catch(e=>message(e.message,true));
  fetch('/api/maps/health').then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{if(v.feature!=='real-maps-v1')throw Error();}).catch(()=>message(_t('当前服务尚未加载真实地图接口。请关闭旧演示服务，再运行“启动演示.cmd”。已有结果仍可查看。'),true));
 }
})();
