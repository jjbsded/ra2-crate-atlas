/* Full-map image layout: native cell detail, independent of the viewport. */
(function(root){
 'use strict';
 const renderer=typeof module!=='undefined'?require('./map-renderer.js'):root.CrateMapRenderer;
 const probability=typeof module!=='undefined'?require('./probability.js'):root.CrateProbability;
 function layout(r){
  if(!Number.isFinite(r.width)||!Number.isFinite(r.height)||r.width<=0||r.height<=0)throw Error('地图图片尺寸无效');
  // Keep at least native detail (60 × 30 pixels per flat cell). Limit optional
  // enlargement on large maps instead of shrinking multiplier text to fit.
  const scale=Math.max(1,Math.min(1.5,16300/r.width,16000/r.height,Math.sqrt(96000000/(r.width*r.height))));
  const area={x:24,y:82,w:Math.ceil(r.width*scale),h:Math.ceil(r.height*scale)};
  return{width:area.w+48,height:area.y+area.h+164,area,scale,labelSize:Math.min(16,12*scale)};
 }
 function render(ctx,source,display,settings,plan=layout(source.data.rendering)){
  const {width,height,area,scale,labelSize}=plan,data=source.data;
  const options={...settings,values:!data.metadata.previewOnly,labelSize,labelWeight:600};
  ctx.fillStyle='#101c25';ctx.fillRect(0,0,width,height);
  function text(value,x,y,size=18,color='#cbdbe6',maxWidth=width-48){ctx.textAlign='left';ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.fillStyle=color;ctx.fillText(value,x,y,maxWidth);}
  text(data.metadata.filename+' · 完整地图 · '+(data.metadata.previewOnly?'时空外观预览':'工具箱概率倍率'),24,34,26,'#edf3f7');
  text(`${data.metadata.size[2]} × ${data.metadata.size[3]} · ${data.metadata.theater} · ${data.metadata.previewOnly?'静态外观，未计算概率与禁行风险':'放大至 100% 查看清晰倍率 · 静态初始布局，单次放箱调用'}`,24,62,17);
  const stats=renderer.render(ctx,{...source,x:area.x,y:area.y,scale,selected:null},area,display,options);
  ctx.strokeStyle='#294151';ctx.lineWidth=1;ctx.strokeRect(area.x,area.y,area.w,area.h);
  if(data.metadata.previewOnly){text('时空 Mod 外观预览：未验证 Mod 的放箱／通行规则，未输出概率或禁行风险。',24,area.y+area.h+40,19);return {...plan,...stats};}
  const y=area.y+area.h+24,legendWidth=Math.min(900,width-48);
  for(let i=0;i<legendWidth;i++){ctx.fillStyle=probability.color(Math.expm1(Math.log1p(display.maxMultiplier)*i/legendWidth),options.palette,display.maxMultiplier);ctx.fillRect(24+i,y,1,16);}
  for(let i=0;i<=4;i++){ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillStyle='#a9becd';ctx.fillText(Math.expm1(Math.log1p(display.maxMultiplier)*i/4).toFixed(1)+'×',24+legendWidth*i/4,y+39);}
  const range={all:'全部',water:'仅海洋',land:'仅陆地'}[options.filter]||'全部';
  text(`范围：${range} · 门槛 ≥ ${Number(options.threshold).toFixed(1)}× · 概率颜色${options.heatmap?'开启':'关闭'} · 透明度 ${Number(options.opacity).toFixed(1)}% · 倍率 ${stats.labels.toLocaleString()} 格`,24,y+68,17);
  text(`1× = 只从自身起点落箱、无邻格转入；${options.baselineValues?'包含':'隐藏'}精确 1× 标签。粉边：放箱后禁行；斜纹粉：移除占用后潜在禁行。`,24,y+96,17);
  text(data.metadata.crateLimits?.maximum===0?'本地图 CrateMaximum=0；图中为调用放箱函数的条件结果，不表示会自动刷箱或刷箱频率。':'倍率保持最终概率之间的比例；筛选与图层只影响显示，不改变概率。',24,y+124,17,'#9fb6c7');
  return{...plan,...stats};
 }
 const api={layout,render};root.CrateMapImageExport=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
