/* Shared terrain, probability and risk layers for the viewer and full-map export. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const occupancy=typeof module!=='undefined'?require('./occupancy-overlay.js'):root.CrateOccupancyOverlay;
 const CrateProbability=typeof module!=='undefined'?require('./probability.js'):root.CrateProbability;
 const transfers=typeof module!=='undefined'?require('./transfer-origins.js'):root.CrateTransferOrigins;
 const probabilityDisplay=typeof module!=='undefined'?require('./probability-display.js'):root.CrateProbabilityDisplay;
 const players=typeof module!=='undefined'?require('./player-starts.js'):root.CratePlayerStarts;
 const artwork=typeof module!=='undefined'?require('./map-artwork.js'):root.CrateMapArtwork;
 const flat=[[[0,-15],[30,0],[0,15],[-30,0]]];
 const armFraction=1/6;
 function surface(c,whole=false){return (whole?c.surface:c.visibleSurface)??flat;}
 const voidHeightCache=new WeakMap();
 // Extend the nearest real boundary height into the void for display only.
 // Cache by result, not by viewport/selection, so panning and reselection do
 // not make a source jump. Equal-distance ties prefer the higher real cell.
 function sourceCell(source,state){
  let level=source.cell?.level??source.level??0;
  if(!source.cell){
   let cache=voidHeightCache.get(state.data);
   if(!cache){
    const edge=state.cells.filter(c=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>!state.lookup.has(`${c.x+dx},${c.y+dy}`)));
    cache={edge,levels:new Map()};voidHeightCache.set(state.data,cache);
   }
   const key=`${source.x},${source.y}`;
   if(!cache.levels.has(key)){
    let distance=Infinity,nearestLevel=0;
    for(const c of cache.edge){
     const d=(source.x-c.x)**2+(source.y-c.y)**2,h=c.level??0;
     if(d<distance||d===distance&&h>nearestLevel){distance=d;nearestLevel=h;}
    }
    cache.levels.set(key,nearestLevel);
   }
   level=cache.levels.get(key);
  }
  const [ox,oy]=state.data.rendering.origin;
  return {...source.cell,x:source.x,y:source.y,level,px:30*(source.x-source.y)+ox,py:15*(source.x+source.y-level)+oy};
 }
 // Attach each arm to the corresponding extreme of the complete terrain
 // footprint, including its hidden part. Text placement never moves the arms.
 function selectionArms(c,scale){
  const rings=surface(c,true),points=rings.flat();if(!points.length)return [];
  const width=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),height=Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));
  const length=Math.max(12,width*scale*armFraction),verticalRatio=width?height/width:.5;
  return [[0,-1],[0,1],[1,-1],[1,1]].map(([axis,sign])=>{
   const other=1-axis,edge=(sign<0?Math.min:Math.max)(...points.map(p=>p[axis]));
   const anchors=points.filter(p=>p[axis]===edge);
   for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    if(a[axis]===edge&&b[axis]===edge){const p=[...a];p[other]=Math.max(Math.min(a[other],b[other]),Math.min(Math.max(a[other],b[other]),0));anchors.push(p);}
   }
   const start=anchors.reduce((best,p)=>Math.abs(p[other])<Math.abs(best[other])?p:best).map(v=>v*scale),end=[...start];end[axis]-=sign*length*(axis===1?verticalRatio:1);
   return [start,end];
  });
 }
 // Risk arms start at the four side midpoints, rather than the selected
 // cell's vertices. Use 1/6 of the opposite-midpoint span, with no pixel floor.
 const riskArmCache=new WeakMap();
 function riskArms(c,scale){
  if(!riskArmCache.has(c)){
   const extremes=selectionArms(c,1).map(([start])=>start);
   if(extremes.length!==4)return [];
   const corners=[2,1,3,0].map(i=>extremes[i]);
   const mids=corners.map((a,i)=>a.map((v,j)=>(v+corners[(i+1)%4][j])/2));
   riskArmCache.set(c,mids.map((a,i)=>[a,a.map((v,j)=>v+(mids[(i+2)%4][j]-v)*armFraction)]));
  }
  return riskArmCache.get(c).map(line=>line.map(p=>p.map(v=>v*scale)));
 }
 const outlineCache=new WeakMap();
 // Split the original terrain perimeter into visible and occluded segments.
 // Pixel contours can differ from the ideal diamond by one pixel; tolerate
 // that raster edge without turning the whole perimeter into tiny dashes.
 function outlineParts(c){
  if(outlineCache.has(c))return outlineCache.get(c);
  const full=surface(c,true),visible=surface(c),out={visible:[],hidden:[]};
  function isVisible(x,y){
   let inside=false,near=false;
   for(const ring of visible)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [a,b]=ring[i],[u,v]=ring[j],dx=u-a,dy=v-b,t=Math.max(0,Math.min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy||1)));
    if(Math.hypot(x-a-t*dx,y-b-t*dy)<=1.1)near=true;
    if((b>y)!==(v>y)&&x<(u-a)*(y-b)/(v-b)+a)inside=!inside;
   }
   return inside||near;
  }
  for(const ring of full){
   if(c.surfaceVisibility===1||full===visible){out.visible.push([...ring,ring[0]]);continue;}
   if(!visible.length){out.hidden.push([...ring,ring[0]]);continue;}
   let previous=null,chain=null;
   for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.5));
    for(let k=0;k<steps;k++){
     const p=[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps],q=[a[0]+(b[0]-a[0])*(k+1)/steps,a[1]+(b[1]-a[1])*(k+1)/steps];
     const kind=isVisible((p[0]+q[0])/2,(p[1]+q[1])/2)?'visible':'hidden';
     if(kind!==previous){chain=[p];out[kind].push(chain);previous=kind;}chain.push(q);
    }
   }
  }
  outlineCache.set(c,out);return out;
 }
 function render(ctx,state,area,display,options){
  const r=state.data.rendering,fixed=n=>Number(n).toFixed(1);
  const labelBoxes=[];
  const multiplier=c=>display.get(c).multiplier;
  const thresholdPass=c=>display.meetsThreshold(c,options.threshold||0);
  const inFilter=c=>options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2);
  const onScreen=c=>{const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;return x>=area.x-80&&x<=area.x+area.w+80&&y>=area.y-80&&y<=area.y+area.h+80;};
  function text(value,x,y,color='#dce9f1',size=16,align='left'){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y);}
 function cellPath(c,whole=false){ctx.beginPath();for(const ring of surface(c,whole)){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale));ctx.closePath();}}
 function linesPath(c,lines){ctx.beginPath();for(const line of lines)line.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale));}
 function labelText(value,x,y,size){ctx.strokeText(value,x,y);ctx.fillText(value,x,y);if(state.selected){const w=ctx.measureText(value).width;labelBoxes.push({x:x-w/2-4,y:y-size-4,w:w+8,h:size+8});}}
 function cellLabels(c){const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   const coords=options.coords&&rx>=26,values=options.values&&rx>=26&&display.showLabel(c,options.baselineValues)&&inFilter(c)&&thresholdPass(c);
   if((coords||values)&&surface(c).length){ctx.textAlign='center';ctx.font=`${options.labelWeight||400} ${options.labelSize||12}px "Microsoft YaHei",sans-serif`;ctx.lineWidth=3;ctx.strokeStyle='rgba(12,25,34,.8)';ctx.fillStyle='#fff';
    if(coords)labelText(`${c.x},${c.y}`,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(values?-(options.labelSize||12)/3:(options.labelSize||12)/3),options.labelSize||12);
    if(values){labels++;labelText(fixed(multiplier(c))+'×',x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(coords?(options.labelSize||12)-1:(options.labelSize||12)/3),options.labelSize||12);}
   }
 }
 function cameraClip(){const r=state.data.rendering.cameraRect;if(!r)return;ctx.beginPath();ctx.rect(state.x+r[0]*state.scale,state.y+r[1]*state.scale,r[2]*state.scale,r[3]*state.scale);ctx.clip();}
 function stripedMarker(c,rx){
  const rings=surface(c),points=rings.flat().map(([dx,dy])=>[state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale]);
  if(!points.length)return;
  const left=Math.min(...points.map(p=>p[0])),right=Math.max(...points.map(p=>p[0])),top=Math.min(...points.map(p=>p[1])),bottom=Math.max(...points.map(p=>p[1]));
  ctx.save();cellPath(c);ctx.fillStyle='rgba(241,156,206,.20)';ctx.fill('evenodd');ctx.strokeStyle='#ed9dca';ctx.lineWidth=2;ctx.stroke();ctx.clip('evenodd');
  ctx.beginPath();for(let x=left-(bottom-top);x<=right;x+=7){ctx.moveTo(x,bottom);ctx.lineTo(x+bottom-top,top);}ctx.strokeStyle='#f4b4dc';ctx.lineWidth=1.6;ctx.stroke();ctx.restore();
  if(rx<18){const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   ctx.save();ctx.fillStyle='#472138';ctx.fillRect(x-4,y-4,8,8);ctx.strokeStyle='#ed9dca';ctx.lineWidth=1.5;ctx.strokeRect(x-4,y-4,8,8);ctx.beginPath();ctx.moveTo(x-3,y+3);ctx.lineTo(x+3,y-3);ctx.stroke();ctx.restore();}
 }
 function outlineEdge(c,x,y,rx,ry){
  const points=[[x,y-ry],[x+rx,y],[x,y+ry],[x-rx,y]];
  const neighbors=[[c.x,c.y-1],[c.x+1,c.y],[c.x,c.y+1],[c.x-1,c.y]];
  for(let i=0;i<4;i++){if(state.lookup.has(neighbors[i].join(',')))continue;
   ctx.beginPath();ctx.moveTo(...points[i]);ctx.lineTo(...points[(i+1)%4]);ctx.strokeStyle='#f16b66';ctx.lineWidth=2;ctx.stroke();}
 }
  ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
  const rx=30*state.scale,ry=15*state.scale,visible=options.visibleCells||visibleCells(state,area),minimum=options.threshold||0;
  let colored=options.foregroundOnly?(options.colored||0):0,labels=0;
  // Pixel-derived surface polygons already exclude foreground cliffs. Clip
  // only the camera boundary: the usable/top-band transition is whole-cell.
  const camera=r.cameraRect;
  if(!options.foregroundOnly){
  artwork.draw(ctx,options.objects&&state.objectImage?state.objectImage:state.image,state.x,state.y,r.width*state.scale,r.height*state.scale);
  if(camera){
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);
   ctx.rect(state.x+camera[0]*state.scale,state.y+camera[1]*state.scale,camera[2]*state.scale,camera[3]*state.scale);ctx.clip('evenodd');
   ctx.fillStyle='rgba(5,16,25,.48)';ctx.fillRect(area.x,area.y,area.w,area.h);ctx.restore();
   ctx.save();cameraClip();
   for(const c of visible)if(!c.usable){cellPath(c);ctx.fillStyle=c.visibleBand?'rgba(238,161,47,.25)':'rgba(165,137,80,.22)';ctx.fill('evenodd');}
   ctx.restore();
  }else for(const c of visible)if(!c.usable){cellPath(c);ctx.fillStyle='rgba(5,16,25,.27)';ctx.fill('evenodd');}
  ctx.save();cameraClip();
  for(const c of visible)if(options.heatmap&&c.terms.length&&inFilter(c)&&thresholdPass(c)){
   cellPath(c);ctx.globalAlpha=display.cellAlpha(c,{opacity:1-options.opacity/100});ctx.fillStyle=CrateProbability.color(multiplier(c),options.palette,display.maxMultiplier);ctx.fill('evenodd');ctx.globalAlpha=1;if(surface(c).length)colored++;
  }
  if(options.blocked)for(const c of visible)if(occupancy.mapCell(c)){
   const rings=surface(c).map(ring=>ring.map(([dx,dy])=>[state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale]));
   occupancy.draw(ctx,rings,state.scale);
  }
  ctx.restore();
  for(const c of visible){const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   if(options.grid&&rx>=10){cellPath(c);ctx.strokeStyle='rgba(24,51,63,.43)';ctx.lineWidth=.7;ctx.stroke();}
   outlineEdge(c,x,y,rx,ry);
   if(c.terrain&&r.missingSprites.includes(c.terrain)&&rx>=18)text('T',x,y+5,'#244d3c',14,'center');
  }
  if(camera){ctx.strokeStyle='#56b5f5';ctx.lineWidth=2;ctx.strokeRect(state.x+camera[0]*state.scale,state.y+camera[1]*state.scale,camera[2]*state.scale,camera[3]*state.scale);}
  ctx.save();cameraClip();
  if(options.potentialMarkers)for(const c of visible)if(c.potentialMarked&&!c.marked)stripedMarker(c,rx);
  if(options.markers){for(const c of visible)if(c.marked&&surface(c).length){const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   cellPath(c);ctx.strokeStyle='#ff77c6';ctx.lineWidth=2.5;ctx.stroke();
   ctx.save();cellPath(c);ctx.clip('evenodd');ctx.beginPath();
   for(const [a,b]of riskArms(c,state.scale)){ctx.moveTo(x+a[0],y+a[1]);ctx.lineTo(x+b[0],y+b[1]);}
   ctx.lineCap='round';ctx.strokeStyle='#471737';ctx.lineWidth=3.5;ctx.stroke();ctx.strokeStyle='#ff77c6';ctx.lineWidth=2.5;ctx.stroke();ctx.restore();
   if(rx<18){ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fillStyle='#ff77c6';ctx.fill();ctx.strokeStyle='#471737';ctx.lineWidth=1;ctx.stroke();}
   else {text('!',x,y-ry-5,'#a31e68',18,'center');}
  }}
  ctx.restore();
  }
  if(options.baseOnly){ctx.restore();return {colored,labels};}
  options.regionLayer?.(ctx,state,visible);
  if(options.players)players.draw(ctx,state,state,{radius:13,offset:23,clip:area,regionStyles:options.playerRegionStyles});
  for(const c of visible)if(c!==state.selected)cellLabels(c);
  options.regionLabels?.(ctx,state);
  const incoming=state.selected&&state.incoming?.key===transfers.key(state.selected)?state.incoming:null;
  const sourceKeys=new Set(incoming?.sources.map(transfers.key)||[]);
  if(incoming){
   const sources=incoming.sources.map(s=>{
    const c=sourceCell(s,state);
    const rings=surface(c);
    return {s,c,rings:rings.map(ring=>ring.map(([dx,dy])=>[state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale]))};
   }).filter(({c})=>onScreen(c));
   if(sources.length){
    // Restore just these cell surfaces from the unchanged artwork. This also
    // removes boundary tint, labels, risk and occupancy overlays temporarily.
    // Do not clip to the camera: out-of-map sampled origins must remain visible.
    ctx.save();ctx.beginPath();
    for(const {rings}of sources)for(const ring of rings){ring.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x,y));ctx.closePath();}
    ctx.clip('evenodd');ctx.fillStyle='#101c25';ctx.fillRect(area.x,area.y,area.w,area.h);
    const points=sources.flatMap(s=>s.rings.flat()),left=Math.max(area.x,Math.min(...points.map(p=>p[0]))-2),top=Math.max(area.y,Math.min(...points.map(p=>p[1]))-2);
    const right=Math.min(area.x+area.w,Math.max(...points.map(p=>p[0]))+2),bottom=Math.min(area.y+area.h,Math.max(...points.map(p=>p[1]))+2);
    if(right>left&&bottom>top)artwork.crop(ctx,options.objects&&state.objectImage?state.objectImage:state.image,r,state,{x:left,y:top,w:right-left,h:bottom-top});ctx.restore();
    for(const {s,c,rings}of sources){const color=transfers.style(s.strength);
     ctx.save();cellPath(c);ctx.clip('evenodd');
     occupancy.path(ctx,rings,Math.min(4,3*state.scale));ctx.fillStyle=color.fill;ctx.fill('evenodd');ctx.strokeStyle=color.stroke;ctx.lineWidth=Math.max(1,Math.min(2,state.scale));ctx.stroke();ctx.restore();
     const hidden=outlineParts(s.cell||c).hidden;
     if(hidden.length){linesPath(c,hidden);ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(104,233,255,.7)';ctx.lineWidth=1.2;ctx.stroke();ctx.setLineDash([]);}
    }
    // Labels follow the visible surface's safe anchor, not the flat-cell center.
    for(const {s,c}of sources)if(rx>=28){
     const label=probabilityDisplay.percent(s.transferProbability),size=Math.min(13,Math.max(10,state.scale*5));
     const x=state.x+(c.px+(c.labelOffset?.[0]||0))*state.scale,y=state.y+(c.py+(c.labelOffset?.[1]||0))*state.scale;
     ctx.font=`600 ${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(7,36,48,.94)';ctx.fillStyle='#e5fcff';
     labelText(label,x,y+size/3,size);
    }
   }
  }
  if(state.selected){const c=state.selected,x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   if((options.markers&&c.marked)||(options.potentialMarkers&&c.potentialMarked))for(const [xx,yy] of c.higher){const n=state.lookup.get(`${xx},${yy}`);if(!n||sourceKeys.has(transfers.key(n)))continue;cellPath(n);ctx.fillStyle='rgba(156,100,236,.35)';ctx.fill();ctx.strokeStyle='#9162d0';ctx.lineWidth=2;ctx.stroke();}
   const edge=outlineParts(c);ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
   if(edge.hidden.length){linesPath(c,edge.hidden);ctx.lineCap='butt';ctx.setLineDash([7,5]);ctx.strokeStyle='rgba(11,28,39,.8)';ctx.lineWidth=3.5;ctx.stroke();ctx.strokeStyle='#e5c88d';ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);ctx.lineCap='round';}
   linesPath(c,edge.visible);ctx.strokeStyle='rgba(16,36,48,.85)';ctx.lineWidth=3.5;ctx.stroke();ctx.strokeStyle='#e5c88d';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
   cellLabels(c);
   if(onScreen(c)){
    // Extend inward; vertical arms and their minimum follow the terrain aspect ratio.
    ctx.save();ctx.beginPath();for(const [a,b]of selectionArms(c,state.scale)){ctx.moveTo(x+a[0],y+a[1]);ctx.lineTo(x+b[0],y+b[1]);}
    ctx.lineCap='round';ctx.strokeStyle='#102b3a';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#46e86f';ctx.lineWidth=3.5;ctx.stroke();ctx.restore();
    const points=surface(c,true).flat(),top=Math.min(...points.map(p=>p[1]),-15)*state.scale+y;
    const label=_t`选中 ${c.x}, ${c.y}`,h=22;ctx.font='600 11px "Microsoft YaHei",sans-serif';const w=ctx.measureText(label).width+20;
    const positions=[[x-w/2,top-42],[x+Math.max(...points.map(p=>p[0]),30)*state.scale+22,y-h/2],
     [x-w/2,y+Math.max(...points.map(p=>p[1]),15)*state.scale+22],[x+Math.min(...points.map(p=>p[0]),-30)*state.scale-22-w,y-h/2]];
    const boxes=positions.map(([bx,by])=>({x:Math.max(area.x+4,Math.min(area.x+area.w-w-4,bx)),y:Math.max(area.y+4,Math.min(area.y+area.h-h-4,by)),w,h}));
    const collisions=b=>labelBoxes.filter(a=>b.x<a.x+a.w&&b.x+b.w>a.x&&b.y<a.y+a.h&&b.y+b.h>a.y).length;
    const box=boxes.reduce((best,b)=>collisions(b)<collisions(best)?b:best),bx=box.x,by=box.y;
    ctx.beginPath();ctx.roundRect(bx,by,w,h,6);ctx.fillStyle='#172c36';ctx.fill();ctx.strokeStyle='#d9b777';ctx.lineWidth=1;ctx.stroke();
    text(label,bx+w/2,by+15,'#ffe7ad',11,'center');
   }
  }
  ctx.restore();
  return {colored,labels};
 }
 function visibleCells(state,area){
  if(state.spatialIndex)return state.spatialIndex.query((area.x-80-state.x)/state.scale,(area.y-80-state.y)/state.scale,(area.x+area.w+80-state.x)/state.scale,(area.y+area.h+80-state.y)/state.scale);
  return state.cells.filter(c=>{const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;return x>=area.x-80&&x<=area.x+area.w+80&&y>=area.y-80&&y<=area.y+area.h+80;});
 }
 // Cache artwork, heatmap, occupancy and terrain boundaries. Region edits and
 // pointer previews only redraw the foreground; probability labels stay on top.
 // At overview scales cache the complete map so panning is also a bitmap copy.
 function createViewCache(makeCanvas=()=>document.createElement('canvas')){
  let cache=null,view=null;
  return {clear(){cache=null;view=null;},render(ctx,state,area,display,options){
   const r=state.data.rendering,pad=40,w=Math.ceil(r.width*state.scale)+2*pad,h=Math.ceil(r.height*state.scale)+2*pad;
   const full=w*h<=8000000&&w<=8192&&h<=8192;
   const settings=JSON.stringify(['filter','palette','opacity','threshold','heatmap','blocked','objects','grid','potentialMarkers','markers'].map(k=>options[k]));
   const key=[state.scale,full?0:state.x,full?0:state.y,area.x,area.y,area.w,area.h,settings].join('|');
   let cacheRebuilt=false;
   if(!cache||cache.data!==state.data||cache.image!==state.image||cache.objects!==state.objectImage||cache.display!==display||cache.key!==key){
    const image=cache?.imageBuffer||makeCanvas();
    image.width=full?w:Math.ceil(area.w);image.height=full?h:Math.ceil(area.h);
    const target=image.getContext('2d');target.fillStyle='#101c25';target.fillRect(0,0,image.width,image.height);
    const baseState={...state,x:full?pad:state.x-area.x,y:full?pad:state.y-area.y};
    render(target,baseState,{x:0,y:0,w:image.width,h:image.height},display,{...options,baseOnly:true,visibleCells:null});
    cache={data:state.data,image:state.image,objects:state.objectImage,display,key,imageBuffer:image};view=null;cacheRebuilt=true;
   }
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   ctx.fillStyle='#101c25';ctx.fillRect(area.x,area.y,area.w,area.h);
   if(full&&r.cameraRect){ctx.fillStyle='rgba(5,16,25,.48)';ctx.fillRect(area.x,area.y,area.w,area.h);}
   ctx.drawImage(cache.imageBuffer,full?state.x-pad:area.x,full?state.y-pad:area.y);ctx.restore();
   const viewKey=[state.x,state.y,state.scale,area.x,area.y,area.w,area.h].join('|');
   if(!view||view.key!==viewKey){
    const cells=visibleCells(state,area);
    const colored=options.heatmap?cells.filter(c=>c.terms.length&&surface(c).length&&(options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2))&&display.meetsThreshold(c,options.threshold||0)).length:0;
    view={key:viewKey,cells,colored};
   }
   return {...render(ctx,state,area,display,{...options,foregroundOnly:true,visibleCells:view.cells,colored:view.colored}),cacheRebuilt};
  }};
 }
 const api={render,createViewCache,surface,outlineParts,selectionArms,riskArms,sourceCell};root.CrateMapRenderer=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
