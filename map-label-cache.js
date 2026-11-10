/* Full-DPI text pixels follow the map; exposed strips refine in small jobs. */
(function(root){
 'use strict';
 function create({schedule,makeCanvas=()=>document.createElement('canvas'),maxPixels=8000000,margin=192,tileSize=512}={}){
  let cache=null,pending=null,current='';
  const metrics={builds:0,fastFrames:0,fallbackFrames:0,paintedParts:0,reusedParts:0,maxPartMs:0};
  const refiner=root.CrateRasterRefinement?.create({makeCanvas,schedule});
  const rect=(image,view)=>({x:view.x+image.worldX*view.scale,y:view.y+image.worldY*view.scale,w:image.width/image.ratio,h:image.height/image.ratio});
  const covers=(r,a)=>r.x<=a.x&&r.y<=a.y&&r.x+r.w>=a.x+a.w&&r.y+r.h>=a.y+a.h;
  const intersects=(r,a)=>r.x<a.x+a.w&&r.x+r.w>a.x&&r.y<a.y+a.h&&r.y+r.h>a.y;
  function clip(ctx,part,fn){ctx.save();ctx.beginPath();ctx.rect(part.x,part.y,part.w,part.h);ctx.clip();try{fn();}finally{ctx.restore();}}
  function render(ctx,view,area,{key,paint,valid=()=>true,prepare=true,paintStatic=true,prepareWhileMoving=false}){
   const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1,stamp=key+'|'+view.scale+'|'+ratio;
   current=stamp;
   if(cache?.stamp!==stamp)cache=null;
   if(pending&&(!prepare||view.navigating&&!prepareWhileMoving||!refiner?.available||pending.stamp!==stamp||!intersects(rect(pending,view),area))){refiner?.cancel();pending=null;}
   const previous=cache,coverage=previous&&rect(previous,view),complete=coverage&&covers(coverage,area);
   const width=Math.ceil((area.w+2*margin)*ratio),height=Math.ceil((area.h+2*margin)*ratio);
   if(prepare&&(!view.navigating||prepareWhileMoving)&&refiner?.available&&!complete&&!pending&&width*height<=maxPixels&&width<8190&&height<8190){
    const plan=pending={stamp,ratio,width,height,scale:view.scale,
     worldX:Math.floor((area.x-margin-view.x)*ratio)/ratio/view.scale,
     worldY:Math.floor((area.y-margin-view.y)*ratio)/ratio/view.scale};
    const local={x:-plan.worldX*view.scale,y:-plan.worldY*view.scale,scale:view.scale},seed=previous&&rect(previous,local);
    refiner.start({key:stamp+'|'+plan.worldX+'|'+plan.worldY,width,height,ratio,tileSize,
     valid(){const fresh=pending===plan&&current===stamp&&valid();if(!fresh&&pending===plan)pending=null;return fresh;},
     paint(contexts,part){
      const target=contexts[0],at=performance.now();
      if(previous){target.imageSmoothingEnabled=false;target.drawImage(previous.image,seed.x,seed.y,seed.w,seed.h);metrics.reusedParts++;}
      for(const exposed of seed?root.CrateRasterRefinement.uncovered(part,seed):[part])clip(target,exposed,()=>{paint(target,local,exposed);metrics.paintedParts++;});
      metrics.maxPartMs=Math.max(metrics.maxPartMs,performance.now()-at);
     },
     publish(images){cache={...plan,image:images[0]};pending=null;metrics.builds++;}
    });
   }
   // During a stationary frame retain the original per-label sampling exactly.
   // Motion can reproject native-DPI pixels without rebuilding text per frame.
   if(!view.navigating){metrics.fallbackFrames++;if(paintStatic)paint(ctx,view,area);return;}
   ctx.imageSmoothingEnabled=false;
   if(complete){ctx.drawImage(previous.image,coverage.x,coverage.y,coverage.w,coverage.h);metrics.fastFrames++;return;}
   metrics.fallbackFrames++;
   if(!previous){paint(ctx,view,area);return;}
   // Inward physical-pixel clips keep cached and freshly painted alpha disjoint.
   const l=Math.max(area.x,Math.ceil(coverage.x*ratio+1)/ratio),t=Math.max(area.y,Math.ceil(coverage.y*ratio+1)/ratio),r=Math.min(area.x+area.w,Math.floor((coverage.x+coverage.w)*ratio-1)/ratio),b=Math.min(area.y+area.h,Math.floor((coverage.y+coverage.h)*ratio-1)/ratio);
   if(l>=r||t>=b){paint(ctx,view,area);return;}
   const kept={x:l,y:t,w:r-l,h:b-t};
   clip(ctx,kept,()=>ctx.drawImage(previous.image,coverage.x,coverage.y,coverage.w,coverage.h));
   for(const part of root.CrateRasterRefinement.uncovered(area,kept))clip(ctx,part,()=>paint(ctx,view,part));
  }
  function cancel(){refiner?.cancel();pending=null;}
  return {render,cancel,*warmup(target){if(cache?.image){target.drawImage(cache.image,0,0,64,64);yield;}},clear(){cancel();cache=null;current='';},get status(){return {...metrics,pending:!!pending,ready:!!cache,pixels:cache?cache.width*cache.height:0};}};
 }
 const api={create};root.CrateMapLabelCache=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
