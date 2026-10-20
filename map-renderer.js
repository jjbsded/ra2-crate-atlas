/* Shared terrain, probability and risk layers for the viewer and full-map export. */
(function(root){
 'use strict';
 const occupancy=typeof module!=='undefined'?require('./occupancy-overlay.js'):root.CrateOccupancyOverlay;
 const CrateProbability=typeof module!=='undefined'?require('./probability.js'):root.CrateProbability;
 const flat=[[[0,-15],[30,0],[0,15],[-30,0]]];
 function surface(c,whole=false){return (whole?c.surface:c.visibleSurface)??flat;}
 function render(ctx,state,area,display,options){
  const r=state.data.rendering,fixed=n=>Number(n).toFixed(1);
  const multiplier=c=>display.get(c).multiplier;
  const thresholdPass=c=>display.meetsThreshold(c,options.threshold||0);
  const inFilter=c=>options.filter==='all'||(options.filter==='water'?c.land===2:c.land!==2);
  const onScreen=c=>{const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;return x>=area.x-80&&x<=area.x+area.w+80&&y>=area.y-80&&y<=area.y+area.h+80;};
  function text(value,x,y,color='#dce9f1',size=16,align='left'){ctx.font=`${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(value,x,y);}
 function cellPath(c,whole=false){ctx.beginPath();for(const ring of surface(c,whole)){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*state.scale,state.y+(c.py+dy)*state.scale));ctx.closePath();}}
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
  ctx.drawImage(options.objects&&state.objectImage?state.objectImage:state.image,state.x,state.y,r.width*state.scale,r.height*state.scale);
  const rx=30*state.scale,ry=15*state.scale,visible=state.cells.filter(onScreen),minimum=options.threshold||0;
  let colored=0,labels=0;
  // Pixel-derived surface polygons already exclude foreground cliffs. Clip
  // only the camera boundary: the usable/top-band transition is whole-cell.
  const camera=r.cameraRect;
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
   if(rx<18){ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fillStyle='#ff77c6';ctx.fill();ctx.strokeStyle='#471737';ctx.lineWidth=1;ctx.stroke();}
   else {text('!',x,y-ry-5,'#a31e68',18,'center');}
  }}
  ctx.restore();
  for(const c of visible){const x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   const coords=options.coords&&rx>=26,values=options.values&&rx>=26&&display.showLabel(c,options.baselineValues)&&inFilter(c)&&thresholdPass(c);
   if((coords||values)&&surface(c).length){ctx.textAlign='center';ctx.font=`${options.labelWeight||400} ${options.labelSize||12}px "Microsoft YaHei",sans-serif`;ctx.lineWidth=3;ctx.strokeStyle='rgba(12,25,34,.8)';ctx.fillStyle='#fff';
    if(coords){const s=`${c.x},${c.y}`;ctx.strokeText(s,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(values?-(options.labelSize||12)/3:(options.labelSize||12)/3));ctx.fillText(s,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(values?-(options.labelSize||12)/3:(options.labelSize||12)/3));}
    if(values){labels++;const s=fixed(multiplier(c))+'×';ctx.strokeText(s,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(coords?(options.labelSize||12)-1:(options.labelSize||12)/3));ctx.fillText(s,x+(c.labelOffset?.[0]||0)*state.scale,y+(c.labelOffset?.[1]||0)*state.scale+(coords?(options.labelSize||12)-1:(options.labelSize||12)/3));}
   }
  }
  if(state.selected){const c=state.selected,x=state.x+c.px*state.scale,y=state.y+c.py*state.scale;
   if((options.markers&&c.marked)||(options.potentialMarkers&&c.potentialMarked))for(const [xx,yy] of c.higher){const n=state.lookup.get(`${xx},${yy}`);if(!n)continue;cellPath(n);ctx.fillStyle='rgba(156,100,236,.35)';ctx.fill();ctx.strokeStyle='#9162d0';ctx.lineWidth=2;ctx.stroke();}
   cellPath(c,!surface(c).length);if(!surface(c).length)ctx.setLineDash([6,4]);ctx.strokeStyle='#112a3c';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);
  }
  ctx.restore();
  return {colored,labels};
 }
 const api={render,surface};root.CrateMapRenderer=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
