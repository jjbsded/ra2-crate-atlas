/* Color-independent native frames. Decode only this map's object atlas pages. */
(function(root){
 'use strict';
 let pending=null;
 const library=()=>pending||(pending=root.CrateMapPlatform.readJSON('live/objects/index.json.gz?v='+root.CrateWebConfig.liveVersion).then(v=>{if(v.version!==1)throw Error('Unsupported object materials');return v;}).catch(e=>{pending=null;throw e;}));
 function hsv(h,s,v){const f=(n,k=(n+h*6)%6)=>v-v*s*Math.max(0,Math.min(k,4-k,1));return[f(5),f(3),f(1)];}
 function colors(record,color,step=31){const [original,remap,voxel]=record,result=original.map(c=>c.slice());if(remap&&color){const values=color.split(',').map(v=>parseInt(v,10)/255);if(values.length>=3&&values.slice(0,3).every(Number.isFinite)){const[h,s,v]=values;for(let i=16;i<32;i++){const shade=Math.max(...original[i])/255;result[i]=hsv(h,s,Math.min(1,v*shade)).map(c=>Math.round(c*255));}}}if(voxel&&step!==31)for(let i=1;i<256;i++)if(i<240||i===255)result[i]=result[i].map(c=>Math.min(255,Math.floor(c*step/31)));return result;}
 function key(meta){const a=JSON.parse(meta.key);a.length=7;a[2]='';if(a[0]!=='INFANTRY')a[4]=Math.floor(a[4]/8)*8;return JSON.stringify(a);}
 async function prepare(report,needed,{signal,baseLibrary}={}){
  const metas=(report.rendering.visualObjects||[]).filter(needed);if(!metas.length)return {get:()=>undefined,pages:0};
  const lib=await library();signal?.throwIfAborted();const name=report.metadata.version+'/'+report.metadata.theater,scope=lib.scopes[name]||{},invariant=lib.invariant?.[name]||{},recipes=new Map(),pages=new Set(),images=new Map(),converted=new Map(),result=new Map();
  for(const meta of metas){const signature=JSON.parse(meta.key),image=signature[1][0];if(['NONE','<NONE>'].includes(image)){recipes.set(meta.key,[]);continue;}const canonical=key(meta),old=invariant[canonical];if(old!==undefined){result.set(meta.key,{originalRefs:baseLibrary.refs[old]});continue;}const id=scope[canonical];if(id===undefined)continue;const refs=lib.refs[id];recipes.set(meta.key,refs);for(const r of refs)pages.add(lib.assets[r[0]][0]);}
  const list=[...pages];let next=0;
  await Promise.all(Array.from({length:Math.min(4,list.length)},async()=>{while(next<list.length){signal?.throwIfAborted();const id=list[next++],a=lib.atlases[id];images.set(id,await root.CrateToyOriginal.page(new URL('live/objects/'+a.file,document.baseURI).href,a));}}));
  let count=0;
  for(const[signature,refs]of recipes){const fields=JSON.parse(signature),color=fields[2],step=fields[7]??31,parts=[];
   for(const[id,x,y,palette,opacity,shadow=0]of refs){const token=JSON.stringify([id,palette,lib.palettes[palette][1]?color:'',opacity,lib.palettes[palette][2]?step:31]);let image=converted.get(token);
    if(!image){const a=lib.assets[id];image=root.CrateToyOriginal.canvas(a[3],a[4]);const ctx=image.getContext('2d',{willReadFrequently:true});ctx.drawImage(images.get(a[0]),a[1],a[2],a[3],a[4],0,0,a[3],a[4]);const pixels=ctx.getImageData(0,0,a[3],a[4]),c=colors(lib.palettes[palette],color,step);for(let i=0;i<pixels.data.length;i+=4){const index=pixels.data[i],rgb=c[index];pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];pixels.data[i+3]=index?opacity:0;}ctx.putImageData(pixels,0,0);converted.set(token,image);}
    parts.push({id:token,image,x,y,shadow:!!shadow});
   }
   result.set(signature,parts);if(++count%32===0){await new Promise(r=>setTimeout(r,0));signal?.throwIfAborted();}
  }
  return {get:meta=>result.get(meta.key),pages:pages.size};
 }
 root.CrateLiveObjects={prepare,colors,key};
})(globalThis);
