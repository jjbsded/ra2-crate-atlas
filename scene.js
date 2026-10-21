(function(root){
  'use strict';
  const M=typeof module!=='undefined'?require('./model.js'):root.CrateModel;
  const H=typeof module!=='undefined'?require('./probability.js'):root.CrateProbability;
  const D=typeof module!=='undefined'?require('./probability-display.js'):root.CrateProbabilityDisplay;
  const O=typeof module!=='undefined'?require('./occupancy-overlay.js'):root.CrateOccupancyOverlay;
  const WIDTH=1600, HEIGHT=900;
  const GEO={ox:537,oy:170,hw:36,hh:18};
  // Fit the complete main panel into the output; preserve the 2:1 tile aspect.
  const summaryScale=(HEIGHT-40)/625;
  const SUMMARY_VIEW={scale:summaryScale,x:(WIDTH-1048*summaryScale)/2-30*summaryScale,y:20-124*summaryScale};
  const C={bg:'#101921',panel:'#18242e',line:'#314350',text:'#eef5f8',muted:'#9db1c1',red:'#ff6672',blue:'#638cff',amber:'#ffd16c',green:'#51e0aa'};
  let artwork={};
  function setAssets(images,metadata){artwork={};for(const [name,image] of Object.entries(images))artwork[name]={image,...metadata[name]};}
  function point([x,y],phase) { const p=[GEO.ox+(x-y)*GEO.hw,GEO.oy+(x+y)*GEO.hh];return phase==='heatmap'?p.map((v,i)=>v*SUMMARY_VIEW.scale+(i?SUMMARY_VIEW.y:SUMMARY_VIEW.x)):p; }
  function unproject(px,py,phase) { if(phase==='heatmap'){px=(px-SUMMARY_VIEW.x)/SUMMARY_VIEW.scale;py=(py-SUMMARY_VIEW.y)/SUMMARY_VIEW.scale;}const d=(px-GEO.ox)/GEO.hw,s=(py-GEO.oy)/GEO.hh;return [Math.round((s+d)/2),Math.round((s-d)/2)]; }
  function render(ctx,trace,step,progress=1,opts={}) {
    const world=trace.world||M.WORLDS.land;
    const summary=step.phase==='heatmap',heat=H.settings(opts.heatmap||{enabled:summary});
    const density=heat.enabled?(trace.probability||H.computeRandom(world)):null;
    const display=density?D.demo(density):null;
    const cellAlpha=c=>H.matches(c,heat.filter)?display.cellAlpha(c,heat):0;
    const {hw,hh,ox,oy}=GEO;
    const text=(s,x,y,size=20,color=C.text,bold=false)=>{ctx.fillStyle=color;ctx.font=`${bold?'bold ':''}${size}px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText(s,x,y);};
    const line=(a,b,color,width=1,dash=[])=>{ctx.beginPath();ctx.setLineDash(dash);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.setLineDash([]);};
    const box=(x,y,w,h,fill,stroke=null,r=12)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}};
    const diamond=(cell,fill,stroke=null,width=1,inset=0)=>{const [x,y]=point(cell);ctx.beginPath();ctx.moveTo(x,y-hh+inset);ctx.lineTo(x+hw-inset,y);ctx.lineTo(x,y+hh-inset);ctx.lineTo(x-hw+inset,y);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}};
    const wrap=(s,x,y,max=410,size=22,color=C.text,gap=36)=>{let row='';for(const token of s.match(/[A-Za-z][A-Za-z0-9_/%]*|[0-9]+(?:\.[0-9]+)*|./gu)||[]){ctx.font=`${size}px "Microsoft YaHei", sans-serif`;if(ctx.measureText(row+token).width>max&&!/[，。；：！？、）]/.test(token)){text(row,x,y,size,color);y+=gap;row=token;}else row+=token;}text(row,x,y,size,color);return y+gap;};
    const label=(s,x,y,color=C.text,size=17)=>{ctx.font=`${size}px "Microsoft YaHei", sans-serif`;const w=ctx.measureText(s).width+22;box(x-w/2,y-22,w,32,C.bg,null,6);text(s,x-w/2+11,y,size,color);};
    const sprite=(name,cell,scale=1.2)=>{const asset=artwork[name];if(!asset)return;const [x,y]=point(cell);ctx.drawImage(asset.image,x-asset.anchor[0]*scale,y-asset.anchor[1]*scale,asset.width*scale,asset.height*scale);};
    ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.fillStyle=C.bg;ctx.fillRect(0,0,WIDTH,HEIGHT);
    if(!summary){
    text('红警 2',38,54,20,C.amber,true);text('随机工具箱 · 从起点到落点',148,55,30,C.text,true);
    text('原版 RA2 / YR · 平地模型 · 8 × 6 微型地图',38,93,18,C.muted);
    box(1120,25,442,72,C.panel);text(trace.preset.name,1142,56,21,C.text,true);text(trace.preset.subtitle,1142,82,16,C.muted);
    }
    ctx.save();
    if(summary){ctx.translate(SUMMARY_VIEW.x,SUMMARY_VIEW.y);ctx.scale(SUMMARY_VIEW.scale,SUMMARY_VIEW.scale);}
    box(30,124,1048,625,'#121e28',C.line,15);
    if(summary){
      text('工具箱落点概率 · 放箱前地图',52,157,20,C.text,true);
      text(`随机逻辑帧 · ${trace.probability?.frameDistribution?.period||H.computeRandom(world).frameDistribution.period} 个等权帧余数精确平均 · 同次调用最多 1000 轮`,52,190,16,C.muted);
    }else{
      text('菱形是一个 Cell；整张地图在屏幕上呈横向矩形',52,157,18,C.muted);
      text(world.id==='island'?'中央 2×2 格为陆地；海水会被排除，但不会挡住外圈扫描':world.id==='ocean'?'全海水示例：真实格全是 Water；地图外仍取 InvalidCell':world.id==='coast'?'左侧水域示例：边界外的真实水格仍有 Water 属性':'陆地示例：矿石与箱子是 Overlay 覆盖物',52,190,16,C.muted);
    }
    // A clipped, faint sampling grid. Not every cell in this square is map terrain.
    ctx.save();ctx.beginPath();ctx.rect(32,175,1044,530);ctx.clip();
    ctx.imageSmoothingEnabled=false;
    // Layer 1: original TMP ground. No annotation is drawn until all art is done.
    for(let s=2;s<=26;s++)for(let x=1;x<=13;x++){
      const y=s-x;if(y<1||y>13)continue;const cell=[x,y],valid=M.inside(cell),use=M.usable(cell);
      diamond(cell,valid?'#91a05a':'#182631');
      if(valid)sprite(M.landType(cell,world)==='Water'?'water'+((y%2)*2+x%2):'ground'+((x*3+y*5)%8),cell);
    }
    // Layer 2: original objects, including a successful new crate, stay BELOW
    // every grid line, coordinate, search highlight, border and label.
    const objectList=Object.entries(world.objects).map(([k,kind])=>({cell:k.split(',').map(Number),kind}));
    if(step.placed||(step.phase==='put'&&!step.failed))objectList.push({cell:step.selected,kind:step.crateKind||'crate'});
    objectList.sort((a,b)=>(a.cell[0]+a.cell[1])-(b.cell[0]+b.cell[1])||a.cell[0]-b.cell[0]);
    for(const {cell,kind} of objectList){
      const [x,y]=point(cell);
      if(kind==='ore'){sprite('ore',cell);continue;}
      if(kind==='unit'){
        sprite('rhino_body',cell,.70);sprite('rhino_turret',cell,.70);
      }else{
        const asset=kind==='building'?'pillbox':kind==='terrain'?'rock':kind;
        sprite(asset+'_shadow',cell);sprite(asset,cell);
      }
    }
    // Tint / probability fill precede the entire grid, numbers and search marks.
    for(let x=1;x<=13;x++)for(let y=1;y<=13;y++){
      const cell=[x,y];if(M.inside(cell)&&!M.usable(cell))diamond(cell,'#152d4b99');
    }
    if(density)for(const cell of Object.values(density.cells)){
      const a=cellAlpha(cell);if(!a)continue;
      ctx.globalAlpha=a;diamond(cell.cell,H.color(display.get(cell).multiplier,heat.palette,display.maxMultiplier));ctx.globalAlpha=1;
    }
    if(heat.showBlocked)for(const {cell} of objectList)if(M.inside(cell)&&O.demoCell(cell,world)){
      const[x,y]=point(cell);O.draw(ctx,[[[x,y-hh],[x+hw,y],[x,y+hh],[x-hw,y]]]);
    }
    for(let s=2;s<=26;s++)for(let x=1;x<=13;x++){
      const y=s-x;if(y<1||y>13)continue;const cell=[x,y],valid=M.inside(cell),use=M.usable(cell);
      diamond(cell,null,valid?'#d4edfa99':'#223540',1);
      if(valid&&opts.coords===true){const [px,py]=point(cell);ctx.font='11px "Microsoft YaHei", sans-serif';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.strokeStyle='#142919';ctx.lineWidth=2.5;ctx.strokeText(`${x},${y}`,px-14,py+12);text(`${x},${y}`,px-14,py+12,11,'#e7f3ef');}
    }
    if(density&&opts.heatmapValues!==false)for(const cell of Object.values(density.cells)){
      if(!cell.inside||!cellAlpha(cell)||!display.showLabel(cell,heat.showBaselineValues))continue;
      const [px,py]=point(cell.cell),value=display.get(cell).multiplier.toFixed(1)+'×';
      ctx.font='bold 12px "Microsoft YaHei", sans-serif';ctx.textAlign='center';ctx.strokeStyle='#0a1424';ctx.lineWidth=3;
      ctx.strokeText(value,px,py-3);ctx.fillStyle='#ffffff';ctx.fillText(value,px,py-3);ctx.textAlign='left';
    }
    if(step.phase==='search'){
      const n=opts.animateScan===false?step.visits.length:Math.max(1,Math.min(step.visits.length,Math.ceil(progress*step.visits.length)));
      step.visits.slice(0,n).forEach(v=>diamond(v.cell,v.ok?'#44ce9b66':'#ed75802c',v.ok?C.green:'#d67782',v.ok?2:1,2));
      const [x,y]=step.origin,r=step.radius;
      const corners=[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]].map(point);
      if(r>0){for(let i=0;i<4;i++)line(corners[i],corners[(i+1)%4],C.amber,2,[7,5]);}
      if(n)diamond(step.visits[n-1].cell,null,C.amber,3,0);
    }else if(step.candidates)step.candidates.forEach(c=>diamond(c,'#42d29e55',C.green,2,2));
    if(step.origin){diamond(step.origin,'#ffd16c44',C.amber,3);const [x,y]=point(step.origin);ctx.beginPath();ctx.fillStyle=C.amber;ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();}
    if(step.selected&&step.origin&&M.key(step.selected)!==M.key(step.origin)){
      const a=point(step.origin),b=point(step.selected);line(a,b,C.amber,3,[5,5]);
    }
    if(step.selected){diamond(step.selected,step.failed?'#ed758044':'#49dca655',step.failed?C.red:C.green,4);}
    ctx.restore();
    // Rectangular envelopes of the included diamond tiles. The exact cell tests
    // are the inequalities in model.js; the bottom diamond tips add one half tile.
    const border=(dmin,dmax,smin,smax,color)=>{ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.strokeRect(ox+dmin*hw,oy+smin*hh,(dmax-dmin)*hw,(smax-smin)*hh);};
    border(-8,8,8,21,C.red);border(-6,6,10,19,C.blue);
    if(!step.origin||M.key(step.origin)!=='1,8')label('1,8 · 左上',...(()=>{const p=point([1,8]);return[p[0]-2,p[1]-31];})(),C.text,17);
    if(!step.origin||M.key(step.origin)!=='8,1')label('8,1 · 右上',...(()=>{const p=point([8,1]);return[p[0]+2,p[1]-31];})(),C.text,17);
    label('地图边界 Size',ox-8*hw+74,oy+21*hh+29,C.red,16);
    line([ox+6*hw,oy+10*hh],[874,oy+10*hh],C.blue,1.5,[4,4]);
    label('模型可用边界 LocalSize',956,oy+10*hh+5,C.blue,16);
    if(step.origin){const [x,y]=point(step.origin);label(`起点 (${step.origin})`,x,y-40,C.amber,18);}
    if(step.selected){const [x,y]=point(step.selected);label(`${step.failed?'被 Overlay 拒绝':step.placed?(step.crateKind==='watercrate'?'新水箱':'新陆地箱'):'选中'} (${step.selected})`,x,y+49,step.failed?C.red:C.green,17);}
    // Coordinate compass stays separate from the map content.
    const compass=[875,600];line(compass,[936,630],C.text,2);line(compass,[814,630],C.text,2);
    text('X +',937,638,18);text('Y +',778,638,18);text('X 向右下 / Y 向左下',787,672,16,C.muted);
    if(density){
      text(`相对倍率 · ${H.PALETTE_NAMES[heat.palette]} / 1× 基准 ${D.percent(display.baselineProbability)}`,52,598,18,C.text,true);
      const ticks=H.legend(heat.palette,display.maxMultiplier);
      if(heat.palette==='multi')ticks.forEach((v,i)=>box(52+i*86,612,69,17,H.color(v),null,3));
      else{
        const gradient=ctx.createLinearGradient(52,0,723,0);
        for(let i=0;i<=100;i++)gradient.addColorStop(i/100,H.color(Math.expm1(Math.log1p(display.maxMultiplier)*i/100),heat.palette,display.maxMultiplier));
        box(52,612,671,17,gradient,null,3);
      }
      ticks.forEach((v,i)=>{
        const caption=H.format(v)+'×';ctx.font='14px "Microsoft YaHei", sans-serif';
        const tickX=52+i*671/7,labelX=tickX-(i===7?ctx.measureText(caption).width:i?ctx.measureText(caption).width/2:0);
        text(caption,heat.palette==='multi'?52+i*86:labelX,650,14,C.muted);
      });
      text(`仅显示 ≥ ${heat.minMultiplier.toFixed(1)}× · ${heat.palette==='multi'?'多色色标固定':'最深色对应全图最高倍率'} · 绿色圆角：占用标识`,52,678,15,C.muted);
    }else if(world.id==='island')text('逐格检查，不是寻路；黄色虚线只连接起点与落点。',52,648,17,C.muted);
    text('红框：地图格的外包络',52,714,16,C.red);text('蓝框：模型可用格的外包络',282,714,16,C.blue);
    if(summary)text({all:'全部显示',water:'仅显示水面',land:'仅显示陆地'}[heat.filter],850,714,16,C.muted);
    else{text('黄色：起点／当前检查',604,714,16,C.amber);text('绿色：候选／落点',850,714,16,C.green);}
    ctx.restore();
    if(summary)return;
    // Explanation panel is part of the recorded video.
    box(1100,124,462,625,C.panel,C.line,15);
    text(`第 ${step.attempt} / 1000 轮`,1126,163,18,C.amber,true);
    text(step.title,1126,206,25,C.text,true);
    text(`取格：${step.cellSource||'真实 Cell'}`,1126,240,17,C.muted);
    text(`起点 ${step.initialLand||'Clear'} → ${step.speed||'Track'} 搜索`,1126,271,20,C.amber,true);
    let yy=wrap(step.text,1126,310,409,20,C.text,29);
    line([1126,yy+8],[1536,yy+8],C.line);
    yy+=36;
    text('X、Y 各 1～13 · 搜索半径 0～13',1126,yy,17,C.muted);yy+=28;
    text(`逻辑帧：${trace.frame}（演示播放期间固定）`,1126,yy,17,C.muted);yy+=37;
    if(step.phase==='search'){
      const n=opts.animateScan===false?step.visits.length:Math.max(1,Math.min(step.visits.length,Math.ceil(progress*step.visits.length)));
      const v=step.visits[n-1];text(`检查顺序：${n} / ${step.visits.length}`,1126,yy,18,C.amber);yy+=31;
      if(v){text(`(${v.cell}) · ${v.ok?'通过':'排除'} · ${v.land}`,1126,yy,21,v.ok?C.green:C.red,true);yy+=32;yy=wrap(v.reason,1126,yy,407,19,C.muted,29);}
      text(`已收集 ${step.visits.slice(0,n).filter(v=>v.ok).length} 条候选`,1126,yy+7,18,C.green);
    }else if(step.phase==='choose'){
      text('候选记录（按扫描顺序）',1126,yy,18,C.green);yy+=30;
      yy=wrap(step.candidates.map((c,i)=>`${i===step.index?'选中 ':''}${i+1}:(${c})`).join('  '),1126,yy,407,17,C.muted,28);
      if(step.radius===0)wrap('r=0 的上下行会重复记录原格两次。',1126,yy+8,400,17,C.muted,27);
    }else{
      wrap(step.phase==='retry'?'最终放置失败 → 整轮重抽':step.phase==='done'?'成功后退出本次调用':'附近搜索 → 候选选择 → 最终放置',1126,yy,405,19,C.green,30);
    }
    // Ordinary chapters retain the mechanism stages and research footer.
    const phaseIndex=step.phase==='origin'||step.phase==='retry'?0:step.phase==='search'?1:step.phase==='choose'?2:3;
    const stages=['01  初始坐标','02  附近搜索','03  候选选择','04  最终放置'];
    stages.forEach((s,i)=>{const x=30+i*388;box(x,770,369,48,i===phaseIndex?'#3b3b2a':C.panel,i===phaseIndex?C.amber:null,8);text(s,x+19,801,19,i===phaseIndex?C.amber:C.muted,true);});
    text('蓝框不是玩家黑幕，也不是当前镜头。平地、无桥梁；首点与重抽点是指定演示输入。',38,851,18,C.muted);
    text('依据：RA2 0x54E410 / 0x5502E0 · YR 0x56BD40 / 0x56DC20；不是实机回放。',38,880,15,'#758c9e');
    if(opts.chapter){box(1268,838,292,40,C.panel);text(opts.chapter,1288,865,17,C.amber);}
  }
  const api={WIDTH,HEIGHT,GEO,SUMMARY_VIEW,point,unproject,render,setAssets};if(typeof module!=='undefined')module.exports=api;root.CrateScene=api;
})(typeof globalThis!=='undefined'?globalThis:this);
