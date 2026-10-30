/* All displayed probabilities come from the integer backend result.
 * View state (filter, threshold, pan, zoom) never changes the probability model.
 */
(() => {
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const $=id=>document.getElementById(id), canvas=$('map'), ctx=canvas.getContext('2d');
 const platform=globalThis.CrateMapPlatform;
 const area={x:24,y:70,w:1552,h:820};let W=1600,H=1050,pixelRatio=1,compact=false;
 const occupancy=CrateOccupancyOverlay;
 const minimap=CrateMinimap;
 let selectionRevision=0,selectionKeyboard=null;
 const state={data:null,image:null,cells:[],lookup:new Map(),selected:null,scale:1,x:0,y:0,drag:null,baseUrl:'',busy:false,visible:0,scheduled:false};
 const readResult=CrateMapResults.createReader(platform?{readJSON:platform.readJSON,readBinary:platform.readBinary}:{}),resultLoader=CrateMapResults.createLoader(readResult);
 const mineralLayouts=CrateMineralLayouts.create({request:(...args)=>CrateLocalAPI.json(...args),read:readResult,load:platform?.minerals});
 let mineralIdleTimer=null,mineralIdleCallback=null,mineralToastTimer=null;
 function cancelMineralPreload(){clearTimeout(mineralIdleTimer);if(mineralIdleCallback!==null)window.cancelIdleCallback?.(mineralIdleCallback);mineralIdleCallback=null;}
 function scheduleMineralPreload(delay=2200){
  cancelMineralPreload();
  if(platform?.preload===false||!state.data||state.busy||document.hidden)return;
  const data=state.data,target=data.metadata.mineralsEnabled===false;
  if(mineralLayouts.has(target)||mineralLayouts.pending(target))return;
  mineralIdleTimer=setTimeout(()=>{
   const start=()=>{
    mineralIdleCallback=null;
    if(state.data!==data||state.busy||document.hidden)return;
    if(state.drag||regions.dragging){scheduleMineralPreload();return;}
    mineralLayouts.get(target,null,{background:true}).catch(error=>{
     // Another tab may be analyzing. Retry when idle; other failures stay
     // silent until the user explicitly switches, which can retry normally.
     if(error.status===409&&state.data===data)scheduleMineralPreload(6000);
    });
   };
   if(window.requestIdleCallback)mineralIdleCallback=window.requestIdleCallback(start,{timeout:3000});else start();
  },delay);
 }
 for(const event of ['pointerdown','wheel','keydown','visibilitychange'])document.addEventListener(event,()=>scheduleMineralPreload(),{passive:true});
 function mineralToast(title,detail='',kind='loading'){
  clearTimeout(mineralToastTimer);
  const toast=$('mineralToast');toast.hidden=false;toast.dataset.kind=kind;
  if($('mineralToastTitle').textContent!==title)$('mineralToastTitle').textContent=title;
  if($('mineralToastDetail').textContent!==detail)$('mineralToastDetail').textContent=detail;
  if(kind!=='loading')mineralToastTimer=setTimeout(()=>{toast.hidden=true;},kind==='error'?6500:1800);
 }
 const terrain3d=platform?.terrain3d===false?{open(){},close(){},select(){}}:CrateTerrain3D.create({loadPatch:platform?.terrain3dPatch,getContext:()=>state.selected?{cell:state.selected,data:state.data,result:state.baseUrl+'result.json',probability:state.data.metadata.previewOnly?null:{display,lookup:state.lookup,options:mapOptions()}}:null,onSelect:(x,y)=>{const c=state.lookup.get(`${x},${y}`);if(c)select(c);}});
 $('terrain3dOpen').onclick=()=>terrain3d.open();
 const details=CrateMapDetails.create();
 const {previewLabel,failurePercent}=CrateMapDetails;
 let display;
 const miniState={position:null,minimized:false};let miniToggleBox=null;
 const mapViewCache=CrateMapRenderer.createViewCache(),miniArtwork=new WeakMap();
 let controlsKey='',legendCache=null;
 const regions=CrateRegionStatisticsUI.create({getState:()=>state,getDisplay:()=>display,schedule,pick,area,onMode:enabled=>{
  if(enabled)deselect();
  $('heatmap').checked=$('values').checked=!enabled&&!state.data?.metadata.previewOnly;
  syncProbabilityToggle();
 }});
 function syncProbabilityToggle(){
  const heat=!$('heatmap').disabled&&$('heatmap').checked,values=!$('values').disabled&&$('values').checked,mixed=heat!==values;
  $('probabilityToggle').textContent=_t('概率:')+(mixed?_t('混合'):heat?_t('开'):_t('关'));
  $('probabilityToggle').setAttribute('aria-pressed',mixed?'mixed':String(heat));
  $('probabilityToggle').disabled=$('heatmap').disabled;
 }
 $('probabilityToggle').onclick=()=>{const enabled=!($('heatmap').checked&&$('values').checked);$('heatmap').checked=$('values').checked=enabled;syncProbabilityToggle();schedule();};
 function syncMineralToggle(){
  const enabled=state.data?.metadata.mineralsEnabled!==false;
  const mixed=!enabled&&state.data?.metadata.treesEnabled!==false;
  $('mineralToggle').textContent=_t('矿石/树木:')+(mixed?_t('混合'):enabled?_t('开'):_t('关'));
  $('mineralToggle').setAttribute('aria-pressed',mixed?'mixed':String(enabled));
  $('mineralToggle').disabled=!state.data||state.busy;
  $('mineralStatus').textContent=enabled?'':state.data?.metadata.previewOnly?_t('矿石/树木已关闭：预置矿石／宝石和树木已移除，3D 和导出同步；概率仍未计算。矿石钻井及其他地形物保留，不模拟后续生长。'):_t('矿石/树木已关闭：预置矿石／宝石和树木已移除，概率、来源、区域统计、3D 和导出均使用此布局；矿石钻井及其他地形物保留，不模拟后续生长。');
  $('mineralStatus').hidden=enabled;
  if(platform&&!enabled)$('mineralStatus').textContent=_t('矿石/树木已关闭：已载入无矿石、无树木布局，来源、区域统计及图片导出均使用对应概率。');
  if(mixed)$('mineralStatus').textContent=_t('旧版布局仅移除了矿石，树木仍保留；点击“矿石/树木”可重新计算完整关闭状态。');
 }
 function setBusy(value){
  _i18n?.setBusy('analysis',value);
  if(value)cancelMineralPreload();
  state.busy=value;$('loadHeck').disabled=$('mapFile').disabled=value;$('progress').hidden=!value;
  globalThis.CrateResourceUI?.setAnalyzing(value);
  $('retryMod').disabled=value;
  $('resourcesOpen').disabled=$('version').disabled=value;
  $('reanalyzeResources').disabled=value||!state.data;
  if($('recompute'))$('recompute').disabled=value||!state.data;
  $('retryApprox').disabled=value;
  if(value)$('progress').value=0;
  syncMineralToggle();
  if(!value)scheduleMineralPreload();
 }
 const jobResult=job=>CrateLocalAPI.waitForMapJob(job,{onProgress:status=>{message(status.message);$('progress').value=status.progress;}});
 $('mineralToggle').onclick=async()=>{
  if(state.busy||!state.data)return;
  const enabled=state.data.metadata.mineralsEnabled===false&&state.data.metadata.treesEnabled===false;
  const label=enabled?_t('有矿石和树木'):_t('无矿石、无树木');
  setBusy(true);message('',true);message(_t`正在切换为${enabled?_t('有矿石和树木'):_t('无矿石、无树木')}布局，完成后同步更新${state.data.metadata.previewOnly?_t('预览画面'):_t('画面与概率')}…`);
  mineralToast(_t`正在切换为${label}布局…`,_t('正在加载，当前画面暂时保留'));
  try{
   // Let the toast paint even when an already-decoded result is ready.
   await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
   const prepared=await mineralLayouts.get(enabled,status=>{
    $('progress').value=status.progress||0;
    mineralToast(_t`正在切换为${label}布局…`,status.message+(status.progress>0&&status.progress<100?` · ${status.progress}%`:''));
   });
   await loadResult(prepared.url,true,{preserveView:true,prepared});
   mineralToast(_t`已切换为${label}布局`,state.data.metadata.previewOnly?_t('地图预览已同步'):_t('地图与概率已同步'),'success');
  }catch(error){message(error.message,true);message(_t('矿石/树木状态未切换；保留原布局和概率，可重试。'));mineralToast(_t('切换未完成，已保留原布局'),error.message,'error');}
  finally{setBusy(false);}
 };
 for(const id of ['heatmap','values'])$(id).addEventListener('change',syncProbabilityToggle);
 const fixed=n=>Number(n).toFixed(1), pct=CrateProbabilityDisplay.percent;
 function message(text,error=false){$(error?'error':'status').textContent=text;}
 function schedule(){if(!state.scheduled){state.scheduled=true;requestAnimationFrame(()=>{state.scheduled=false;draw();});}}
 function diamond(x,y,rx,ry){ctx.beginPath();ctx.moveTo(x,y-ry);ctx.lineTo(x+rx,y);ctx.lineTo(x,y+ry);ctx.lineTo(x-rx,y);ctx.closePath();}
 function text(value,x,y,color='#dce9f1',size=16,align='left',maxWidth){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y,maxWidth??(align==='right'?x-26:align==='left'?W-x-26:W));}
 function numerator(c){return display.get(c).numerator;}
 function thresholdPass(c){return display.meetsThreshold(c,Number($('threshold').value)||0);}
 const multiplier=c=>display.get(c).multiplier;
 function frame(){const r=state.data.rendering;state.scale=Math.min(area.w/r.width,area.h/r.height);state.x=area.x+(area.w-r.width*state.scale)/2;state.y=area.y+(area.h-r.height*state.scale)/2;schedule();}
 function zoom(factor,px=area.x+area.w/2,py=area.y+area.h/2){const next=Math.max(.06,Math.min(6,state.scale*factor));state.x=px-(px-state.x)*next/state.scale;state.y=py-(py-state.y)*next/state.scale;state.scale=next;schedule();}
 function centerCell(c){state.x=area.x+area.w/2-c.px*state.scale;state.y=area.y+area.h/2-c.py*state.scale;schedule();}
 function focus(c){select(c);state.scale=Math.max(state.scale,2.5);centerCell(c);}
 function moveSelection(direction){
  const c=minimap.neighbor(state.lookup,state.selected,direction);if(!c)return;
  select(c);const p={x:state.x+c.px*state.scale,y:state.y+c.py*state.scale},m=miniLayout();
  if(p.x<area.x+60||p.x>area.x+area.w-60||p.y<area.y+60||p.y>area.y+area.h-60||m&&minimap.contains(m,p))centerCell(c);
 }
 const surface=CrateMapRenderer.surface;
 function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const[a,b]=ring[i],[u,v]=ring[j];if((b>y)!==(v>y)&&x<(u-a)*(y-b)/(v-b)+a)inside=!inside;}return inside;}
 function pointOnSurface(c,x,y){let inside=false;for(const ring of surface(c))if(pointInRing(x-c.px,y-c.py,ring))inside=!inside;return inside;}
 function miniLayout(){return state.data&&$('minimap').checked?minimap.layout(state.data.rendering,area,{...miniState,compact}):null;}
 function setMinimap(enabled){$('minimap').checked=enabled;$('webNavigator')?.setAttribute('aria-pressed',String(enabled));if(enabled){miniState.position=null;miniState.minimized=false;}schedule();}
 function canvasButton(box,label,active=false,disabled=false){
  ctx.fillStyle=disabled?'#11212b':active?'#2b4351':'#192c38';ctx.strokeStyle=disabled?'#293d4b':active?'#d8b66d':'#567184';ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(box.x,box.y,box.w,box.h,5);ctx.fill();ctx.stroke();
  text(label,box.x+box.w/2,box.y+box.h/2+5,disabled?'#49606e':active?'#f5ce80':'#dce9f1',label===_t('地图导航')?15:18,'center',box.w-12);
 }
 function syncCanvasControls(m){
  const rect=canvas.getBoundingClientRect(),host=$('canvasHost'),hr=host.getBoundingClientRect();
  const scale=Math.min(rect.width/W,rect.height/H),x=rect.left-hr.left-host.clientLeft+(rect.width-W*scale)/2,y=rect.top-hr.top-host.clientTop+(rect.height-H*scale)/2;
  const key=JSON.stringify([x,y,scale,m?.x,m?.y,m?.w,m?.h,m?.minimized,miniToggleBox,state.selected?.x,state.selected?.y,state.baseUrl]);
  if(key===controlsKey)return;controlsKey=key;
  const controls=[['minimapToggle',miniToggleBox],['minimapMinimize',m?.buttons.minimize],['minimapClose',m?.buttons.close],['navCenter',m?.buttons.center],...minimap.directions.map(d=>['nav'+d.id,m?.navigation?.find(n=>n.id===d.id)?.box])];
  for(const[id,box]of controls){
   const button=$(id);button.hidden=!box;if(box)Object.assign(button.style,{left:x+box.x*scale+'px',top:y+box.y*scale+'px',width:box.w*scale+'px',height:box.h*scale+'px'});
  }
  $('minimapToggle').setAttribute('aria-pressed',String($('minimap').checked));
  const action=miniState.minimized?_t('还原地图导航'):_t('最小化地图导航');$('minimapMinimize').setAttribute('aria-label',action);$('minimapMinimize').title=action;
  $('navCenter').disabled=!state.selected;
  for(const d of minimap.directions){const c=minimap.neighbor(state.lookup,state.selected,d),button=$('nav'+d.id);button.disabled=!c;button.title=c?`${d.name}：(${c.x}, ${c.y})`:(state.selected?_t('该方向已到地图边缘'):_t('请先选择格子'));}
 }
 function miniPan(p){Object.assign(state,minimap.pan(miniLayout(),p,area,state.scale,state.data.rendering));schedule();}
 function drawMinimap(){
  const m=miniLayout();syncCanvasControls(m);if(!m)return;
  const r=state.data.rendering,im=m.image;ctx.save();ctx.beginPath();ctx.roundRect(m.x,m.y,m.w,m.h,9);ctx.fillStyle='rgba(10,24,34,.96)';ctx.fill();ctx.strokeStyle='#567180';ctx.lineWidth=1;ctx.stroke();
  if(!m.minimized)text(compact?_t('地图导航'):_t('地图导航 · 拖动移动'),m.x+10,m.y+(compact?29:23),'#dbe9f2',13,'left',m.w-(compact?96:20));
  canvasButton(m.buttons.minimize,m.minimized?'□':'−');canvasButton(m.buttons.close,'×');
  if(m.minimized){ctx.restore();return;}
  const artwork=$('objects').checked&&state.objectImage?state.objectImage:state.image;
  let small=miniArtwork.get(artwork);if(!small){small=document.createElement('canvas');small.width=Math.ceil(im.w);small.height=Math.ceil(im.h);CrateMapArtwork.draw(small.getContext('2d'),artwork,0,0,small.width,small.height);miniArtwork.set(artwork,small);}
  ctx.drawImage(small,im.x,im.y,im.w,im.h);
  regions.minimap(ctx,im);
  for(const [coords,enabled,color]of [[state.data.markers,$('markers').checked,'#ff77c6'],[state.data.potentialMarkers||[],$('potentialMarkers').checked,'#ed9dca']])if(enabled){ctx.fillStyle=color;for(const p of coords){const c=state.lookup.get(p.join(','));ctx.fillRect(im.x+c.px*im.scale-1.5,im.y+c.py*im.scale-1.5,3,3);}}
  const v=minimap.viewport(m,area,state,r);if(v){ctx.fillStyle='rgba(255,255,255,.12)';ctx.fillRect(v.x,v.y,v.w,v.h);ctx.strokeStyle='#0b1720';ctx.lineWidth=4;ctx.strokeRect(v.x,v.y,v.w,v.h);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(v.x,v.y,v.w,v.h);}
  if(state.selected){ctx.beginPath();ctx.arc(im.x+state.selected.px*im.scale,im.y+state.selected.py*im.scale,3,0,Math.PI*2);ctx.fillStyle='#ffe18f';ctx.fill();ctx.strokeStyle='#332916';ctx.lineWidth=1;ctx.stroke();}
  if($('players').checked)CratePlayerStarts.draw(ctx,state,im,{radius:8,clip:im,regionStyles:regions.playerStyles()});
  if(compact){ctx.restore();return;}
  ctx.beginPath();ctx.moveTo(m.x+12,m.y+195);ctx.lineTo(m.x+m.w-12,m.y+195);ctx.strokeStyle='#2c4453';ctx.lineWidth=1;ctx.stroke();
  text(_t('移动选中格'),m.x+14,m.y+225,'#c9dbe7',13);
  text(state.selected?`(${state.selected.x}, ${state.selected.y})`:_t('未选择'),m.x+14,m.y+251,state.selected?'#ffe0a0':'#849eae',15);
  text(_t('方向键：可组合'),m.x+14,m.y+279,'#91a9b9',11);
  text(_t('◎：居中查看'),m.x+14,m.y+298,'#91a9b9',11);
  text(_t('长按连续移动'),m.x+14,m.y+316,'#708c9e',10);
  for(const d of m.navigation)canvasButton(d.box,d.label,false,!minimap.neighbor(state.lookup,state.selected,d));
  canvasButton(m.buttons.center,'◎',!!state.selected,!state.selected);
  ctx.restore();
 }
 function mapOptions({snapshotRegions=false}={}){
  const options={filter:$('filter').value,palette:$('palette').value,opacity:Number($('opacity').value)||0,threshold:Number($('threshold').value)||0};
  for(const key of ['heatmap','blocked','objects','grid','potentialMarkers','markers','coords','values','baselineValues','players'])options[key]=$(key).checked;
  if(state.data?.metadata.previewOnly)for(const key of ['heatmap','values','baselineValues','markers','potentialMarkers'])options[key]=false;
  if(state.data?.metadata.approximate)options.markers=options.potentialMarkers=false;
  if(regions.active){options.regionLayer=snapshotRegions?regions.snapshotLayer():(ctx,view,cells)=>regions.render(ctx,view,cells);options.regionLabels=snapshotRegions?options.regionLayer.labels:regions.labels;options.playerRegionStyles=regions.playerStyles();}
  return options;
 }
 function drawRegionHover(){
  const info=regions.hoverInfo(),cell=info?.cell;
  if(!cell){text(info?_t('未指向地图格子'):_t('区域统计 · 指向格子查看区域'),1574,1028,'#9bb2c2',14,'right');return;}
  if(!info.regions.length){text(_t`指向 (${cell.x}, ${cell.y}) · ${info.selectable?_t('未划分区域'):_t('不可选区域')}`,1574,1028,'#b2c7d6',14,'right');return;}
  ctx.save();ctx.font='14px "Microsoft YaHei",sans-serif';
  const tokens=[{label:_t`指向 (${cell.x}, ${cell.y}) · 区域`,color:null},...info.regions.map(r=>({label:r.id.slice(1),color:r.color}))];
  const rows=[[]];let width=0;
  for(const token of tokens){
   token.width=ctx.measureText(token.label).width+(token.color?23:0)+12;
   if(width+token.width>758){rows.push([]);width=0;}rows[rows.length-1].push(token);width+=token.width;
  }
  // Dense overlaps wrap upward within the right-hand information block.
  // Clear that portion of the legend rather than drawing status text over it.
  const top=1028-(rows.length-1)*22-16;ctx.fillStyle='#101c25';ctx.fillRect(800,top,778,rows.length*22);
  rows.forEach((row,i)=>{
   let x=1574-row.reduce((n,t)=>n+t.width,0)+12;const y=1028-(rows.length-1-i)*22;
   for(const t of row){
    if(t.color){ctx.beginPath();ctx.roundRect(x,y-11,12,12,3);ctx.fillStyle=t.color;ctx.fill();ctx.strokeStyle='#d8e8f266';ctx.lineWidth=1;ctx.stroke();}
    text(t.label,x+(t.color?20:0),y,'#e1ecef',14);x+=t.width;
   }
  });ctx.restore();
 }
 function draw(){
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#101c25';ctx.fillRect(0,0,W,H);if(!state.data)return;
  if(compact){
   const result=mapViewCache.render(ctx,state,area,display,mapOptions());miniToggleBox=null;drawMinimap();state.visible=result.colored;
   const info=$('mobileMapInfo');
   if(info){const c=state.selected,name=_i18n?.mapName(state.data.metadata)||state.data.metadata.displayName||state.data.metadata.filename;
    const value=name+(c?` · (${c.x}, ${c.y}) · ${fixed(multiplier(c))}×`:'')+(state.incoming?_t` · ${state.incoming.sources.length} 个转入起点`:'');
    if(info.textContent!==value)info.textContent=value;}
   return;
  }
  const d=state.data,p=d.probability,r=d.rendering;
  const metadataText=`${d.metadata.size[2]} × ${d.metadata.size[3]} · ${d.metadata.theater} · ${d.metadata.previewOnly?previewLabel(d.metadata):d.metadata.approximate?_t('近似概率 · 不保证准确'):_t('随机帧精确平均')}`;
  ctx.font='16px "Microsoft YaHei",sans-serif';const toggleWidth=_i18n?.language==='en'?132:96;miniToggleBox={x:1574-ctx.measureText(metadataText).width-toggleWidth-22,y:13,w:toggleWidth,h:32};
  ctx.save();ctx.beginPath();ctx.rect(24,0,miniToggleBox.x-42,60);ctx.clip();text((_i18n?.mapName(d.metadata)||d.metadata.displayName||d.metadata.filename)+(d.metadata.previewOnly?_t(' · 地图外观'):_t(' · 工具箱落点概率'))+(d.metadata.mineralsEnabled===false?_t(d.metadata.treesEnabled===false?' · 无矿石、无树木':' · 仅无矿石（旧版）'):''),26,34,'#edf3f7',23);ctx.restore();
  canvasButton(miniToggleBox,_t('地图导航'),$('minimap').checked);
  text(metadataText,1574,34,'#9fb6c7',16,'right');
  const options=mapOptions(),minimum=options.threshold;
  const {colored}=mapViewCache.render(ctx,state,area,display,options);
  ctx.strokeStyle='#294151';ctx.lineWidth=1;ctx.strokeRect(area.x,area.y,area.w,area.h);
  drawMinimap();
  if(d.metadata.previewOnly){text(previewLabel(d.metadata)+_t(' · 未计算概率和放箱禁行风险'),26,936,'#f1cf88',20);text(_t('已保留可读取的地形与对象；加载告警见地图上方。'),26,978,'#bacfdd',16);$('thresholdInfo').textContent=_t('外观预览，不计算概率');return;}
  text(_t`本图 1× 基准：${pct(display.baselineProbability)} · 单次放箱调用`,26,928,'#d8e6f0',16);
  text(_t`落箱 ${pct(p.finalSuccess)} · 未生成实体 ${pct(p.finalGhost)} · 重试耗尽 ${failurePercent(p)}`,1574,928,'#cbdbe6',15,'right');
  const legendX=26,legendY=952,legendWidth=740;
  const legendKey=display.maxMultiplier+options.palette;
  if(legendCache?.key!==legendKey){const image=document.createElement('canvas');image.width=legendWidth;image.height=15;const target=image.getContext('2d');
   for(let i=0;i<legendWidth;i++){const value=Math.expm1(Math.log1p(display.maxMultiplier)*i/legendWidth);target.fillStyle=CrateProbability.color(value,options.palette,display.maxMultiplier);target.fillRect(i,0,1,15);}legendCache={key:legendKey,image};}
  ctx.drawImage(legendCache.image,legendX,legendY);
  for(let i=0;i<=4;i++){const v=Math.expm1(Math.log1p(display.maxMultiplier)*i/4);text(fixed(v)+'×',legendX+legendWidth*i/4,987,'#a9becd',13,i===0?'left':i===4?'right':'center');}
  text(_t('红：地图 · 蓝：镜头可视 · 琥珀：可视禁区 · 绿：占用标识'),808,956,'#bacfdd',14);
  if(d.metadata.approximate){text(_t('近似：未知格选中后重抽 · 禁行风险未验证'),808,982,'#f1cf88',14);}else{
  ctx.strokeStyle='#ff77c6';ctx.lineWidth=2;ctx.strokeRect(808,970,14,12);text(_t('粉：当前可出箱，放箱后禁行'),830,982,'#ffc3e4',13);
  ctx.fillStyle='rgba(241,156,206,.20)';ctx.fillRect(1115,970,14,12);ctx.strokeStyle='#ed9dca';ctx.strokeRect(1115,970,14,12);ctx.beginPath();ctx.moveTo(1115,980);ctx.lineTo(1125,970);ctx.moveTo(1121,982);ctx.lineTo(1129,974);ctx.stroke();text(_t('斜纹粉：清空对象后潜在禁行'),1138,982,'#edb6d5',13);
  }
  const transparency=Number($('opacity').value)||0;
  const opacityText=_t`0% 不透明 · 100% 全透明；1× 基准格自动淡化，当前透明度 ${fixed(Math.sqrt(transparency/100)*100)}%。`;if($('opacityInfo').textContent!==opacityText)$('opacityInfo').textContent=opacityText;
  text(_t`≥ ${fixed(minimum)}× · 透明度 ${fixed(transparency)}% / 1× 格 ${fixed(Math.sqrt(transparency/100)*100)}% · ${$('heatmap').checked?_t('开'):_t('关')}`,808,1005,'#a2b8c9',14);
  text(state.incoming?_t`青蓝：${state.incoming.sources.length} 个转入起点 · ${state.scale<28/30?_t('放大查看：从该格出发 → 选中格的概率'):_t('从该格出发 → 选中格的概率')} · 深色概率更高`:_t('灰暗：镜头不可视 · 金色：选中格（实线可见 / 虚线遮挡）'),26,1028,state.incoming?'#8deafa':'#819aab',14);
  if(regions.active)drawRegionHover();else text(state.selected?_t`选中 (${state.selected.x},${state.selected.y})  高度 ${state.selected.level}  ${fixed(multiplier(state.selected))}×${state.selected.marked?_t('  放箱后不可通行'):state.selected.potentialMarked?_t('  清空对象后潜在禁行'):''}`:_t('滚轮缩放 / 拖动平移'),1574,1028,'#b2c7d6',14,'right');
  state.visible=colored;
  const thresholdText=_t`≥ ${fixed(minimum)}×（最终概率 ${pct(minimum*display.baselineProbability)}）；当前视窗着色 ${colored} 格。仅影响显示。`;if($('thresholdInfo').textContent!==thresholdText)$('thresholdInfo').textContent=thresholdText;
 }
 async function showSources(c){
  const revision=++selectionRevision,data=state.data;
  state.incoming=null;details.transfer(null);
  if(data.metadata.previewOnly||!c.terms.length)return;
  try{
   const index=await state.prepared.getSources();
   if(revision!==selectionRevision||data!==state.data||state.selected!==c)return;
   const incoming=index.get(c);state.incoming=incoming;
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
  ++selectionRevision;state.selected=null;state.incoming=null;
  details.clear();
  schedule();
 }
 function select(c){
  state.selected=c;$('gotoX').value=c.x;$('gotoY').value=c.y;$('selectedCoord').textContent=`${c.x}, ${c.y}`;
  $('terrain3dOpen').disabled=platform?.terrain3d===false;$('terrain3dOpen').title=_t`以 (${c.x}, ${c.y}) 为中心查看附近地形`;terrain3d.select(c);
  showSources(c);
  details.cell(c,state.data,display);schedule();
 }
 function pointer(e){const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/W,r.height/H);return{x:(e.clientX-r.left-(r.width-W*scale)/2)/scale,y:(e.clientY-r.top-(r.height-H*scale)/2)/scale};}
 let touchBrush=true,touchGesture=null,touchSuppressed=false;const touches=new Map();
 function touchPair(){const [a,b]=[...touches.values()].slice(0,2);return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))}:null;}
 function startPinch(){const p=touchPair();if(!p)return;regions.cancel();regions.leave();state.drag=null;touchSuppressed=true;touchGesture={...p,scale:state.scale,mapX:(p.x-state.x)/state.scale,mapY:(p.y-state.y)/state.scale};}
 if(platform){
  const button=document.createElement('button');button.id='touchMode';button.type='button';button.textContent=_t('触控：画笔');button.setAttribute('aria-pressed','true');
  button.onclick=()=>{touchBrush=!touchBrush;regions.cancel();button.textContent=_t(touchBrush?'触控：画笔':'触控：移动');button.setAttribute('aria-pressed',String(touchBrush));};$('regionToolbar').prepend(button);
  const info=document.createElement('div');info.id='mobileMapInfo';info.setAttribute('role','status');info.setAttribute('aria-live','polite');$('canvasHost').append(info);
 }
 function pick(pos){const x=(pos.x-state.x)/state.scale,y=(pos.y-state.y)/state.scale;
  const cells=state.spatialIndex?state.spatialIndex.query(x-65,y-130,x+65,y+130):state.cells;
  for(let i=cells.length-1;i>=0;i--){const c=cells[i];if(Math.abs(x-c.px)<=65&&Math.abs(y-c.py)<=130&&pointOnSurface(c,x,y))return c;}return null;}
 canvas.addEventListener('wheel',e=>{if(!state.data)return;e.preventDefault();if(regions.dragging)return;regions.leave();const p=pointer(e),m=miniLayout();if(m&&minimap.contains(m,p)||miniToggleBox&&minimap.contains(miniToggleBox,p))return;zoom(Math.exp(-e.deltaY*.0015),p.x,p.y);},{passive:false});
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
  state.drag={...p,pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,startX:state.x,startY:state.y,startMini:m,moved:false,mode};
  if(e.button===2)e.preventDefault();if(mode==='overview')miniPan(p);if(mode==='panel'||mode==='pan')canvas.style.cursor='grabbing';canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'&&touches.has(e.pointerId)){
   touches.set(e.pointerId,pointer(e));
   if(touchGesture){const p=touchPair();if(p){const scale=Math.max(.06,Math.min(6,touchGesture.scale*p.distance/touchGesture.distance));state.scale=scale;state.x=p.x-touchGesture.mapX*scale;state.y=p.y-touchGesture.mapY*scale;schedule();}return;}
   if(touchSuppressed)return;
  }
  const p=pointer(e),d=state.drag,m=miniLayout();if(d&&d.pointerId!==e.pointerId)return;
  if(!d){if(m&&minimap.contains(m,p))regions.leave();else regions.move(p,false,e);canvas.style.cursor=m&&minimap.contains(m,p)&&(m.minimized||p.y<m.y+34)?'grab':'crosshair';return;}
  if(d.mode==='region'){regions.move(p,!!m&&minimap.contains(m,p),e);return;}
  if(d.mode==='overview'){miniPan(p);return;}if(Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)>4)d.moved=true;
  if(d.moved&&d.mode==='panel'){miniState.position=minimap.position(area,{x:d.startMini.x+p.x-d.x,y:d.startMini.y+p.y-d.y},m.w,m.h);schedule();}
  else if(d.moved&&(d.mode==='map'||d.mode==='pan')){regions.leave();state.x=d.startX+p.x-d.x;state.y=d.startY+p.y-d.y;schedule();}
 });
 canvas.addEventListener('pointerup',e=>{
  touches.delete(e.pointerId);
  if(e.pointerType==='touch'&&touchSuppressed){touchGesture=null;if(!touches.size)touchSuppressed=false;state.drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);return;}
  const d=state.drag;if(d&&d.pointerId!==e.pointerId)return;if(d?.mode==='region'){const p=pointer(e),m=miniLayout();regions.move(p,!!m&&minimap.contains(m,p),e);regions.up();}else if(e.button===0&&d?.mode==='map'&&!d.moved&&Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)<=4){const c=pick(pointer(e));if(c){if(c===state.selected)deselect();else select(c);}}state.drag=null;canvas.style.cursor='crosshair';if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointercancel',()=>{touches.clear();touchGesture=null;touchSuppressed=false;regions.cancel();state.drag=null;canvas.style.cursor='crosshair';});
 canvas.addEventListener('lostpointercapture',()=>{regions.cancel();state.drag=null;});
 canvas.addEventListener('pointerleave',()=>regions.leave());
 window.addEventListener('blur',()=>{state.drag=null;touches.clear();touchGesture=null;touchSuppressed=false;});
 canvas.addEventListener('dblclick',e=>{if(regions.active)return;const p=pointer(e),m=miniLayout();if(!minimap.contains(area,p)||m&&minimap.contains(m,p))return;const c=pick(p);if(c)zoom(1.5,p.x,p.y);});
 $('minimapToggle').onclick=()=>setMinimap(!$('minimap').checked);
 $('minimapMinimize').onclick=()=>{miniState.minimized=!miniState.minimized;schedule();};
 $('minimapClose').onclick=()=>{setMinimap(false);$('minimapToggle').focus();};
 $('minimap').addEventListener('change',()=>setMinimap($('minimap').checked));
 for(const d of minimap.directions)$('nav'+d.id).onclick=()=>moveSelection(d);
 $('navCenter').onclick=()=>{if(state.selected)centerCell(state.selected);};
 function keyboardEnabled(target=document.activeElement){
  const editable=target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="spinbutton"],[role="slider"]');
  const rect=canvas.getBoundingClientRect();
  return !regions.active&&!!state.selected&&!state.busy&&!state.drag&&!editable&&!document.querySelector('dialog[open]')&&!document.hidden&&rect.bottom>0&&rect.top<window.innerHeight;
 }
 selectionKeyboard=CrateSelectionKeyboard.create({enabled:keyboardEnabled,move:({horizontal,vertical})=>{
  const direction=minimap.directions.find(d=>d.col===horizontal+1&&d.row===vertical+1);if(direction)moveSelection(direction);
 }});
 document.addEventListener('keydown',e=>{
  if(!CrateSelectionKeyboard.arrows.has(e.key))return;
  if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||!keyboardEnabled(e.target)){selectionKeyboard.cancel();return;}
  if(selectionKeyboard.down(e.key,e.repeat))e.preventDefault();
 });
 document.addEventListener('keyup',e=>{selectionKeyboard.up(e.key);});
 document.addEventListener('pointerdown',()=>selectionKeyboard.cancel(),true);
 document.addEventListener('focusin',e=>{if(!keyboardEnabled(e.target))selectionKeyboard.cancel();});
 window.addEventListener('blur',()=>selectionKeyboard.cancel());
 document.addEventListener('visibilitychange',()=>{if(document.hidden)selectionKeyboard.cancel();});
 function resizeViewport(){
  if(!platform){schedule();return;}
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const nextCompact=matchMedia('(max-width:760px), (pointer: coarse) and (max-width:1100px), (orientation:landscape) and (max-height:600px) and (max-width:1200px)').matches,nextW=nextCompact?Math.round(rect.width):1600,nextH=nextCompact?Math.round(rect.height):1050,ratio=nextCompact?Math.min(2,devicePixelRatio||1):1;
  if(nextW===W&&nextH===H&&compact===nextCompact&&pixelRatio===ratio){schedule();return;}
  const center=state.data?{x:(area.x+area.w/2-state.x)/state.scale,y:(area.y+area.h/2-state.y)/state.scale}:null;
  const oldFit=state.data?Math.min(area.w/state.data.rendering.width,area.h/state.data.rendering.height):0;
  const fitted=oldFit>0&&Math.abs(state.scale/oldFit-1)<.01;
  W=nextW;H=nextH;compact=nextCompact;pixelRatio=ratio;canvas.width=Math.round(W*ratio);canvas.height=Math.round(H*ratio);
  Object.assign(area,compact?{x:8,y:8,w:W-16,h:H-16}:{x:24,y:70,w:1552,h:820});miniState.position=null;controlsKey='';
  if(center){
   // A fitted overview follows the new viewport. Deliberately zoomed views keep
   // their scale and center when rotating or opening/closing full-screen view.
   if(fitted)state.scale=Math.min(area.w/state.data.rendering.width,area.h/state.data.rendering.height);
   state.x=area.x+area.w/2-center.x*state.scale;state.y=area.y+area.h/2-center.y*state.scale;
  }
  schedule();
 }
 new ResizeObserver(resizeViewport).observe(canvas);
 $('fit').onclick=frame;$('zoomIn').onclick=()=>zoom(1.5);$('zoomOut').onclick=()=>zoom(1/1.5);
 $('goto').onclick=()=>{const c=state.lookup.get(`${Number($('gotoX').value)},${Number($('gotoY').value)}`);if(c){message('',true);if(regions.active){state.scale=Math.max(state.scale,2.5);centerCell(c);}else focus(c);}else message(_t('该坐标不在完整地图内。'),true);};
 for(const id of ['heatmap','palette','filter','markers','potentialMarkers','blocked','objects','coords','values','baselineValues','grid','players'])$(id).addEventListener('change',schedule);
 function sync(range,input,max){
  $(range).addEventListener('input',()=>{$(input).value=fixed(Number($(range).value));schedule();});
  $(input).addEventListener('input',()=>{const v=Number($(input).value);if(Number.isFinite(v))$(range).value=Math.max(0,Math.min(max(),v));schedule();});
  $(input).addEventListener('change',()=>{const v=Math.max(0,Math.min(max(),Number($(input).value)||0));$(input).value=fixed(v);$(range).value=v;schedule();});
 }
 sync('opacityRange','opacity',()=>100);sync('thresholdRange','threshold',()=>state.data?.probability.sampleCount||1);
 async function openPreview(){const host=$('canvasHost');host.classList.add('preview');document.body.classList.add('preview-open');$('exitFullscreen').hidden=false;try{await host.requestFullscreen();}catch{}schedule();}
 function closePreview(){if(document.fullscreenElement)document.exitFullscreen();$('canvasHost').classList.remove('preview');document.body.classList.remove('preview-open');$('exitFullscreen').hidden=true;}
 $('fullscreen').onclick=openPreview;$('exitFullscreen').onclick=closePreview;document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)closePreview();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('terrain3dDialog').open)closePreview();});
 CrateMapExports.bind({getContext:()=>({state,display}),canvas,draw,mapOptions,message});
 async function loadResult(url,fromJob=false,{preserveView=false,prepared=null}={}){
  const request=resultLoader.request(url,prepared);
  try{prepared=await request.ready;}catch(error){if(!request.current())return false;throw error;}
  if(!request.current())return false;
  const {data,base,im,objectImage}=prepared;
  const previous=preserveView&&state.data?.metadata.sourceSha256===data.metadata.sourceSha256?{x:state.x,y:state.y,scale:state.scale,selected:state.selected?[state.selected.x,state.selected.y]:null,threshold:$('threshold').value,position:miniState.position,minimized:miniState.minimized,threeD:$('terrain3dDialog').open}:null;
  regions.beforeLoad();state.objectImage=objectImage;$('objects').disabled=!objectImage;
  terrain3d.close();selectionKeyboard?.cancel();++selectionRevision;state.incoming=null;state.prepared=prepared;
  state.data=data;state.baseUrl=base;state.image=im;state.selected=null;state.drag=null;miniState.position=null;miniState.minimized=false;state.lookup.clear();display=CrateProbabilityDisplay.map(data);
  const[ox,oy]=data.rendering.origin;state.cells=[...data.cells].sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.x-b.x);
  for(const c of state.cells){c.px=30*(c.x-c.y)+ox;c.py=15*(c.x+c.y-c.level)+oy;state.lookup.set(`${c.x},${c.y}`,c);}
  regions.load({preserve:!!previous});
  $('workspace').hidden=false;$('thresholdRange').max=Math.max(Number(previous?.threshold)||0,Math.ceil(display.maxMultiplier*10)/10)||1;$('threshold').max=data.probability?.sampleCount||1;$('threshold').value=$('thresholdRange').value=previous?.threshold||'0.0';
  details.report(prepared,display,{busy:state.busy,lookup:state.lookup,onFocus:focus});
  syncProbabilityToggle();syncMineralToggle();
  if($('recompute'))$('recompute').disabled=state.busy;
  if(previous){
   Object.assign(state,{x:previous.x,y:previous.y,scale:previous.scale});miniState.position=previous.position;miniState.minimized=previous.minimized;
   const c=previous.selected&&state.lookup.get(previous.selected.join(','));if(c)select(c);else deselect();schedule();
   if(previous.threeD&&c)terrain3d.open();
  }else{resizeViewport();frame();const c=state.lookup.get('99,105')||state.cells.find(c=>c.marked)||state.cells[Math.floor(state.cells.length/2)];select(c);}
  history.replaceState(null,'','maps.html?result='+encodeURIComponent(url));
  if(data.metadata.previewOnly||data.metadata.approximate||!state.busy||fromJob)message(platform?_t('预计算地图已加载')+' · '+(_i18n?.mapName(data.metadata)||data.metadata.displayName||data.metadata.filename)+' · '+(data.metadata.version==='ra2'?_t('原版'):_t('尤里')):CrateMapDetails.completion(data));
  window.CrateMapViewer={state,draw,focus,frame,loadResult,numerator,thresholdPass,display,get area(){return area;}};
  mineralLayouts.use(prepared,{reset:!previous});scheduleMineralPreload();
 }
 async function analyze(file,official=null){
  if(state.busy)return;resultLoader.invalidate();setBusy(true);message('',true);message(_t('准备读取地图'));
  try{if(platform){
    if(!official)throw Error(_t('此地图版本不在当前预计算列表中。'));
    message(_t('正在加载预计算地图…'));
    await loadResult(await platform.official(official.id,official.version,state.data?.metadata.mineralsEnabled!==false),true);return;
   }
   const choice=official?.version||$('version').value;if(official){$('version').value=choice;$('version').dispatchEvent(new Event('change'));}const version=await CrateResourceUI.resolve(choice);if(!version){message(_t('请检查资源提示后重新开始分析。'));return;}const endpoint=official?'/api/maps/official?'+new URLSearchParams({version,id:official.id}):file?'/api/maps/analyze?version='+version+'&filename='+encodeURIComponent(file.name):'/api/maps/heck?version='+version;
   const job=await CrateLocalAPI.json(endpoint+'&minerals='+(state.data?.metadata.mineralsEnabled===false?'0':'1'),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file||null});
   await loadResult(await jobResult(job),true);
  }catch(e){message(e.message,true);message(_t('分析未完成；之前的结果保留。'));}
  finally{setBusy(false);$('mapFile').value='';}
 }
 CrateOfficialMaps.create({onAnalyze:official=>analyze(null,official),...(platform?{loadCatalog:platform.catalog,precomputed:true}:{})});
 if($('recompute')){
  $('recompute').hidden=!!platform;
  $('recompute').onclick=async()=>{
   if(state.busy||!state.data)return;
   resultLoader.invalidate();setBusy(true);message('',true);message(_t('正在重新计算当前地图…'));
   try{
    const job=await CrateLocalAPI.json('/api/maps/recompute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:state.prepared.url})});
    await loadResult(await jobResult(job),true,{preserveView:true});
    mineralLayouts.use(state.prepared,{reset:true});
   }catch(error){message(error.message,true);message(_t('分析未完成；之前的结果保留。'));}
   finally{setBusy(false);}
  };
 }
 async function analyzeSaved(version){
  if(state.busy||!state.data)return;
  setBusy(true);message('',true);
  try{
   const response=await fetch(state.baseUrl+'source.map');if(!response.ok)throw Error(_t('原地图记录无法读取，请重新导入地图。'));
   const file=new File([await response.blob()],state.data.metadata.filename);
   $('version').value=version==='shikong'?'directory':version;$('version').dispatchEvent(new Event('change'));
   setBusy(false);await analyze(file);
  }catch(error){message(error.message,true);}finally{setBusy(false);}
 }
 $('retryMod').onclick=()=>analyzeSaved('directory');
 $('reanalyzeResources').onclick=()=>analyzeSaved($('version').value);
 if(globalThis.CrateResourceUI)CrateResourceUI.onApplied=version=>analyzeSaved(version);
 $('retryApprox').onclick=()=>analyzeSaved(state.data.metadata.version);
 $('mapFile').onchange=()=>{const file=$('mapFile').files[0];if(file)analyze(file);};
 const drop=$('dropzone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');const file=e.dataTransfer.files[0];if(file)analyze(file);});
 const existing=new URLSearchParams(location.search).get('result');
 if(platform){
  setBusy(true);message(_t('正在加载预计算地图…'));
  platform.initial(location.search).then(url=>loadResult(url,true)).catch(error=>message(error.message,true)).finally(()=>setBusy(false));
 }else{
  if(existing&&/^\/output\/[a-zA-Z0-9_-]+\/result\.json$/.test(existing))loadResult(existing).catch(e=>message(e.message,true));
  fetch('/api/maps/health').then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{if(v.feature!=='real-maps-v1')throw Error();}).catch(()=>message(_t('当前服务尚未加载真实地图接口。请关闭旧演示服务，再运行“启动演示.cmd”。已有结果仍可查看。'),true));
 }
})();
