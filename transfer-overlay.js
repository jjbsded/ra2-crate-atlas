/* A selected destination owns one immutable, spatially indexed origin layer.
 * Reproject full-DPI pixels while panning; prepare exposed strips in bounded
 * background work. Direct renders / exports retain the vector painter. */
(function(root){
 'use strict';
 const occupancy=typeof module!=='undefined'?require('./occupancy-overlay.js'):root.CrateOccupancyOverlay;
 const transfers=typeof module!=='undefined'?require('./transfer-origins.js'):root.CrateTransferOrigins;
 const probability=typeof module!=='undefined'?require('./probability-display.js'):root.CrateProbabilityDisplay;
 const artwork=typeof module!=='undefined'?require('./map-artwork.js'):root.CrateMapArtwork;
 const columns=typeof module!=='undefined'?require('./transfer-columns.js'):root.CrateTransferColumns;
 const selection=typeof module!=='undefined'?require('./selection-probability.js'):root.CrateSelectionProbability;
 function create({sourceCell,surface,outlineParts,makeCanvas,schedule}={}){
  const raster=root.CrateMapLabelCache?.create({makeCanvas,schedule,maxPixels:16000000,tileSize:256});
  let prepared=null,stamp=null,revision=0,indices=new WeakMap();const widths=new Map();
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  function prepare(incoming,state){
   if(prepared?.incoming===incoming&&prepared.data===state.data)return prepared;
   raster?.clear();stamp=null;
   const cached=indices.get(incoming);if(cached?.data===state.data){prepared=cached;return cached;}
   const entries=incoming.sources.map((s,order)=>{const c=sourceCell(s,state),rings=surface(c);return {s,c,rings,order,label:probability.percent(s.transferProbability),color:transfers.style(s.strength),hidden:outlineParts(s.cell||c).hidden};});
   const buckets=new Map(),size=256;
   for(const e of entries){
    const points=e.rings.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const left=e.c.px+Math.min(-30,...xs),right=e.c.px+Math.max(30,...xs),top=e.c.py+Math.min(-15,...ys),bottom=e.c.py+Math.max(15,...ys);
    for(let y=Math.floor(top/size);y<=Math.floor(bottom/size);y++)for(let x=Math.floor(left/size);x<=Math.floor(right/size);x++){const key=x+','+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e);}
   }
   function visible(view,area){
    const found=new Set(),margin=80,left=(area.x-margin-view.x)/view.scale,right=(area.x+area.w+margin-view.x)/view.scale,top=(area.y-margin-view.y)/view.scale,bottom=(area.y+area.h+margin-view.y)/view.scale;
    for(let y=Math.floor(top/size);y<=Math.floor(bottom/size);y++)for(let x=Math.floor(left/size);x<=Math.floor(right/size);x++)for(const e of buckets.get(x+','+y)||[]){const c=e.c;if(c.px>=left&&c.px<=right&&c.py>=top&&c.py<=bottom)found.add(e);}
    return [...found].sort((a,b)=>a.order-b.order);
   }
   prepared={incoming,data:state.data,entries,visible,sourceKeys:new Set(incoming.sources.map(transfers.key))};indices.set(incoming,prepared);return prepared;
  }
  function paint(ctx,state,area,options,index){
   const entries=index.visible(state,area),scale=state.scale;
   const ringPath=(rings,c)=>{for(const ring of rings){ring.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*scale,state.y+(c.py+dy)*scale));ctx.closePath();}};
   if(entries.length){
    ctx.save();ctx.beginPath();for(const {c,rings}of entries)ringPath(rings,c);ctx.clip('evenodd');ctx.fillStyle='#101c25';ctx.fillRect(area.x,area.y,area.w,area.h);
    artwork.scene(ctx,state,state.data.rendering,options,area);options.sceneLayer?.(ctx,state,area);ctx.restore();
   }
   columns.draw(ctx,state,area,index.entries,options.transferColumns,index.incoming);
   for(const {s,c,rings,color,hidden}of entries){
    ctx.save();ctx.beginPath();ringPath(rings,c);ctx.clip('evenodd');
    const projected=rings.map(r=>r.map(([dx,dy])=>[state.x+(c.px+dx)*scale,state.y+(c.py+dy)*scale]));
    occupancy.path(ctx,projected,Math.min(4,3*scale));ctx.fillStyle=color.fill;ctx.fill('evenodd');ctx.restore();selection.stroke(ctx,()=>{ctx.beginPath();ringPath(rings,c);},options.selectionOutline);
    if(hidden.length){ctx.save();ctx.globalAlpha=.7;selection.stroke(ctx,()=>{ctx.beginPath();for(const line of hidden)line.forEach(([dx,dy],i)=>ctx[i?'lineTo':'moveTo'](state.x+(c.px+dx)*scale,state.y+(c.py+dy)*scale));},options.selectionOutline);ctx.restore();}
   }
   if(30*scale>=28){
    const size=Math.min(13,Math.max(10,scale*5));ctx.font=`600 ${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(7,36,48,.94)';ctx.fillStyle='#e5fcff';
    for(const {c,label}of entries){if(options.transferLabelSkip?.has(transfers.key(c)))continue;const x=state.x+(c.px+(c.labelOffset?.[0]||0))*scale,y=state.y+(c.py+(c.labelOffset?.[1]||0))*scale+size/3;ctx.strokeText(label,x,y);ctx.fillText(label,x,y);}
   }
  }
  function render(ctx,state,area,incoming,options){
   const index=prepare(incoming,state),key=[incoming,state.data,state.image,state.objectImage,state.artworkRevision,options.scene,options.objects,options.objectOpacity,options.sceneLayer,options.transferColumns,JSON.stringify(options.selectionOutline),state.outgoing];
   if(!same(stamp,key)){stamp=key;revision++;raster?.clear();}
   if(raster&&index.entries.length>=128)raster.render(ctx,state,area,{key:revision,prepare:!options.labelCacheBusy,prepareWhileMoving:true,paint:(target,local,part)=>paint(target,{...state,...local},part,options,index),valid:()=>prepared===index&&same(stamp,key)});
   else paint(ctx,state,area,options,index);
   const labelBoxes=[];
   if(state.selected&&options.collectLabelBoxes!==false&&30*state.scale>=28){
    const size=Math.min(13,Math.max(10,state.scale*5)),font=`600 ${size}px "Microsoft YaHei",sans-serif`;
    ctx.save();ctx.font=font;
    for(const {c,label}of index.visible(state,area)){
     const key=font+'|'+label;if(!widths.has(key))widths.set(key,ctx.measureText(label).width);const w=widths.get(key),x=state.x+(c.px+(c.labelOffset?.[0]||0))*state.scale,y=state.y+(c.py+(c.labelOffset?.[1]||0))*state.scale+size/3;
     labelBoxes.push({x:x-w/2-4,y:y-size-4,w:w+8,h:size+8});
    }ctx.restore();
   }
   return {sourceKeys:index.sourceKeys,labelBoxes};
  }
  function hide(){if(prepared||stamp){raster?.clear();prepared=stamp=null;}}
  return {render,prepare,hide,clear(){hide();indices=new WeakMap();widths.clear();},get status(){return {...raster?.status,sources:prepared?.entries.length||0};}};
 }
 const api={create};root.CrateTransferOverlay=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
