/* Map report and cell detail presentation. No viewport or analysis state. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const probability=root.CrateProbabilityDisplay||(typeof require==='function'?require('./probability-display.js'):null);
 const occupancy=root.CrateOccupancyOverlay||(typeof require==='function'?require('./occupancy-overlay.js'):null);
 const fixed=n=>Number(n).toFixed(1),pct=probability.percent;
 const removalNames={building:_t('建筑'),mineral:_t('矿物'),terrain:_t('树木／地形物'),unit:_t('单位')};
 const removalText=c=>(c.removable||[]).map(o=>`${removalNames[o.category]||o.category} ${o.type}`).join('、')||_t('其他格子的占用（影响附近搜索）');
 const landNames=[_t('普通地面（Clear）'),_t('道路（Road）'),_t('水面（Water）'),_t('不可通行地面（Rock）'),_t('围墙（Wall）'),_t('矿石地面（Tiberium）'),_t('海滩（Beach）'),_t('粗糙地面（Rough）'),_t('冰面（Ice）'),_t('铁轨（Railroad）'),_t('隧道（Tunnel）')];
 const previewLabel=meta=>meta.partialAnalysis?_t('部分地图预览'):['directory','shikong'].includes(meta.version)?_t('目录资源预览'):_t('地图外观预览');
 function failurePercent(p){return p.finalFailure===0&&BigInt(p.exact.failureNumerator||0)>0n?_t('极小（非零）'):pct(p.finalFailure);}

 function completionText(data){
  const {previewOnly:preview,approximate}=data.metadata,objectInfo=data.rendering.objects;
  if(approximate)return _t`近似计算完成 · ${data.metadata.filename} · 概率不保证准确 · ${data.metadata.approximation.retryCellCount} 格采用重抽假设`;else if(preview)return _t`${previewLabel(data.metadata)}完成 · ${data.metadata.filename} · 矿石/树木${data.metadata.mineralsEnabled===false&&data.metadata.treesEnabled!==false?_t('混合'):data.metadata.mineralsEnabled===false?_t('关'):_t('开')} · 已绘制 ${objectInfo?.total||0} 个建筑／单位`;else return _t`完成 · ${_i18n?.mapName(data.metadata)||data.metadata.displayName||data.metadata.filename} · ${data.metadata.version==='ra2'?_t('原版'):_t('尤里')}规则 · 矿石/树木${data.metadata.mineralsEnabled===false&&data.metadata.treesEnabled!==false?_t('混合'):data.metadata.mineralsEnabled===false?_t('关'):_t('开')} · 放箱后禁行 ${data.markers.length} 格 · 清空对象后潜在禁行 ${data.potentialMarkers?.length??_t('未计算')} 格 · ${data.metadata.elapsedSeconds} 秒`;
 }
 function completion(data){const text=completionText(data),kind=data.metadata.calculationSource?.kind;return kind==='official-precomputed'?_t('官方预计算')+' · '+text:kind==='local-cache'?_t('本地缓存')+' · '+text:text;}
 function create({document=root.document}={}){
  const $=id=>document.getElementById(id);
 function appendRow(table,label,value){const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;td.textContent=value;tr.append(th,td);table.append(tr);}

 function cell(c,data,display){
  const info=$('cellInfo');info.replaceChildren();const table=document.createElement('table');info.append(table);
  if(data.metadata.previewOnly){appendRow(table,_t('模式'),previewLabel(data.metadata)+_t('（未计算概率）'));appendRow(table,_t('高度 / 坡型'),`${c.level} / ${c.terrainError?_t('未知'):c.slope}`);appendRow(table,_t('对象'),c.objects.join(', ')||_t('无'));appendRow(table,'Overlay',c.overlayName||(c.overlay!==255?_t('未知类型 ')+c.overlay:_t('无')));appendRow(table,'TMP',`${c.file} / ${c.subTile}`);if(c.terrainError)appendRow(table,_t('地形告警'),c.terrainError+_t('；菱形为占位显示。'));appendRow(table,_t('占用判定'),c.occupancyUnknown?_t('缺少定义，无法确定'):_t('仅保留对象位置，未验证通行'));return;}
  if(data.metadata.approximate)appendRow(table,_t('结果质量'),_t('近似概率，不保证准确'));
  appendRow(table,_t('相对倍率'),fixed(display.get(c).multiplier)+'×'+(display.get(c).isBaseline?_t('（基准格）'):''));appendRow(table,data.metadata.approximate?_t('近似概率（单次调用）'):_t('最终概率（单次调用）'),pct(c.probability));
  appendRow(table,_t('高度 / 坡型'),`${c.level} / ${c.terrainError?_t('未知'):c.slope}`);appendRow(table,_t('原始 / 当前地面'),`${c.terrainError?_t('未知'):landNames[c.rawLand]||_t('未知')} → ${landNames[c.land]}`);
  appendRow(table,_t('放箱后地面（预测）'),data.metadata.approximate?_t('未验证'):c.status==='crate'?landNames[c.postLand]:_t('无实体／未放置'));
  if(c.assumedRetry)appendRow(table,_t('重抽假设'),c.retryAssumptions.join('；')+_t('。搜索选中本格时放箱失败并重抽。'));
  appendRow(table,_t('可用边界'),c.usable?_t('范围内'):c.visibleBand?_t('顶部可视禁区（不可移动／建造）'):_t('范围外'));appendRow(table,_t('镜头显示范围'),c.cameraCoverage===undefined?_t('旧版'):fixed(c.cameraCoverage*100)+_t('%（边界按显示范围裁切）'));appendRow(table,_t('表面可见'),c.surfaceVisibility===undefined?_t('旧版平面显示'):fixed(c.surfaceVisibility*100)+_t('%（其余被地形遮挡）'));appendRow(table,_t('投影分组'),c.primary?_t('首选'):_t('次选'));
  appendRow(table,'Overlay',c.overlayName||(c.overlay!==255?_t('未知类型 ')+c.overlay:_t('空')));appendRow(table,_t('占用'),c.objects.join(', ')||_t('无'));
  if(c.bridge){
   appendRow(table,_t('桥梁'),c.bridge.kind==='high'?_t`高桥：桥下高度 ${c.level}，桥面高度 ${c.bridge.deckLevel}；搜索检查桥面占用层`:_t`低桥：使用地面通行和占用层${c.bridge.emptySprite?_t('；本格自身帧透明，相邻桥段的贴图可能覆盖本格'):''}`);
   if(c.bridge.kind==='high'&&c.objectsGround){
    appendRow(table,_t('桥面占用'),c.objectsDeck.join('、')||_t('无'));
    appendRow(table,_t('桥下对象'),c.objectsGround.join('、')||_t('无'));
   }
  }
  if(occupancy.mapCell(c))appendRow(table,_t('占用阻挡'),_t('建筑／单位占用，无法作为附近搜索候选（绿色）'));
  if(c.potentialMarked){appendRow(table,_t('本格可移除对象'),removalText(c));appendRow(table,_t('移除后 → 再放箱'),`${landNames[c.clearance.land]} → ${landNames[c.clearance.postLand]}`);appendRow(table,_t('移除后的落箱条件'),_t('存在随机落箱路径（未计算新概率）'));}
  appendRow(table,'TMP',`${c.file} / ${c.subTile}`);
  const note=document.createElement('p');note.className='cause';
  note.textContent=data.metadata.approximate?(c.assumedRetry?_t('本格包含不明内容，按假设不产生实体箱；搜索选中本格后重新抽取初始坐标。若存在已知占用或地形限制，仍按这些条件先筛选。'):_t('本图使用近似模型，未知格的重抽假设也会影响本格概率。数值不保证与游戏一致，未验证放箱后的通行风险。')):c.marked?_t`箱子能在这里出现，但放箱会改变该格的通行属性，普通步兵和履带车辆随后无法走入拾取。不是箱子贴图挡路，而是附近高地触发了地面重算。相关高格：${c.higher.map(([x,y,l])=>_t`(${x},${y}) 高 ${l}`).join('；')}。`:
   c.potentialMarked?_t`斜纹粉色：当前未标为放箱后禁行格；在全图建筑、矿物、树木／地形物及单位全部移除、不留下废墟的假设布局中，本格能随机出箱，随后变成普通步兵和履带车辆无法进入的地面。上方概率仍对应当前布局。相关高格：${c.higher.map(([x,y,l])=>_t`(${x},${y}) 高 ${l}`).join('；')}。`:
   c.clearance?.rockTransition?_t('清空对象后具备放箱禁行的地形条件，但未找到随机落箱路径，因此不加斜纹标记。'):
   c.rockTransition?_t('该格具备放箱后禁行的地形条件，但当前没有随机落箱路径，因此不加实色粉色标记。'):
   c.status==='ghost'?_t`${c.ghostReason==='terrain'?_t('桥下／地面存在树木等 Terrain 对象，箱子覆盖物的创建被拒绝'):_t('坡型大于 4，最终 Overlay 放置被拒绝')}；放箱入口却报告成功。可能被搜索选中，但不会生成实体箱子，也不会重抽或转移到其他格。`:
   c.bridge&&c.status==='retry'?_t`桥梁覆盖物占用了本格的 Overlay。即使通过附近搜索，最终放箱也会失败并重新抽取初始坐标；这不是向周围格子的就近转移。`:
   c.bridge?.kind==='high'?_t('高桥箱子按桥下地面高度绘制。桥面或桥下单位到达同一地图坐标时均可触发拾取；是否能抵达仍取决于实际路线，不保证所有箱子可拾取。尚未模拟炸桥、修桥或单位移动。'):
   c.terms.length?_t('在当前模型中随机出箱概率大于 0；未发现放箱会使该格变得不可通行。此结论不等于已确认有完整路线能到达。'):_t('当前静态布局中实际落箱概率为 0。');
  info.append(note);
  for(const id of ['markerList','potentialList'])for(const b of $(id).children)b.classList.toggle('selected',b.dataset.key===`${c.x},${c.y}`);
 }
 function clear(){
  $('selectedCoord').textContent=_t('点击地图');$('cellInfo').textContent=_t('滚轮缩放，左键或右键拖动平移；点击格子或输入坐标可锁定详情；再次左键点击选中格可取消。');
  $('transferInfo').hidden=true;$('transferInfo').textContent='';
  for(const id of ['markerList','potentialList'])for(const b of $(id).children)b.classList.remove('selected');
 }
 function transfer(incoming,error=''){
  $('transferInfo').hidden=!incoming&&!error;$('transferInfo').textContent=error;
  if(incoming){
    const projection=incoming.sources.filter(s=>s.reason===_t('投影优先规则')).length;
    $('transferInfo').textContent=_t`青蓝：${incoming.sources.length} 个起点经附近搜索转入本格${projection?_t`，其中 ${projection} 个因地形投影优先规则继续搜索`:''}。格上百分比＝固定以该格为本轮起点，附近搜索转入选中格的概率，按随机帧平均，不计失败后的重新抽点。不同起点的百分比不能相加。深色表示转入概率更高，仅比较当前来源；放大可查看标签。填色贴合可见地形，遮挡轮廓用虚线；取消或切换选择后恢复原图层。${incoming.sources.some(s=>!s.cell)?_t('地图外虚空格仅在显示时沿用最近边缘地形的高度。'):''}`;
  }
 }
 function report({data,base,url},display,{busy=false,lookup,onFocus}){
  const objectInfo=data.rendering.objects;
  const emptyFoundationCount=objectInfo?.hidden?.filter(o=>o.reason==='registered-empty-foundation').length||0;
  const hiddenObjectCount=(objectInfo?.hidden?.length||0)-emptyFoundationCount;
  $('objectStatus').textContent=objectInfo?_t`建筑／单位：已绘制 ${objectInfo.total} / ${objectInfo.requested} 个${hiddenObjectCount?'；'+hiddenObjectCount+_t(' 个按地图定义隐藏'):''}${emptyFoundationCount?'；'+emptyFoundationCount+_t(' 条空基础记录（不占格、无贴图）'):''}${objectInfo.missing.length?'；'+objectInfo.missing.length+_t(' 个缺少资源，保留占用标识'):''}。`:_t('旧结果尚无建筑／单位贴图，请重新分析地图。');
  $('objectDetails').hidden=!objectInfo?.missing.length&&!objectInfo?.warnings.length;
  $('objectWarnings').replaceChildren();for(const warning of [...(objectInfo?.warnings||[]),...(objectInfo?.missing||[]).map(o=>`${o.type}：${o.reason}`)]){const el=document.createElement('p');el.textContent=warning;$('objectWarnings').append(el);}
  $('objectAudit').href=base+'object-audit.json';
  $('objectAudit').hidden=!!data.precomputed;
  const directoryResult=['directory','shikong'].includes(data.metadata.version);
  $('resultResourceSummary').textContent=directoryResult?_t('当前结果使用游戏目录：')+(data.metadata.resourceRoot||_t('旧报告未记录路径，请重新分析')):_t('当前结果使用内置')+(data.metadata.version==='ra2'?_t('原版'):_t('尤复'))+_t('资源。');
  $('reanalyzeResources').disabled=busy;
  const preview=!!data.metadata.previewOnly,approximate=!!data.metadata.approximate;
  $('probabilityNote').hidden=preview;$('riskHint').hidden=preview||approximate;
  $('baselineInfo').textContent=preview?'':_t`本图 1× 基准概率：${pct(display.baselineProbability)}；2× 表示该基准的 2 倍。基准对应只从自身起点落箱、无邻格转入；不是全图平均概率。`;
  $('opacityInfo').textContent=preview?_t('外观预览不计算概率。'):$('opacityInfo').textContent;
  $('mapImageStatus').textContent=preview?_t('地图图片：完整地图高清 JPEG；包含当前建筑／单位图层，未计算概率。'):_t('完整地图 JPEG：自动标注符合当前筛选条件的倍率；1× 标签与图层沿用当前设置。');
  $('mapImageExport').title=preview?_t('导出当前地图外观；建筑／单位显示沿用当前设置。'):_t('导出完整地图 JPEG，标注符合当前筛选条件的倍率；1× 标签和图层沿用当前设置。');
  for(const key of ['heatmap','markers','potentialMarkers','values','baselineValues','palette','filter','opacity','opacityRange','threshold','thresholdRange','cellFraction'])$(key).disabled=preview;
  for(const key of ['markers','potentialMarkers'])$(key).disabled=preview||approximate;
  $('cellFraction').textContent=approximate?_t('下载选中格子的近似模型分数'):_t('下载选中格子的精确分数');
  for(const key of ['rockDownload','potentialDownload'])$(key).hidden=preview||approximate;
  $('jsonDownload').textContent=preview?_t('下载外观预览 JSON'):approximate?_t('下载近似概率 JSON'):_t('下载精确概率 JSON');
  $('markerCount').textContent=_t`${data.markers.length} 格`;$('markerList').replaceChildren();
  for(const[x,y]of data.markers){const b=document.createElement('button');b.textContent=`${x}, ${y}`;b.dataset.key=`${x},${y}`;b.onclick=()=>onFocus(lookup.get(b.dataset.key));$('markerList').append(b);}
  if(!data.markers.length)$('markerList').textContent=_t('未检测到符合条件的格子。');
  $('potentialCount').textContent=data.potentialMarkers?_t`${data.potentialMarkers.length} 格`:_t('未计算');$('potentialList').replaceChildren();
  for(const[x,y]of data.potentialMarkers||[]){const b=document.createElement('button'),c=lookup.get(`${x},${y}`);b.textContent=`${x}, ${y}`;b.dataset.key=`${x},${y}`;b.title=removalText(c);b.onclick=()=>onFocus(c);$('potentialList').append(b);}
  if(!data.potentialMarkers?.length)$('potentialList').textContent=data.potentialMarkers?_t('未检测到符合条件的潜在格。'):_t('这是旧分析结果，请重新分析地图以计算潜在格。');
  $('potentialDownload').hidden=preview||approximate||!data.potentialMarkers;
  $('stats').replaceChildren();
  const p=data.probability;for(const[value,label]of (preview?[[data.metadata.cellCount.toLocaleString(),_t('真实地图格子')],[String(objectInfo?.total||0),_t('已绘制建筑／单位')]]:[[data.metadata.cellCount.toLocaleString(),_t('真实地图格子')],[p.sampleCount.toLocaleString(),approximate?_t('近似模型枚举的初始坐标'):_t('精确枚举的初始坐标')],[pct(p.finalSuccess),_t('生成实体箱子')],[pct(p.finalGhost),_t('成功返回但未出实体箱')],[failurePercent(p),_t('重试耗尽（未落箱）')]])){const div=document.createElement('div');div.className='stat';const n=document.createElement('strong'),s=document.createElement('span');n.textContent=value;s.textContent=label;div.append(n,s);if(label===_t('重试耗尽（未落箱）'))div.title=_t('最多 1000 轮尝试后仍未放箱。极小概率保留在精确分数中。');$('stats').append(div);}
  $('crateLimitNote').hidden=data.metadata.crateLimits?.maximum!==0;
  $('crateLimitNote').textContent=_t('本地图设置 CrateMaximum=0：常规随机箱数量受限。这里显示的是“调用一次放箱函数时”的条件概率，不表示地图会自动刷箱，也不表示刷箱频率。');
  $('jsonDownload').href=url;$('csvDownload').href=base+'cells.csv';$('rockDownload').href=base+'rock-cells.csv';
  $('potentialDownload').href=base+'potential-rock-cells.csv';
  $('scope').replaceChildren();for(const s of [_t`源文件 SHA-256：${data.metadata.sourceSha256}`,_t`Size=${data.metadata.size}；LocalSize=${data.metadata.localSize}；运行时可用矩形=${data.metadata.visibleRect}`,_t`候选联合周期 ${(p?.period||0).toLocaleString()}；重抽权重周期 ${(p?.weightPeriod||0).toLocaleString()}；${data.metadata.elapsedSeconds} 秒。整数概率守恒已验证。`,_t`${data.zeroProbabilityRockCandidates.length} 个地形候选当前没有随机落箱路径，不加实色粉色标记。`,data.clearance?.description||_t('旧结果未计算移除占用后的风险，请重新分析。'),...data.metadata.warnings]){const el=document.createElement('p');el.textContent=s;$('scope').append(el);}
  if(preview){
   $('scope').replaceChildren();for(const line of data.metadata.warnings){const el=document.createElement('p');el.textContent=line;$('scope').append(el);}
   $('crateLimitNote').hidden=false;$('crateLimitNote').textContent=data.metadata.warnings[0];
  }
  const issues=data.metadata.loadIssues||[],partial=!!data.metadata.partialAnalysis,warningOnly=issues.length&&!partial&&!preview&&!approximate;
  $('analysisNotice').hidden=!partial&&!preview&&!approximate&&!warningOnly;
  $('retryApprox').hidden=!preview;
  $('analysisNoticeTitle').textContent=approximate?_t('近似概率 · 不保证准确'):warningOnly?_t('地图已加载 · 有告警'):_t('地图已部分加载 · 未计算概率');
  $('analysisNoticeText').textContent=warningOnly?_t('静态概率已完成计算。以下冲突字段不参与本工具的静态计算，详细记录包含原值、采用值和行号。'):approximate?
   (data.metadata.approximation.retryCellCount>0?_t`已继续计算概率：${data.metadata.approximation.retryCellCount} 格含不明内容，按可读地形参与附近搜索，选中时假定放箱失败并重抽。未知建筑只使用可读基础，否则按原点一格；这些假设会影响全图概率。区域统计、3D 和导出同步使用近似结果；禁行风险未验证。`:_t('检测到冲突或未支持的配置，已按告警中列出的假设继续计算。这些假设可能影响全图概率；区域统计、3D 和导出使用同一近似结果，禁行风险未验证。')):
   data.metadata.analysisError?
   _t`原因：${data.metadata.analysisError}。已继续读取可用的地形、建筑和单位；缺失内容可能影响全图的附近搜索及重抽，因此概率、区域倍率和禁行预测暂不可用。`:
   _t('部分内容缺少定义或无法解析，已保留可用地形和对象。紫灰色菱形表示未知地形，仅保留地图记录的高度；对象标识不代表已验证占用。');
  $('retryMod').hidden=!partial||directoryResult;
  $('retryMod').title=_t('使用所选游戏目录自动发现规则和资源，重新分析当前地图；无需再次选择地图文件。');
  $('analysisIssues').replaceChildren();
  for(const issue of issues){const p=document.createElement('p'),positions=(issue.cells||[]).slice(0,6).map(([x,y])=>`(${x}, ${y})`).join('、');p.textContent=`${issue.message}${issue.count>1?' · '+issue.count+_t(' 处'):''}${positions?' · '+positions:''}${issue.cells?.length>6?' …':''}`;$('analysisIssues').append(p);}
  if(approximate)for(const text of [data.metadata.analysisError,...data.metadata.approximation.assumptions].filter(Boolean)){const p=document.createElement('p');p.textContent=text;$('analysisIssues').append(p);}
  $('analysisIssueDetails').hidden=!issues.length&&!approximate;
  $('analysisIssueSummary').textContent=_t`加载告警详情（${issues.length} 类；完整记录包含在 JSON 中）`;
  if(partial)$('crateLimitNote').hidden=true;
  $('riskLists').hidden=preview||approximate;
 }
 return {cell,clear,transfer,report};
 }
 const api={create,previewLabel,failurePercent,completion};root.CrateMapDetails=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
