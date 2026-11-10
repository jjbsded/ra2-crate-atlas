/* Original atlas pixels projected onto the existing bounded 3D height model.
 * Geometry remains illustrative; probabilities and passability are unchanged. */
(function(root){
 'use strict';
 const O=()=>root.CrateToyOriginal,A=()=>root.CrateToyTerrain;
 const key=c=>`${c.x},${c.y}`,edges=[[0,-1],[1,0],[0,1],[-1,0]],corners=[[0,0],[1,0],[1,1],[0,1]],high=new Set(['BRIDGE1','BRIDGE2','BRIDGEB1','BRIDGEB2']),variation=[0,1,2,3,3,2,1,0,2,3,0,1,1,0,3,2];
 const h=(c,u,v)=>{const[a,b,d,e]=c;return a*(1-u)*(1-v)+b*u*(1-v)+d*u*v+e*(1-u)*v;};
 const frame=c=>c.overlayData+(high.has(c.overlayName)&&[0,9].includes(c.overlayData)?variation[(c.x&3)|((c.y&3)<<2)]:0);
 async function patch(report,selected,{radius=10,signal}={}){
  const scene=O()?.get(report,{optional:true});
  if(!scene)return root.CrateToyTerrain3D.patch(report,selected,{radius,signal});
  const lookup=new Map(report.cells.map(c=>[key(c),c])),textures={},sources=new Map(),tiles=new Map(),affected=new Map();
  const enabled=!report.metadata.previewOnly&&(!report.metadata.approximate||!!report.metadata.riskPredictionVersion);
  radius=Math.max(1,Math.min(15,Math.floor(Number(radius)||10)));
  for(const c of report.cells)for(const[x,y]of c.higher||[]){const k=`${x},${y}`;if(!affected.has(k))affected.set(k,[]);affected.get(k).push([c.x,c.y,c.level]);}
  function source(refs){
   const id=JSON.stringify(refs);if(sources.has(id))return sources.get(id);
   if(!refs.length){const image=O().canvas(1,1),value={image,left:0,top:0,w:1,h:1,pixels:new Uint8ClampedArray(4),rows:[]};sources.set(id,value);return value;}
   const left=Math.min(...refs.map(p=>p[1])),top=Math.min(...refs.map(p=>p[2])),right=Math.max(...refs.map(p=>p[1]+scene.data.assets[p[0]][3])),bottom=Math.max(...refs.map(p=>p[2]+scene.data.assets[p[0]][4]));
   const image=O().canvas(right-left,bottom-top),ctx=image.getContext('2d',{willReadFrequently:true});
   for(const ref of refs){const a=scene.data.assets[ref[0]];ctx.drawImage(scene.images[a[0]],a[1],a[2],a[3],a[4],ref[1]-left,ref[2]-top,a[3],a[4]);}
   const value={image,left,top,w:image.width,h:image.height,pixels:ctx.getImageData(0,0,image.width,image.height).data,rows:null};sources.set(id,value);return value;
  }
  function nearest(s,x,y){
   if(!s.rows){s.rows=[];for(let yy=0;yy<s.h;yy++){const row=[];for(let xx=0;xx<s.w;xx++)if(s.pixels[(yy*s.w+xx)*4+3])row.push(xx);if(row.length)s.rows.push([yy,row]);}}
   let best=Infinity,index=-1;
   for(const[yy,row]of s.rows){const dy=(yy-y)**2;if(dy>best)continue;let lo=0,hi=row.length;while(lo<hi){const mid=(lo+hi)>>1;if(row[mid]<x)lo=mid+1;else hi=mid;}for(const at of [lo-1,lo])if(at>=0&&at<row.length){const d=(row[at]-x)**2+dy;if(d<best){best=d;index=(yy*s.w+row[at])*4;}}}return index;
  }
  function sample(id,s,w,height,project,extend=true){
   if(textures[id])return id;
   const image=O().canvas(w,height),ctx=image.getContext('2d'),out=ctx.createImageData(w,height);
   for(let y=0;y<height;y++)for(let x=0;x<w;x++){
    const [px,py]=project((x+.5)/w,(y+.5)/height),xx=Math.floor(px-s.left),yy=Math.floor(py-s.top);
    let at=xx>=0&&xx<s.w&&yy>=0&&yy<s.h?(yy*s.w+xx)*4:-1;
    if((at<0||!s.pixels[at+3])&&extend)at=nearest(s,xx,yy);
    if(at>=0)out.data.set(s.pixels.subarray(at,at+4),(y*w+x)*4);
   }
   ctx.putImageData(out,0,0);textures[id]=image;return id;
  }
  const tileKey=c=>root.CrateTerrainVariants.file(c,scene.data.terrainVariants)+'/'+c.subTile;
  const refs=c=>scene.data.tiles[tileKey(c)]||[];
  const cells=[];
  for(let y=selected.y-radius;y<=selected.y+radius;y++)for(let x=selected.x-radius;x<=selected.x+radius;x++){
   const c=lookup.get(`${x},${y}`);if(!c)continue;
   const shape=A().ramps[c.slope]||A().ramps[0],parts=refs(c),id=tileKey(c);
   if(!tiles.has(id)){
    const base=source(c.slope?parts:parts.slice(0,1)),top=sample('top:'+id,base,64,64,(u,v)=>[30+30*(u-v),15*(u+v)-15*h(shape,u,v)]);
    let wall=null;if(parts.length>1&&!c.slope){const s=source(parts.slice(1));wall=sample('wall:'+id,s,64,96,(u,v)=>[s.left+u*s.w,s.top+v*s.h]);}
    tiles.set(id,{top,wall});
   }
   const tile=tiles.get(id),d={...c,corners:[...shape],texture:tile.top,wallTexture:tile.wall,walls:{},decorations:[],higher:(c.higher||[]).map(p=>[...p]),affected:(affected.get(key(c))||[]),canPlace:!!(enabled&&c.riskKnown!==false&&Number.isInteger(c.postLand)&&c.status==='crate'&&c.probability>0&&c.overlay===255&&!c.occupied)};
   for(const[name,overlay,f]of [[c.terrain,0,0],[c.overlayName,1,frame(c)]]){
    if(!name||high.has(name)||/^LOBRD[GB]/.test(name))continue;
    const ref=scene.data.sprites[`${overlay}/${name}/${f}`];if(!ref)continue;
    const id=`sprite:${overlay}/${name}/${f}`,s=source([ref]);
    if(overlay&&/^(TIB|GEM)\d+/.test(name))d.decorations.push({flat:true,texture:sample('flat:'+id,s,64,64,(u,v)=>[30*(u-v),15*(u+v-1-h(shape,u,v))],false)});
    else{textures[id]||=s.image;d.decorations.push({texture:id,width:s.w,height:s.h,offset:[s.left+s.w/2,s.top+s.h/2]});}
   }
   cells.push(d);
   if(cells.length%40===0){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
  }
  const local=new Map(cells.map(c=>[key(c),c])),walls=cells.filter(c=>c.wallTexture);
  for(const c of cells){
   if(!c.wallTexture&&walls.length){const nearby=walls.reduce((a,b)=>(b.x-c.x)**2+(b.y-c.y)**2<(a.x-c.x)**2+(a.y-c.y)**2?b:a);if(Math.max(Math.abs(nearby.x-c.x),Math.abs(nearby.y-c.y))<=3)c.wallTexture=nearby.wallTexture;}
   for(let edge=0;edge<4;edge++){
    const[dx,dy]=edges[edge],n=local.get(`${c.x+dx},${c.y+dy}`);if(!n)continue;const a=corners[edge],b=corners[(edge+1)%4];
    if(Math.max(...[a,b].map(([u,v])=>c.level+h(c.corners,u,v)-n.level-h(n.corners,u-dx,v-dy)))<=0)continue;
    const owner=[n,c].find(v=>refs(v).length>1&&!v.slope);if(!owner)continue;
    const s=source(refs(owner));c.walls[edge]=sample(`face:${key(c)}:${edge}`,s,64,96,(u,v)=>{const pu=a[0]+(b[0]-a[0])*u,pv=a[1]+(b[1]-a[1])*u,upper=c.level+h(c.corners,pu,pv),lower=Math.min(upper,n.level+h(n.corners,pu-dx,pv-dy)),level=upper*(1-v)+lower*v;return[30+30*(pu+c.x-owner.x-pv-c.y+owner.y),15*(pu+c.x-owner.x+pv+c.y-owner.y)-15*(level-owner.level)];});
   }
  }
  // Original bridge art can extend beyond its owner and movement flags. Sample
  // the entire SHP into all intersected world cells, as the desktop adapter does.
  const bridgeLayers=new Map();
  for(const c of report.cells.filter(c=>high.has(c.overlayName)||/^LOBRD[GB]/.test(c.overlayName||'')).sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x)){
   if(Math.abs(c.x-selected.x)>radius+7||Math.abs(c.y-selected.y)>radius+7)continue;
   const name=c.overlayName,f=frame(c),ref=scene.data.sprites[`1/${name}/${f}`];if(!ref)continue;
   const s=source([ref]),isHigh=high.has(name),level=c.level+(isHigh?4:0),span=isHigh?{axis:name.endsWith('2')?'x':'y',origin:name.endsWith('2')?c.x:c.y,minimum:-2,maximum:2}:null;
   for(const target of cells){if(Math.abs(target.x-c.x)>7||Math.abs(target.y-c.y)>7||(isHigh?target.level>level:target.level!==level))continue;
    const id=`bridge:${key(target)}:${isHigh}:${level}:${span?.axis}:${span?.origin}`,shape=isHigh?[0,0,0,0]:target.corners;
    // Reject cells outside the projected sprite before allocating or sampling
    // 4096 pixels. Bilinear ramp projections reach their extrema at corners.
    const projected=corners.map(([u,v])=>[30*(target.x-c.x-target.y+c.y+u-v)-s.left,15*(target.x-c.x+target.y-c.y+u+v-1-(level-c.level)-h(shape,u,v))-s.top]);
    if(Math.max(...projected.map(p=>p[0]))<0||Math.min(...projected.map(p=>p[0]))>=s.w||Math.max(...projected.map(p=>p[1]))<0||Math.min(...projected.map(p=>p[1]))>=s.h)continue;
    const layer=O().canvas(64,64),ctx=layer.getContext('2d'),out=ctx.createImageData(64,64);let visible=false;
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){const u=(x+.5)/64,v=(y+.5)/64,dx=target.x-c.x,dy=target.y-c.y,px=Math.floor(30*(dx-dy+u-v)-s.left),py=Math.floor(15*(dx+dy+u+v-1-(level-c.level)-h(shape,u,v))-s.top);if(px>=0&&px<s.w&&py>=0&&py<s.h){const at=(py*s.w+px)*4;if(s.pixels[at+3]){out.data.set(s.pixels.subarray(at,at+4),(y*64+x)*4);visible=true;}}}
    if(!visible)continue;ctx.putImageData(out,0,0);
    if(!bridgeLayers.has(id)){bridgeLayers.set(id,{target,level,span,isHigh});textures[id]=layer;}else textures[id].getContext('2d').drawImage(layer,0,0);
   }
  }
  for(const[id,{target,level,span,isHigh}]of bridgeLayers){const rails=edges.flatMap(([dx,dy],edge)=>{const n=lookup.get(`${target.x+dx},${target.y+dy}`);return target.bridge&&!n?.bridge&&(!n||n.level<level)?[edge]:[];});target.decorations.push({flat:true,texture:id,bridge:isHigh?'high':'low',level,span,rails});}
  for(const[x,y,level,dx,dy,parts]of scene.data.objects){const c=local.get(`${x},${y}`);if(!c)continue;for(const ref of parts){const id='object:'+ref[0],s=source([ref]);textures[id]||=s.image;c.decorations.push({texture:id,width:s.w,height:s.h,offset:[s.left+s.w/2,s.top+s.h/2],anchor:{u:.5+dx/60+dy/30,v:.5-dx/60+dy/30,level}});}}
  signal?.throwIfAborted();
  // Pack projected flat surfaces for GPU batching; trees/buildings retain their
  // own billboard images. UV rectangles keep independent tile boundaries.
  const flat=new Set();for(const c of cells){flat.add(c.texture);if(c.wallTexture)flat.add(c.wallTexture);for(const id of Object.values(c.walls))flat.add(id);for(const d of c.decorations)if(d.flat)flat.add(d.texture);}
  const rects=new Map();let page=null,x=0,y=0,row=0,pageId=0;
  for(const id of flat){const im=textures[id];if(!im)continue;if(!page||y+im.height+2>1024){page=O().canvas(1024,1024);textures['flat-atlas:'+pageId++]=page;x=y=row=0;}
   if(x+im.width+2>1024){x=0;y+=row;row=0;if(y+im.height+2>1024){page=O().canvas(1024,1024);textures['flat-atlas:'+pageId++]=page;x=y=row=0;}}
   page.getContext('2d').drawImage(im,x+1,y+1);rects.set(id,{id:'flat-atlas:'+(pageId-1),rect:[(x+1)/1024,(y+1)/1024,im.width/1024,im.height/1024]});x+=im.width+2;row=Math.max(row,im.height+2);
  }
  for(const c of cells){for(const name of ['texture','wallTexture'])if(rects.has(c[name])){const v=rects.get(c[name]);c[name+'Rect']=v.rect;c[name]=v.id;}c.wallsRect={};for(const edge of Object.keys(c.walls)){const v=rects.get(c.walls[edge]);c.walls[edge]=v.id;c.wallsRect[edge]=v.rect;}for(const d of c.decorations)if(d.flat){const v=rects.get(d.texture);d.texture=v.id;d.textureRect=v.rect;}}
  for(const id of flat)delete textures[id];
  return {version:1,originalArt:true,batchStatic:true,center:[selected.x,selected.y],radius,cells,textures,metadata:{...report.metadata,predictionEnabled:enabled,relationsEnabled:true,missing:[],uniqueTiles:tiles.size,sourceDescription:root.CrateI18n.t('原版贴图 3D：复用当前地图的共享素材、原始高度和坡形；悬崖使用简化几何，对象使用静态贴图。概率与主图一致。')}};
 }
 root.CrateToyOriginal3D={patch};
})(globalThis);
