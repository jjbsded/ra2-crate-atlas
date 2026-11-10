/* Placement anchors are independent of rendering, probability and history. */
(function(root){
 'use strict';
 const EPS=1e-6,sign=n=>Math.abs(n)<EPS?0:Math.sign(n);
 function firstCell(cells,start,screen=false){
  const distance=c=>screen?(c.px-start.x)**2+(c.py-start.y)**2:(c.x-start.x)**2+(c.y-start.y)**2;
  return cells.reduce((best,c)=>{const d=distance(c)-distance(best);return d<-EPS||Math.abs(d)<EPS&&(c.x<best.x||c.x===best.x&&c.y<best.y)?c:best;});
 }
 function screenAlignment(settings,reference,footprint,project){
  const a=settings.boxStart,b=settings.boxEnd,sx=sign(b.x-a.x),sy=sign(b.y-a.y);
  const corners=footprint.map(([x,y])=>({x:30*(x-y),y:15*(x+y)}));
  // Screen selection includes a cell by its center. Use those same centers
  // for the two start-side limits, allowing the cell edges to cross the box.
  // The nearest feasible lattice anchor then hugs both limits without an
  // extra half-cell inset. The end-facing sides remain unconstrained.
  const extents={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
  const last=settings.boxLast||reference,corner=[last.x<settings.start.x?settings.width-1:0,last.y<settings.start.y?settings.height-1:0],base=project(reference.x,reference.y);
  const ideal={x:sx?a.x-(sx>0?extents.left:extents.right):base.x-30*(corner[0]-corner[1]),y:sy?a.y-(sy>0?extents.top:extents.bottom):base.y-15*(corner[0]+corner[1])};
  const contains=p=>(!sx||(sx>0?p.x+extents.left>=a.x-EPS:p.x+extents.right<=a.x+EPS))&&(!sy||(sy>0?p.y+extents.top>=a.y-EPS:p.y+extents.bottom<=a.y+EPS));
  const u=(ideal.x-base.x)/30,v=(ideal.y-base.y)/15,fx=(u+v)/2,fy=(v-u)/2;let best=null;
  // Only neighbouring lattice points can be the closest feasible anchor.
  // Search a fixed small neighbourhood, independent of map/selection size.
  for(let dx=Math.floor(fx)-1;dx<=Math.ceil(fx)+1;dx++)for(let dy=Math.floor(fy)-1;dy<=Math.ceil(fy)+1;dy++){
   const p=project(reference.x+dx,reference.y+dy);if(!contains(p))continue;const cost=(p.x-ideal.x)**2+(p.y-ideal.y)**2;
   if(!best||cost<best.cost-EPS||Math.abs(cost-best.cost)<EPS&&(dx<best.x||dx===best.x&&dy<best.y))best={x:dx,y:dy,cost};
  }
  return {shift:best||{x:Math.round(fx),y:Math.round(fy)},contains};
 }
 function* boxTargets(settings,cells,{footprint,building=false,project}){
  if(!cells.length)return;
  // A single selected cell, including the empty-box fallback, always denotes
  // the top foundation cell. No directional phase survives this case.
  if(cells.length===1){yield {x:cells[0].x,y:cells[0].y};return;}
  const game=settings.method==='box-game',reference=firstCell(cells,game?settings.start:settings.boxStart,!game);
  let shift={x:0,y:0},contains=null;
  if(building&&game){const last=settings.boxLast||settings.start;shift={x:last.x<settings.start.x?-(settings.width-1):0,y:last.y<settings.start.y?-(settings.height-1):0};}
  else if(building)({shift,contains}=screenAlignment(settings,reference,footprint,project));
  for(const c of cells){
   if((c.x-reference.x)%settings.width||(c.y-reference.y)%settings.height)continue;
   const x=c.x+shift.x,y=c.y+shift.y;
   if(contains&&!contains(project(x,y)))continue;
   yield {x,y};
  }
 }
 const api={boxTargets};root.CrateSimulationPlacement=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
