/* Color-independent native frames. Decode only this map's object atlas pages. */
(function(root){
 'use strict';
 let pending=null;
 const convertedCache=new Map();
 const library=()=>pending||(pending=root.CrateMapPlatform.readJSON('live/objects/index.json.gz?v='+root.CrateWebConfig.liveVersion).then(v=>{if(v.version!==1)throw Error('Unsupported object materials');return v;}).catch(e=>{pending=null;throw e;}));
 function hsv(h,s,v){const f=(n,k=(n+h*6)%6)=>v-v*s*Math.max(0,Math.min(k,4-k,1));return[f(5),f(3),f(1)];}
 function stripes(color){
  if(color==='stripe-3-yellow-black-fixed')return [[255,212,0],[0,0,0]];
  if(!/^stripe-3-region-[0-9a-f]{6}$/.test(color))return null;
  const rgb=color.slice(-6).match(/../g).map(v=>parseInt(v,16));
  return [rgb.map(v=>Math.floor((v*72+255*28+50)/100)),rgb.map(v=>Math.floor((v*55+50)/100))];
 }
 function colors(record,color,step=31){const [original,remap,voxel]=record,result=original.map(c=>c.slice());if(remap&&color){const values=color.split(',').map(v=>parseInt(v,10)/255);if(stripes(color)){for(let i=16;i<32;i++)result[i]=[Math.max(...original[i]),0,0];}else if(values.length>=3&&values.slice(0,3).every(Number.isFinite)){const[h,s,v]=values;for(let i=16;i<32;i++){const shade=Math.max(...original[i])/255;result[i]=hsv(h,s,Math.min(1,v*shade)).map(c=>Math.round(c*255));}}}if(voxel&&step!==31)for(let i=1;i<256;i++)if(i<240||i===255)result[i]=result[i].map(c=>Math.min(255,Math.floor(c*step/31)));return result;}
 function key(meta){const a=JSON.parse(meta.key);a.length=7;a[2]='';if(a[0]!=='INFANTRY')a[4]=Math.floor(a[4]/8)*8;return JSON.stringify(a);}
 // An implicit building barrel can be <type>barl even for identical Image/rules.
 const identity=meta=>JSON.stringify([meta.key,meta.type]);
 const compose=(lib,name,meta)=>root.CrateToyComponents?.compose(lib,name,meta);
 async function prepare(report,needed,{signal,baseLibrary}={}){
  const metas=(report.rendering.visualObjects||[]).filter(needed);if(!metas.length)return {get:()=>undefined,pages:0};
  const lib=await library();signal?.throwIfAborted();const name=report.metadata.version+'/'+report.metadata.theater,scope=lib.scopes[name]||{},invariant=lib.invariant?.[name]||{},recipes=new Map(),pages=new Set(),images=new Map(),converted=convertedCache,result=new Map();
  for(const meta of metas){const token=identity(meta),signature=JSON.parse(meta.key),image=signature[1][0];if(['NONE','<NONE>'].includes(image)){recipes.set(token,[meta.key,[]]);continue;}let refs=compose(lib,name,meta);if(refs===undefined){const canonical=key(meta),old=invariant[canonical];if(old!==undefined){result.set(token,{originalRefs:baseLibrary.refs[old]});continue;}const id=scope[canonical];if(id===undefined)continue;refs=lib.refs[id];}recipes.set(token,[meta.key,refs]);for(const r of refs)pages.add(lib.assets[r[0]][0]);}
  const list=[...pages];let next=0;
  await Promise.all(Array.from({length:Math.min(4,list.length)},async()=>{while(next<list.length){signal?.throwIfAborted();const id=list[next++],a=lib.atlases[id];images.set(id,await root.CrateToyOriginal.page(new URL('live/objects/'+a.file,document.baseURI).href,a));}}));
  let count=0;
  for(const[token,[signature,refs]]of recipes){const fields=JSON.parse(signature),color=fields[2],step=fields[7]??31,parts=[];
   for(const[id,x,y,palette,opacity,shadow=0]of refs){const pattern=lib.palettes[palette][1]&&stripes(color),patterned=!!pattern,phase=patterned?[(Math.round(x)%6+6)%6,(Math.round(y)%6+6)%6]:[0,0],token=JSON.stringify([id,palette,lib.palettes[palette][1]?color:'',opacity,lib.palettes[palette][2]?step:31,phase]);let image=converted.get(token);
    if(!image){const a=lib.assets[id];image=root.CrateToyOriginal.canvas(a[3],a[4]);const ctx=image.getContext('2d',{willReadFrequently:true});ctx.drawImage(images.get(a[0]),a[1],a[2],a[3],a[4],0,0,a[3],a[4]);const pixels=ctx.getImageData(0,0,a[3],a[4]),c=colors(lib.palettes[palette],color,step);for(let i=0;i<pixels.data.length;i+=4){const index=pixels.data[i],pixel=i/4,black=Math.floor((pixel%a[3]+phase[0]+Math.floor(pixel/a[3])+phase[1])/3)%2,rgb=patterned&&index>=16&&index<32?pattern[black]:c[index];pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];pixels.data[i+3]=index?opacity:0;}ctx.putImageData(pixels,0,0);converted.set(token,image);}
    parts.push({id:token,image,x,y,shadow:!!shadow});
   }
   result.set(token,parts);if(++count%32===0){await new Promise(r=>setTimeout(r,0));signal?.throwIfAborted();}
  }
  while(convertedCache.size>512)convertedCache.delete(convertedCache.keys().next().value);
  return {get:meta=>result.get(identity(meta)),pages:pages.size};
 }
 async function preview(source,choice,level,color=''){
  const lib=await library(),cfg=source.rules[choice.type]||{},art=source.art[(cfg.IMAGE||choice.type).toUpperCase()]||{},yes=v=>/^(yes|true|1)$/i.test(String(v)),category=choice.category;
  const signature=[category,lib.visualFields.map(k=>String(cfg[k]??(k==='IMAGE'?choice.type:'')).toUpperCase()),color?'stripe-3-region-'+color:'stripe-3-yellow-black-fixed',2,category==='INFANTRY'?2:category==='STRUCTURES'&&!yes(cfg.TURRET)?0:64,'',[]];
  if(category==='UNITS'&&yes(art.VOXEL)||category==='STRUCTURES'&&yes(cfg.TURRET)&&cfg.TURRETANIM&&yes(cfg.TURRETANIMISVOXEL)){
   const light=source.map.LIGHTING||{},finite=(o,k,d)=>{const s=String(o[k]??d).split(';')[0].trim(),n=s?Number(s):NaN;return Number.isFinite(n)?n:d;},intensity=finite(light,'AMBIENT',1)-finite(light,'GROUND',0)+finite(light,'LEVEL',0)*level+(category==='UNITS'?finite(source.rules.AUDIOVISUAL||{},'EXTRAUNITLIGHT',0):0),shade=Math.min(254,(261*Math.trunc(Math.max(0,Math.min(2,intensity))*1000))>>11);
   signature.push(Math.min(62,Math.trunc(127*shade*62/32258)));
  }
  const meta={type:choice.type,category,key:JSON.stringify(signature)},baseLibrary=await root.CrateLiveArtwork.catalog(),report={metadata:{version:source.version,theater:source.map.MAP.THEATER.toUpperCase()},rendering:{visualObjects:[meta]}};
  const prepared=await prepare(report,()=>true,{baseLibrary});let parts=prepared.get(meta);
  if(parts?.originalRefs)parts=await Promise.all(parts.originalRefs.map(async([id,x,y])=>{const a=baseLibrary.assets[id],atlas=baseLibrary.atlases[a[0]],page=await root.CrateToyOriginal.page(new URL('art/'+atlas.file,document.baseURI).href,atlas),image=root.CrateToyOriginal.canvas(a[3],a[4]);image.getContext('2d').drawImage(page,a[1],a[2],a[3],a[4],0,0,a[3],a[4]);return{image,x,y};}));
  parts=parts?.filter(p=>!p.shadow);if(!parts?.length)throw Error('该对象没有可显示的素材');
  const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y)),image=root.CrateToyOriginal.canvas(Math.max(...parts.map(p=>p.x+p.image.width))-x,Math.max(...parts.map(p=>p.y+p.image.height))-y),ctx=image.getContext('2d');
  for(const p of parts)ctx.drawImage(p.image,p.x-x,p.y-y);return{image,x,y};
 }
 root.CrateLiveObjects={prepare,colors,key,preview};
})(globalThis);
