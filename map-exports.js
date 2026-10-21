/* Download serializers and controls; snapshots never mutate the viewer. */
(function(root){
 'use strict';
 function report(data,display){
  const cells=data.cells.map(c=>{const{exactN,px,py,...raw}=c;return{...raw,...display.exportCell(c)};});
  return {text:JSON.stringify({...data,probability:data.metadata.previewOnly?null:{...data.probability,display:display.metadata},cells}),type:'application/json',name:data.metadata.previewOnly?'map-visual-preview.json':data.metadata.approximate?'crate-map-probability-approximate.json':'crate-map-probability.json'};
 }
 function csv(data,display,mode='all'){
  const columns=['x','y','level','slope','rawLand','land','postLand','overlayName','terrain','occupied','usable','primary','probability','multiplier','relativeMultiplier','isBaseline','rockTransition','marked','potentialMarked','removable','clearance','higher','clearanceScenario','mineralsEnabled','status','occupancyUnknown','terrainError','approximate','assumedRetry','retryAssumptions'];
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const lines=[columns.join(',')];for(const c of data.cells){if(mode==='current'&&!c.marked||mode==='potential'&&!c.potentialMarked)continue;const row={...c,...display.exportCell(c),approximate:!!data.metadata.approximate,retryAssumptions:JSON.stringify(c.retryAssumptions||[]),higher:JSON.stringify(c.higher),removable:JSON.stringify(c.removable||[]),clearance:JSON.stringify(c.clearance||null),clearanceScenario:c.potentialMarked?data.clearance.description:'',mineralsEnabled:data.metadata.mineralsEnabled!==false};lines.push(columns.map(k=>quote(row[k])).join(','));}
  return {text:'\ufeff'+lines.join('\r\n'),type:'text/csv;charset=utf-8',name:mode==='current'?'rock-cells.csv':mode==='potential'?'potential-rock-cells.csv':data.metadata.approximate?'cells-approximate.csv':'cells.csv'};
 }

 function fraction(data,c,display){
  let n=display.get(c).numerator,d=BigInt(data.probability.exact.denominator);const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(n,d);return {text:JSON.stringify({cell:[c.x,c.y],approximate:!!data.metadata.approximate,approximation:data.metadata.approximation,sourceSha256:data.metadata.sourceSha256,mineralsEnabled:data.metadata.mineralsEnabled!==false,probability:{numerator:String(n/g),denominator:String(d/g)},relativeMultiplier:display.exactFraction(c),baseline:display.metadata.baseline,singleDrawBaseline:{numerator:'1',denominator:String(data.probability.sampleCount)},display:display.metadata.mode,framePolicy:'uniform-cycle',attemptLimit:1000},null,2),type:'application/json',name:`cell-${c.x}-${c.y}-${data.metadata.approximate?'approximate-model':'exact'}.json`};
 }
 function bind({getContext,canvas,draw,mapOptions,message,document=root.document}){
  const $=id=>document.getElementById(id),imageExport=root.CrateMapImageExport,details=root.CrateMapDetails;
 function save(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

  const download=file=>save(new Blob([file.text],{type:file.type}),file.name);
  $('jsonDownload').onclick=e=>{e.preventDefault();const {state,display}=getContext();download(report(state.data,display));};
  for(const [id,mode] of [['csvDownload','all'],['rockDownload','current'],['potentialDownload','potential']]){
   $(id).onclick=e=>{e.preventDefault();const {state,display}=getContext();download(csv(state.data,display,mode));};
  }
 $('screenshot').onclick=()=>{
  const {state}=getContext(),filename=state.data.metadata.filename;
  draw();canvas.toBlob(b=>save(b,`${filename}-crate-probability.png`),'image/png');
 };
 $('mapImageExport').onclick=async()=>{
  const {state,display}=getContext();
  if(!state.data||$('mapImageExport').disabled)return;
  const source={data:state.data,image:state.image,objectImage:state.objectImage,cells:state.cells,lookup:new Map(state.lookup)},snapshotDisplay=display,options=mapOptions({snapshotRegions:true}),out=document.createElement('canvas');
  const button=$('mapImageExport'),status=$('mapImageStatus');button.disabled=true;status.textContent='正在生成完整地图 JPEG，沿用当前筛选与图层设置…';
  try{
   const plan=imageExport.layout(source.data.rendering);
   // Paint the progress message before the independent full-size render.
   await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
   out.width=plan.width;out.height=plan.height;const target=out.getContext('2d',{alpha:false});
   if(!target)throw Error('无法分配地图图片画布，请关闭其他大图后重试。');
   const result=imageExport.render(target,source,snapshotDisplay,options,plan);
   const blob=await new Promise((resolve,reject)=>out.toBlob(b=>b?resolve(b):reject(Error('图片编码失败，请关闭其他大图后重试。')),'image/jpeg',.95));
   const extension=blob.type==='image/jpeg'?'jpg':'png';
   save(blob,`${source.data.metadata.filename}-完整地图.${extension}`);
   status.textContent=`已导出完整地图 · ${plan.width} × ${plan.height} · ${(blob.size/1024**2).toFixed(1)} MB · ${source.data.metadata.previewOnly?details.previewLabel(source.data.metadata)+'（未计算概率）':result.labels.toLocaleString()+' 格倍率；请在图片查看器中放大至 100% 阅读。'}`;
  }catch(error){status.textContent='地图图片未导出：'+error.message;}
  finally{out.width=out.height=1;button.disabled=false;}
 };

  $('cellFraction').onclick=()=>{
   const {state,display}=getContext();
   if(!state.selected){message('先点击格子或按坐标定位。',true);return;}
   download(fraction(state.data,state.selected,display));
  };
 }
 const api={report,csv,fraction,bind};root.CrateMapExports=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
