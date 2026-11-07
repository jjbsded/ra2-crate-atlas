/* World-aligned, multiresolution preview tiles; never part of the exact result. */
(function(root){
 'use strict';
 const R=root.CrateRasterRefinement||(typeof module!=='undefined'?require('./raster-refinement.js'):null);
 const size=256,bleed=2,side=size+2*bleed;
 const intersect=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;};
 const overlap=(a,b)=>!!intersect(a,b);
 function create({makeCanvas=()=>document.createElement('canvas'),schedule,maxPixels=14000000}={}){
  const tiles=new Map();let pixels=0,source=null,request=null,pending=[],cancelJob=null,failed=false;
  const enabled=!!root.CrateRasterRefinement?.enqueue&&typeof schedule==='function';
  function release(tile){pixels-=tile.cost;for(const image of tile.images){image.width=1;image.height=1;}tiles.delete(tile.key);}
  function cancel(){cancelJob?.();cancelJob=null;pending=[];}
  function clear(){cancel();for(const tile of [...tiles.values()])release(tile);source=null;request=null;}
  function invalidate(rectangles){cancel();for(const tile of [...tiles.values()])if(rectangles.some(rect=>overlap(tile.world,rect)))release(tile);}
  function evict(wanted){
   for(const tile of [...tiles.values()])if(pixels>maxPixels&&!wanted.has(tile.key))release(tile);
   while(pixels>maxPixels&&tiles.size)release(tiles.values().next().value);
  }
  const job={
   valid:()=>!!request&&request.valid()&&pending.length>0,
   abort(){cancelJob=null;pending=[];},fail(error){failed=true;cancel();console.warn('Display preview tiles:',error);},
   cost:()=>side*side*(request?.layers||1),remaining:()=>pending.length>0,
   step(){
    const item=pending.shift(),spec=request;if(!item||tiles.has(item.key))return;
    const images=Array.from({length:spec.layers},()=>makeCanvas());
    try{
     const contexts=images.map(image=>{image.width=side;image.height=side;const ctx=image.getContext('2d');ctx.cratePreviewTile=true;ctx.setTransform(spec.ratio,0,0,spec.ratio,0,0);return ctx;});
     const scale=item.physical/spec.ratio,view={scale,x:bleed/spec.ratio-item.world.x*scale,y:bleed/spec.ratio-item.world.y*scale};
     spec.paint(contexts,view,{x:0,y:0,w:side/spec.ratio,h:side/spec.ratio});
     const tile={...item,images,cost:side*side*images.length};tiles.set(tile.key,tile);pixels+=tile.cost;evict(spec.wanted);schedule();
    }catch(error){for(const image of images){image.width=1;image.height=1;}throw error;}
   },finish(){cancelJob=null;}
  };
  function screen(world,view,ratio){
   const x=Math.round((view.x+world.x*view.scale)*ratio)/ratio,y=Math.round((view.y+world.y*view.scale)*ratio)/ratio;
   const right=Math.round((view.x+(world.x+world.w)*view.scale)*ratio)/ratio,bottom=Math.round((view.y+(world.y+world.h)*view.scale)*ratio)/ratio;
   return {x,y,w:right-x,h:bottom-y};
  }
  function detailCoverage(detail,area,ratio){
   if(!detail)return null;
   const x=Math.max(area.x,Math.ceil(detail.rect.x*ratio+1)/ratio),y=Math.max(area.y,Math.ceil(detail.rect.y*ratio+1)/ratio);
   const right=Math.min(area.x+area.w,Math.floor((detail.rect.x+detail.rect.w)*ratio-1)/ratio),bottom=Math.min(area.y+area.h,Math.floor((detail.rect.y+detail.rect.h)*ratio-1)/ratio);
   return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;
  }
  function composite(ctx,area,ratio,background,detail,candidates,sampling){
   const cover=detailCoverage(detail,area,ratio),coverage=cover?[cover]:[],parts=[];
   // Prefer the resident level nearest the screen sampling rate. Drawing dozens
   // of unnecessarily fine tiles while zooming out only adds bitmap transfers.
   // Subtract occupied rectangles before drawing, so transparent
   // holes replace coarse pixels and region/probability alpha is never doubled.
   candidates.sort((a,b)=>Math.abs(Math.log2(a.tile.physical/sampling))-Math.abs(Math.log2(b.tile.physical/sampling))||b.tile.physical-a.tile.physical);
   for(const {tile,rect}of candidates){
    const clip=intersect(rect,area);if(!clip)continue;let fragments=[clip];
    for(const occupied of coverage){fragments=fragments.flatMap(part=>R.uncovered(part,occupied));if(!fragments.length)break;}
    if(!fragments.length)continue;coverage.push(...fragments);parts.push({tile,fragments});
   }
   if(!coverage.length){background();return {mixedDetail:false,previewTiles:0,previewLevels:[]};}
   ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);for(const rect of coverage)ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip('evenodd');background();ctx.restore();
   for(const {tile,fragments}of parts){
    ctx.save();ctx.beginPath();for(const rect of fragments)ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
    const scale=request.view.scale/tile.physical,x=request.view.x+tile.world.x*request.view.scale-bleed*scale,y=request.view.y+tile.world.y*request.view.scale-bleed*scale;
    for(const image of tile.images)ctx.drawImage(image,x,y,side*scale,side*scale);ctx.restore();
   }
   if(cover){ctx.save();ctx.beginPath();ctx.rect(cover.x,cover.y,cover.w,cover.h);ctx.clip();detail.paint();ctx.restore();}
   return {mixedDetail:!!cover,previewTiles:parts.length,previewLevels:[...new Set(parts.map(p=>p.tile.physical))]};
  }
  function render(ctx,view,area,spec){
   if(!enabled||failed)return null;
   if(source!==spec.source){clear();source=spec.source;}
   const {ratio,bounds}=spec,visible=intersect(bounds,{x:(area.x-view.x)/view.scale,y:(area.y-view.y)/view.scale,w:area.w/view.scale,h:area.h/view.scale});
   const sampling=Math.min(view.scale*ratio,view.scale*Math.sqrt(maxPixels*.65/(area.w*area.h*spec.layers)),4);
   const physical=2**Math.max(-8,Math.floor(Math.log2(sampling))),levels=[physical/2,physical].filter(n=>n>spec.basePhysical*1.15);
   const wanted=new Set(),items=[],detail=detailCoverage(spec.detail,area,ratio);
   if(visible)for(const level of levels){
    const worldSize=size/level;
    for(let y=Math.floor(visible.y/worldSize);y<Math.ceil((visible.y+visible.h)/worldSize);y++)for(let x=Math.floor(visible.x/worldSize);x<Math.ceil((visible.x+visible.w)/worldSize);x++){
     const world={x:x*worldSize,y:y*worldSize,w:worldSize,h:worldSize},rect=screen(world,view,ratio);
     if(detail&&rect.x>=detail.x&&rect.y>=detail.y&&rect.x+rect.w<=detail.x+detail.w&&rect.y+rect.h<=detail.y+detail.h)continue;
     const key=level+':'+x+','+y;wanted.add(key);if(!tiles.has(key))items.push({key,world,physical:level});
    }
   }
   // Replace the request in place; obsolete zoom/pan states never form a queue.
   request={...spec,view:{x:view.x,y:view.y,scale:view.scale},wanted};pending=items;
   if(pending.length&&!cancelJob)cancelJob=R.enqueue(job);else if(!pending.length)cancel();
   const candidates=[];
   for(const tile of [...tiles.values()])if(tile.physical>spec.basePhysical*1.05&&tile.physical<=physical*4&&visible&&overlap(tile.world,visible)){
    candidates.push({tile,rect:screen(tile.world,view,ratio)});tiles.delete(tile.key);tiles.set(tile.key,tile);
   }
   const result=composite(ctx,area,ratio,spec.background,spec.detail,candidates,sampling);
   return {...result,previewPixels:pixels,pendingTiles:pending.length};
  }
  return {render,invalidate,cancel,clear,get status(){return {tiles:tiles.size,pixels,pending:pending.length,levels:[...new Set([...tiles.values()].map(t=>t.physical))]};}};
 }
 const api={create};root.CrateRasterPreviewCache=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
