/* Region locator images and their cancellable, latest-only background queue. */
(function(root){
 'use strict';
 const R=root.CrateRegionStatistics||(typeof require==='function'?require('./region-statistics.js'):null);
 const i18n=root.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const translate=i18n?.t||(text=>text);

 function layout(bounds,rendering,width,height,overview){
  let crop={x:0,y:0,w:rendering.width,h:rendering.height};
  if(!overview){
   const scale=Math.min(width/bounds.w,height/bounds.h);
   const w=Math.min(rendering.width,width/scale),h=Math.min(rendering.height,height/scale);
   crop={x:Math.max(0,Math.min(rendering.width-w,bounds.x+(bounds.w-w)/2)),y:Math.max(0,Math.min(rendering.height-h,bounds.y+(bounds.h-h)/2)),w,h};
  }
  const scaleX=width/crop.w,scaleY=height/crop.h;
  return {crop,view:{x:-crop.x*scaleX,y:-crop.y*scaleY,scale:scaleX,scaleX,scaleY}};
 }

 function create({getState,getDocument,getGeometry,getSettings,paintRegion,isVisible,isDrawing,onDeferred,
  makeCanvas=()=>root.document.createElement('canvas'),now=()=>root.performance.now(),
  defer=fn=>root.requestIdleCallback?root.requestIdleCallback(fn,{timeout:100}):root.setTimeout(fn,16),
  cancelDeferred=id=>root.cancelIdleCallback?root.cancelIdleCallback(id):root.clearTimeout(id)}){
  let cache=new WeakMap(),transparency=getDocument().transparency,job=null,pendingImages=0;
  const buttons=new Map(),applied=new Map();
  const diagnostics={renders:0,cacheHits:0,replacements:0,unchanged:0,cancelledJobs:0};

  function cancel(){
   if(!job)return;
   cancelDeferred(job.id);job=null;diagnostics.cancelledJobs++;
  }
  function reset(){cancel();applied.clear();transparency=getDocument().transparency;}
  function invalidate(){cache=new WeakMap();}

  function render(region,overview,opacity=applied.get(region.id)??transparency){
   const state=getState(),doc=getDocument(),settings=getSettings(),geometry=getGeometry(region);
   const source=settings.objects&&state.objectImage?state.objectImage:state.image;
   const size=settings.size||{width:1,height:1},width=216*size.width,height=121.5*size.height;
   const density=Math.max(1,Math.min(3,root.devicePixelRatio||1));
   const starts=root.CratePlayerStarts?.positions(state)||[];
   const focusPlayers=R.playersForRegion(doc,region,starts);
   const key=[geometry.revision,region.color,region.id===doc.active,opacity,settings.players,settings.playerStylesKey,density,focusPlayers.join(',')].join('|');
   let entry=cache.get(region);
   if(!entry||entry.key!==key||entry.source!==source){entry={key,source,images:[]};cache.set(region,entry);}
   const index=Number(overview),sizeKey=size.width+','+size.height;
   if(entry.images[index]?.regionSizeKey===sizeKey){diagnostics.cacheHits++;return entry.images[index];}

   const canvas=makeCanvas();canvas.width=Math.ceil(width*density);canvas.height=Math.ceil(height*density);
   canvas.setAttribute('aria-hidden','true');canvas.regionSizeKey=sizeKey;entry.images[index]=canvas;diagnostics.renders++;
   const ctx=canvas.getContext('2d'),bounds=geometry.bounds;
   ctx.scale(canvas.width/width,canvas.height/height);ctx.fillStyle='#0a151e';ctx.fillRect(0,0,width,height);
   if(!bounds){
    ctx.fillStyle='#78909f';ctx.font='12px sans-serif';ctx.textAlign='center';
    ctx.fillText(overview?translate('全图位置'):translate('尚未划分'),width/2,height/2+4);return canvas;
   }
   const {crop,view}=layout(bounds,state.data.rendering,width,height,overview);
   // Artwork can be resized independently; overlays and starts use map space.
   const sourceX=(source.naturalWidth||source.width)/state.data.rendering.width;
   const sourceY=(source.naturalHeight||source.height)/state.data.rendering.height;
   const sourceCrop=[crop.x*sourceX,crop.y*sourceY,crop.w*sourceX,crop.h*sourceY];
   function finish(background){
   if(background)ctx.drawImage(background,0,0,width,height);
   else (root.CrateMapArtwork?.draw||((ctx,...args)=>ctx.drawImage(...args)))(ctx,source,...sourceCrop,0,0,width,height);
   ctx.save();const stretch=view.scaleY/view.scaleX;ctx.scale(1,stretch);
   paintRegion(ctx,region,{...view,y:view.y/stretch},1-opacity/100);ctx.restore();
   if(overview){
    const w=Math.max(6,bounds.w*view.scaleX),h=Math.max(6,bounds.h*view.scaleY);
    const x=view.x+(bounds.x+bounds.w/2)*view.scaleX-w/2,y=view.y+(bounds.y+bounds.h/2)*view.scaleY-h/2;
    ctx.strokeStyle='#07131d';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);
    ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);
   }
   if(settings.players){
    const includePlayers=overview?null:starts.filter(p=>region.cells.has(R.key(p))).map(p=>p.number);
    root.CratePlayerStarts?.draw(ctx,state,view,{radius:(overview?5.5:7)*Math.min(size.width,size.height),clip:{x:0,y:0,w:width,h:height},regionStyles:settings.playerStyles,focusPlayers,includePlayers,fit:true});
   }
   }
   const pending=source.prepareThumbnail?.(sourceCrop,[canvas.width,canvas.height]);
   if(pending){
    // Keep this canvas stable while exact source-pixel compositing runs away
    // from pointer/scroll handlers. Obsolete map, geometry or style work cannot
    // publish into a newer thumbnail.
    const valid=()=>cache.get(region)===entry&&entry.images[index]===canvas&&getDocument()===doc&&getState()===state;
    pendingImages++;
    canvas.regionReady=Promise.resolve(pending).then(image=>{if(valid())finish(image);},error=>{
     if(error.name!=='AbortError'&&valid())finish(null);
    }).finally(()=>pendingImages--);
   }else finish(null);
   return canvas;
  }

  function request(force=false){
   cancel();
   if(!isVisible()){reset();return;}
   const doc=getDocument(),opacity=doc.transparency;
   if(!force&&transparency===opacity&&!applied.size)return;
   const regions=doc.regions.slice(),current=job={id:null};let index=0;
   const schedule=()=>{current.id=defer(step);};
   function step(deadline){
    if(job!==current)return;
    if(root.CrateMapPriority?.blocked){root.CrateMapPriority.wait().then(()=>{if(job===current)schedule();});return;}
    if(isDrawing()){job=null;onDeferred?.();return;}
    if(getDocument()!==doc||doc.transparency!==opacity){job=null;return;}
    const started=now();
    while(index<regions.length){
     const region=regions[index++],targets=buttons.get(region.id);
     targets?.forEach((button,i)=>{
      const image=render(region,!!i,opacity);
      if(button.children.length===1&&button.children[0]===image)diagnostics.unchanged++;
      else{button.replaceChildren(image);diagnostics.replacements++;}
     });
     if(targets)applied.set(region.id,opacity);
     if(now()-started>=5||deadline&&deadline.timeRemaining()<=2)break;
    }
    if(index<regions.length)schedule();
    else{transparency=opacity;applied.clear();job=null;}
   }
   schedule();
  }

  return {render,request,cancel,reset,invalidate,
   setButtons:(id,targets)=>buttons.set(id,targets),buttonsFor:id=>buttons.get(id)||[],clearButtons:()=>buttons.clear(),
   get status(){return {pending:!!job||pendingImages>0,pendingImages,...diagnostics};}
  };
 }
 const api={create,layout};root.CrateRegionThumbnails=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
