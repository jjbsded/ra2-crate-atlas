/* Mixed custom-map artwork. Reuse only matching bundled pixels; absence is local
 * to a tile/sprite/object, never a reason to replace the whole map with symbols. */
(function(root){
 'use strict';
 const O=()=>root.CrateToyOriginal,A=()=>root.CrateToyTerrain,B=()=>root.CrateToySymbols;
 const high=new Set(['BRIDGE1','BRIDGE2','BRIDGEB1','BRIDGEB2']),variation=[0,1,2,3,3,2,1,0,2,3,0,1,1,0,3,2];
 const frame=c=>c.overlayData+(high.has(c.overlayName)&&[0,9].includes(c.overlayData)?variation[(c.x&3)|((c.y&3)<<2)]:0),key=c=>`${c.x},${c.y}`;
 let library=null;
 const catalog=()=>library||(library=root.CrateMapPlatform.readJSON('live/materials.json.gz?v='+root.CrateWebConfig.liveVersion).then(v=>{if(v.version!==1)throw Error('Unsupported shared materials');return v;}).catch(e=>{library=null;throw e;}));
 async function create(report,{signal,preview=false}={}){
  const lib=await catalog();signal?.throwIfAborted();const manualSource={version:report.metadata.version,map:{MAP:{THEATER:report.metadata.theater}}};await root.CrateSimulationAssets.prepare(manualSource);
  const r=report.rendering,scope=lib.scopes[report.metadata.version+'/'+report.metadata.theater]||{tiles:{},sprites:{},objects:{}},origin=r.origin,lookup=new Map(report.cells.map(c=>[key(c),c])),palette=A().palettes[report.metadata.theater]||A().palettes.TEMPERATE;
  const data={size:[r.width,r.height],assets:lib.assets.slice(),atlases:lib.atlases,tiles:{},terrainVariants:scope.terrainVariants||{},sprites:{},objects:[]},images=new Array(lib.atlases.length),needed=new Set(),events=[],generated=new Map(),missingBridges=new Set();
  const stats={originalTiles:0,fallbackTiles:0,originalSprites:0,fallbackSprites:0,originalObjects:0,fallbackObjects:0,atlasPages:0},missing=new Set();
  const resolve=(type,k)=>{const id=scope[type][k];return id===null?null:Number.isInteger(id)&&typeof id==='number'?lib.refs[id]:undefined;};
  const use=ref=>{if(ref&&data.assets[ref[0]][0]<lib.atlases.length)needed.add(data.assets[ref[0]][0]);return ref;};
  function generatedRef(id,left,top,w,h,paint){if(generated.has(id))return generated.get(id);const image=O().canvas(Math.max(1,Math.ceil(w)),Math.max(1,Math.ceil(h))),ctx=image.getContext('2d');ctx.translate(-left,-top);paint(ctx);const page=images.length;images.push(image);const ref=[data.assets.length,left,top];data.assets.push([page,0,0,image.width,image.height]);generated.set(id,ref);return ref;}
  function polygon(points,fill,id){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.floor(Math.min(...xs)),top=Math.floor(Math.min(...ys));return generatedRef(id,left,top,Math.max(...xs)-left+1,Math.max(...ys)-top+1,ctx=>B().polygon(ctx,points,fill));}
  function command(ref,x,y,depth,tie,objects=false,flags={}){if(!ref)return;use(ref);events.push({id:ref[0],x:Math.round(x+ref[1]),y:Math.round(y+ref[2]),depth,tie,objects,...flags});}
  function fallbackTile(c){
   const shape=A().ramps[c.slope]||A().ramps[0],points=[[30,-15*shape[0]],[60,15-15*shape[1]],[30,30-15*shape[2]],[0,15-15*shape[3]]],fill=c.terrainError?'#70677f':A().color(c,palette),id=`tile:${c.rawLand}:${c.slope}:${!!c.terrainError}`;
   return [generatedRef(id,0,-30,61,61,ctx=>{B().polygon(ctx,points,fill);})];
  }
  function symbol(kind,scale=1){return generatedRef('symbol:'+kind+':'+scale,-20*scale,-48*scale,40*scale,54*scale,ctx=>B().symbol(ctx,kind,0,0,scale));}
  function fallbackSprite(c,overlay){
   const name=overlay?c.overlayName:c.terrain;
   if(overlay&&/^(TIB|GEM)\d+/.test(name)){const gem=name.startsWith('GEM');return generatedRef('mineral:'+gem,-18,-12,36,26,ctx=>{for(const[x,y]of [[-10,0],[1,-4],[10,1],[-1,5]])B().polygon(ctx,[[x-3,y],[x,y-3],[x+3,y],[x,y+2]],gem?'#a778b6':'#d7ae4d');});}
   return symbol(!overlay&&/^TREE\d+$/.test(name)?'tree':/^TIBTRE/.test(name)?'drill':/ROCK/.test(name)?'rock':'scenery');
  }
  const coords=c=>[30*(c.x-c.y)+origin[0],15*(c.x+c.y-c.level)+origin[1]];
  const ordered=[...report.cells].sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x);
  for(let i=0;i<ordered.length;i++){
   const c=ordered[i],[cx,cy]=coords(c),depth=c.x+c.y,k=root.CrateTerrainVariants.file(c,data.terrainVariants)+'/'+c.subTile;let parts=c.terrainError?undefined:resolve('tiles',k);
   if(parts!==undefined){stats.originalTiles++;}else{stats.fallbackTiles++;missing.add('tile:'+k);parts=fallbackTile(c);
    const top=A().top(c,[0,0]),h=A().ramps[c.slope]||A().ramps[0];
    for(const[e,dx,dy,a,b]of [[1,1,0,0,3],[2,0,1,1,0]]){const n=lookup.get(`${c.x+dx},${c.y+dy}`),nh=A().ramps[n?.slope]||A().ramps[0],j=(e+1)%4,da=Math.max(0,c.level+h[e]-(n?n.level+nh[a]:0))*15,db=Math.max(0,c.level+h[j]-(n?n.level+nh[b]:0))*15;
     if(da||db){const xy=top.map(p=>[p[0]-30*(c.x-c.y),p[1]-15*(c.x+c.y-c.level)]),face=[xy[e],xy[j],[xy[j][0],xy[j][1]+db],[xy[e][0],xy[e][1]+da]];command(polygon(face,palette[e===1?2:3],`face:${c.slope}:${e}:${da}:${db}`),cx,cy,depth+.01,c.x,false,{terrain:true,level:c.level});}
    }
   }
   data.tiles[k]=parts||[];for(const [i,ref] of (parts||[]).entries())command(ref,cx-30,cy-15,depth,c.x,false,{terrain:true,receiver:!i||!!c.slope,level:c.level});
   for(const overlay of [true,false]){const name=overlay?c.overlayName:c.terrain;if(!name||overlay&&name==='RUBBLE_OVERLAY')continue;const sk=`${+overlay}/${name}/${overlay?frame(c):0}`,bridge=overlay&&(high.has(name)||/^LOBRD[GB]/.test(name));const signature=r.spriteSignatures?.[name]||[];let ref=resolve('sprites',JSON.stringify([+overlay,signature[0],overlay?frame(c):0,signature,high.has(name)?name:'']));
    if(overlay?c.simulationOverlay:c.simulationTerrain){const art=await root.CrateSimulationAssets.get(manualSource,{type:name},{frame:overlay?frame(c):0});if(art)ref=generatedRef('manual:'+sk,art.x,art.y,art.image.width,art.image.height,ctx=>ctx.drawImage(art.image,art.x,art.y));}
    if(ref!==undefined){stats.originalSprites++;data.sprites[sk]=ref;}
    else{stats.fallbackSprites++;missing.add('sprite:'+sk);if(bridge){missingBridges.add(key(c));continue;}ref=fallbackSprite(c,overlay);data.sprites[sk]=ref;}
    command(ref,cx,cy,depth+(bridge?-1.8:overlay?.2:.3),c.x,false,{solid:!bridge&&!(overlay&&/^(TIB|GEM)\d+/.test(name)),stencil:bridge?(high.has(name)?128|Math.min(127,c.level+4):Math.min(127,c.level+3)):0});
   }
   if(i%512===0){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
  }
  for(const c of report.cells){if(!c.bridge)continue;const owner=c.bridge.kind==='high'?c.bridge.owner:[c.x,c.y];if(!missingBridges.has(owner.join(',')))continue;
   const level=c.bridge.deckLevel??c.level,[cx,cy]=coords({...c,level});command(polygon([[0,-15],[30,0],[0,15],[-30,0]],'#6c797e','bridge-deck'),cx,cy,c.x+c.y+.4,c.x,false,{stencil:128|Math.min(127,level)});
  }
  const voxel=meta=>meta&&JSON.parse(meta.key).length>7;
  const stockObjects=await root.CrateLiveObjects.prepare(report,meta=>voxel(meta)||resolve('objects',meta.key)===undefined,{signal,baseLibrary:lib});
  for(let i=0;i<(r.simplified?.objects||[]).length;i++){
   const [x,y,level,kind,w,h,subcell]=r.simplified.objects[i],meta=r.visualObjects?.[i],c=lookup.get(`${x},${y}`);if(!c)continue;
   let refs=meta?resolve('objects',meta.key):undefined,dx=0,dy=0,depth=x+y+.6;
   if((refs===undefined||voxel(meta))&&meta){const parts=stockObjects.get(meta);if(parts!==undefined)refs=parts.originalRefs||parts.map(p=>{const key='stock:'+p.id;if(!generated.has(key)){const page=images.length;images.push(p.image);const id=data.assets.length;data.assets.push([page,0,0,p.image.width,p.image.height]);generated.set(key,[id,0,0]);}return [generated.get(key)[0],p.x,p.y,p.shadow?1:0];});}
   if(refs!==undefined){stats.originalObjects++;if(meta.category==='INFANTRY'){[dx,dy]=({2:[15,0],3:[-15,0],4:[0,7]})[subcell]||[0,0];depth+=dy/15;}if(meta.category==='STRUCTURES')depth+=w+h-2;}
   else{stats.fallbackObjects++;missing.add('object:'+(meta?.type||kind));refs=[symbol(kind,Math.min(1.8,Math.max(1,(w+h)/3)))];dx=15*(w-h);dy=7.5*(w+h-2);depth+=w+h-2;}
   if(meta?.category==='STRUCTURES'&&JSON.parse(meta.key)[3]===0)depth=x+y+.2;
   data.objects.push([x,y,level,dx,dy,(refs||[]).filter(ref=>!ref[3]).map(ref=>ref.slice(0,3))]);const cx=30*(x-y)+origin[0]+dx,cy=15*(x+y-level)+origin[1]+dy;for(const ref of refs||[])command(ref,cx,cy,ref[3]?Infinity:depth,x,true,ref[3]?{shadow:true,level}:{solid:true,stencil:Math.min(127,level+2)});
  }
  const pages=[...needed];let next=0;await Promise.all(Array.from({length:Math.min(4,pages.length)},async()=>{while(next<pages.length){signal?.throwIfAborted();const n=pages[next++];images[n]=await O().page(new URL('art/'+lib.atlases[n].file,document.baseURI).href,lib.atlases[n]);}}));signal?.throwIfAborted();stats.atlasPages=pages.length;
  stats.atlasPages+=stockObjects.pages;
  events.sort((a,b)=>a.depth-b.depth||a.tie-b.tie);const scene={data,images,commands:events,layers:[events.flatMap((c,i)=>c.objects?[]:[i]),events.map((_,i)=>i)],report,missingBridges,hybrid:stats};
  scene.paint=root.CrateLivePainter.create(scene);scene.thumbnail=(layer,crop,size)=>root.CrateLiveRaster?.thumbnail(scene,layer,crop,size);scene.export=(...args)=>root.CrateLiveRaster?.export(scene,...args);O().register(report,scene);const im=O().makeSource(scene,0),objectImage=O().makeSource(scene,1);scene.im=im;scene.objectImage=objectImage;r.hybrid={...stats,missing:[...missing]};
  // The first overview used to perform a complete pixel replay inside draw().
  // Warm it off-thread before committing the report, using the same resolution.
  if(!preview&&root.CrateLiveRaster){
   const scale=Math.min(1,(root.matchMedia?.('(pointer:coarse)').matches?1280:2048)/Math.max(r.width,r.height));
   try{
    const overview=await root.CrateLiveRaster.overview(scene,Math.ceil(r.width*scale),Math.ceil(r.height*scale),scale);
    if(signal?.aborted){overview?.ground.close();overview?.objects.close();signal.throwIfAborted();}
    if(overview){im.setOverview(overview.ground);objectImage.setOverview(overview.objects);}
   }finally{root.CrateLiveRaster.release(scene);}
  }
  return {im,objectImage,renderTile:box=>root.CrateLiveRaster?.tile(scene,box),release:()=>root.CrateLiveRaster?.release(scene)};
 }
 async function patch(report,selected,options){
  const scene=O().get(report,{optional:true});
  if(!scene)return root.CrateToyTerrain3D.patch(report,selected,options);
  const result=await root.CrateToyOriginal3D.patch(report,selected,options);
  if(scene.missingBridges.size){const simple=root.CrateToyTerrain3D.patch(report,selected,options),lookup=new Map(simple.cells.map(c=>[key(c),c]));Object.assign(result.textures,simple.textures);
   for(const c of result.cells){if(!c.bridge)continue;const owner=c.bridge.kind==='high'?c.bridge.owner:[c.x,c.y];if(scene.missingBridges.has(owner.join(',')))c.decorations.push(...(lookup.get(key(c))?.decorations||[]).filter(d=>d.bridge));}
  }
  result.metadata.sourceDescription=root.CrateI18n.language==='en'?'Bundled original artwork; missing visual states use simplified shapes.':'优先使用包内原版素材；缺失的显示状态采用简绘外观。';result.hybrid={...scene.hybrid};return result;
 }
 root.CrateLiveArtwork={create,patch,catalog};
})(globalThis);
