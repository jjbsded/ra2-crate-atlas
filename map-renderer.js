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
 const refinement=root.CrateRasterRefinement||(typeof module!=='undefined'?require('./raster-refinement.js'):null);
 const flat=[[[0,-15],[30,0],[0,15],[-30,0]]];
 const mapEdges=new WeakMap(),colorTables=new WeakMap();
 const probabilityLabels=new WeakMap();
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
  const opacityAt=CrateProbability.opacityCurve(display.maxMultiplier,options.paletteColors);
  const paletteKey=options.palette+':'+display.maxMultiplier+':'+JSON.stringify(options.paletteColors);
  let colors=colorTables.get(display);
  if(!colors||colors.key!==paletteKey){colors={key:paletteKey,values:new Map(),labels:new Map()};colorTables.set(display,colors);}
  function paletteColor(value){if(!colors.values.has(value))colors.values.set(value,CrateProbability.color(value,options.palette,display.maxMultiplier,options.paletteColors));return colors.values.get(value);}
  function labelColor(value){const key=value+':'+(options.colorText!==false);if(!colors.labels.has(key))colors.labels.set(key,CrateProbability.labelColor(value,options.palette,display.maxMultiplier,options.colorText!==false,options.paletteColors));return colors.labels.get(key);}
  const labelBoxes=[];
  const multiplier=c=>display.get(c).multiplier;
  const thresholdPass=c=>display.meetsThreshold(c,options.threshold||0);
  const inFilter=c=>options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2);
  const onScreen=c=>{const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;return x>=area.x-80&&x<=area.x+area.w+80&&y>=area.y-80&&y<=area.y+area.h+80;};
  function text(value,x,y,color='#dce9f1',size=16,align='left'){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y);}
 function cellPath(c,whole=false){ctx.beginPath();for(const ring of surface(c,whole)){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale));ctx.closePath();}}
 function linesPath(c,lines){ctx.beginPath();for(const line of lines)line.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale));}
 function labelText(value,x,y,size){ctx.strokeText(value,x,y);ctx.fillText(value,x,y);if(state.selected){const w=ctx.measureText(value).width;labelBoxes.push({x:x-w/2-4,y:y-size-4,w:w+8,h:size+8});}}
 const probabilitySize=CrateProbability.labelSize(state.scale,options.labelSize||12,options.paletteColors);
 function labelStyle(){ctx.textAlign='center';ctx.font=`${options.labelWeight||400} ${probabilitySize}px "Microsoft YaHei",sans-serif`;ctx.lineJoin='round';ctx.lineWidth=CrateProbability.labelStrokeWidth(probabilitySize,options.paletteColors);ctx.strokeStyle='rgba(12,25,34,.8)';ctx.fillStyle='#fff';}
 function cellLabels(c){const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   const coords=options.coords&&rx>=26,values=options.values&&rx>=26&&display.showLabel(c,options.baselineValues)&&inFilter(c)&&thresholdPass(c);
   if((coords||values)&&surface(c).length){
    if(coords){ctx.lineWidth=3;ctx.font=`${options.labelWeight||400} ${options.labelSize||12}px "Microsoft YaHei",sans-serif`;ctx.fillStyle='#fff';labelText(`${c.x},${c.y}`,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(values?-probabilitySize*.65:(options.labelSize||12)/3),options.labelSize||12);}
    if(values){labels++;const value=display.get(c);let label=probabilityLabels.get(value);if(label===undefined){label=fixed(value.multiplier)+'×';probabilityLabels.set(value,label);}ctx.font=`${options.labelWeight||400} ${probabilitySize}px "Microsoft YaHei",sans-serif`;ctx.lineWidth=CrateProbability.labelStrokeWidth(probabilitySize,options.paletteColors);ctx.fillStyle=labelColor(value.multiplier);labelText(label,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+probabilitySize/3,probabilitySize);}
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
   let edges=mapEdges.get(c);
   if(edges===undefined){
    edges=0;
    [[c.x,c.y-1],[c.x+1,c.y],[c.x,c.y+1],[c.x-1,c.y]].forEach((p,i)=>{if(!state.lookup.has(p.join(',')))edges|=1<<i;});
    mapEdges.set(c,edges);
   }
   for(let i=0;i<4;i++){if(!(edges&(1<<i)))continue;
   ctx.beginPath();ctx.moveTo(...points[i]);ctx.lineTo(...points[(i+1)%4]);ctx.strokeStyle='#f16b66';ctx.lineWidth=2;ctx.stroke();}
 }
  ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
  const rx=30*state.scale,ry=15*state.scale,visible=options.visibleCells||visibleCells(state,area),minimum=options.threshold||0;
  let colored=options.foregroundOnly?(options.colored||0):0,labels=0;
  // Pixel-derived surface polygons already exclude foreground cliffs. Clip
  // only the camera boundary: the usable/top-band transition is whole-cell.
  const camera=r.cameraRect;
  if(!options.foregroundOnly){
  if(!options.overlayOnly){options.coordinateSpace?.paint(ctx,state,area);artwork.scene(ctx,state,r,options);}
  if(camera){
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);
   ctx.rect(state.x+camera[0]*state.scale,state.y+camera[1]*state.scale,camera[2]*state.scale,camera[3]*state.scale);ctx.clip('evenodd');
   options.coordinateSpace?.clipTerrain(ctx,state);
   ctx.fillStyle='rgba(5,16,25,.48)';ctx.fillRect(area.x,area.y,area.w,area.h);ctx.restore();
   ctx.save();cameraClip();
   for(const c of visible)if(!c.usable){cellPath(c);ctx.fillStyle=c.visibleBand?'rgba(238,161,47,.25)':'rgba(165,137,80,.22)';ctx.fill('evenodd');}
   ctx.restore();
  }else for(const c of visible)if(!c.usable){cellPath(c);ctx.fillStyle='rgba(5,16,25,.27)';ctx.fill('evenodd');}
  ctx.save();cameraClip();
  for(const c of visible)if(options.heatmap&&(options.baselineLayer!==false||!display.get(c).isBaseline)&&c.terms.length&&inFilter(c)&&thresholdPass(c)){
   const value=multiplier(c);
   cellPath(c);ctx.globalAlpha=display.cellAlpha(c,{opacity:(1-options.opacity/100)*opacityAt(value),baselineFactor:options.paletteColors?.baselineFactor});ctx.fillStyle=paletteColor(value);ctx.fill('evenodd');ctx.globalAlpha=1;if(surface(c).length)colored++;
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
  if(options.buffFieldLayer){const counts=options.buffFieldLayer(ctx,state,area);colored+=counts?.colored||0;labels+=counts?.labels||0;}
  options.regionLayer?.(ctx,state,visible);
  if(options.players)players.draw(ctx,state,state,{radius:13,offset:23,clip:area,regionStyles:options.playerRegionStyles});
  labelStyle();
  for(const c of visible)if(c!==state.selected)cellLabels(c);
  if(options.buffFieldLabels){const counts=options.buffFieldLabels(ctx,state,area);labels+=counts?.labels||0;}
  options.regionLabels?.(ctx,state,area,visible);
  options.unitBuffLayer?.(ctx,state,area);
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
    if(right>left&&bottom>top)artwork.scene(ctx,state,r,options,{x:left,y:top,w:right-left,h:bottom-top});ctx.restore();
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
   labelStyle();cellLabels(c);
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
  const margin=state.liveEditing?Math.max(80,128*state.scale):80;
  if(state.spatialIndex){
   const cells=state.spatialIndex.query((area.x-margin-state.x)/state.scale,(area.y-margin-state.y)/state.scale,(area.x+area.w+margin-state.x)/state.scale,(area.y+area.h+margin-state.y)/state.scale);
   return state.liveEditing?cells.map(c=>state.lookup.get(`${c.x},${c.y}`)||c):cells;
  }
  return state.cells.filter(c=>{const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;return x>=area.x-margin&&x<=area.x+area.w+margin&&y>=area.y-margin&&y<=area.y+area.h+margin;});
 }
 function coloredCells(cells,display,options){
  return options.heatmap?cells.filter(c=>(options.baselineLayer!==false||!display.get(c).isBaseline)&&c.terms.length&&surface(c).length&&
   (options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2))&&display.meetsThreshold(c,options.threshold||0)).length:0;
 }
 // Cache artwork, heatmap, occupancy and terrain boundaries. Region edits and
 // pointer previews only redraw the foreground; probability labels stay on top.
 // At overview scales cache the complete map so panning is also a bitmap copy.
 function createViewCache(makeCanvas=()=>document.createElement('canvas'),schedule=null){
  let cache=null,view=null,live=null,navigation=null,overview=null,viewport=null,latest=null,refined=false;
  let overviewSource=null,overviewReadyAt=0,overviewTimer=null;
  const refiner=root.CrateRasterRefinement?.create({makeCanvas,schedule});
  const overviewRefiner=root.CrateRasterRefinement?.create({makeCanvas,schedule});
  const previews=root.CrateRasterPreviewCache?.create({makeCanvas,schedule});
  const result=value=>{value.refined=refined;refined=false;return value;};
  function scroll(buffer,pan){
   if(!pan)return;
   const target=buffer.getContext('2d');
   target.save();target.setTransform(1,0,0,1,0,0);target.imageSmoothingEnabled=false;
   target.globalCompositeOperation='copy';target.drawImage(buffer,pan.dx,pan.dy);target.restore();
   for(const box of pan.parts)target.clearRect(box.x,box.y,box.w,box.h);
  }
  function paintArt(target,base,box,options){
   target.save();target.beginPath();target.rect(box.x,box.y,box.w,box.h);target.clip();
   target.fillStyle='#101c25';target.fillRect(box.x,box.y,box.w,box.h);
   options.coordinateSpace?.paint(target,base,box);artwork.scene(target,base,base.data.rendering,options,box);target.restore();
  }
  function paintBase(target,base,box,display,options){
   target.save();target.beginPath();target.rect(box.x,box.y,box.w,box.h);target.clip();paintArt(target,base,box,options);
   render(target,base,box,display,{...options,baseOnly:true,overlayOnly:true,visibleCells:null});target.restore();
  }
  function updateLive(ctx,state,area,display,options,layout){
   const {ratio,full,cw,ch,left,top,key,pan}=layout;
   const r=state.data.rendering,base={...state,x:-left,y:-top};
   const bounds={x:0,y:0,w:cw,h:ch};
   const artOptions=JSON.stringify([options.objects,options.objectOpacity??1]);
   const rebuild=!live||live.geometry!==r||live.key!==key||live.artOptions!==artOptions;
   if(rebuild){
    live={geometry:r,key,artOptions,art:makeCanvas(),overlay:makeCanvas()};
    for(const buffer of [live.art,live.overlay]){
     buffer.width=Math.ceil(cw*ratio);buffer.height=Math.ceil(ch*ratio);
     buffer.getContext('2d').setTransform(ratio,0,0,ratio,0,0);
    }
   }
   function paintParts(buffer,parts,artOnly){
    const target=buffer.getContext('2d');
    for(const part of parts){
     target.clearRect(part.x,part.y,part.w,part.h);
     if(artOnly)paintArt(target,base,part,options);
     else render(target,base,part,display,{...options,baseOnly:true,overlayOnly:true});
    }
   }
   function paint(buffer,boxes,artOnly){
    const tiles=new Map(),size=256;
    for(const box of boxes){
     const l=Math.max(0,Math.floor(box.x*ratio)-2),t=Math.max(0,Math.floor(box.y*ratio)-2);
     const r=Math.min(buffer.width,Math.ceil((box.x+box.w)*ratio)+2),b=Math.min(buffer.height,Math.ceil((box.y+box.h)*ratio)+2);
     if(l>=r||t>=b)continue;
     for(let y=Math.floor(t/size)*size;y<b;y+=size)for(let x=Math.floor(l/size)*size;x<r;x+=size){
      tiles.set(`${x},${y}`,{x:x/ratio,y:y/ratio,w:Math.min(size,buffer.width-x)/ratio,h:Math.min(size,buffer.height-y)/ratio});
     }
    }
    paintParts(buffer,tiles.values(),artOnly);
   }
   const scaled=([x,y,w,h])=>({x:base.x+x*state.scale,y:base.y+y*state.scale,w:w*state.scale,h:h*state.scale});
   const artworkDirty=state.artworkDirty||[];
   if(rebuild){
    const target=live.art.getContext('2d');target.clearRect(0,0,cw,ch);
    paintArt(target,base,bounds,options);
   }else{
    scroll(live.art,pan);
    if(pan)paintParts(live.art,pan.parts,true);
    paint(live.art,artworkDirty.map(scaled),true);
   }
   const paletteKey=options.palette==='multi'?null:display.maxMultiplier;
   const globalOverlay=rebuild||live.paletteKey!==paletteKey||live.overlayData!==state.data&&state.overlayDirty==null;
   const tiles=state.overlayDirty||[];
   if(globalOverlay){
    const target=live.overlay.getContext('2d');target.clearRect(0,0,cw,ch);
    render(target,base,bounds,display,{...options,baseOnly:true,overlayOnly:true});
   }else{
    scroll(live.overlay,pan);
    if(pan)paintParts(live.overlay,pan.parts,false);
    paint(live.overlay,tiles.map(scaled),false);
   }
   live.paletteKey=paletteKey;
   live.overlayData=state.data;
   state.artworkDirty=null;state.overlayDirty=null;
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   ctx.fillStyle='#101c25';ctx.fillRect(area.x,area.y,area.w,area.h);
   if(full&&r.cameraRect){ctx.fillStyle='rgba(5,16,25,.48)';ctx.fillRect(area.x,area.y,area.w,area.h);}
   ctx.imageSmoothingEnabled=false;
   const dx=Math.round((state.x+left)*ratio)/ratio,dy=Math.round((state.y+top)*ratio)/ratio;
   for(const buffer of [live.art,live.overlay])ctx.drawImage(buffer,dx,dy,buffer.width/ratio,buffer.height/ratio);
   ctx.restore();
   return {cacheRebuilt:rebuild,globalOverlay,overlayTiles:tiles.length,artworkTiles:artworkDirty.length,panParts:pan?.parts.length||0};
  }
  return {get previewStatus(){return previews?.status;},clear(){previews?.clear();refiner?.cancel();overviewRefiner?.cancel();clearTimeout(overviewTimer);overviewTimer=null;overviewSource=null;overviewReadyAt=0;cache=null;view=null;live=null;navigation=null;overview=null;viewport=null;latest=null;refined=false;},render(ctx,state,area,display,options){
   const r=state.data.rendering,extent=options.coordinateSpace?.bounds||{x:0,y:0,w:r.width,h:r.height},pad=40,w=Math.ceil(extent.w*state.scale)+2*pad,h=Math.ceil(extent.h*state.scale)+2*pad;
   const transform=ctx.getTransform(),ratio=Math.hypot(transform.a,transform.b);
   const full=w*h*ratio*ratio<=8000000&&w*ratio<=8192&&h*ratio<=8192;
   // Keep a bounded margin outside the viewport. Its origin moves in whole
   // physical pixels, so existing raster pixels can slide without resampling.
   const budget=8000000/(ratio*ratio),margin=Math.max(0,Math.min(192,(Math.sqrt((area.w-area.h)**2+4*budget)-area.w-area.h)/4));
   const cw=full?w:(Math.ceil((area.w+2*margin)*ratio)+1)/ratio,ch=full?h:(Math.ceil((area.h+2*margin)*ratio)+1)/ratio;
   const settings=JSON.stringify([options.coordinateSpace?.key,CrateProbability.heatStyle(options.paletteColors),...['filter','palette','opacity','threshold','heatmap','baselineLayer','blocked','objects','objectOpacity','grid','potentialMarkers','markers'].map(k=>options[k])]);
   const key=[ratio,state.scale,full,cw,ch,area.x,area.y,area.w,area.h,settings].join('|');
   latest={state,display,settings,ratio,key};refiner?.check();
   function refine(){
    if(!refiner?.available||options.navigation)return;
    const scale=state.scale,data=state.data,image=state.image,objects=state.objectImage,artworkRevision=state.artworkRevision,usesLive=!!state.liveEditing;
    const x=state.x,y=state.y,left=Math.floor((full?x+extent.x*state.scale-pad:area.x-margin)*ratio)/ratio-x,top=Math.floor((full?y+extent.y*state.scale-pad:area.y-margin)*ratio)/ratio-y;
    const base={...state,x:-left,y:-top},width=Math.ceil(cw*ratio),height=Math.ceil(ch*ratio),clipKey=[area.x,area.y,area.w,area.h].join('|');
    refiner.start({key:key+'|'+usesLive,width,height,ratio,layers:usesLive?2:1,
     valid:()=>latest?.state===state&&state.scale===scale&&state.data===data&&state.image===image&&state.objectImage===objects&&state.artworkRevision===artworkRevision&&
      !!state.liveEditing===usesLive&&latest.display===display&&latest.settings===settings&&latest.ratio===ratio&&latest.key===key&&[area.x,area.y,area.w,area.h].join('|')===clipKey&&!state.artworkDirty?.length&&!state.overlayDirty?.length,
     paint(contexts,part){
      if(usesLive){paintArt(contexts[0],base,part,options);render(contexts[1],base,part,display,{...options,baseOnly:true,overlayOnly:true});}
      else paintBase(contexts[0],base,part,display,options);
     },
     publish(buffers){
      if(usesLive){live={geometry:r,key,artOptions:JSON.stringify([options.objects,options.objectOpacity??1]),art:buffers[0],overlay:buffers[1],paletteKey:options.palette==='multi'?null:display.maxMultiplier,overlayData:data};cache=null;}
      else{cache={data,image,objects,display,key,imageBuffer:buffers[0],artworkRevision};live=null;}
      viewport={key,left,top};view=null;
      navigation={buffers,settings,ratio,full,data,display,image,objects,artworkRevision,x,y,scale,left:x+left,top:y+top};if(full){overviewRefiner?.cancel();overview=navigation;}refined=true;
     }});
   }
   const matches=old=>old&&old.data===state.data&&old.display===display&&old.settings===settings&&old.ratio===ratio&&
    old.image===state.image&&old.objects===state.objectImage&&old.artworkRevision===state.artworkRevision&&!state.artworkDirty?.length&&!state.overlayDirty?.length;
   const sameOverviewSource=overviewSource&&overviewSource.data===state.data&&overviewSource.display===display&&overviewSource.settings===settings&&overviewSource.ratio===ratio&&
    overviewSource.image===state.image&&overviewSource.objects===state.objectImage&&overviewSource.artworkRevision===state.artworkRevision&&overviewSource.liveEditing===!!state.liveEditing;
   if(!sameOverviewSource){
    // Continuous edits supersede this optional whole-map warmup. Keep exact
    // viewport patches immediate, and start at most one warmup after settling.
    overviewReadyAt=overviewSource?performance.now()+250:0;
    overviewSource={data:state.data,display,settings,ratio,image:state.image,objects:state.objectImage,artworkRevision:state.artworkRevision,liveEditing:!!state.liveEditing};
    clearTimeout(overviewTimer);overviewTimer=null;
    if(overviewReadyAt&&!full&&overviewRefiner?.available&&schedule)overviewTimer=setTimeout(()=>{overviewTimer=null;overviewReadyAt=0;schedule();},250);
   }
   if(overview&&!matches(overview))overview=null;
   overviewRefiner?.check();
   if(!overview&&!full&&!options.navigation&&overviewRefiner?.available&&performance.now()>=overviewReadyAt){
    // A focused result can arrive without ever drawing a whole-map frame.
    // Keep newly exposed terrain at twice the previous linear preview resolution.
    // The sharper resident viewport remains untouched, and warmup stays sliced.
    const physical=Math.min(Math.sqrt(6000000/(extent.w*extent.h)),4000/extent.w,4000/extent.h),scale=physical/ratio;
    const width=Math.ceil(extent.w*physical)+8,height=Math.ceil(extent.h*physical)+8,usesLive=!!state.liveEditing;
    const source={settings,ratio,data:state.data,display,image:state.image,objects:state.objectImage,artworkRevision:state.artworkRevision};
    const base={...state,x:4/ratio-extent.x*scale,y:4/ratio-extent.y*scale,scale};
    overviewRefiner.start({key:[settings,ratio,usesLive,width,height].join('|'),width,height,ratio,layers:usesLive?2:1,
     valid:()=>matches(source)&&!!state.liveEditing===usesLive&&latest?.state===state&&latest.display===display&&latest.settings===settings&&latest.ratio===ratio,
     paint(contexts,part){
      if(usesLive){paintArt(contexts[0],base,part,options);render(contexts[1],base,part,display,{...options,baseOnly:true,overlayOnly:true});}
      else paintBase(contexts[0],base,part,display,options);
     },
     publish(buffers){overview={...source,buffers,full:true,x:0,y:0,left:extent.x*scale-4/ratio,top:extent.y*scale-4/ratio,scale};}});
   }
   let old=navigation,detail=null;
   // A complete overview fills newly exposed terrain, while the previous
   // viewport remains the sharper source for the area it already contains.
   if(matches(old)&&!old.full&&overview&&state.scale<old.scale){
    const factor=state.scale/old.scale,l=state.x+(old.left-old.x)*factor,t=state.y+(old.top-old.y)*factor;
    if(l>area.x||t>area.y||l+old.buffers[0].width/ratio*factor<area.x+area.w||t+old.buffers[0].height/ratio*factor<area.y+area.h){if(old.scale>overview.scale)detail=old;old=overview;}
   }
   // Reproject the last complete base. New zoom resolutions refine offscreen;
   // foreground labels remain screen-sized and edits still invalidate previews.
   if((options.navigation||refiner?.available)&&old&&(old!==navigation||old.scale!==state.scale)&&old.data===state.data&&old.display===display&&old.settings===settings&&old.ratio===ratio&&
      old.image===state.image&&old.objects===state.objectImage&&old.artworkRevision===state.artworkRevision&&!state.artworkDirty?.length&&!state.overlayDirty?.length){
    const factor=state.scale/old.scale,left=state.x+(old.left-old.x)*factor,top=state.y+(old.top-old.y)*factor;
    const width=old.buffers[0].width/ratio*factor,height=old.buffers[0].height/ratio*factor;
    if(old.full||left<=area.x&&top<=area.y&&left+width>=area.x+area.w&&top+height>=area.y+area.h||refiner?.available){
     ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.fillStyle='#101c25';ctx.fillRect(area.x,area.y,area.w,area.h);
     if(old.full&&r.cameraRect){ctx.fillStyle='rgba(5,16,25,.48)';ctx.fillRect(area.x,area.y,area.w,area.h);}
     ctx.imageSmoothingEnabled=false;
     const background=()=>{for(const buffer of old.buffers)ctx.drawImage(buffer,left,top,width,height);};
     let detailSource=null;
     if(detail){const f=state.scale/detail.scale,x=state.x+(detail.left-detail.x)*f,y=state.y+(detail.top-detail.y)*f,w=detail.buffers[0].width/ratio*f,h=detail.buffers[0].height/ratio*f;detailSource={rect:{x,y,w,h},paint:()=>{for(const buffer of detail.buffers)ctx.drawImage(buffer,x,y,w,h);}};}
     const usesLive=!!state.liveEditing;
     const tiled=previews?.render(ctx,state,area,{source:overviewSource,ratio,bounds:extent,layers:usesLive?2:1,basePhysical:old.scale*ratio,background,detail:detailSource,
      valid:()=>matches(old)&&!!state.liveEditing===usesLive&&latest?.settings===settings&&latest.ratio===ratio,
      paint(contexts,local,part){const base={...state,...local};if(usesLive){paintArt(contexts[0],base,part,options);render(contexts[1],base,part,display,{...options,baseOnly:true,overlayOnly:true});}else paintBase(contexts[0],base,part,display,options);}});
     let mixedDetail=tiled?.mixedDetail||false;
     if(!tiled){if(detailSource&&refinement?.composite)mixedDetail=refinement.composite(ctx,area,detailSource.rect,ratio,background,detailSource.paint);else background();}
     if(!old.full)for(const part of root.CrateRasterRefinement?.uncovered(area,{x:left,y:top,w:width,h:height})||[])paintBase(ctx,state,part,display,options);
     ctx.restore();
     refine();
     const cells=visibleCells(state,area),colored=coloredCells(cells,display,options);
     return result({...render(ctx,state,area,display,{...options,foregroundOnly:true,visibleCells:cells,colored}),...tiled,preview:true,overview:old===overview,mixedDetail,cacheRebuilt:false,refining:!!refiner?.pending});
    }
   }
   previews?.cancel();
   let left=extent.x*state.scale-pad,top=extent.y*state.scale-pad,pan=null;
   if(!full){
    const previous=viewport;
    if(!previous||previous.key!==key||state.x+previous.left>area.x+1e-6||state.y+previous.top>area.y+1e-6||
       state.x+previous.left+cw<area.x+area.w-1e-6||state.y+previous.top+ch<area.y+area.h-1e-6){
     left=Math.floor((area.x-margin)*ratio)/ratio-state.x;top=Math.floor((area.y-margin)*ratio)/ratio-state.y;
     if(previous?.key===key){
      const dx=Math.ceil((previous.left-left)*ratio-1e-7),dy=Math.ceil((previous.top-top)*ratio-1e-7),width=Math.round(cw*ratio),height=Math.round(ch*ratio);
      left=previous.left-dx/ratio;top=previous.top-dy/ratio;
      let parts;
      if(Math.abs(dx)>=width||Math.abs(dy)>=height)parts=[{x:0,y:0,w:cw,h:ch}];
      else{
       parts=[];
       if(dx)parts.push({x:dx>0?0:(width+dx)/ratio,y:0,w:Math.abs(dx)/ratio,h:ch});
       if(dy)parts.push({x:Math.max(0,dx)/ratio,y:dy>0?0:(height+dy)/ratio,w:(width-Math.abs(dx))/ratio,h:Math.abs(dy)/ratio});
      }
      pan={dx,dy,parts};
     }
     viewport={key,left,top};
    }else({left,top}=previous);
   }else{
    if(viewport?.key===key)({left,top}=viewport);
    else{left=Math.floor((state.x+extent.x*state.scale-pad)*ratio)/ratio-state.x;top=Math.floor((state.y+extent.y*state.scale-pad)*ratio)/ratio-state.y;viewport={key,left,top};}
   }
   // Panning only moves existing pixels; stopping is not an invalidation.
   function remember(buffers){
    navigation={buffers,settings,ratio,full,data:state.data,display,image:state.image,objects:state.objectImage,
     artworkRevision:state.artworkRevision,x:state.x,y:state.y,scale:state.scale,left:state.x+left,top:state.y+top};
    if(full){overviewRefiner?.cancel();overview=navigation;}
   }
   if(state.liveEditing){
    cache=null;
    const stats=updateLive(ctx,state,area,display,options,{ratio,full,cw,ch,left,top,key,pan});
    remember([live.art,live.overlay]);
    const viewKey=[state.x,state.y,state.scale,area.x,area.y,area.w,area.h,key].join('|');
    if(!view||view.key!==viewKey||view.data!==state.data){
     const cells=visibleCells(state,area);
     const colored=coloredCells(cells,display,options);
     view={key:viewKey,data:state.data,cells,colored};
    }
    return result({...render(ctx,state,area,display,{...options,foregroundOnly:true,visibleCells:view.cells,colored:view.colored}),...stats});
   }
   live=null;
   let cacheRebuilt=false;
   if(!cache||cache.data!==state.data||cache.image!==state.image||cache.objects!==state.objectImage||cache.display!==display||cache.key!==key){
    const image=cache?.imageBuffer&&!overview?.buffers.includes(cache.imageBuffer)?cache.imageBuffer:makeCanvas();
    image.width=Math.ceil(cw*ratio);image.height=Math.ceil(ch*ratio);
    const target=image.getContext('2d');target.fillStyle='#101c25';target.fillRect(0,0,image.width,image.height);
    target.setTransform(ratio,0,0,ratio,0,0);
    const baseState={...state,x:-left,y:-top};
    paintBase(target,baseState,{x:0,y:0,w:cw,h:ch},display,options);
    cache={data:state.data,image:state.image,objects:state.objectImage,display,key,imageBuffer:image,artworkRevision:state.artworkRevision};view=null;cacheRebuilt=true;
   }else if(pan){
    scroll(cache.imageBuffer,pan);
    const target=cache.imageBuffer.getContext('2d'),baseState={...state,x:-left,y:-top};
    for(const box of pan.parts)paintBase(target,baseState,box,display,options);
   }
   if(cache.artworkRevision!==state.artworkRevision&&state.artworkDirty){
    const baseState={...state,x:-left,y:-top},target=cache.imageBuffer.getContext('2d');
    for(const [x,y,w,h] of state.artworkDirty){
     const box={x:baseState.x+x*state.scale-2,y:baseState.y+y*state.scale-2,w:w*state.scale+4,h:h*state.scale+4};
     paintBase(target,baseState,box,display,options);
    }
    cache.artworkRevision=state.artworkRevision;
   }
   state.artworkDirty=null;
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();
   ctx.fillStyle='#101c25';ctx.fillRect(area.x,area.y,area.w,area.h);
   if(full&&r.cameraRect){ctx.fillStyle='rgba(5,16,25,.48)';ctx.fillRect(area.x,area.y,area.w,area.h);}
   ctx.imageSmoothingEnabled=false;
   const dx=Math.round((state.x+left)*ratio)/ratio,dy=Math.round((state.y+top)*ratio)/ratio;
   ctx.drawImage(cache.imageBuffer,dx,dy,cache.imageBuffer.width/ratio,cache.imageBuffer.height/ratio);ctx.restore();
   remember([cache.imageBuffer]);
   const viewKey=[state.x,state.y,state.scale,area.x,area.y,area.w,area.h].join('|');
   if(!view||view.key!==viewKey){
    const cells=visibleCells(state,area);
    const colored=coloredCells(cells,display,options);
    view={key:viewKey,cells,colored};
   }
   return result({...render(ctx,state,area,display,{...options,foregroundOnly:true,visibleCells:view.cells,colored:view.colored}),cacheRebuilt,panParts:pan?.parts.length||0});
  }};
 }
 const api={render,createViewCache,surface,outlineParts,selectionArms,riskArms,sourceCell};root.CrateMapRenderer=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
