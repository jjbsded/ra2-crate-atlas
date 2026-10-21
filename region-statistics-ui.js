/* Region workspace. Persistence is keyed by source bytes, never an analysis job URL. */
(function(root){
 'use strict';
 const R=root.CrateRegionStatistics,$=id=>document.getElementById(id);
 const format=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
 const amount=n=>n===null?'—':(n>0&&n<.01?n.toPrecision(2):format.format(n))+'×';
 function create({getState,getDisplay,schedule,pick,area,onMode}){
  let doc=R.defaults(),lookup=new Map(),eligible=new Map(),stats=new Map(),storageKey='',active=false,stroke=null,hover=null,history=[],future=[],saveTimer=null,storageBlocked=false,nameEditing=false,colorEditing=false,opacityEditing=false;
  let selectionIndex=null,geometryCache=new WeakMap(),statisticsCache=new WeakMap(),thumbnailCache=new WeakMap(),rasterCache=new Map(),rasterPixels=0;
  const current=()=>doc.regions.find(r=>r.id===doc.active),state=getState;
  const tool=()=>$('regionTool').value;
  let lastTool=tool()||'brush-ellipse',shiftHeld=false,ctrlHeld=false;
  const picking=()=>stroke?stroke.tool==='picker':tool()==='picker'||ctrlHeld;
  const removing=()=>Boolean(stroke?.baseRemove??($('regionOperation').value==='remove'))!==shiftHeld;
  function interactionHint(){
   $('regionEyedropper').setAttribute('aria-pressed',String(tool()==='picker'));
   $('regionModifierStatus').textContent=!active?'':picking()?'取色：点击已有区域；不改变选区':shiftHeld?`Shift · 临时${removing()?'取消选择':'选择'}`:'';
  }
  function modifiers(e={}){
   const shift=typeof e.shiftKey==='boolean'?e.shiftKey:shiftHeld,ctrl=typeof e.ctrlKey==='boolean'?e.ctrlKey:ctrlHeld;
   if(shift===shiftHeld&&ctrl===ctrlHeld)return;
   if(stroke&&stroke.tool.startsWith('brush')&&shift!==shiftHeld)stroke.gap=true;
   shiftHeld=shift;ctrlHeld=ctrl;if(stroke&&stroke.tool!=='picker')stroke.remove=removing();
   interactionHint();schedule();
  }
  const width=()=>Math.round(Math.max(1,Math.min(60,Number($('regionWidth').value)||1)));
  const height=()=>Math.round(Math.max(1,Math.min(60,Number($('regionHeight').value)||1)));
  const status=(value,error=false)=>{$('regionSave').textContent=value;$('regionSave').classList.toggle('error',error);};
  let regionChoices=[];
  function closePicker(focus=false){
   $('regionOptions').hidden=true;$('regionActive').setAttribute('aria-expanded','false');
   if(focus)$('regionActive').focus();
  }
  function openPicker(){
   if(!regionChoices.length)return;
   $('regionOptions').hidden=false;$('regionActive').setAttribute('aria-expanded','true');
   const option=regionChoices.find(b=>b.value===doc.active)||regionChoices[0];option.focus();option.scrollIntoView({block:'nearest'});
  }
  function persist(){
   clearTimeout(saveTimer);saveTimer=null;if(!storageKey||storageBlocked)return;
   try{localStorage.setItem(storageKey,R.encode(doc));status('已自动保存 · 本浏览器');}
   catch{status('自动保存失败：浏览器存储不可用或已满。请导出划分备份。',true);}
  }
  function saveSoon(){if(storageBlocked)return;status('正在自动保存…');clearTimeout(saveTimer);saveTimer=setTimeout(persist,300);}
  function remember(raw){history.push(raw);if(history.length>20)history.shift();future=[];}
  function checkpoint(){remember(R.encode(doc));}
  function dirty(save=true){refresh();schedule();if(save)saveSoon();}
  function setMode(value){
   closePicker();
   cancel();hover=null;shiftHeld=ctrlHeld=false;active=!!value&&!state().data?.metadata.previewOnly;interactionHint();
   $('regionToggle').setAttribute('aria-pressed',String(active));
   $('regionToggle').textContent=active?'结束区域统计':'区域统计';
   $('regionToolbar').hidden=$('regionEditor').hidden=$('regionSummary').hidden=!active;
   $('cellAside').hidden=active;$('map').classList.toggle('region-editing',active);
   $('mapInteractionHint').hidden=active;
   onMode(active);if(active)refresh();schedule();
  }
  function load({preserve=false}={}){
   const s=state();
   const nextKey=s.data.metadata.sourceSha256?'crate-atlas.regions.v1.'+s.data.metadata.sourceSha256:'';
   const keep=preserve&&storageKey&&storageKey===nextKey;
   lookup=new Map(s.cells.map(c=>[R.key(c),c]));eligible=new Map(s.cells.filter(c=>R.canSelect(c,s.data.rendering)).map(c=>[R.key(c),c]));
   selectionIndex=R.createSelectionIndex(s.cells,c=>eligible.has(R.key(c)));s.spatialIndex=selectionIndex.screen;
   geometryCache=new WeakMap();statisticsCache=new WeakMap();thumbnailCache=new WeakMap();rasterCache.clear();rasterPixels=0;
   if(!keep){doc=R.defaults();history=[];future=[];storageBlocked=false;}
   stats.clear();hover=null;shiftHeld=ctrlHeld=false;interactionHint();nameEditing=colorEditing=opacityEditing=false;
   storageKey=nextKey;
   if(keep){/* Recompute statistics/artwork while keeping selection and undo. */}
   else if(storageKey){
    try{const raw=localStorage.getItem(storageKey);if(raw){doc=R.decode(raw,eligible);const old=JSON.parse(raw),removed=old.regions.reduce((n,r)=>n+r.cells.filter(k=>!eligible.has(k)).length,0);status('已恢复此地图的区域划分');$('regionActionStatus').textContent=removed?`已排除 ${removed} 处可选边界外的格子归属。`:'';if(old.defaultRegionCount!==12||old.selectionBoundsVersion!==1||removed)saveSoon();}else status('划分后自动保存 · 本浏览器');}
    catch{storageBlocked=true;status('已有区域记录无法读取，暂不覆盖。可导出当前划分备份。',true);}
   }else{storageBlocked=true;status('结果缺少地图标识，无法自动保存；请重新分析。',true);}
   $('regionToggle').disabled=!!s.data.metadata.previewOnly;
   $('regionToggle').title=s.data.metadata.previewOnly?'外观预览没有概率，无法统计':'划分地区并比较概率';
   if(active&&s.data.metadata.previewOnly)setMode(false);else refresh();schedule();
  }
  function refresh(){
   if(!state().data||state().data.metadata.previewOnly)return;
   const r=current(),selector=$('regionActive');closePicker();$('regionOptions').replaceChildren();regionChoices=[];
   $('regionActiveText').textContent=`${r.name} · ${r.cells.size} 格`;$('regionActiveSwatch').style.backgroundColor=r.color;
   for(const reg of doc.regions){
    const option=document.createElement('button');option.type='button';option.value=reg.id;option.className='region-option';option.tabIndex=-1;
    option.setAttribute('role','option');option.setAttribute('aria-selected',String(reg.id===doc.active));
    const dot=document.createElement('i');dot.className='region-swatch';dot.style.backgroundColor=reg.color;dot.setAttribute('aria-hidden','true');
    const name=document.createElement('span');name.className='region-option-name';name.textContent=reg.name;
    const count=document.createElement('small');count.textContent=`${reg.cells.size} 格`;
    option.append(dot,name,count);option.onclick=()=>{closePicker(true);activate(reg.id);};
    $('regionOptions').append(option);regionChoices.push(option);
   }
   selector.value=doc.active;if(document.activeElement!==$('regionName'))$('regionName').value=r.name;$('regionColor').value=r.color;$('regionOverlap').checked=doc.overlap;
   $('regionUndo').disabled=!history.length;$('regionRedo').disabled=!future.length;$('regionClear').disabled=!r.cells.size;$('regionDelete').disabled=doc.regions.length<=1;$('regionAdd').disabled=doc.regions.length>=64;
   $('regionTransparency').value=doc.transparency;$('regionTransparencyValue').textContent=doc.transparency+'%';
   $('regionFocus').disabled=!r.cells.size;$('regionEditor').style.setProperty('--region-color',r.color);
   if(!active)return;
   stats=new Map(doc.regions.map(r=>{
    let cached=statisticsCache.get(r);if(!cached||cached.revision!==R.revision(r)){cached={revision:R.revision(r),value:R.statistics(r,lookup,getDisplay())};statisticsCache.set(r,cached);}
    return [r.id,cached.value];
   }));
   const order=R.sorted(doc.regions,stats,$('regionSort').value,$('regionAscending').checked);
   const body=$('regionRows');body.replaceChildren();
   for(const reg of order){
    const tr=document.createElement('tr');tr.classList.toggle('active',reg.id===doc.active);
    const label=document.createElement('td'),button=document.createElement('button');button.className='region-row-name';
    const dot=document.createElement('i');dot.style.backgroundColor=reg.color;button.append(dot,document.createTextNode(reg.name));
    button.setAttribute('aria-pressed',String(reg.id===doc.active));button.onclick=()=>activate(reg.id);label.append(button);
    const count=document.createElement('small');count.textContent=`${reg.cells.size.toLocaleString()} 格`;label.append(count);tr.append(label);
    const preview=document.createElement('td');preview.className='region-preview';
    for(const overview of [false,true]){
     const b=document.createElement('button');b.title=overview?'在全图中定位此区域':'查看区域包围范围';b.setAttribute('aria-label',`${overview?'全图定位':'查看地形'}：${reg.name}`);b.disabled=!reg.cells.size;
     const cv=thumbnail(reg,overview);b.append(cv);b.onclick=()=>{activate(reg.id);focus();};preview.append(b);
    }
    tr.append(preview);
    for(const group of ['land','sea','all']){
     const g=stats.get(reg.id)[group];
     for(const field of ['total','average']){
      const td=document.createElement('td');td.textContent=amount(g[field]);
      td.title=`${state().data.metadata.approximate?'近似统计，不保证准确；':''}${g.count} 格（含零概率格）${field==='average'?'；总倍率 ÷ 本类格数':''}`;
      if(field==='average'){const count=document.createElement('small');count.textContent=`${g.count.toLocaleString()} 格`;td.append(count);}
      tr.append(td);
     }
    }
    body.append(tr);
   }
   const selected=stats.get(doc.active),metric=$('regionLive');
   metric.textContent=`${state().data.metadata.approximate?'近似统计 · 不保证准确 · ':''}当前 ${r.cells.size.toLocaleString()} 格 · 综合 ${amount(selected.all.total)} · 平均 ${amount(selected.all.average)}`;
   $('regionCount').textContent=`${doc.regions.length} 个区域${doc.overlap?' · 可重叠，各区独立统计':' · 不重叠'}`;
  }
  function activate(id){cancel();doc.active=id;nameEditing=colorEditing=false;hover=null;refresh();saveSoon();schedule();}
  function focus(){
   const b=R.bounds(current(),lookup,CrateMapRenderer.surface);if(!b)return;
   const s=state();s.scale=Math.min(6,Math.max(.06,Math.min((area.w-120)/b.w,(area.h-120)/b.h)));
   s.x=area.x+area.w/2-(b.x+b.w/2)*s.scale;s.y=area.y+area.h/2-(b.y+b.h/2)*s.scale;schedule();
  }
  function path(ctx,c,view,whole=false){
   for(const ring of CrateMapRenderer.surface(c,whole)){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](view.x+(c.px+dx)*view.scale,view.y+(c.py+dy)*view.scale));ctx.closePath();}
  }
  function geometry(reg){
   let cached=geometryCache.get(reg);if(cached?.revision===R.revision(reg))return cached;
   const fill=new Path2D(),edge=new Path2D();
   for(const k of reg.cells){const c=lookup.get(k);if(!c)continue;
    path(fill,c,{x:0,y:0,scale:1});
    if([1024,-1024,1,-1].some(d=>!reg.cells.has(k+d)))path(edge,c,{x:0,y:0,scale:1});
   }
   cached={revision:R.revision(reg),fill,edge,bounds:R.bounds(reg,lookup,CrateMapRenderer.surface)};geometryCache.set(reg,cached);return cached;
  }
  function paintRegion(ctx,reg,view,alpha=.18){
   if(!reg.cells.size)return;paintGeometry(ctx,geometry(reg),view,reg.color,alpha,reg.id===doc.active);
  }
  function paintGeometry(ctx,g,view,color,alpha,selected){
   ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);
   ctx.fillStyle=color;ctx.globalAlpha=alpha;ctx.fill(g.fill,'evenodd');ctx.globalAlpha=1;
   if(view.scale>=.12){ctx.strokeStyle=color;ctx.lineWidth=(selected?1.4:.8)/view.scale;ctx.stroke(g.edge);}
   ctx.restore();
  }
  function cachedRegion(ctx,reg,view,clip,kind,alpha){
   if(!reg.cells.size)return;const g=geometry(reg),b=g.bounds;if(!b)return;
   const worldLeft=Math.floor(b.x*view.scale-2),worldTop=Math.floor(b.y*view.scale-2),worldRight=Math.ceil((b.x+b.w)*view.scale+2),worldBottom=Math.ceil((b.y+b.h)*view.scale+2);
   if(view.x+worldRight<clip.x||view.y+worldBottom<clip.y||view.x+worldLeft>clip.x+clip.w||view.y+worldTop>clip.y+clip.h)return;
   // Whole-region bitmaps at overview scales can slide with the map without
   // rerasterizing at each viewport edge. Large zoomed regions stay clipped.
   const whole=kind==='map'&&(worldRight-worldLeft)*(worldBottom-worldTop)<=2000000;
   const x=whole?view.x+worldLeft:Math.max(Math.floor(view.x+b.x*view.scale-2),clip.x),y=whole?view.y+worldTop:Math.max(Math.floor(view.y+b.y*view.scale-2),clip.y);
   const right=whole?view.x+worldRight:Math.min(Math.ceil(view.x+(b.x+b.w)*view.scale+2),clip.x+clip.w),bottom=whole?view.y+worldBottom:Math.min(Math.ceil(view.y+(b.y+b.h)*view.scale+2),clip.y+clip.h);
   const w=whole?worldRight-worldLeft:right-x,h=whole?worldBottom-worldTop:bottom-y;if(w<=0||h<=0)return;
   const offsetX=whole?-worldLeft:view.x-x,offsetY=whole?-worldTop:view.y-y;
   const id=kind+reg.id,key=[g.revision,reg.color,reg.id===doc.active,view.scale,offsetX,offsetY,w,h,alpha].join('|');
   let cached=rasterCache.get(id);
   if(!cached||cached.region!==reg||cached.key!==key){
    if(cached){rasterPixels-=cached.pixels;rasterCache.delete(id);}
    const pixels=w*h;
    while((rasterPixels+pixels>16000000||rasterCache.size>=128)&&rasterCache.size){const oldest=rasterCache.keys().next().value;rasterPixels-=rasterCache.get(oldest).pixels;rasterCache.delete(oldest);}
    const image=document.createElement('canvas');image.width=w;image.height=h;
    paintRegion(image.getContext('2d'),reg,{x:offsetX,y:offsetY,scale:view.scale},alpha);
    cached={region:reg,key,image,pixels};rasterCache.set(id,cached);rasterPixels+=pixels;
   }else{rasterCache.delete(id);rasterCache.set(id,cached);}
   ctx.drawImage(cached.image,x,y);
  }
  function thumbnail(reg,overview){
   const s=state(),source=$('objects').checked&&s.objectImage?s.objectImage:s.image,key=[R.revision(reg),reg.color,reg.id===doc.active,doc.transparency,$('players').checked].join('|');
   let cached=thumbnailCache.get(reg);if(!cached||cached.key!==key||cached.source!==source){cached={key,source,images:[]};thumbnailCache.set(reg,cached);}
   const index=Number(overview);if(cached.images[index])return cached.images[index];
   const cv=document.createElement('canvas');cv.width=overview?132:180;cv.height=90;cv.setAttribute('aria-hidden','true');cached.images[index]=cv;
   const ctx=cv.getContext('2d'),b=geometry(reg).bounds;ctx.fillStyle='#0a151e';ctx.fillRect(0,0,cv.width,cv.height);
   if(!b){ctx.fillStyle='#78909f';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText(overview?'全图位置':'尚未划分',cv.width/2,cv.height/2+4);return cv;}
   const crop=overview?{x:0,y:0,w:s.data.rendering.width,h:s.data.rendering.height}:b,scale=Math.min((cv.width-8)/crop.w,(cv.height-8)/crop.h);
   const view={scale,x:(cv.width-crop.w*scale)/2-crop.x*scale,y:(cv.height-crop.h*scale)/2-crop.y*scale};
   ctx.drawImage(source,crop.x,crop.y,crop.w,crop.h,(cv.width-crop.w*scale)/2,(cv.height-crop.h*scale)/2,crop.w*scale,crop.h*scale);
   paintRegion(ctx,reg,view,1-doc.transparency/100);
   if(overview){
    const w=Math.max(6,b.w*scale),h=Math.max(6,b.h*scale),x=view.x+(b.x+b.w/2)*scale-w/2,y=view.y+(b.y+b.h/2)*scale-h/2;
    ctx.strokeStyle='#07131d';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);
   }
   if($('players').checked)root.CratePlayerStarts?.draw(ctx,s,view,{radius:overview?5.5:7,clip:{x:0,y:0,w:cv.width,h:cv.height}});
   return cv;
  }
  function mapPoint(p){
   const s=state(),x=(p.x-s.x)/s.scale,y=(p.y-s.y)/s.scale,t=stroke?.tool||tool(),c=(t.includes('game')||t==='box-screen')?pick(p):null,[ox,oy]=s.data.rendering.origin;
   // Picking accounts for cliffs. Keep a discrete anchor for game-coordinate tools.
   const game=c?{x:c.x,y:c.y}:{x:Math.round(((x-ox)/30+(y-oy)/15)/2),y:Math.round(((y-oy)/15-(x-ox)/30)/2)};
   return {x,y,game,level:c?.level||0};
  }
  const inside=p=>p.x>=area.x&&p.x<=area.x+area.w&&p.y>=area.y&&p.y<=area.y+area.h;
  function down(p,e={}){
   if(!active||!inside(p))return false;
   modifiers(e);
   if(saveTimer)persist();
   const q=mapPoint(p);
   if(picking()){
    stroke={a:q,b:q,tool:'picker',point:p,client:{x:e.clientX??p.x,y:e.clientY??p.y},moved:false};
    hover=q;interactionHint();schedule();return true;
   }
   stroke={a:q,b:q,before:R.encode(doc),tool:tool(),width:width(),height:height(),baseRemove:$('regionOperation').value==='remove',remove:removing(),changed:false};
   if(stroke.tool.startsWith('brush'))brush(q);else stroke.preview=selectionIndex.selectedCells(stroke.tool,q,q);
   hover=q;schedule();return true;
  }
  function brush(q){
   const d=stroke,keys=selectionIndex.selected(d.tool,d.b,q,d.width,d.height);
   d.changed=R.apply(doc,keys,d.remove)||d.changed;d.b=q;
  }
  function move(p,occluded=false,e={}){
   if(!active)return false;
   modifiers(e);
   if(occluded||!inside(p)){hover=null;if(stroke){stroke.gap=true;if(stroke.tool==='picker')stroke.moved=true;}schedule();return !!stroke;}
   const q=mapPoint(p);hover=q;
   if(stroke){
    if(stroke.tool==='picker'){stroke.b=q;stroke.point=p;if(Math.hypot((e.clientX??p.x)-stroke.client.x,(e.clientY??p.y)-stroke.client.y)>4)stroke.moved=true;}
    else if(stroke.tool.startsWith('brush')){if(stroke.gap)stroke.b=q;brush(q);}
    else{stroke.b=q;stroke.preview=selectionIndex.selectedCells(stroke.tool,stroke.a,q);}
    stroke.gap=false;
   }
   schedule();return !!stroke;
  }
  function hoverInfo(){
   if(!active||!hover)return null;
   // Pick once per drawn frame using the existing terrain-aware spatial index,
   // independently of the active brush/region. Membership stays live while painting.
   const s=state(),cell=pick({x:s.x+hover.x*s.scale,y:s.y+hover.y*s.scale});
   if(!cell)return {cell:null,regions:[]};
   const k=R.key(cell);
   return {cell,selectable:eligible.has(k),regions:doc.regions.filter(r=>r.cells.has(k))};
  }
  function up(){
   if(!stroke)return;const d=stroke;
   if(d.tool==='picker'){
    stroke=null;
    if(!d.moved){
     const cell=pick(d.point),members=cell?doc.regions.filter(r=>r.cells.has(R.key(cell))):[];
     // Match visual stacking: the active region is on top, otherwise the latest region.
     const target=members.find(r=>r.id===doc.active)||members[members.length-1];
     if(target){activate(target.id);$('regionTool').value=lastTool;controls();const label=`区域 ${target.id.slice(1)}`;$('regionActionStatus').textContent=`已取色：${target.name===label?label:label+' · '+target.name}；已恢复上次工具。`;}
     else $('regionActionStatus').textContent=cell?'该格未划分区域，当前区域未变。':'此处没有地图格子，当前区域未变。';
    }
    interactionHint();schedule();return;
   }
   if(d.tool.startsWith('box')){const keys=d.preview.map(R.key);if(!keys.length&&Math.hypot(d.a.x-d.b.x,d.a.y-d.b.y)<4){const c=state().lookup.get(`${d.a.game.x},${d.a.game.y}`);if(c&&eligible.has(R.key(c)))keys.push(R.key(c));}d.changed=R.apply(doc,keys,d.remove);}
   stroke=null;interactionHint();
   if(d.changed){remember(d.before);dirty();}else schedule();
  }
  function cancel(){
   if(stroke){if(stroke.before)doc=R.decode(stroke.before,eligible);stroke=null;refresh();interactionHint();schedule();}
  }
  function preview(ctx,view){
   const d=stroke;if(!active||!hover)return;
   if(picking()){
    const x=view.x+hover.x*view.scale,y=view.y+hover.y*view.scale;ctx.save();ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.moveTo(x-12,y);ctx.lineTo(x-3,y);ctx.moveTo(x+3,y);ctx.lineTo(x+12,y);ctx.moveTo(x,y-12);ctx.lineTo(x,y-3);ctx.moveTo(x,y+3);ctx.lineTo(x,y+12);ctx.strokeStyle='#10232d';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#ffe19c';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();return;
   }
   const t=d?.tool||tool(),q=d?.b||hover,a=d?.a||q,w=d?.width||width(),h=d?.height||height(),remove=d?.remove??removing();
   ctx.save();ctx.strokeStyle=remove?'#ffb3a9':current().color;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=1.6;ctx.setLineDash([6,4]);ctx.beginPath();
   const screen=p=>[view.x+p.x*view.scale,view.y+p.y*view.scale];
   if(t.includes('game')){
    const gx=q.game.x+(w%2===0?.5:0),gy=q.game.y+(h%2===0?.5:0);
    const left=t.startsWith('box')?Math.min(a.game.x,q.game.x)-.5:gx-w/2;
    const right=t.startsWith('box')?Math.max(a.game.x,q.game.x)+.5:gx+w/2;
    const top=t.startsWith('box')?Math.min(a.game.y,q.game.y)-.5:gy-h/2;
    const bottom=t.startsWith('box')?Math.max(a.game.y,q.game.y)+.5:gy+h/2;
    const [ox,oy]=state().data.rendering.origin;
    [[left,top],[right,top],[right,bottom],[left,bottom]].forEach(([x,y],i)=>{const p=screen({x:30*(x-y)+ox,y:15*(x+y-q.level)+oy});ctx[i?'lineTo':'moveTo'](...p);});ctx.closePath();
   }else if(t==='brush-circle'||t==='brush-ellipse'){const [x,y]=screen(q);ctx.ellipse(x,y,w*30*view.scale,w*(t==='brush-ellipse'?15:30)*view.scale,0,0,Math.PI*2);}
   else{const x=t.startsWith('box')?Math.min(a.x,q.x):q.x-w*30,y=t.startsWith('box')?Math.min(a.y,q.y):q.y-h*15;const p=screen({x,y});ctx.rect(...p,(t.startsWith('box')?Math.abs(q.x-a.x):w*60)*view.scale,(t.startsWith('box')?Math.abs(q.y-a.y):h*30)*view.scale);}
   ctx.globalAlpha=.10;ctx.fill();ctx.globalAlpha=1;ctx.stroke();ctx.restore();
   if(d?.tool.startsWith('box')){
    ctx.save();ctx.beginPath();
    for(const c of d.preview)path(ctx,c,view);ctx.fillStyle=remove?'#ffb3a9':current().color;ctx.globalAlpha=.25;ctx.fill('evenodd');ctx.restore();
   }
  }
  function clipCamera(ctx,view,camera){
   if(camera){ctx.beginPath();ctx.rect(view.x+camera[0]*view.scale,view.y+camera[1]*view.scale,camera[2]*view.scale,camera[3]*view.scale);ctx.clip();}
  }
  function orderedRegions(){return [...doc.regions].sort((a,b)=>Number(a.id===doc.active)-Number(b.id===doc.active));}
  function snapshotLayer(){
   // Geometry paths are replaced on revision, never edited in place. Retaining
   // them freezes an export without copying every cell or rasterizing early.
   if(!active)return ()=>{};
   const camera=state().data.rendering.cameraRect?.slice(),layers=orderedRegions().filter(r=>r.cells.size).map(r=>({geometry:geometry(r),color:r.color,alpha:(1-doc.transparency/100)*(r.id===doc.active?1:.75),selected:r.id===doc.active}));
   return (ctx,view)=>{
    ctx.save();clipCamera(ctx,view,camera);
    for(const layer of layers)paintGeometry(ctx,layer.geometry,view,layer.color,layer.alpha,layer.selected);
    ctx.restore();
   };
  }
  function render(ctx,view,visible){
   if(!active)return;
   ctx.save();clipCamera(ctx,view,state().data.rendering.cameraRect);
   for(const r of orderedRegions()){
    const alpha=(1-doc.transparency/100)*(r.id===doc.active?1:.75);
    if(view===state())cachedRegion(ctx,r,view,area,'map',alpha);else paintRegion(ctx,r,view,alpha);
   }
   ctx.restore();
   if(view===state())preview(ctx,view);
  }
  function minimap(ctx,im){
   if(!active)return;const view={x:0,y:0,scale:im.scale},clip={x:0,y:0,w:Math.ceil(im.w),h:Math.ceil(im.h)};
   ctx.save();ctx.translate(im.x,im.y);for(const r of doc.regions)cachedRegion(ctx,r,view,clip,'mini',1-doc.transparency/100);ctx.restore();
  }
  $('regionToggle').onclick=()=>setMode(!active);
  $('regionActive').onclick=()=>{$('regionOptions').hidden?openPicker():closePicker();};
  $('regionActive').onkeydown=e=>{
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();openPicker();if(e.key==='Home'||e.key==='End')regionChoices[e.key==='Home'?0:regionChoices.length-1]?.focus();}
  };
  $('regionOptions').onkeydown=e=>{
   const index=regionChoices.indexOf(document.activeElement);let next=null;
   if(e.key==='ArrowDown')next=Math.min(regionChoices.length-1,index+1);
   if(e.key==='ArrowUp')next=Math.max(0,index-1);
   if(e.key==='Home')next=0;if(e.key==='End')next=regionChoices.length-1;
   if(next!==null){e.preventDefault();regionChoices[next]?.focus();}
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePicker(true);}
  };
  $('regionPicker').addEventListener('focusout',e=>{if(!$('regionPicker').contains(e.relatedTarget))closePicker();});
  document.addEventListener('pointerdown',e=>{if(!$('regionPicker').contains(e.target))closePicker();});
  $('regionName').oninput=()=>{
   if(!nameEditing){checkpoint();nameEditing=true;}
   current().name=$('regionName').value.trim().slice(0,48)||'未命名区域';dirty();
  };
  $('regionName').onblur=()=>{nameEditing=false;$('regionName').value=current().name;};
  $('regionColor').oninput=()=>{if(!colorEditing){checkpoint();colorEditing=true;}current().color=$('regionColor').value;dirty();};
  $('regionColor').onchange=$('regionColor').onblur=()=>{colorEditing=false;};
  $('regionOverlap').onchange=()=>{
   checkpoint();doc.overlap=$('regionOverlap').checked;const removed=doc.overlap?0:R.exclusive(doc);dirty();
   $('regionActionStatus').textContent=removed?`已移除 ${removed} 处重复归属，优先保留当前区域；可撤销。`:doc.overlap?'允许同一格归属多个区域。':'同一格只属于一个区域。';
  };
  $('regionAdd').onclick=()=>{checkpoint();const n=doc.next++;doc.regions.push({id:`r${n}`,name:`区域 ${n}`,color:R.nextColor(doc.regions),cells:new Set()});doc.active=`r${n}`;dirty();};
  $('regionClear').onclick=()=>{checkpoint();current().cells.clear();R.touch(current());dirty();$('regionActionStatus').textContent='已清空当前区域；可撤销。';};
  $('regionDelete').onclick=()=>{if(doc.regions.length<=1)return;checkpoint();doc.regions=doc.regions.filter(r=>r.id!==doc.active);doc.active=doc.regions[0].id;dirty();$('regionActionStatus').textContent='已删除区域；可撤销。';};
  function travel(redo){
   cancel();const stack=redo?future:history,raw=stack.pop();if(!raw)return;
   (redo?history:future).push(R.encode(doc));doc=R.decode(raw,eligible);nameEditing=colorEditing=opacityEditing=false;dirty();$('regionActionStatus').textContent=redo?'已重做上一步。':'已撤销上一步。';
  }
  $('regionUndo').onclick=()=>travel(false);$('regionRedo').onclick=()=>travel(true);
  $('regionTransparency').oninput=()=>{if(!opacityEditing){checkpoint();opacityEditing=true;}doc.transparency=Math.max(0,Math.min(100,Number($('regionTransparency').value)||0));dirty();};
  $('regionTransparency').onchange=$('regionTransparency').onblur=()=>{opacityEditing=false;};
  $('regionFocus').onclick=focus;
  $('regionSort').onchange=$('regionAscending').onchange=refresh;
  function controls(){if(tool()!=='picker')lastTool=tool();const brush=tool().startsWith('brush'),round=['brush-circle','brush-ellipse'].includes(tool());$('regionSizes').hidden=!brush;$('regionHeightLabel').hidden=round;$('regionWidthText').textContent=tool()==='brush-circle'?'直径':tool()==='brush-ellipse'?'横向直径':'宽度';hover=null;interactionHint();schedule();}
  $('regionTool').onchange=()=>{cancel();controls();};
  $('regionEyedropper').onclick=()=>{cancel();$('regionTool').value=tool()==='picker'?lastTool:'picker';controls();};
  $('regionOperation').onchange=()=>{hover=null;interactionHint();schedule();};
  for(const id of ['regionWidth','regionHeight'])$(id).onchange=()=>{$(id).value=id==='regionWidth'?width():height();schedule();};
  $('regionBackup').onclick=()=>{
   const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({mapSha256:state().data.metadata.sourceSha256,selection:JSON.parse(R.encode(doc))})],{type:'application/json'}));
   a.href=url;a.download=state().data.metadata.filename+'-区域划分.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('regionRestore').onchange=async()=>{
   const file=$('regionRestore').files[0];if(!file)return;
   try{
    if(file.size>128*1024*1024)throw Error('备份文件过大（上限 128 MB）');
    const data=JSON.parse(await file.text());if(data.mapSha256!==state().data.metadata.sourceSha256)throw Error('备份属于另一张地图');
    const restored=R.decode(JSON.stringify(data.selection),eligible);checkpoint();doc=restored;storageBlocked=false;dirty();$('regionActionStatus').textContent='已恢复备份（自动排除可选边界外的格子）；可撤销。';
   }catch(e){$('regionActionStatus').textContent='恢复失败：'+e.message;}
   $('regionRestore').value='';
  };
  $('objects').addEventListener('change',()=>{if(active)refresh();});
  $('players').addEventListener('change',()=>{if(active)refresh();});
  window.addEventListener('pagehide',()=>{cancel();if(saveTimer)persist();});
  window.addEventListener('blur',()=>{cancel();hover=null;modifiers({shiftKey:false,ctrlKey:false});schedule();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();hover=null;modifiers({shiftKey:false,ctrlKey:false});schedule();}});
  // Do not silently overwrite an update made in another tab.
  window.addEventListener('storage',e=>{
   if(e.key!==storageKey||!e.newValue)return;
   if(stroke||saveTimer){storageBlocked=true;clearTimeout(saveTimer);saveTimer=null;status('另一页面修改了此地图划分。已暂停保存，请导出备份后刷新。',true);return;}
   try{doc=R.decode(e.newValue,eligible);history=[];future=[];nameEditing=colorEditing=opacityEditing=false;dirty(false);status('已同步另一页面的区域划分');}catch{status('另一页面的区域记录无法读取',true);}
  });
  document.addEventListener('keydown',e=>{
   if(active&&(e.key==='Shift'||e.key==='Control')&&!document.querySelector('dialog[open]')&&(hover||stroke||!e.target?.closest('input,textarea,select,[contenteditable]')))modifiers(e);
   if(!active||e.target?.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
   if(e.key==='Escape'){if(stroke){e.preventDefault();cancel();}else if(tool()==='picker'){e.preventDefault();$('regionTool').value=lastTool;controls();}}
   if(e.ctrlKey||e.metaKey){const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();$(k==='y'||e.shiftKey?'regionRedo':'regionUndo').click();}}
  });
  document.addEventListener('keyup',e=>{if(e.key==='Shift'||e.key==='Control')modifiers(e);});
  controls();
  return {load,beforeLoad:()=>{cancel();if(saveTimer)persist();},render,snapshotLayer,minimap,hoverInfo,down,move,up,cancel,leave:()=>{if(hover){hover=null;schedule();}},get active(){return active;},get dragging(){return !!stroke;},setMode};
 }
 root.CrateRegionStatisticsUI={create};
})(typeof globalThis!=='undefined'?globalThis:this);
