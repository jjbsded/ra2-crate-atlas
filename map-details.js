/* Map report and cell detail presentation. No viewport or analysis state. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const probability=root.CrateProbabilityDisplay||(typeof require==='function'?require('./probability-display.js'):null);
 const riskPagination=root.CrateRiskPagination||(typeof require==='function'?require('./risk-pagination.js'):null);
 const fixed=n=>Number(n).toFixed(1),pct=probability.percent;
 const removalNames={building:_t('建筑'),mineral:_t('矿物'),terrain:_t('树木／地形物'),unit:_t('单位')};
 const removalText=c=>(c.removable||[]).map(o=>`${removalNames[o.category]||o.category} ${o.type}`).join('、')||_t('其他格子的占用（影响附近搜索）');
 const landNames=[_t('平地'),_t('道路'),_t('水面'),_t('不可通行地面'),_t('围墙'),_t('矿石'),_t('海滩'),_t('粗糙地面'),_t('冰面'),_t('铁轨'),_t('隧道')];
 const previewLabel=meta=>_t('外观预览');
 const failureText=new WeakMap(),superscript='⁰¹²³⁴⁵⁶⁷⁸⁹';
 const riskFields=['markers','potentialMarkers','zeroProbabilityRockCandidates'];
 // Keep an exact, bounded numeric snapshot. Updates need no joined strings or
 // temporary arrays and still detect a caller changing an array in place.
 const riskSnapshot=data=>riskFields.map(field=>{const list=data[field];if(!list)return null;const flat=new Int32Array(list.length*2);for(let i=0;i<list.length;i++){flat[i*2]=list[i][0];flat[i*2+1]=list[i][1];}return flat;});
 function sameRisks(data,snapshot){
  if(!snapshot)return false;
  for(let f=0;f<riskFields.length;f++){const list=data[riskFields[f]],flat=snapshot[f];if(!list){if(flat)return false;continue;}if(!flat||flat.length!==list.length*2)return false;for(let i=0;i<list.length;i++)if(list[i][0]!==flat[i*2]||list[i][1]!==flat[i*2+1])return false;}
  return true;
 }
 function failurePercent(p){
  const n=p.exact?.failureNumerator,d=p.exact?.denominator,cached=failureText.get(p);
  if(cached&&cached.value===p.finalFailure&&cached.n===n&&cached.d===d)return cached.text;
  let text=pct(p.finalFailure);
  if(!(p.finalFailure>=1e-8)){
   const numerator=String(n??'0').replace(/^0+/,''),denominator=String(d??'0').replace(/^0+/,'');
   if(numerator&&denominator){
    // Leading decimal digits are enough for a two-significant-digit label;
    // never parse huge retry integers or underflow their ratio to Number.
    const head=s=>Number(s.slice(0,16))/10**(Math.min(16,s.length)-1);
    let m=head(numerator)/head(denominator),e=numerator.length-denominator.length+2;
    if(m<1){m*=10;e--;}else if(m>=10){m/=10;e++;}
    m=Number(m.toPrecision(2));if(m>=10){m/=10;e++;}
    text=e>=-6?pct(m*10**(e-2)):m+'×10'+String(e).replace(/-/g,'⁻').replace(/\d/g,k=>superscript[k])+'%';
   }else if(p.finalFailure>0)text=p.finalFailure.toExponential(1).replace(/e([+-]?\d+)/,(_,e)=>'×10'+String(Number(e)+2).replace(/-/g,'⁻').replace(/\d/g,k=>superscript[k]))+'%';
  }
  failureText.set(p,{value:p.finalFailure,n,d,text});return text;
 }

 function completionText(data){
  return _t('地图已加载');
 }
 function completion(data){return completionText(data);}
 function create({document=root.document,onListFocus}={}){
  const $=id=>document.getElementById(id);let lastReport=null,lastRisks=null,lastRiskStatus='',lastStatsKey='',technicalOpen=false,technicalNode=null;
  const riskStatus=data=>[data.metadata.riskPredictionVersion,data.metadata.riskUnknownCellCount,data.clearance?.model,data.clearance?.unknownCellCount].join('|');
  let focusCell=()=>{};
  const emptyConnections=[];let connectionValue=null,riskSpecs=null,connectionLookup=null;
  const lists=[{grid:$('markerList'),label:'放箱后禁行',kind:'blocked'},{grid:$('potentialList'),label:'清空对象后潜在禁行',kind:'blocked',title:removalText}];
  if($('seaLandList'))lists.push({grid:$('seaLandList'),label:'海陆直通格',kind:'connections'});
  const risks=riskPagination.create({document,aside:$('mapAside'),host:$('coordinateLists'),onFocus:(c,list)=>{onListFocus?.(list.kind);focusCell(c);},lists});
  function connections(value=connectionValue){connectionValue=value;if($('seaLandLists'))$('seaLandCount').textContent=_t`${value?.land.length||0} 格`;if(riskSpecs)risks.set([...riskSpecs,...(lists.length>2?[{items:value?.land||emptyConnections,immutable:true,lookup:connectionLookup,empty:_t('未检测到符合条件的格子。')}]:[])],false);}
  const rememberTechnical=()=>{if(technicalNode)technicalOpen=!!technicalNode.open;};
 function appendRow(table,label,value){const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;td.textContent=value;tr.append(th,td);table.append(tr);}

 function cell(c,data,display){
  rememberTechnical();const info=$('cellInfo');info.replaceChildren();const table=document.createElement('table');info.append(table);
  risks.select(`${c.x},${c.y}`);
  if(c.virtual){appendRow(table,_t('地面'),_t('无地形格'));appendRow(table,_t('区域'),_t('有效坐标'));appendRow(table,_t('落箱概率'),'0%');return;}
  const preview=!!data.metadata.previewOnly,approximate=!!data.metadata.approximate;
  if(preview)appendRow(table,_t('模式'),_t('外观预览（未计算概率）'));
  else{
   appendRow(table,_t('倍率'),fixed(display.get(c).multiplier)+'×');
   appendRow(table,approximate?_t('近似概率'):_t('落箱概率'),pct(c.probability));
  }
  appendRow(table,_t('高度'),String(c.level));
  appendRow(table,_t('地面'),c.terrainError?_t('未知'):landNames[c.land]||_t('未知'));
  appendRow(table,_t('对象'),c.objects.join(', ')||_t('无'));
  const hasOverlay=!!c.overlayName||Number.isInteger(c.overlay)&&c.overlay!==255;
  appendRow(table,'Overlay',hasOverlay?(c.overlayName||_t('未知类型 ')+c.overlay):_t('无'));
  if(hasOverlay)appendRow(table,_t('变体编号'),Number.isInteger(c.overlayData)?String(c.overlayData):'—');
  if(!preview&&!c.marked&&c.status==='crate'&&c.postLand!==c.land&&Number.isInteger(c.postLand))appendRow(table,_t('放箱后地面'),landNames[c.postLand]||_t('未知'));
  if(!c.usable)appendRow(table,_t('区域'),c.visibleBand?_t('顶部禁区'):_t('地图边界外'));
  if(c.terrainError)appendRow(table,_t('地形告警'),c.terrainError);
  if(c.assumedRetry)appendRow(table,_t('未知对象'),(c.retryAssumptions||[]).join('；'));
  if(c.bridge){
   appendRow(table,_t('桥梁'),c.bridge.kind==='high'?_t`高桥 · 桥面高度 ${c.bridge.deckLevel}`:_t('低桥'));
   if(c.bridge.kind==='high'&&c.objectsGround){appendRow(table,_t('桥面对象'),c.objectsDeck.join('、')||_t('无'));appendRow(table,_t('桥下对象'),c.objectsGround.join('、')||_t('无'));}
  }
  const text=preview?'':c.riskKnown===false?_t('该格放箱后的地面暂无法判断。'):c.marked?_t('放箱后无法通行。'):c.potentialMarked?_t('清空对象后放箱将无法通行。'):c.status==='ghost'?_t('此格不会生成箱子。'):c.bridge&&c.status==='retry'?_t('桥梁所在格无法放箱。'):'';
  if(text){const note=document.createElement('p');note.className='cause';note.textContent=text;info.append(note);}
  const technical=document.createElement('details'),summary=document.createElement('summary'),fields=document.createElement('table');summary.textContent=_t('技术详情');
  technical.id='cellTechnicalDetails';technical.open=technicalOpen;technicalNode=technical;technical.ontoggle=()=>{if(technicalNode===technical)technicalOpen=technical.open;};
  appendRow(fields,'TMP',`${c.file} / ${c.subTile}`);
  appendRow(fields,_t('坡型'),String(c.slope));if(!preview)appendRow(fields,_t('投影分组'),c.primary?_t('首选'):_t('次选'));
  technical.append(summary,fields);info.append(technical);
 }
 function clear(){
  rememberTechnical();technicalNode=null;
  $('selectedCoord').textContent=_t('点击地图');$('cellInfo').textContent=_t('点击格子查看详情，再次点击取消。');
  $('transferInfo').hidden=true;$('transferInfo').textContent='';
  risks.select(null);
 }
 function transfer(incoming,error=''){
  $('transferInfo').hidden=!incoming&&!error;$('transferInfo').textContent=error;
  if(incoming)$('transferInfo').textContent=_t`青蓝：${incoming.sources.length} 个来源格 · 再次点击取消`;

 }
 function report({data,base,url},display,{busy=false,lookup,onFocus}){
  if(lastReport&&['sourceSha256','version','rulesSha256'].some(key=>lastReport.metadata[key]!==data.metadata[key])){connectionValue=null;if($('seaLandCount'))$('seaLandCount').textContent=_t`${0} 格`;}
  const objectInfo=data.rendering.objects,p=data.probability;
  const missing=objectInfo?.missing?.length||0,objectWarnings=objectInfo?.warnings?.length||0;
  $('objectStatus').hidden=!missing&&!objectWarnings;
  $('objectStatus').textContent=missing?_t`缺少 ${missing} 个对象素材`:objectWarnings?_t`素材告警：${objectWarnings} 项`:'';
  $('objectDetails').hidden=!objectInfo?.missing.length&&!objectInfo?.warnings.length;
  $('objectWarnings').replaceChildren();for(const warning of [...(objectInfo?.warnings||[]),...(objectInfo?.missing||[]).map(o=>`${o.type}：${o.reason}`)]){const el=document.createElement('p');el.textContent=warning;$('objectWarnings').append(el);}
  $('objectAudit').href=base+'object-audit.json';
  $('objectAudit').hidden=!!data.precomputed;
  const directoryResult=['directory','shikong'].includes(data.metadata.version);
  $('resultResourceSummary').hidden=true;$('resultResourceSummary').textContent='';
  $('reanalyzeResources').disabled=busy;
  const preview=!!data.metadata.previewOnly,approximate=!!data.metadata.approximate;
  const riskAvailable=!preview&&(!approximate||!!data.metadata.riskPredictionVersion),clearanceAvailable=riskAvailable&&data.clearance?.model!=='unverified';
  $('probabilityNote').hidden=$('riskHint').hidden=true;$('baselineInfo').textContent='';
  $('mapImageExport').title=_t('导出完整地图 JPEG');
  for(const key of ['heatmap','markers','values','baselineLayer','baselineValues','palette','filter','opacity','opacityRange','threshold','thresholdRange','cellFraction'])$(key).disabled=preview;
  // An empty or approximate result must not lock the user's layer preference.
  $('markers').disabled=false;
  $('cellFraction').textContent=approximate?_t('下载选中格子的近似分数'):_t('下载选中格子的精确分数');
  for(const key of ['rockDownload','potentialDownload'])$(key).hidden=!riskAvailable;
  $('jsonDownload').textContent=preview?_t('下载外观预览 JSON'):approximate?_t('下载近似概率 JSON'):_t('下载精确概率 JSON');
  $('markerCount').textContent=riskAvailable?_t`${data.markers.length} 格`:_t('未计算');
  $('potentialCount').textContent=clearanceAvailable&&data.potentialMarkers?_t`${data.potentialMarkers.length} 格`:_t('未计算');
  focusCell=onFocus;connectionLookup=lookup;riskSpecs=[{items:data.markers,lookup,empty:!riskAvailable?_t('此结果尚无禁行预测，请重新分析。'):data.metadata.riskUnknownCellCount?_t('可判断格子中未检出；部分格子暂无法判断。'):_t('未检测到符合条件的格子。')},{items:data.potentialMarkers||[],lookup,empty:!clearanceAvailable?_t('此结果尚无禁行预测，请重新分析。'):data.clearance?.unknownCellCount?_t('可判断格子中未检出；部分格子暂无法判断。'):data.potentialMarkers?_t('未检测到符合条件的潜在格。'):_t('这是旧分析结果，请重新分析地图以计算潜在格。')}];
  risks.set([...riskSpecs,...(lists.length>2?[{items:connectionValue?.land||emptyConnections,immutable:true,lookup,empty:_t('未检测到符合条件的格子。')}]:[])],!sameRisks(data,lastRisks));
  $('potentialDownload').hidden=!clearanceAvailable||!data.potentialMarkers;
  updateStats(data);
  $('crateLimitNote').hidden=data.metadata.crateLimits?.maximum!==0;
  $('crateLimitNote').textContent=_t('本地图的随机箱数量上限为 0。');
  $('jsonDownload').href=url;$('csvDownload').href=base+'cells.csv';$('rockDownload').href=base+'rock-cells.csv';
  $('potentialDownload').href=base+'potential-rock-cells.csv';
  $('scope').replaceChildren();for(const s of [_t`源文件 SHA-256：${data.metadata.sourceSha256}`,_t`Size=${data.metadata.size}；LocalSize=${data.metadata.localSize}；运行时可用矩形=${data.metadata.visibleRect}`,_t`候选联合周期 ${(p?.period||0).toLocaleString()}；${data.metadata.elapsedSeconds} 秒。整数概率守恒已验证。`,_t`${data.zeroProbabilityRockCandidates.length} 个地形候选当前没有随机落箱路径，不加实色粉色标记。`,data.clearance?.description||_t('旧结果未计算移除占用后的风险，请重新分析。'),...data.metadata.warnings]){const el=document.createElement('p');el.textContent=s;$('scope').append(el);}
  if(preview){
   $('scope').replaceChildren();for(const line of data.metadata.warnings){const el=document.createElement('p');el.textContent=line;$('scope').append(el);}
   $('crateLimitNote').hidden=false;$('crateLimitNote').textContent=data.metadata.warnings[0];
  }
  const issues=data.metadata.loadIssues||[],partial=!!data.metadata.partialAnalysis,warningOnly=issues.length&&!partial&&!preview&&!approximate;
  $('analysisNotice').hidden=!partial&&!preview&&!issues.length&&!data.metadata.analysisError;
  $('retryApprox').hidden=!preview;
  $('analysisNoticeTitle').textContent=approximate?_t('近似概率'):preview?_t('外观预览'):_t('加载告警');
  $('analysisNoticeText').textContent=data.metadata.analysisError||'';
  $('analysisNoticeText').hidden=!data.metadata.analysisError;
  $('retryMod').hidden=!partial||directoryResult;
  $('retryMod').title=_t('使用游戏目录重新分析');
  $('analysisIssues').replaceChildren();
  for(const issue of issues){const p=document.createElement('p'),positions=(issue.cells||[]).slice(0,6).map(([x,y])=>`(${x}, ${y})`).join('、');p.textContent=`${issue.message}${issue.count>1?' · '+issue.count+_t(' 处'):''}${positions?' · '+positions:''}${issue.cells?.length>6?' …':''}`;$('analysisIssues').append(p);}
  if(approximate)for(const text of (data.metadata.approximation?.assumptions||[]).filter(Boolean)){const p=document.createElement('p');p.textContent=text;$('analysisIssues').append(p);}
  $('analysisIssueDetails').hidden=!issues.length&&!approximate;
  $('analysisIssueSummary').textContent=_t`加载告警（${issues.length} 类）`;
  if(partial)$('crateLimitNote').hidden=true;
  lastReport=data;lastRisks=riskSnapshot(data);lastRiskStatus=riskStatus(data);
 }
 function updateStats(data){
  const p=data.probability,info=data.rendering.objects,preview=!!data.metadata.previewOnly;
  const values=preview?[[data.metadata.cellCount.toLocaleString(),_t('真实地图格子')],[String(info?.total||0),_t('已绘制建筑／单位')]]:[[data.metadata.cellCount.toLocaleString(),_t('真实地图格子')],[pct(p.finalSuccess),_t('生成成功')],[failurePercent(p),_t('生成失败')]];
  const stamp=JSON.stringify(values);if(stamp===lastStatsKey)return;lastStatsKey=stamp;
  const host=$('stats');
  if(host.children.length===values.length){for(let i=0;i<values.length;i++){const [value,label]=values[i],node=host.children[i];if(node.children[0].textContent!==value)node.children[0].textContent=value;if(node.children[1].textContent!==label)node.children[1].textContent=label;}return;}
  host.replaceChildren();for(const[value,label]of values){const div=document.createElement('div');div.className='stat';const n=document.createElement('strong'),name=document.createElement('span');n.textContent=value;name.textContent=label;div.append(n,name);host.append(div);}
 }
 function update(context,display,options){
  const data=context.data;
  if(!lastReport||data.metadata.sourceSha256!==lastReport.metadata.sourceSha256||data.metadata.previewOnly!==lastReport.metadata.previewOnly||data.metadata.approximate!==lastReport.metadata.approximate||data.probability?.period!==lastReport.probability?.period||riskStatus(data)!==lastRiskStatus||!sameRisks(data,lastRisks)){report(context,display,options);return;}
  updateStats(data);lastReport=data;
 }
 return {cell,clear,transfer,report,update,connections,get riskPages(){return risks.status.slice(0,2);},get connectionPages(){return risks.status[2];}};
 }
 const api={create,previewLabel,failurePercent,completion};root.CrateMapDetails=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
