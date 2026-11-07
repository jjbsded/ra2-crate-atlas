/* Independent, bounded artwork updates. Probability workers never gate pixels. */
(function(root){
 'use strict';
 function create({getState,getArea,schedule,onPaint,onProgress}){
  let generation=0,request=0,worker=null,flight=null,timer=null,patches=new Map(),visualPlan=null,baseGround=null,baseObjects=null,last=null;
  const wrapped=new WeakMap(),snapshots=new WeakMap();
  const unfinished=new Map(),grounds=new Map();
  const diagnostics={decoded:0,groundHits:0,published:0,lastDecodeMs:0,lastPublishMs:0};
  const decode=async src=>{
   const image=new Image();image.src=src;await image.decode();
   diagnostics.decoded++;return image;
  };
  function wrap(base,layer,tiles=patches,frozen=false){const result={width:base.naturalWidth||base.width,height:base.naturalHeight||base.height,
   snapshot(){if(frozen)return this;let copy=snapshots.get(tiles);if(!copy){copy=new Map(tiles);snapshots.set(tiles,copy);}return wrap(base.snapshot?.()||base,layer,copy,true);},draw(ctx,...args){
   root.CrateMapArtwork.draw(ctx,base,...args);
   let sx=0,sy=0,sw=this.width,sh=this.height,dx,dy,dw,dh;
   if(args.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=args;else{[dx,dy,dw=this.width,dh=this.height]=args;}
   ctx.save();ctx.beginPath();ctx.rect(dx,dy,dw,dh);ctx.clip();
   for(const patch of tiles.values()){const[x,y,w,h]=patch.box;if(x+w<sx||y+h<sy||x>sx+sw||y>sy+sh)continue;ctx.drawImage(patch[layer],dx+(x-sx)*dw/sw,dy+(y-sy)*dh/sh,w*dw/sw,h*dh/sh);}ctx.restore();
  }};wrapped.set(result,{base,layer,tiles});return result;}
  function reset(plan=null){generation++;clearTimeout(timer);timer=null;flight=null;patches=new Map();unfinished.clear();grounds.clear();visualPlan=plan;baseGround=baseObjects=null;last=null;worker?.terminate();worker=null;}
  function publish(tiles,plan,complete=true){
   const s=getState();
   if(tiles.length){
    if(!baseGround){
     const ground=wrapped.get(s.image),objects=wrapped.get(s.objectImage);
     // Reuse a restored checkpoint without accumulating nested image wrappers.
     if(ground?.layer==='ground'&&objects?.layer==='objects'&&ground.tiles===objects.tiles){baseGround=ground.base;baseObjects=objects.base;patches=new Map(ground.tiles);}
     else{baseGround=s.image;baseObjects=s.objectImage||s.image;}
     s.image=wrap(baseGround,'ground');s.objectImage=wrap(baseObjects,'objects');
    }
    snapshots.delete(patches);
    for(const tile of tiles){
     const [x,y,w,h]=tile.box;
     for(const [key,p] of patches){const [a,b,pw,ph]=p.box;if(a>=x&&b>=y&&a+pw<=x+w&&b+ph<=y+h)patches.delete(key);}
     patches.set(tile.box.join(','),tile);
    }
    s.artworkRevision=(s.artworkRevision||0)+1;
    s.artworkDirty=(s.artworkDirty||[]).concat(tiles.map(tile=>tile.box));
   }
   delete s.simulationVisualError;
   if(complete){visualPlan=plan;onPaint(plan);}
   schedule();
  }
  async function installTiles(result,valid){
   const token=generation;if(!valid())return false;const started=performance.now();
   const tiles=await Promise.all(result.patches.map(async tile=>{
    let ground=tile.groundKey&&grounds.get(tile.groundKey);
    if(ground){grounds.delete(tile.groundKey);grounds.set(tile.groundKey,ground);diagnostics.groundHits++;}
    if(!ground&&!tile.ground){const e=Error('Missing artwork ground checkpoint');e.code='ART_GROUND_MISSING';throw e;}
    const [decodedGround,objects]=await Promise.all([ground||decode(tile.ground),decode(tile.objects)]);
    if(token===generation&&valid()&&tile.groundKey){grounds.set(tile.groundKey,decodedGround);while(grounds.size>64)grounds.delete(grounds.keys().next().value);}
    return {box:tile.box,ground:decodedGround,objects};
   }));
   diagnostics.lastDecodeMs=performance.now()-started;
   if(token!==generation||!valid())return false;
   const at=performance.now();publish(tiles,result.plan,result.done===result.total);diagnostics.lastPublishMs=performance.now()-at;diagnostics.published++;
   return true;
  }
  function toyScene(source,plan,box){
   return new Promise((resolve,reject)=>{
    worker||=new Worker(new URL('live/worker.js',document.baseURI));
    worker.onmessage=({data})=>{
     if(data.error)reject(Error(data.error));
     else if(data.preview)resolve(root.CrateLiveArtwork.create(data.report));
    };
    worker.onerror=e=>reject(Error(e.message));
    worker.postMessage({id:++request,preview:true,version:source.version,minerals:true,filename:'simulation-preview.map',source,plan,box});
   });
  }
  function crop(art,box){
   const result={box};
   for(const [name,image] of [['ground',art.im],['objects',art.objectImage]]){
    const c=document.createElement('canvas');c.width=box[2];c.height=box[3];
    root.CrateMapArtwork.draw(c.getContext('2d'),image,...box,0,0,c.width,c.height);
    result[name]=c;
   }
   return result;
  }
  async function native(url,plan,box){
   const reply=await root.CrateLocalAPI.json('/api/maps/simulation-patch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:url,plan,box})});
   const [ground,objects]=await Promise.all([decode(reply.ground),decode(reply.objects)]);
   return {...reply,ground,objects};
  }
  function affectedBoxes(points){
   const s=getState(),r=s.data.rendering,a=getArea(),size=512,boxes=new Map(unfinished);
   for(const c of points){
    const l=Math.max(0,c.px-180),t=Math.max(0,c.py-240),right=Math.min(r.width,c.px+180),bottom=Math.min(r.height,c.py+160);
    for(let y=Math.floor(t/size)*size;y<bottom;y+=size)for(let x=Math.floor(l/size)*size;x<right;x+=size){
     const box=[x,y,Math.min(size,r.width-x),Math.min(size,r.height-y)];
     boxes.set(box.join(','),box);
    }
   }
   const x=(a.x+a.w/2-s.x)/s.scale,y=(a.y+a.h/2-s.y)/s.scale;
   const distance=b=>(b[0]+b[2]/2-x)**2+(b[1]+b[3]/2-y)**2;
   return [...boxes.values()].sort((a,b)=>distance(a)-distance(b));
  }
  function bounds(model,plan){
   const s=getState(),r=s.data.rendering,a=getArea(),points=[...model.changesSince(visualPlan,plan)].map(p=>s.lookup.get(p)).filter(Boolean);
   if(!points.length)return null;
   const extent=points=>{let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const c of points){x=Math.min(x,c.px-180);y=Math.min(y,c.py-240);right=Math.max(right,c.px+180);bottom=Math.max(bottom,c.py+160);}return [x,y,right,bottom];};
   let [x,y,right,bottom]=extent(points);
   if((right-x)*(bottom-y)>3000000){
    const left=(a.x-s.x)/s.scale,top=(a.y-s.y)/s.scale,viewRight=left+a.w/s.scale,viewBottom=top+a.h/s.scale;
    const visible=points.filter(c=>c.px>=left-180&&c.px<=viewRight+180&&c.py>=top-160&&c.py<=viewBottom+240);
    if(!visible.length)return null;[x,y,right,bottom]=extent(visible);
    x=Math.max(x,left-180);y=Math.max(y,top-240);right=Math.min(right,viewRight+180);bottom=Math.min(bottom,viewBottom+160);
    if((right-x)*(bottom-y)>4000000)return null;
   }
   x=Math.max(0,Math.floor(x));y=Math.max(0,Math.floor(y));right=Math.min(r.width,Math.ceil(right));bottom=Math.min(r.height,Math.ceil(bottom));return right>x&&bottom>y?[x,y,right-x,bottom-y]:null;
  }
  async function paint(){timer=null;if(flight||!last)return;const {model,url,revision,bulk,plan}=last;
   const s=getState(),points=bulk||unfinished.size?[...model.changesSince(visualPlan,plan)].map(key=>s.lookup.get(key)).filter(Boolean):[];
   const progressive=unfinished.size>0||points.length>24,boxes=progressive?affectedBoxes(points):[];
   const box=progressive?null:bounds(model,plan);
   if(!box&&!boxes.length)return;
   const token=generation,job={revision,progressive};flight=job;const start=performance.now();try{
   if(progressive){
    const art=root.CrateMapPlatform?.simulate?await toyScene(model.source,plan):null;
    for(let i=0;i<boxes.length;i++){
     if(token!==generation||last?.revision!==revision)return;
     const tile=art?crop(art,boxes[i]):await native(url,plan,boxes[i]);
     if(token!==generation||last?.revision!==revision)return;
     const complete=i+1===boxes.length;
     unfinished.set(tile.box.join(','),tile.box);
     publish([tile],plan,complete);
     onProgress?.({revision,done:i+1,total:boxes.length});
     if(!complete)await new Promise(requestAnimationFrame);
    }
    unfinished.clear();
    return;
   }
   const patch=root.CrateMapPlatform?.simulate?crop(await toyScene(model.source,plan,box),box):await native(url,plan,box);
   if(token!==generation||last?.revision!==revision)return;const s=getState();publish([patch],plan);s.simulationVisualTiming={elapsedMs:Math.round(performance.now()-start),serverMs:patch.elapsedMs,paintedCells:patch.paintedCells};
  }catch(error){if(token===generation){getState().simulationVisualError=error.message;console.warn('Local simulation artwork:',error.message);}}finally{if(flight===job)flight=null;if(token===generation&&last?.revision!==revision)timer=setTimeout(paint,0);}}
  function update(model,url,revision,bulk=false,plan=model.plan){last={model,url,revision,bulk,plan};if(!flight){clearTimeout(timer);timer=setTimeout(paint,16);}}
  return {reset,update,installTiles,groundKeys:()=>[...grounds.keys()],clearGrounds:()=>grounds.clear(),get diagnostics(){return {...diagnostics,groundEntries:grounds.size,patches:patches.size};},get pending(){return !!flight||!!timer;},get progressivePending(){return !!flight?.progressive;}};
 }
 root.CrateSimulationVisual={create};
})(globalThis);
