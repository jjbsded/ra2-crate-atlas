/* Exact spatial index for the demo's flat-map NearbyLocation model. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const M=typeof module!=='undefined'?require('./model.js'):root.CrateModel;
 const cache=new Map();
 function signature(world){return JSON.stringify([M.MAP,world]);}
 function remember(key,value){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
 function prepare(world){
  const key=signature(world);if(cache.has(key))return cache.get(key);
  const side=M.MAP.w+M.MAP.h-1,N=side*side,maxRadius=Math.min(M.MAP.w+M.MAP.h,32)-1;
  const cells=[],track=new Uint8Array(N),water=new Uint8Array(N),overlay=new Uint8Array(N);
  const id=(x,y)=>(x-1)*side+y-1;
  for(let x=1;x<=side;x++)for(let y=1;y<=side;y++){
   const c=[x,y],i=id(x,y);
   cells.push({cell:c,inside:M.inside(c),land:M.landType(c,world)});
   // Reuse the reference predicates, including occupied and Overlay distinctions.
   track[i]=+M.classify(c,world,'Track').ok;water[i]=+M.classify(c,world,'Float').ok;
   overlay[i]=+M.hasOverlay(c,world);
  }
  function distances(mask){
   const distance=new Int16Array(N).fill(-1),queue=new Uint32Array(N);let head=0,tail=0;
   for(let i=0;i<N;i++)if(mask[i]){distance[i]=0;queue[tail++]=i;}
   // All cells propagate, including water, obstacles and invalid map cells.
   // This computes Chebyshev distance, NOT movement/path connectivity.
   while(head<tail){
    const i=queue[head++],r=distance[i]+1;if(r>maxRadius)continue;
    const x=Math.floor(i/side),y=i%side;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
     const nx=x+dx,ny=y+dy;if(nx<0||nx>=side||ny<0||ny>=side)continue;
     const j=nx*side+ny;if(distance[j]>=0)continue;
     distance[j]=r;queue[tail++]=j;
    }
   }
   return distance;
  }
  const distance=[distances(track),distances(water)],masks=[track,water];
  const radii=new Int16Array(N),offsets=new Uint32Array(N+1),candidates=[];
  for(let i=0;i<N;i++){
   const speed=+(cells[i].land==='Water'),r=distance[speed][i],mask=masks[speed];
   radii[i]=r;offsets[i]=candidates.length;if(r<0)continue;
   const [x,y]=cells[i].cell;
   // Empty inner rings cannot affect selection. Scan the first nonempty ring
   // in the reference order; retain r=0 duplicates and the 24-record cutoff.
   for(const [cx,cy] of M.ring([x,y],r)){
    if(cx>=1&&cx<=side&&cy>=1&&cy<=side&&mask[id(cx,cy)])candidates.push(id(cx,cy));
    if(candidates.length-offsets[i]===24)break;
   }
   if(candidates.length===offsets[i])throw Error(_t('距离索引与候选环不一致'));
  }
  offsets[N]=candidates.length;
  const packed=Uint32Array.from(candidates);
  const candidateCounts=[...new Set(Array.from({length:N},(_,i)=>offsets[i+1]-offsets[i]).filter(Boolean))].sort((a,b)=>a-b);
  return remember(key,{key,side,N,maxRadius,cells,candidateCounts,resolve(frame){
   const hits=new Uint32Array(N),origins=[],failures={overlay:0,'no-candidate':0};let successCount=0;
   for(let i=0;i<N;i++){
    const start=offsets[i],count=offsets[i+1]-start,speed=M.speedFor(cells[i].land);
    if(!count){origins.push({origin:[...cells[i].cell],selected:null,speed,success:false,failure:'no-candidate'});failures['no-candidate']++;continue;}
    const target=packed[start+frame%count],failed=!!overlay[target];
    origins.push({origin:[...cells[i].cell],selected:[...cells[target].cell],radius:radii[i],speed,success:!failed,failure:failed?'overlay':null});
    if(failed)failures.overlay++;else{hits[target]++;successCount++;}
   }
   return {hits,origins,failures,successCount};
  }});
 }
 const api={prepare,signature,clearCache:()=>cache.clear()};
 if(typeof module!=='undefined')module.exports=api;root.CrateProbabilityIndex=api;
})(typeof globalThis!=='undefined'?globalThis:this);
