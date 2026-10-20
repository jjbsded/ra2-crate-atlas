'use strict';
const $=id=>document.getElementById(id),M=CrateModel,S=CrateScene,H=CrateProbability,T=CrateTiming,D=CrateProbabilityDisplay;
const canvas=$('scene'),ctx=canvas.getContext('2d');
const preview=$('outputPreview'),previewCanvas=$('previewScene'),previewCtx=previewCanvas.getContext('2d');
let trace,time=0,playing=false,last=0,lastRecord=-1,forceComplete=true,minMultiplier=0,transparency=45;
M.PRESETS.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;$('preset').append(o);});
let activeTiming=T.settings(),timingStartupError='';
try{activeTiming=T.fromQuery(location.search);}catch(e){timingStartupError=`链接播放参数无效：${e.message}已恢复默认节奏。`;}
for(const [phase,name] of Object.entries(T.PHASES)){
 const row=document.createElement('tr'),label=document.createElement('td');label.textContent=name;row.append(label);
 for(const field of ['seconds','speed']){
  const td=document.createElement('td'),input=document.createElement('input');input.id=`timing-${phase}-${field}`;input.type='number';input.min='.1';input.max=field==='seconds'?'600':'10';input.step='.1';input.placeholder='原时长';input.setAttribute('aria-label',`${name}${field==='seconds'?'停留秒数':'速度倍率'}`);td.append(input);row.append(td);
 }
 $('timingRows').append(row);
}
function syncTiming(){
 $('speed').value=activeTiming.speed;
 for(const phase of Object.keys(T.PHASES)){const entry=activeTiming.phases[phase]||{};$(`timing-${phase}-seconds`).value=entry.seconds??'';$(`timing-${phase}-speed`).value=entry.speed??1;}
}
function readTiming(){
 const value={speed:$('speed').valueAsNumber,phases:{}};
 for(const phase of Object.keys(T.PHASES)){
  const seconds=$(`timing-${phase}-seconds`),speed=$(`timing-${phase}-speed`);
  if(seconds.validity.badInput)throw Error(`${T.PHASES[phase]}停留秒数无效。`);
  const entry={speed:speed.valueAsNumber};if(seconds.value!=='')entry.seconds=seconds.valueAsNumber;
  if(entry.seconds!==undefined||entry.speed!==1)value.phases[phase]=entry;
 }
 return T.settings(value);
}
function applyTiming(){
 try{
  const next=readTiming(),state=M.atTime(trace,time),atEnd=time>=trace.duration;
  activeTiming=next;T.apply(trace,activeTiming);time=atEnd?trace.duration:state.step.start+state.progress*state.step.duration;
  $('seek').max=trace.duration;$('error').textContent='';$('timingStatus').textContent=`已应用 · 当前场景 ${trace.duration.toFixed(1)} 秒`;last=performance.now();draw();return true;
 }catch(e){$('error').textContent=e.message;return false;}
}
syncTiming();
function options(){return{preset:$('preset').value,start:[Number($('x').value),Number($('y').value)],frame:Number($('frame').value)};}
function heatmapOptions(){return H.settings({enabled:$('heatmapEnabled').checked,showBaselineValues:$('heatmapBaselineValues').checked,showBlocked:$('heatmapBlocked').checked,opacity:1-transparency/100,filter:$('heatmapFilter').value,palette:$('heatmapPalette').value,minMultiplier});}
function syncTransparency(preserveInput=false){
 $('heatmapTransparencyRange').value=transparency;if(!preserveInput)$('heatmapTransparency').value=transparency.toFixed(1);
 $('heatmapTransparencyRange').disabled=$('heatmapTransparency').disabled=!$('heatmapEnabled').checked;
}
function changeTransparency(input){
 if(input.value.trim()===''||!Number.isFinite(input.valueAsNumber))return;
 transparency=Math.round(Math.max(0,Math.min(100,input.valueAsNumber))*10)/10;
 syncTransparency(input.id==='heatmapTransparency');draw();
}
function syncThreshold(preserveInput=false){
 $('heatmapMinRange').max=Math.max(1,Math.ceil(D.demo(trace.probability).maxMultiplier),minMultiplier);
 $('heatmapMinRange').value=minMultiplier;if(!preserveInput)$('heatmapMin').value=minMultiplier.toFixed(1);
}
function changeThreshold(input){
 if(input.value.trim()===''||!Number.isFinite(input.valueAsNumber))return;
 minMultiplier=Math.round(Math.max(0,Math.min(H.MAX_MULTIPLIER,input.valueAsNumber))*10)/10;syncThreshold(input.id==='heatmapMin');draw();
}
function build(){try{trace=T.apply(H.decorate(M.buildTrace(options())),activeTiming);syncThreshold();time=0;playing=false;forceComplete=true;lastRecord=-1;$('seek').max=trace.duration;$('error').textContent='';const d=trace.probability;$('densityInfo').textContent=`随机逻辑帧 · 精确平均 ${d.frameDistribution.period} 个等权帧余数 × ${d.sampleCount} 个起点 · 1× = 仅直接抽中、无邻格转入 · 含最多 1000 轮重抽 · 单轮成功起点均值 ${d.successCount.toFixed(1)}/169 · 最高 ${D.demo(d).maxMultiplier.toFixed(1)}×`;$('densityCell').textContent='鼠标移到格子上查看坐标、最终概率与单轮统计。';draw();}catch(e){$('error').textContent=e.message;}}
function draw(){
 const state=M.atTime(trace,time);S.render(ctx,trace,state.step,forceComplete?1:state.progress,{coords:$('coords').checked,animateScan:!forceComplete,heatmap:heatmapOptions(),heatmapValues:$('heatmapValues').checked});
 if(!preview.hidden)previewCtx.drawImage(canvas,0,0);
 const heat=heatmapOptions(),display=D.demo(trace.probability),shown=Object.values(trace.probability.cells).filter(c=>H.matches(c,heat.filter)&&display.cellAlpha(c,heat)>0).length;
 $('heatmapThresholdInfo').textContent=`仅显示 ≥ ${minMultiplier.toFixed(1)}×（约 ${D.percent(minMultiplier*display.baselineProbability)}） · 当前着色 ${shown} 格；阈值不改变概率。`;
 $('seek').value=time;$('play').textContent=playing?'Ⅱ 暂停':'▶ 播放';$('position').textContent=`步骤 ${state.step.i+1} / ${trace.steps.length} · ${time.toFixed(1)} / ${trace.duration.toFixed(1)} 秒`;
 if(lastRecord!==state.step.i){lastRecord=state.step.i;const visits=state.step.visits||[];$('records').replaceChildren();if(!visits.length){$('records').textContent='此步骤不扫描格子。';}else{const table=document.createElement('table');const header=table.insertRow();['顺序','Cell (X,Y)','附近检查','原因'].forEach(t=>{const th=document.createElement('th');th.textContent=t;header.append(th);});visits.forEach((v,i)=>{const row=table.insertRow();[i+1,`(${v.cell})`,v.ok?'通过':'排除',v.reason].forEach(t=>row.insertCell().textContent=t);});$('records').append(table);}}
}
function toggle(){if(time>=trace.duration)time=0;playing=!playing;forceComplete=false;draw();}
function jump(delta){playing=false;forceComplete=true;const i=M.atTime(trace,time).step.i;time=trace.steps[Math.max(0,Math.min(trace.steps.length-1,i+delta))].start;draw();}
$('applyTiming').onclick=applyTiming;$('speed').onchange=applyTiming;
$('resetTiming').onclick=()=>{activeTiming=T.settings();syncTiming();applyTiming();};
$('timingDownload').onclick=()=>{if(applyTiming())download(JSON.stringify(exportConfig(false),null,2),'crate-export-config.json','application/json');};
$('preset').onchange=()=>{const p=M.PRESETS.find(p=>p.id===$('preset').value);$('x').value=p.start[0];$('y').value=p.start[1];build();};
$('apply').onclick=build;$('coords').onchange=draw;$('play').onclick=toggle;$('next').onclick=()=>jump(1);$('prev').onclick=()=>jump(-1);$('reset').onclick=()=>{time=0;playing=false;forceComplete=true;draw();};
['heatmapFilter','heatmapValues','heatmapBaselineValues','heatmapBlocked','heatmapPalette'].forEach(id=>$(id).onchange=draw);
$('heatmapEnabled').onchange=()=>{syncTransparency();draw();};
['heatmapTransparencyRange','heatmapTransparency'].forEach(id=>{const input=$(id);input.oninput=()=>changeTransparency(input);input.onchange=input.onblur=()=>{changeTransparency(input);syncTransparency();};});
['heatmapMinRange','heatmapMin'].forEach(id=>{const input=$(id);input.oninput=()=>changeThreshold(input);input.onchange=input.onblur=()=>{changeThreshold(input);syncThreshold();};});
$('densitySummary').onclick=()=>{time=trace.steps.at(-1).start;playing=false;forceComplete=true;draw();};
$('densityDownload').onclick=()=>download(JSON.stringify({...trace.probability,display:D.demo(trace.probability).metadata,cells:Object.fromEntries(Object.entries(trace.probability.cells).map(([k,c])=>[k,{...c,...D.demo(trace.probability).exportCell(c)}]))},null,2),'crate-probability.json','application/json');
$('seek').oninput=()=>{time=Number($('seek').value);playing=false;forceComplete=false;draw();};
canvas.onclick=e=>{const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/S.WIDTH,r.height/S.HEIGHT),left=r.left+(r.width-S.WIDTH*scale)/2,top=r.top+(r.height-S.HEIGHT*scale)/2,c=S.unproject((e.clientX-left)/scale,(e.clientY-top)/scale,M.atTime(trace,time).step.phase);if(c.some(v=>v<1||v>13)){$('error').textContent='初始坐标应位于 X、Y 各 1～13 的采样范围内。';return;}$('x').value=c[0];$('y').value=c[1];build();};
canvas.onmousemove=e=>{const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/S.WIDTH,r.height/S.HEIGHT),left=r.left+(r.width-S.WIDTH*scale)/2,top=r.top+(r.height-S.HEIGHT*scale)/2,c=S.unproject((e.clientX-left)/scale,(e.clientY-top)/scale,M.atTime(trace,time).step.phase),v=trace.probability.cells[M.key(c)];if(!v)return;$('densityCell').textContent=`格子 (${c}) · ${v.inside?v.land:'地图外'} · 相对 ${D.demo(trace.probability).get(v).multiplier.toFixed(1)}× / ${D.percent(v.probability)} · 单轮跨帧平均 ${D.percent(v.oneAttemptProbability)}${H.matches(v,heatmapOptions().filter)?'':' · 已被海陆筛选隐藏'}${!D.demo(trace.probability).meetsThreshold(v,minMultiplier)?' · 低于显示门槛':''}`;};
function closePreview(){
 preview.hidden=true;document.body.classList.remove('preview-open');document.querySelector('main').inert=false;
 if(document.fullscreenElement===preview)document.exitFullscreen().catch(()=>{});
 $('fullscreen').focus();
}
$('fullscreen').onclick=async()=>{
 preview.hidden=false;document.body.classList.add('preview-open');document.querySelector('main').inert=true;
 previewCtx.drawImage(canvas,0,0);$('closePreview').focus();
 // The viewport preview also works when native fullscreen is unavailable.
 try{await preview.requestFullscreen();}catch{}
};
$('closePreview').onclick=closePreview;
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&!preview.hidden)closePreview();});
window.onkeydown=e=>{
 if(!preview.hidden){
  if(e.code==='Escape'){e.preventDefault();closePreview();return;}
  if(e.code==='Tab'){e.preventDefault();$('closePreview').focus();return;}
 }else if(['INPUT','SELECT','BUTTON','TEXTAREA'].includes(document.activeElement.tagName))return;
 if(e.code==='Space'){e.preventDefault();toggle();}if(e.code==='ArrowRight'){e.preventDefault();jump(1);}if(e.code==='ArrowLeft'){e.preventDefault();jump(-1);}
};
function download(data,name,type){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([data],{type}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
$('snapshot').onclick=()=>{
 const button=$('snapshot'),status=$('snapshotStatus'),step=M.atTime(trace,time).step;
 const name=`crate-${trace.preset.id}-${step.phase}-step${step.i+1}-${Math.round(time*1000)}ms.png`;
 button.disabled=true;status.textContent='正在生成 PNG…';
 try{
  // Copy the displayed frame immediately so playback cannot change the export.
  const still=document.createElement('canvas');still.width=canvas.width;still.height=canvas.height;
  still.getContext('2d').drawImage(canvas,0,0);
  still.toBlob(blob=>{
   button.disabled=false;
   if(!blob){status.textContent='截图未生成，请重试。';return;}
   download(blob,name,'image/png');status.textContent=`PNG 已生成并开始下载 · ${still.width} × ${still.height}`;
  },'image/png');
 }catch(e){button.disabled=false;status.textContent=`截图未完成：${e.message}`;}
};
$('trace').onclick=()=>download(JSON.stringify(trace,null,2),'crate-trace.json','application/json');
function exportConfig(all){return {all,options:options(),timing:activeTiming,heatmap:heatmapOptions(),coords:$('coords').checked,heatmapValues:$('heatmapValues').checked};}
async function exportVideo(all){
 if(!applyTiming())return;
 if(location.protocol==='file:'){$('exportStatus').textContent='请先运行“启动演示.cmd”，再在本地页面导出 MP4。';return;}
 $('exportAll').disabled=$('exportCurrent').disabled=true;$('exportLink').style.display='none';$('exportStatus').textContent='正在准备视频…';
 try{const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exportConfig(all))});const data=await response.json();if(!response.ok)throw Error(data.error||'导出失败');
 const poll=async()=>{const r=await fetch(`/api/job/${data.id}`),j=await r.json();if(j.error)throw Error(j.error);$('exportStatus').textContent=j.done?'视频已生成。':`正在生成 MP4 · ${j.progress||0}%`;
 if(j.done){$('exportLink').href=j.url;$('exportLink').style.display='inline';$('exportAll').disabled=$('exportCurrent').disabled=false;}else setTimeout(()=>poll().catch(fail),900);};await poll();
 }catch(e){fail(e);}
}
function fail(e){$('exportStatus').textContent=`导出未完成：${e.message}`;$('exportAll').disabled=$('exportCurrent').disabled=false;}
$('exportAll').onclick=()=>exportVideo(true);$('exportCurrent').onclick=()=>exportVideo(false);
function loop(now){if(playing){time=Math.min(trace.duration,time+(now-last)/1000);forceComplete=false;if(time>=trace.duration){playing=false;forceComplete=true;}draw();}last=now;requestAnimationFrame(loop);}
build();if(timingStartupError)$('error').textContent=timingStartupError;requestAnimationFrame(loop);
Promise.all(Object.entries(CrateAssetData).map(([name,asset])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([name,image]);image.onerror=()=>reject(Error('素材加载失败：'+name));image.src=asset.data;}))).then(entries=>{S.setAssets(Object.fromEntries(entries),CrateAssetData);draw();$('snapshot').disabled=false;}).catch(e=>{$('error').textContent=e.message;});
if(location.protocol!=='file:')document.querySelector('a[href="../../docs/random-crate-generation.md"]').href='/research';
// Local QA and deterministic export use the exact same renderer as the controls.
window.crateDemo={get trace(){return trace;},get time(){return time;},setTime(t){time=Math.max(0,Math.min(trace.duration,t));playing=false;forceComplete=false;draw();},build,options};
