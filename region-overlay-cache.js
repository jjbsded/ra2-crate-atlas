/* A single bounded, transparent raster for the ordered region layer. */
(function(root){
 'use strict';
 const refinement=root.CrateRasterRefinement||(typeof module!=='undefined'?require('./raster-refinement.js'):null);
 function create(makeCanvas=()=>document.createElement('canvas'),schedule=null){
  let cached=null,overview=null,latest=null,refined=false;
  const refiner=root.CrateRasterRefinement?.create({makeCanvas,schedule});
  const overviewRefiner=root.CrateRasterRefinement?.create({makeCanvas,schedule});
  const previews=root.CrateRasterPreviewCache?.create({makeCanvas,schedule,maxPixels:7000000});
  const budget=8000000;
  function invalidate(rectangles){
   previews?.invalidate(rectangles);
   refiner?.cancel();overviewRefiner?.cancel();
   for(const entry of new Set([cached,overview]))if(entry){
    entry.dirty??=[];
    for(const rect of rectangles){let next={...rect};for(let i=entry.dirty.length-1;i>=0;i--){const p=entry.dirty[i];if(next.x<=p.x+p.w&&next.x+next.w>=p.x&&next.y<=p.y+p.h&&next.y+next.h>=p.y){const x=Math.min(next.x,p.x),y=Math.min(next.y,p.y);next={x,y,w:Math.max(next.x+next.w,p.x+p.w)-x,h:Math.max(next.y+next.h,p.y+p.h)-y};entry.dirty.splice(i,1);}}entry.dirty.push(next);}
   }
  }
  function patch(entry,paint){
   if(!entry?.dirty?.length)return 0;
   const target=entry.image.getContext('2d'),ratio=entry.ratio,local={x:-entry.left,y:-entry.top,scale:entry.scale};let count=0;
   target.setTransform(ratio,0,0,ratio,0,0);
   for(const rect of entry.dirty){const x=Math.max(0,Math.floor((rect.x*entry.scale-entry.left)*ratio-3)/ratio),y=Math.max(0,Math.floor((rect.y*entry.scale-entry.top)*ratio-3)/ratio),right=Math.min(entry.image.width/ratio,Math.ceil(((rect.x+rect.w)*entry.scale-entry.left)*ratio+3)/ratio),bottom=Math.min(entry.image.height/ratio,Math.ceil(((rect.y+rect.h)*entry.scale-entry.top)*ratio+3)/ratio);if(right<=x||bottom<=y)continue;
    const part={x,y,w:right-x,h:bottom-y};target.save();target.beginPath();target.rect(x,y,part.w,part.h);target.clip();target.clearRect(x,y,part.w,part.h);paint(target,local,part,true);target.restore();count++;
   }
   entry.dirty=[];return count;
  }
  function render(ctx,view,area,bounds,stamp,paint){
   if(!bounds){previews?.clear();refiner?.cancel();overviewRefiner?.cancel();overview=null;return {rebuilt:false,parts:0};}
   const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1;
   const clipKey=[area.x,area.y,area.w,area.h].join('|');
   const boundsKey=[bounds.x,bounds.y,bounds.w,bounds.h].join('|');
   latest={view,ratio,stamp,clipKey,boundsKey};refiner?.check();overviewRefiner?.check();
   let patched=0;for(const entry of new Set([cached,overview]))if(entry?.stamp===stamp)patched+=patch(entry,paint);
   if(overview&&(overview.stamp!==stamp||overview.ratio!==ratio))overview=null;
   if(!overview&&!view.navigating&&overviewRefiner?.available&&(bounds.w*view.scale*ratio+8)*(bounds.h*view.scale*ratio+8)>budget){
    const physical=Math.min(Math.sqrt(6000000/(bounds.w*bounds.h)),4000/bounds.w,4000/bounds.h),scale=physical/ratio;
    const width=Math.ceil(bounds.w*physical)+8,height=Math.ceil(bounds.h*physical)+8,left=bounds.x*scale-4/ratio,top=bounds.y*scale-4/ratio;
    const local={x:-left,y:-top,scale};
    overviewRefiner.start({key:[stamp,ratio,boundsKey].join('|'),width,height,ratio,
     valid:()=>latest?.view===view&&latest.stamp===stamp&&latest.ratio===ratio&&latest.boundsKey===boundsKey,
     paint:([target],part)=>paint(target,local,part),publish:([image])=>{overview={image,left,top,scale,ratio,full:true,stamp};}});
   }
   let old=cached,detail=null;
   const covers=(left,top,w,h)=>left<=area.x&&top<=area.y&&left+w>=area.x+area.w&&top+h>=area.y+area.h;
   if((view.navigating||refiner?.available)&&old&&old.stamp===stamp&&old.ratio===ratio&&!old.full&&overview&&view.scale<old.scale){
    const factor=view.scale/old.scale;
    if(!covers(view.x+old.left*factor,view.y+old.top*factor,old.image.width/ratio*factor,old.image.height/ratio*factor)){if(old.scale>overview.scale)detail=old;old=overview;}
   }
   const same=old&&old.stamp===stamp&&old.ratio===ratio;
   if(same&&(view.navigating||refiner?.available)&&(old!==cached||old.scale!==view.scale)){
    const factor=view.scale/old.scale,left=view.x+old.left*factor,top=view.y+old.top*factor;
    const w=old.image.width/ratio*factor,h=old.image.height/ratio*factor;
    if(old.full||covers(left,top,w,h)||refiner?.available){
     const background=()=>ctx.drawImage(old.image,left,top,w,h);let mixedDetail=false,detailSource=null;
     if(detail){const f=view.scale/detail.scale,x=view.x+detail.left*f,y=view.y+detail.top*f,width=detail.image.width/ratio*f,height=detail.image.height/ratio*f;detailSource={rect:{x,y,w:width,h:height},paint:()=>ctx.drawImage(detail.image,x,y,width,height)};}
     const tiled=previews?.render(ctx,view,area,{source:stamp+'|'+ratio+'|'+boundsKey,ratio,bounds,layers:1,basePhysical:old.scale*ratio,background,detail:detailSource,
      valid:()=>latest?.stamp===stamp&&latest.ratio===ratio&&latest.boundsKey===boundsKey,paint:([target],local,part)=>paint(target,local,part)});
     mixedDetail=tiled?.mixedDetail||false;
     if(!tiled){if(detailSource&&refinement?.composite)mixedDetail=refinement.composite(ctx,area,detailSource.rect,ratio,background,detailSource.paint);else background();}
     if(!old.full)for(const part of root.CrateRasterRefinement?.uncovered(area,{x:left,y:top,w,h})||[]){
      ctx.save();ctx.beginPath();ctx.rect(part.x,part.y,part.w,part.h);ctx.clip();paint(ctx,view,part);ctx.restore();
     }
     if(!view.navigating&&refiner?.available){
      const scale=view.scale,phaseX=view.x,phaseY=view.y,pad=3;
      const wl=Math.floor((bounds.x*scale-pad)*ratio)/ratio,wt=Math.floor((bounds.y*scale-pad)*ratio)/ratio;
      const ww=Math.ceil(((bounds.x+bounds.w)*scale+pad-wl)*ratio)+1,wh=Math.ceil(((bounds.y+bounds.h)*scale+pad-wt)*ratio)+1;
      const full=ww*wh<=budget&&ww<=8192&&wh<=8192;
      const margin=Math.max(0,Math.min(192,(Math.sqrt((area.w-area.h)**2+4*budget/ratio**2)-area.w-area.h)/4));
      const width=full?ww:Math.ceil((area.w+2*margin)*ratio)+1,height=full?wh:Math.ceil((area.h+2*margin)*ratio)+1;
      const sourceLeft=Math.floor((full?phaseX+wl:area.x-margin)*ratio)/ratio-phaseX,sourceTop=Math.floor((full?phaseY+wt:area.y-margin)*ratio)/ratio-phaseY;
      const key=[stamp,ratio,scale,width,height].join('|'),local={x:-sourceLeft,y:-sourceTop,scale};
      refiner.start({key,width,height,ratio,valid:()=>latest?.view===view&&view.scale===scale&&latest.stamp===stamp&&latest.ratio===ratio&&latest.clipKey===clipKey&&[area.x,area.y,area.w,area.h].join('|')===clipKey,
       paint:([target],part)=>paint(target,local,part),
       publish:([image])=>{cached={image,left:sourceLeft,top:sourceTop,scale,ratio,full,stamp};if(full){overviewRefiner?.cancel();overview=cached;}refined=true;}});
     }
     return {...tiled,rebuilt:false,parts:0,patched,preview:true,overview:old===overview,mixedDetail,refining:!!refiner?.pending};
    }
   }
   previews?.cancel();
   const pad=3,worldLeft=Math.floor((bounds.x*view.scale-pad)*ratio)/ratio,worldTop=Math.floor((bounds.y*view.scale-pad)*ratio)/ratio;
   const wholeW=Math.ceil(((bounds.x+bounds.w)*view.scale+pad-worldLeft)*ratio)+1;
   const wholeH=Math.ceil(((bounds.y+bounds.h)*view.scale+pad-worldTop)*ratio)+1;
   const full=wholeW*wholeH<=budget&&wholeW<=8192&&wholeH<=8192;
   const margin=Math.max(0,Math.min(192,(Math.sqrt((area.w-area.h)**2+4*budget/ratio**2)-area.w-area.h)/4));
   const width=full?wholeW:Math.ceil((area.w+2*margin)*ratio)+1,height=full?wholeH:Math.ceil((area.h+2*margin)*ratio)+1;
   const w=width/ratio,h=height/ratio;
   let left=old?.left,top=old?.top,parts=[],rebuilt=false;
   const reusable=same&&old.scale===view.scale&&old.full===full&&old.image.width===width&&old.image.height===height;
   if(!reusable){
    refiner?.cancel();
    left=Math.floor((full?view.x+worldLeft:area.x-margin)*ratio)/ratio-view.x;
    top=Math.floor((full?view.y+worldTop:area.y-margin)*ratio)/ratio-view.y;
    const image=old?.image&&old.image!==overview?.image?old.image:makeCanvas();image.width=width;image.height=height;
    cached={image,left,top,scale:view.scale,ratio,full,stamp};
    if(full){overviewRefiner?.cancel();overview=cached;}
    parts=[{x:0,y:0,w,h}];rebuilt=true;
   }else if(!full&&!covers(view.x+left,view.y+top,w,h)){
    const nextLeft=Math.floor((area.x-margin)*ratio)/ratio-view.x,nextTop=Math.floor((area.y-margin)*ratio)/ratio-view.y;
    const dx=Math.ceil((left-nextLeft)*ratio-1e-7),dy=Math.ceil((top-nextTop)*ratio-1e-7);
    left-=dx/ratio;top-=dy/ratio;cached.left=left;cached.top=top;
    if(Math.abs(dx)>=width||Math.abs(dy)>=height)parts=[{x:0,y:0,w,h}];
    else{
     const target=cached.image.getContext('2d');target.save();target.setTransform(1,0,0,1,0,0);
     target.globalCompositeOperation='copy';target.imageSmoothingEnabled=false;target.drawImage(cached.image,dx,dy);target.restore();
     if(dx)parts.push({x:dx>0?0:(width+dx)/ratio,y:0,w:Math.abs(dx)/ratio,h});
     if(dy)parts.push({x:Math.max(0,dx)/ratio,y:dy>0?0:(height+dy)/ratio,w:(width-Math.abs(dx))/ratio,h:Math.abs(dy)/ratio});
    }
   }
   const target=cached.image.getContext('2d'),local={x:-left,y:-top,scale:view.scale};
   target.setTransform(ratio,0,0,ratio,0,0);
   for(const part of parts){
    target.save();target.beginPath();target.rect(part.x,part.y,part.w,part.h);target.clip();
    target.clearRect(part.x,part.y,part.w,part.h);paint(target,local,part);target.restore();
   }
   ctx.drawImage(cached.image,Math.round((view.x+left)*ratio)/ratio,Math.round((view.y+top)*ratio)/ratio,w,h);
   const result={rebuilt,parts:parts.length,patched,pixels:width*height,full,refined};refined=false;return result;
  }
  return {render,invalidate,*warmup(target){if(cached?.image){target.drawImage(cached.image,0,0,64,64);yield;}},get previewStatus(){return previews?.status;},cancelRefinement(){previews?.cancel();refiner?.cancel();overviewRefiner?.cancel();},clear(){previews?.clear();refiner?.cancel();overviewRefiner?.cancel();cached=null;overview=null;latest=null;refined=false;}};
 }
 const api={create};root.CrateRegionOverlayCache=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
