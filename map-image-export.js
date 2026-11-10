/* Full-map image layout: native cell detail, independent of the viewport. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const renderer=typeof module!=='undefined'?require('./map-renderer.js'):root.CrateMapRenderer;
 const probability=typeof module!=='undefined'?require('./probability.js'):root.CrateProbability;
 const CrateProbabilityDisplay=typeof module!=='undefined'?require('./probability-display.js'):root.CrateProbabilityDisplay;
 const modes=typeof module!=='undefined'?require('./display-modes.js'):root.CrateDisplayModes;
 function layout(r,{maxScale=1.5,bounds=null}={}){
  if(!Number.isFinite(r.width)||!Number.isFinite(r.height)||r.width<=0||r.height<=0)throw Error(_t('地图图片尺寸无效'));
  // Keep at least native detail (60 × 30 pixels per flat cell). Limit optional
  // enlargement on large maps instead of shrinking multiplier text to fit.
  const width=bounds?.w||r.width,height=bounds?.h||r.height,limit=Math.min(maxScale,16300/width,16000/height,Math.sqrt(96000000/(width*height))),scale=bounds?limit:Math.max(1,limit);
  const area={x:24,y:82,w:Math.ceil(width*scale),h:Math.ceil(height*scale)};
  return{width:area.w+48,height:area.y+area.h+140,area,scale,bounds,labelSize:Math.min(16,12*scale)};
 }
 function render(ctx,source,display,settings,plan=layout(source.data.rendering),scenePrepared=false){
  const {width,height,area,scale,labelSize}=plan,data=source.data;
  const options={...settings,...(scenePrepared?{overlayOnly:true}:{}),values:!data.metadata.previewOnly&&(!settings.probabilityMode||settings.probabilityMode==='crate'),labelSize,labelWeight:600};
  if(!scenePrepared){ctx.fillStyle='#101c25';ctx.fillRect(0,0,width,height);}
  function text(value,x,y,size=18,color='#cbdbe6',maxWidth=width-48){ctx.textAlign='left';ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.fillStyle=color;ctx.fillText(value,x,y,maxWidth);}
  const modeTitle=options.probabilityMode&&options.probabilityMode!=='crate'?_t(modes.names[options.probabilityMode]):data.metadata.approximate?_t('近似概率'):_t('工具箱概率倍率');
  text((_i18n?.mapName(data.metadata)||data.metadata.displayName||data.metadata.filename)+_t(' · 完整地图 · ')+(data.metadata.previewOnly?_t('地图外观预览'):modeTitle)+(data.metadata.mineralsEnabled===false?_t(' · 无矿石'):''),24,34,26,'#edf3f7');
  text(`${data.metadata.size[2]} × ${data.metadata.size[3]} · ${data.metadata.theater}`,24,62,17);
  const stats=renderer.render(ctx,{...source,x:area.x-(plan.bounds?.x||0)*scale,y:area.y-(plan.bounds?.y||0)*scale,scale,selected:null},area,display,options);
  ctx.strokeStyle='#294151';ctx.lineWidth=1;ctx.strokeRect(area.x,area.y,area.w,area.h);
  if(data.metadata.previewOnly)return {...plan,...stats};
  const y=area.y+area.h+24,legendWidth=Math.min(900,width-48),maximum=settings.legendMaximum??display.maxMultiplier;
  if(settings.probabilityMode!=='off'){
  for(let i=0;i<legendWidth;i++){ctx.fillStyle=probability.color(Math.expm1(Math.log1p(maximum)*i/legendWidth),options.palette,maximum,options.paletteColors);ctx.fillRect(24+i,y,1,16);}
  for(let i=0;i<=4;i++){ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillStyle='#a9becd';ctx.fillText(Math.expm1(Math.log1p(maximum)*i/4).toFixed(1)+'×',24+legendWidth*i/4,y+39);}
  }
  const range={all:_t('全部'),water:_t('仅水面'),land:_t('仅陆地')}[options.filter]||_t('全部');
  text(_t`范围：${range} · 门槛 ≥ ${Number(options.threshold).toFixed(1)}× · 概率颜色${options.heatmap?_t('开'):_t('关')} · 透明度 ${Number(options.opacity).toFixed(1)}% · 倍率 ${stats.labels.toLocaleString()} 格`,24,y+68,17);
  if(data.metadata.crateLimits?.maximum===0)text(_t('本地图的随机箱数量上限为 0。'),24,y+96,17,'#9fb6c7');
  return{...plan,...stats};
 }
 async function renderAsync(ctx,source,display,settings,plan=layout(source.data.rendering)){
  if(settings.scene&&settings.scene!=='all')return render(ctx,source,display,settings,plan);
  const opacity=settings.objectOpacity??1,layers=!settings.objects||!source.objectImage?[[source.image,1]]:opacity>=1?[[source.objectImage,1]]:[[source.image,1],[source.objectImage,opacity]];
  if(layers.some(([image])=>!image?.renderExport))return render(ctx,source,display,settings,plan);
  const view={x:plan.area.x-(plan.bounds?.x||0)*plan.scale,y:plan.area.y-(plan.bounds?.y||0)*plan.scale,scale:plan.scale,width:source.data.rendering.width*plan.scale,height:source.data.rendering.height*plan.scale};
  ctx.fillStyle='#101c25';ctx.fillRect(0,0,plan.width,plan.height);
  ctx.save();ctx.beginPath();ctx.rect(plan.area.x,plan.area.y,plan.area.w,plan.area.h);ctx.clip();
  settings.coordinateSpace?.paint(ctx,{...source,...view},plan.area);ctx.restore();
  for(const [image,alpha]of layers){
   let done;ctx.save();ctx.globalAlpha*=alpha;
   try{done=await image.renderExport(ctx,view,plan.area);}finally{ctx.restore();}
   if(!done)return render(ctx,source,display,settings,plan);
  }
  return render(ctx,source,display,settings,plan,true);
 }
 const api={layout,render,renderAsync};root.CrateMapImageExport=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
