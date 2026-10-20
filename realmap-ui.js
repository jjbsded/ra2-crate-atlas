/* All displayed probabilities come from the integer backend result.
 * View state (filter, threshold, pan, zoom) never changes the probability model.
 */
(() => {
 'use strict';
 const $=id=>document.getElementById(id), canvas=$('map'), ctx=canvas.getContext('2d');
 const area={x:24,y:70,w:1552,h:820}, W=1600,H=1050;
 const occupancy=CrateOccupancyOverlay;
 const minimap=CrateMinimap;
 const removalNames={building:'建筑',mineral:'矿物',terrain:'树木／地形物',unit:'单位'};
 const removalText=c=>(c.removable||[]).map(o=>`${removalNames[o.category]||o.category} ${o.type}`).join('、')||'其他格子的占用（影响附近搜索）';
 const landNames=['普通地面（Clear）','道路（Road）','水面（Water）','不可通行地面（Rock）','围墙（Wall）','矿石地面（Tiberium）','海滩（Beach）','粗糙地面（Rough）','冰面（Ice）','铁轨（Railroad）','隧道（Tunnel）'];
 const state={data:null,image:null,cells:[],lookup:new Map(),selected:null,scale:1,x:0,y:0,drag:null,baseUrl:'',busy:false,visible:0,scheduled:false};
 let coefficients=[],denominator=1n,display;
 const miniState={position:null,minimized:false};let miniToggleBox=null;
 const fixed=n=>Number(n).toFixed(1), pct=CrateProbabilityDisplay.percent;
 function message(text,error=false){$(error?'error':'status').textContent=text;}
 function schedule(){if(!state.scheduled){state.scheduled=true;requestAnimationFrame(()=>{state.scheduled=false;draw();});}}
 function diamond(x,y,rx,ry){ctx.beginPath();ctx.moveTo(x,y-ry);ctx.lineTo(x+rx,y);ctx.lineTo(x,y+ry);ctx.lineTo(x-rx,y);ctx.closePath();}
 function text(value,x,y,color='#dce9f1',size=16,align='left'){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y);}
 function numerator(c){if(c.exactN===undefined)c.exactN=c.terms.reduce((a,[id,count])=>a+coefficients[id]*BigInt(count),0n);return c.exactN;}
 function thresholdPass(c){return display.meetsThreshold(c,Number($('threshold').value)||0);}
 const multiplier=c=>display.get(c).multiplier;
 function frame(){const r=state.data.rendering;state.scale=Math.min(area.w/r.width,area.h/r.height);state.x=area.x+(area.w-r.width*state.scale)/2;state.y=area.y+(area.h-r.height*state.scale)/2;schedule();}
 function zoom(factor,px=area.x+area.w/2,py=area.y+area.h/2){const next=Math.max(.06,Math.min(6,state.scale*factor));state.x=px-(px-state.x)*next/state.scale;state.y=py-(py-state.y)*next/state.scale;state.scale=next;schedule();}
 function focus(c){select(c);state.scale=Math.max(state.scale,2.5);state.x=area.x+area.w/2-c.px*state.scale;state.y=area.y+area.h/2-c.py*state.scale;schedule();}
 const surface=CrateMapRenderer.surface;
 function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const[a,b]=ring[i],[u,v]=ring[j];if((b>y)!==(v>y)&&x<(u-a)*(y-b)/(v-b)+a)inside=!inside;}return inside;}
 function pointOnSurface(c,x,y){let inside=false;for(const ring of surface(c))if(pointInRing(x-c.px,y-c.py,ring))inside=!inside;return inside;}
 function miniLayout(){return state.data&&$('minimap').checked?minimap.layout(state.data.rendering,area,miniState):null;}
 function setMinimap(enabled){$('minimap').checked=enabled;if(enabled){miniState.position=null;miniState.minimized=false;}schedule();}
 function canvasButton(box,label,active=false){
  ctx.fillStyle=active?'#2b4351':'#192c38';ctx.strokeStyle=active?'#d8b66d':'#567184';ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(box.x,box.y,box.w,box.h,5);ctx.fill();ctx.stroke();
  text(label,box.x+box.w/2,box.y+box.h/2+5,active?'#f5ce80':'#dce9f1',label==='小地图'?15:18,'center');
 }
 function syncCanvasControls(m){
  const rect=canvas.getBoundingClientRect(),host=$('canvasHost'),hr=host.getBoundingClientRect();
  const scale=Math.min(rect.width/W,rect.height/H),x=rect.left-hr.left-host.clientLeft+(rect.width-W*scale)/2,y=rect.top-hr.top-host.clientTop+(rect.height-H*scale)/2;
  for(const[id,box]of [['minimapToggle',miniToggleBox],['minimapMinimize',m?.buttons.minimize],['minimapClose',m?.buttons.close]]){
   const button=$(id);button.hidden=!box;if(box)Object.assign(button.style,{left:x+box.x*scale+'px',top:y+box.y*scale+'px',width:box.w*scale+'px',height:box.h*scale+'px'});
  }
  $('minimapToggle').setAttribute('aria-pressed',String($('minimap').checked));
  const action=miniState.minimized?'还原小地图':'最小化小地图';$('minimapMinimize').setAttribute('aria-label',action);$('minimapMinimize').title=action;
 }
 function miniPan(p){Object.assign(state,minimap.pan(miniLayout(),p,area,state.scale,state.data.rendering));schedule();}
 function drawMinimap(){
  const m=miniLayout();syncCanvasControls(m);if(!m)return;
  const r=state.data.rendering,im=m.image;ctx.save();ctx.fillStyle='rgba(10,24,34,.94)';ctx.fillRect(m.x,m.y,m.w,m.h);ctx.strokeStyle='#688293';ctx.lineWidth=1;ctx.strokeRect(m.x,m.y,m.w,m.h);
  if(!m.minimized)text('小地图 · 拖动移动',m.x+10,m.y+23,'#dbe9f2',13);
  canvasButton(m.buttons.minimize,m.minimized?'□':'−');canvasButton(m.buttons.close,'×');
  if(m.minimized){ctx.restore();return;}
  ctx.drawImage($('objects').checked&&state.objectImage?state.objectImage:state.image,im.x,im.y,im.w,im.h);
  for(const [coords,enabled,color]of [[state.data.markers,$('markers').checked,'#ff77c6'],[state.data.potentialMarkers||[],$('potentialMarkers').checked,'#ed9dca']])if(enabled){ctx.fillStyle=color;for(const p of coords){const c=state.lookup.get(p.join(','));ctx.fillRect(im.x+c.px*im.scale-1.5,im.y+c.py*im.scale-1.5,3,3);}}
  const v=minimap.viewport(m,area,state,r);if(v){ctx.fillStyle='rgba(255,255,255,.12)';ctx.fillRect(v.x,v.y,v.w,v.h);ctx.strokeStyle='#0b1720';ctx.lineWidth=4;ctx.strokeRect(v.x,v.y,v.w,v.h);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(v.x,v.y,v.w,v.h);}
  if(state.selected){ctx.beginPath();ctx.arc(im.x+state.selected.px*im.scale,im.y+state.selected.py*im.scale,3,0,Math.PI*2);ctx.fillStyle='#ffe18f';ctx.fill();ctx.strokeStyle='#332916';ctx.lineWidth=1;ctx.stroke();}
  ctx.restore();
 }
 function mapOptions(){
  const options={filter:$('filter').value,palette:$('palette').value,opacity:Number($('opacity').value)||0,threshold:Number($('threshold').value)||0};
  for(const key of ['heatmap','blocked','objects','grid','potentialMarkers','markers','coords','values','baselineValues'])options[key]=$(key).checked;
  if(state.data?.metadata.previewOnly)for(const key of ['heatmap','values','baselineValues','markers','potentialMarkers'])options[key]=false;
  return options;
 }
 function draw(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#101c25';ctx.fillRect(0,0,W,H);if(!state.data)return;
  const d=state.data,p=d.probability,r=d.rendering;
  const metadataText=`${d.metadata.size[2]} × ${d.metadata.size[3]} · ${d.metadata.theater} · ${d.metadata.previewOnly?'目录资源外观预览':'随机帧精确平均'}`;
  ctx.font='16px "Microsoft YaHei",sans-serif';miniToggleBox={x:1574-ctx.measureText(metadataText).width-108,y:13,w:86,h:32};
  ctx.save();ctx.beginPath();ctx.rect(24,0,miniToggleBox.x-42,60);ctx.clip();text(d.metadata.filename+(d.metadata.previewOnly?' · 地图外观':' · 工具箱落点概率'),26,34,'#edf3f7',23);ctx.restore();
  canvasButton(miniToggleBox,'小地图',$('minimap').checked);
  text(metadataText,1574,34,'#9fb6c7',16,'right');
  const options=mapOptions(),minimum=options.threshold;
  const {colored}=CrateMapRenderer.render(ctx,state,area,display,options);
  ctx.strokeStyle='#294151';ctx.lineWidth=1;ctx.strokeRect(area.x,area.y,area.w,area.h);
  drawMinimap();
  if(d.metadata.previewOnly){text('所选游戏目录 外观预览 · 尚未计算概率和放箱禁行风险',26,936,'#f1cf88',20);text('建筑／单位显示开关同时作用于主视图、小地图和导出的图片。',26,978,'#bacfdd',16);$('thresholdInfo').textContent='外观预览，不计算概率';return;}
  text('相对倍率：仅直接抽中、无邻格转入 = 1×（保留最终概率比例）',26,928,'#d8e6f0',16);
  text(`落箱 ${pct(p.finalSuccess)} · 无实体 ${pct(p.finalGhost)} · 禁行 ${d.markers.length} / 移除后潜在 ${d.potentialMarkers?.length??'未计算'} 格`,1574,928,'#cbdbe6',15,'right');
  const legendX=26,legendY=952,legendWidth=740;
  for(let i=0;i<legendWidth;i++){const value=Math.expm1(Math.log1p(display.maxMultiplier)*i/legendWidth);ctx.fillStyle=CrateProbability.color(value,$('palette').value,display.maxMultiplier);ctx.fillRect(legendX+i,legendY,1,15);}
  for(let i=0;i<=4;i++){const v=Math.expm1(Math.log1p(display.maxMultiplier)*i/4);text(fixed(v)+'×',legendX+legendWidth*i/4,987,'#a9becd',13,i===0?'left':i===4?'right':'center');}
  text('红：地图 · 蓝：镜头可视 · 琥珀：可视禁区 · 绿：建筑/单位',808,956,'#bacfdd',14);
  ctx.strokeStyle='#ff77c6';ctx.lineWidth=2;ctx.strokeRect(808,970,14,12);text('粉：当前可出箱，放箱后禁行',830,982,'#ffc3e4',13);
  ctx.fillStyle='rgba(241,156,206,.20)';ctx.fillRect(1115,970,14,12);ctx.strokeStyle='#ed9dca';ctx.strokeRect(1115,970,14,12);ctx.beginPath();ctx.moveTo(1115,980);ctx.lineTo(1125,970);ctx.moveTo(1121,982);ctx.lineTo(1129,974);ctx.stroke();text('斜纹粉：移除占用后潜在禁行',1138,982,'#edb6d5',13);
  const transparency=Number($('opacity').value)||0;
  text(`≥ ${fixed(minimum)}× · 透明度 ${fixed(transparency)}% / 1× 格 ${fixed(Math.sqrt(transparency/100)*100)}% · ${$('heatmap').checked?'开启':'关闭'}`,808,1005,'#a2b8c9',14);
  text(`灰暗：镜头不可视 · 顶部禁区整格显示 · 格线/概率随坡面与遮挡`,26,1028,'#819aab',14);
  text(state.selected?`选中 (${state.selected.x},${state.selected.y})  高度 ${state.selected.level}  ${fixed(multiplier(state.selected))}×${state.selected.marked?'  放箱后不可通行':state.selected.potentialMarked?'  移除占用后潜在禁行':''}`:'滚轮缩放 / 拖动平移',1574,1028,'#b2c7d6',14,'right');
  state.visible=colored;
  $('thresholdInfo').textContent=`≥ ${fixed(minimum)}×（最终概率 ${pct(minimum*display.baselineProbability)}）；当前视窗着色 ${colored} 格。`;
 }
 function appendRow(table,label,value){const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;td.textContent=value;tr.append(th,td);table.append(tr);}
 function select(c){
  state.selected=c;$('gotoX').value=c.x;$('gotoY').value=c.y;$('selectedCoord').textContent=`${c.x}, ${c.y}`;
  const info=$('cellInfo');info.replaceChildren();const table=document.createElement('table');info.append(table);
  if(state.data.metadata.previewOnly){appendRow(table,'模式','目录资源外观预览（未计算概率）');appendRow(table,'高度 / 坡型',`${c.level} / ${c.slope}`);appendRow(table,'对象',c.objects.join(', ')||'无');appendRow(table,'Overlay',c.overlayName||'无');appendRow(table,'TMP',`${c.file} / ${c.subTile}`);schedule();return;}
  appendRow(table,'相对倍率',fixed(multiplier(c))+'×'+(display.get(c).isBaseline?'（基准格）':''));appendRow(table,'最终概率',pct(c.probability));
  appendRow(table,'高度 / 坡型',`${c.level} / ${c.slope}`);appendRow(table,'原始 / 当前地面',`${landNames[c.rawLand]} → ${landNames[c.land]}`);
  appendRow(table,'放箱后地面（预测）',c.status==='crate'?landNames[c.postLand]:'无实体／未放置');
  appendRow(table,'可用边界',c.usable?'范围内':c.visibleBand?'顶部可视禁区（不可移动／建造）':'范围外');appendRow(table,'镜头显示范围',c.cameraCoverage===undefined?'旧版':fixed(c.cameraCoverage*100)+'%（边界按显示范围裁切）');appendRow(table,'表面可见',c.surfaceVisibility===undefined?'旧版平面显示':fixed(c.surfaceVisibility*100)+'%（其余被地形遮挡）');appendRow(table,'投影分组',c.primary?'首选':'次选');
  appendRow(table,'Overlay',c.overlayName||'空');appendRow(table,'占用',c.objects.join(', ')||'无');
  if(occupancy.mapCell(c))appendRow(table,'占用阻挡','建筑／单位占用，无法作为附近搜索候选（绿色）');
  if(c.potentialMarked){appendRow(table,'移除对象',removalText(c));appendRow(table,'移除后 → 再放箱',`${landNames[c.clearance.land]} → ${landNames[c.clearance.postLand]}`);appendRow(table,'移除后的落箱条件','存在随机落箱路径（未计算新概率）');}
  appendRow(table,'TMP',`${c.file} / ${c.subTile}`);
  const note=document.createElement('p');note.className='cause';
  note.textContent=c.marked?`箱子能在这里出现，但放箱会改变该格的通行属性，普通步兵和履带车辆随后无法走入拾取。不是箱子贴图挡路，而是附近高地触发了地面重算。相关高格：${c.higher.map(([x,y,l])=>`(${x},${y}) 高 ${l}`).join('；')}。`:
   c.potentialMarked?`斜纹粉色：当前未标为放箱后禁行格；在建筑、矿物、树木／地形物及单位完全移除、不留下废墟的假设布局中，本格能随机出箱，随后变成普通步兵和履带车辆无法进入的地面。上方概率仍对应当前布局。相关高格：${c.higher.map(([x,y,l])=>`(${x},${y}) 高 ${l}`).join('；')}。`:
   c.clearance?.rockTransition?'移除占用后具备放箱禁行的地形条件，但未找到随机落箱路径，因此不加斜纹标记。':
   c.rockTransition?'该格具备放箱后禁行的地形条件，但当前没有随机落箱路径，因此不加实色粉色标记。':
   c.status==='ghost'?'坡型大于 4：可能进入候选；最终 Overlay 放置被拒绝，Put 却报成功。其权重计入“坡面无实体”，不会转移到其他格。':
   c.terms.length?'在当前模型中随机出箱概率大于 0；未发现放箱会使该格变得不可通行。此结论不等于已确认有完整路线能到达。':'当前静态布局中实际落箱概率为 0。';
  info.append(note);
  for(const id of ['markerList','potentialList'])for(const b of $(id).children)b.classList.toggle('selected',b.dataset.key===`${c.x},${c.y}`);
  schedule();
 }
 function pointer(e){const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/W,r.height/H);return{x:(e.clientX-r.left-(r.width-W*scale)/2)/scale,y:(e.clientY-r.top-(r.height-H*scale)/2)/scale};}
 function pick(pos){const x=(pos.x-state.x)/state.scale,y=(pos.y-state.y)/state.scale;
  for(let i=state.cells.length-1;i>=0;i--){const c=state.cells[i];if(Math.abs(x-c.px)<=65&&Math.abs(y-c.py)<=130&&pointOnSurface(c,x,y))return c;}return null;}
 canvas.addEventListener('wheel',e=>{if(!state.data)return;e.preventDefault();const p=pointer(e),m=miniLayout();if(m&&minimap.contains(m,p)||miniToggleBox&&minimap.contains(miniToggleBox,p))return;zoom(Math.exp(-e.deltaY*.0015),p.x,p.y);},{passive:false});
 canvas.addEventListener('pointerdown',e=>{
  if(!state.data||e.button!==0)return;const p=pointer(e),m=miniLayout();let mode='map';
  if(m&&minimap.contains(m,p))mode=m.minimized||p.y<m.y+34?'panel':minimap.contains(m.image,p)?'overview':'chrome';
  else if(!minimap.contains(area,p))return;
  state.drag={...p,startX:state.x,startY:state.y,startMini:m,moved:false,mode};
  if(mode==='overview')miniPan(p);if(mode==='panel')canvas.style.cursor='grabbing';canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{
  const p=pointer(e),d=state.drag,m=miniLayout();if(!d){canvas.style.cursor=m&&minimap.contains(m,p)&&(m.minimized||p.y<m.y+34)?'grab':'crosshair';return;}
  if(d.mode==='overview'){miniPan(p);return;}if(Math.hypot(p.x-d.x,p.y-d.y)>4)d.moved=true;
  if(d.moved&&d.mode==='panel'){miniState.position=minimap.position(area,{x:d.startMini.x+p.x-d.x,y:d.startMini.y+p.y-d.y},m.w,m.h);schedule();}
  else if(d.moved&&d.mode==='map'){state.x=d.startX+p.x-d.x;state.y=d.startY+p.y-d.y;schedule();}
 });
 canvas.addEventListener('pointerup',e=>{if(state.drag?.mode==='map'&&!state.drag.moved){const c=pick(pointer(e));if(c)select(c);}state.drag=null;canvas.style.cursor='crosshair';if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);});
 canvas.addEventListener('pointercancel',()=>{state.drag=null;canvas.style.cursor='crosshair';});
 canvas.addEventListener('dblclick',e=>{const p=pointer(e),m=miniLayout();if(!minimap.contains(area,p)||m&&minimap.contains(m,p))return;const c=pick(p);if(c)focus(c);});
 $('minimapToggle').onclick=()=>setMinimap(!$('minimap').checked);
 $('minimapMinimize').onclick=()=>{miniState.minimized=!miniState.minimized;schedule();};
 $('minimapClose').onclick=()=>{setMinimap(false);$('minimapToggle').focus();};
 $('minimap').addEventListener('change',()=>setMinimap($('minimap').checked));
 new ResizeObserver(schedule).observe(canvas);
 $('fit').onclick=frame;$('zoomIn').onclick=()=>zoom(1.5);$('zoomOut').onclick=()=>zoom(1/1.5);
 $('goto').onclick=()=>{const c=state.lookup.get(`${Number($('gotoX').value)},${Number($('gotoY').value)}`);if(c){message('',true);focus(c);}else message('该坐标不在完整地图内。',true);};
 for(const id of ['heatmap','palette','filter','markers','potentialMarkers','blocked','objects','coords','values','baselineValues','grid'])$(id).addEventListener('change',schedule);
 function sync(range,input,max){
  $(range).addEventListener('input',()=>{$(input).value=fixed(Number($(range).value));schedule();});
  $(input).addEventListener('input',()=>{const v=Number($(input).value);if(Number.isFinite(v))$(range).value=Math.max(0,Math.min(max(),v));schedule();});
  $(input).addEventListener('change',()=>{const v=Math.max(0,Math.min(max(),Number($(input).value)||0));$(input).value=fixed(v);$(range).value=v;schedule();});
 }
 sync('opacityRange','opacity',()=>100);sync('thresholdRange','threshold',()=>state.data?.probability.sampleCount||1);
 async function openPreview(){const host=$('canvasHost');host.classList.add('preview');document.body.classList.add('preview-open');$('exitFullscreen').hidden=false;try{await host.requestFullscreen();}catch{}schedule();}
 function closePreview(){if(document.fullscreenElement)document.exitFullscreen();$('canvasHost').classList.remove('preview');document.body.classList.remove('preview-open');$('exitFullscreen').hidden=true;}
 $('fullscreen').onclick=openPreview;$('exitFullscreen').onclick=closePreview;document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)closePreview();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closePreview();});
 function save(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function exportReport(){
  const data=state.data;
  const cells=data.cells.map(c=>{const{exactN,px,py,...raw}=c;return{...raw,...display.exportCell(c)};});
  save(new Blob([JSON.stringify({...data,probability:data.metadata.previewOnly?null:{...data.probability,display:display.metadata},cells})],{type:'application/json'}),data.metadata.previewOnly?'map-visual-preview.json':'crate-map-probability.json');
 }
 function exportCsv(mode='all'){
  const columns=['x','y','level','slope','rawLand','land','postLand','overlayName','terrain','occupied','usable','primary','probability','multiplier','relativeMultiplier','isBaseline','rockTransition','marked','potentialMarked','removable','clearance','higher','clearanceScenario'];
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const lines=[columns.join(',')];for(const c of state.data.cells){if(mode==='current'&&!c.marked||mode==='potential'&&!c.potentialMarked)continue;const row={...c,...display.exportCell(c),higher:JSON.stringify(c.higher),removable:JSON.stringify(c.removable||[]),clearance:JSON.stringify(c.clearance||null),clearanceScenario:c.potentialMarked?state.data.clearance.description:''};lines.push(columns.map(k=>quote(row[k])).join(','));}
  save(new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),mode==='current'?'rock-cells.csv':mode==='potential'?'potential-rock-cells.csv':'cells.csv');
 }
 $('jsonDownload').onclick=e=>{e.preventDefault();exportReport();};
 $('csvDownload').onclick=e=>{e.preventDefault();exportCsv();};
 $('rockDownload').onclick=e=>{e.preventDefault();exportCsv('current');};
 $('potentialDownload').onclick=e=>{e.preventDefault();exportCsv('potential');};
 $('screenshot').onclick=()=>{draw();canvas.toBlob(b=>save(b,`${state.data.metadata.filename}-crate-probability.png`),'image/png');};
 $('mapImageExport').onclick=async()=>{
  if(!state.data||$('mapImageExport').disabled)return;
  const source={data:state.data,image:state.image,objectImage:state.objectImage,cells:state.cells,lookup:state.lookup},snapshotDisplay=display,options=mapOptions(),out=document.createElement('canvas');
  const button=$('mapImageExport'),status=$('mapImageStatus');button.disabled=true;status.textContent='正在生成完整地图图片，倍率将以高清文字绘制…';
  try{
   const plan=CrateMapImageExport.layout(source.data.rendering);
   // Paint the progress message before the independent full-size render.
   await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
   out.width=plan.width;out.height=plan.height;const target=out.getContext('2d',{alpha:false});
   if(!target)throw Error('无法分配地图图片画布，请关闭其他大图后重试。');
   const result=CrateMapImageExport.render(target,source,snapshotDisplay,options,plan);
   const blob=await new Promise((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error('图片编码失败，请关闭其他大图后重试。')),'image/jpeg',.95));
   const extension=blob.type==='image/jpeg'?'jpg':'png';
   save(blob,`${source.data.metadata.filename}-完整地图.${extension}`);
   status.textContent=`已导出完整地图 · ${plan.width} × ${plan.height} · ${(blob.size/1024**2).toFixed(1)} MB · ${source.data.metadata.previewOnly?'目录资源外观预览（未计算概率）':result.labels.toLocaleString()+' 格倍率；请在图片查看器中放大至 100% 阅读。'}`;
  }catch(error){status.textContent='地图图片未导出：'+error.message;}
  finally{out.width=out.height=1;button.disabled=false;}
 };
 $('cellFraction').onclick=()=>{const c=state.selected;if(!c){message('先点击格子或按坐标定位。',true);return;}let n=numerator(c),d=denominator;const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(n,d);save(new Blob([JSON.stringify({cell:[c.x,c.y],sourceSha256:state.data.metadata.sourceSha256,probability:{numerator:String(n/g),denominator:String(d/g)},relativeMultiplier:display.exactFraction(c),baseline:display.metadata.baseline,singleDrawBaseline:{numerator:'1',denominator:String(state.data.probability.sampleCount)},display:display.metadata.mode,framePolicy:'uniform-cycle',attemptLimit:1000},null,2)],{type:'application/json'}),`cell-${c.x}-${c.y}-exact.json`);};
 async function loadResult(url,fromJob=false){
  const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('分析结果无法读取');const data=await response.json();
  const base=url.slice(0,url.lastIndexOf('/')+1),im=new Image();im.src=base+data.rendering.image+'?v='+(data.rendering.version||1);await im.decode();
  let objectImage=null;
  if(data.rendering.objectImage){objectImage=new Image();objectImage.src=base+data.rendering.objectImage+'?v='+data.rendering.version;await objectImage.decode();}
  state.objectImage=objectImage;$('objects').disabled=!objectImage;
  const objectInfo=data.rendering.objects;
  $('objectStatus').textContent=objectInfo?`建筑／单位：已绘制 ${objectInfo.total} / ${objectInfo.requested} 个${objectInfo.hidden?.length?'；'+objectInfo.hidden.length+' 个按地图定义隐藏':''}${objectInfo.missing.length?'；'+objectInfo.missing.length+' 个缺少资源，保留占用标识':''}。`:'旧结果尚无建筑／单位贴图，请重新分析地图。';
  $('objectDetails').hidden=!objectInfo?.missing.length&&!objectInfo?.warnings.length;
  $('objectWarnings').replaceChildren();for(const warning of [...(objectInfo?.warnings||[]),...(objectInfo?.missing||[]).map(o=>`${o.type}：${o.reason}`)]){const el=document.createElement('p');el.textContent=warning;$('objectWarnings').append(el);}
  $('objectAudit').href=base+'object-audit.json';
  if(['yr','ra2','directory'].includes(data.metadata.version)){$('version').value=data.metadata.version;$('version').dispatchEvent(new Event('change'));}
  state.data=data;state.baseUrl=base;state.image=im;state.selected=null;state.drag=null;miniState.position=null;miniState.minimized=false;state.lookup.clear();display=CrateProbabilityDisplay.map(data);
  coefficients=data.probability?.exact.coefficients.map(c=>BigInt(c.numerator))||[];denominator=BigInt(data.probability?.exact.denominator||1);
  const preview=!!data.metadata.previewOnly;
  $('mapImageStatus').textContent=preview?'地图图片：完整地图高清 JPEG；包含当前建筑／单位图层，未计算概率。':'地图图片：完整地图高清 JPEG；倍率始终标注，1× 标签、图层与筛选沿用当前设置。';
  $('mapImageExport').title=preview?'导出时空地图外观；建筑／单位显示沿用当前设置。':'导出完整地图的高清 JPEG，倍率始终标注；1× 标签、图层和筛选沿用当前设置。';
  for(const key of ['heatmap','markers','potentialMarkers','values','baselineValues','palette','filter','opacity','opacityRange','threshold','thresholdRange','cellFraction'])$(key).disabled=preview;
  for(const key of ['rockDownload','potentialDownload'])$(key).hidden=preview;
  $('jsonDownload').textContent=preview?'下载外观预览 JSON':'下载精确概率 JSON';
  const[ox,oy]=data.rendering.origin;state.cells=[...data.cells].sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.x-b.x);
  for(const c of state.cells){c.px=30*(c.x-c.y)+ox;c.py=15*(c.x+c.y-c.level)+oy;state.lookup.set(`${c.x},${c.y}`,c);}
  $('workspace').hidden=false;$('threshold').value='0.0';$('thresholdRange').value='0';$('thresholdRange').max=Math.ceil(display.maxMultiplier*10)/10||1;$('threshold').max=data.probability?.sampleCount||1;
  $('markerCount').textContent=`${data.markers.length} 格`;$('markerList').replaceChildren();
  for(const[x,y]of data.markers){const b=document.createElement('button');b.textContent=`${x}, ${y}`;b.dataset.key=`${x},${y}`;b.onclick=()=>focus(state.lookup.get(b.dataset.key));$('markerList').append(b);}
  if(!data.markers.length)$('markerList').textContent='未检测到符合条件的格子。';
  $('potentialCount').textContent=data.potentialMarkers?`${data.potentialMarkers.length} 格`:'未计算';$('potentialList').replaceChildren();
  for(const[x,y]of data.potentialMarkers||[]){const b=document.createElement('button'),c=state.lookup.get(`${x},${y}`);b.textContent=`${x}, ${y}`;b.dataset.key=`${x},${y}`;b.title=removalText(c);b.onclick=()=>focus(c);$('potentialList').append(b);}
  if(!data.potentialMarkers?.length)$('potentialList').textContent=data.potentialMarkers?'未检测到符合条件的潜在格。':'这是旧分析结果，请重新分析地图以计算潜在格。';
  $('potentialDownload').hidden=preview||!data.potentialMarkers;
  $('stats').replaceChildren();
  const p=data.probability;for(const[value,label]of (preview?[[data.metadata.cellCount.toLocaleString(),'真实地图格子'],[String(objectInfo?.total||0),'已绘制建筑／单位']]:[[data.metadata.cellCount.toLocaleString(),'真实地图格子'],[p.sampleCount.toLocaleString(),'精确枚举的初始坐标'],[pct(p.finalSuccess),'最终实际落箱'],[pct(p.finalGhost),'调用结束但无实体箱子']])){const div=document.createElement('div');div.className='stat';const n=document.createElement('strong'),s=document.createElement('span');n.textContent=value;s.textContent=label;div.append(n,s);$('stats').append(div);}
  $('crateLimitNote').hidden=data.metadata.crateLimits?.maximum!==0;
  $('crateLimitNote').textContent='本地图设置 CrateMaximum=0：常规随机箱数量受限。这里显示的是“调用一次放箱函数时”的条件概率，不表示地图会自动刷箱，也不表示刷箱频率。';
  $('jsonDownload').href=url;$('csvDownload').href=base+'cells.csv';$('rockDownload').href=base+'rock-cells.csv';
  $('potentialDownload').href=base+'potential-rock-cells.csv';
  $('scope').replaceChildren();for(const s of [`源文件 SHA-256：${data.metadata.sourceSha256}`,`Size=${data.metadata.size}；LocalSize=${data.metadata.localSize}；运行时可用矩形=${data.metadata.visibleRect}`,`候选联合周期 ${(p?.period||0).toLocaleString()}；重抽权重周期 ${(p?.weightPeriod||0).toLocaleString()}；${data.metadata.elapsedSeconds} 秒。整数概率守恒已验证。`,`${data.zeroProbabilityRockCandidates.length} 个地形候选当前没有随机落箱路径，不加实色粉色标记。`,data.clearance?.description||'旧结果未计算移除占用后的风险，请重新分析。',...data.metadata.warnings]){const el=document.createElement('p');el.textContent=s;$('scope').append(el);}
  if(preview){
   $('scope').replaceChildren();for(const line of data.metadata.warnings){const el=document.createElement('p');el.textContent=line;$('scope').append(el);}
   $('crateLimitNote').hidden=false;$('crateLimitNote').textContent=data.metadata.warnings[0];
  }
  $('riskLists').hidden=preview;
  frame();const c=state.lookup.get('99,105')||state.cells.find(c=>c.marked)||state.cells[Math.floor(state.cells.length/2)];select(c);
  history.replaceState(null,'','maps.html?result='+encodeURIComponent(url));
  if(preview)message(`外观预览完成 · ${data.metadata.filename} · 已绘制 ${objectInfo?.total||0} 个建筑／单位`);else if(!state.busy||fromJob)message(`完成 · ${data.metadata.filename} · 当前禁行 ${data.markers.length} 格 · 移除后潜在 ${data.potentialMarkers?.length??'未计算'} 格 · ${data.metadata.elapsedSeconds} 秒`);
  window.CrateMapViewer={state,draw,focus,frame,loadResult,numerator,thresholdPass,display};
 }
 async function analyze(file){
  if(state.busy)return;state.busy=true;message('',true);message('准备读取地图');$('loadHeck').disabled=$('mapFile').disabled=true;$('progress').hidden=false;$('progress').value=0;
  try{const version=$('version').value;if(!await CrateResourceUI.ensure(version)){message('请检查资源提示后重新开始分析。');return;}const endpoint=file?'/api/maps/analyze?version='+version+'&filename='+encodeURIComponent(file.name):'/api/maps/heck?version='+version;
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file||null});const job=await response.json();if(!response.ok)throw Error(job.error||'无法开始分析');
   for(;;){const response=await fetch('/api/maps/job/'+job.id);const status=await response.json();if(status.error)throw Error(status.error);message(status.message);$('progress').value=status.progress;
    if(status.done){await loadResult(status.url,true);break;}await new Promise(resolve=>setTimeout(resolve,700));}
  }catch(e){message(e.message,true);message('分析未完成；之前的结果保留。');}
  finally{state.busy=false;$('loadHeck').disabled=$('mapFile').disabled=false;$('progress').hidden=true;$('mapFile').value='';}
 }
 $('loadHeck').onclick=()=>analyze(null);$('mapFile').onchange=()=>{const file=$('mapFile').files[0];if(file)analyze(file);};
 const drop=$('dropzone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');const file=e.dataTransfer.files[0];if(file)analyze(file);});
 const existing=new URLSearchParams(location.search).get('result');
 if(existing&&/^\/output\/[a-zA-Z0-9_-]+\/result\.json$/.test(existing))loadResult(existing).catch(e=>message(e.message,true));
 fetch('/api/maps/health').then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{if(v.feature!=='real-maps-v1')throw Error();}).catch(()=>message('当前服务尚未加载真实地图接口。请关闭旧演示服务，再运行“启动演示.cmd”。已有结果仍可查看。',true));
})();
