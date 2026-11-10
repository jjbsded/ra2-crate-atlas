/* Forward/reverse native search lists. Conditional labels average random
 * frames and retain failed candidates. Final entity contributions still use
 * the backend coefficients; failed destinations contribute no entities. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const D=typeof module!=='undefined'?require('./probability-display.js'):root.CrateProbabilityDisplay;
 const key=c=>c.y*512+c.x;
 function create(data,buffer){
  const count=data.probability.sampleCount,maximum=Math.sqrt(count);
  if(!Number.isInteger(maximum)||maximum<1||maximum>510)throw Error(_t('来源坐标范围无效'));
  const view=new DataView(buffer),cells=new Map(data.cells.map(c=>[key(c),c]));
  const exact=data.probability.exact,denominator=BigInt(exact.denominator);
  const numerators=exact.coefficients.map(c=>BigInt(c.numerator));
  const coefficients=new Map(exact.coefficients.map((c,i)=>[c.n+','+c.r,numerators[i]]));
  const byDestination=new Map(),direct=new Map(),offsets=new Uint32Array(count);let offset=0;
  for(let i=0;i<count;i++){
   offsets[i]=offset;
   if(offset+4>view.byteLength)throw Error(_t('来源候选文件不完整'));
   const n=view.getUint32(offset,true);offset+=4;
   if(n>24||offset+4*n>view.byteLength)throw Error(_t('来源候选文件损坏'));
   const x=i%maximum+1,y=Math.floor(i/maximum)+1,origin=cells.get(y*512+x);
   // The actual search record is authoritative. Even a passable origin can
   // search outward when it belongs to the secondary projection group.
   // Failed placement/retry branches never appear as successful destinations.
   const reason=!origin?_t('地图外'):!origin.usable?_t('可用边界外'):origin.occupied?_t('对象占用'):origin.wall?_t('围墙'):!(origin.land===2?origin.float:origin.track)?_t('通行受阻'):origin.primary===false?_t('投影优先规则'):_t('附近搜索');
   const weights=new Map(),hits=new Map();
   for(let r=0;r<n;r++){
    const target=view.getUint32(offset+4*r,true),cell=cells.get(target);
    if(!cell)continue;
    const weight=cell.status==='crate'?coefficients.get(n+','+r):0n;
    if(weight===undefined)throw Error(_t('来源候选与概率结果不匹配'));
    if(target===y*512+x){if(cell.status==='crate')direct.set(target,(direct.get(target)||0n)+weight);}
    else {weights.set(target,(weights.get(target)||0n)+weight);hits.set(target,(hits.get(target)||0)+1);}
   }
   for(const[target,numerator]of weights){
    if(!byDestination.has(target))byDestination.set(target,[]);
    byDestination.get(target).push({x,y,level:origin?.level||0,cell:origin||null,reason,numerator,candidateHits:hits.get(target),candidateCount:n});
   }
   offset+=4*n;
  }
  if(offset!==view.byteLength)throw Error(_t('来源候选文件长度不符'));
  // Every entity probability must be explained by its own origin plus search
  // transfers. Check all destinations, including those with no transfers.
  const exactNumerator=cell=>cell.terms.reduce((sum,[id,hits])=>sum+numerators[id]*BigInt(hits),0n);
  for(const cell of data.cells)if(cell.status==='crate'){
   const k=key(cell),sum=(byDestination.get(k)||[]).reduce((s,c)=>s+c.numerator,direct.get(k)||0n);
   if(sum!==exactNumerator(cell))throw Error(_t('来源贡献与所选地图的概率结果不一致，请重新分析地图。'));
  }
  const results=new Map();let cachedSources=0;
  const lazy=(object,name,calculate)=>{let value;Object.defineProperty(object,name,{enumerable:true,get(){return value??=(calculate());}});};
  return {directNumerator:cell=>direct.get(key(cell))||0n,outgoing(cell){
   const {x,y}=cell;if(x<1||y<1||x>maximum||y>maximum)return null;
   const at=offsets[(y-1)*maximum+x-1],n=view.getUint32(at,true),hits=new Map();
   for(let r=0;r<n;r++){const target=view.getUint32(at+4+4*r,true);hits.set(target,(hits.get(target)||0)+1);}
   return {key:key(cell),candidateCount:n,retryHere:!n||hits.size===1&&hits.has(key(cell))&&cells.get(key(cell))?.status!=='crate',destinations:[...hits].map(([target,hits])=>({cell:cells.get(target),key:target,transferProbability:hits/n})).filter(v=>v.cell)};
  },get(cell){
   const target=key(cell);if(results.has(target)){const value=results.get(target);results.delete(target);results.set(target,value);return value;}
   const entries=byDestination.get(target)||[];
   if(!entries.length)return null;
   // Uniform frames give each candidate residue equal weight. Repeated
   // occurrences of the same destination count separately; failures remain
   // in the denominator, with no retry or success-only renormalization.
   const maximum=entries.reduce((best,c)=>Math.max(best,c.candidateHits/c.candidateCount),0);
   let total;const sum=()=>total??=(entries.reduce((n,c)=>n+c.numerator,0n));
   const result={key:target,sources:entries.map(c=>{
    const source={...c,strength:(c.candidateHits/c.candidateCount)/maximum,transferProbability:c.candidateHits/c.candidateCount};
    lazy(source,'contributionProbability',()=>D.ratio(c.numerator,denominator));return source;
   }),maximumTransferProbability:maximum};
   // Conditional source labels do not need thousands-digit final ratios.
   // Preserve those exact-derived API fields, calculating only when requested.
   lazy(result,'contributionProbability',()=>D.ratio(sum(),denominator));lazy(result,'shareOfSelected',()=>D.ratio(sum(),exactNumerator(cell)));
   results.set(target,result);cachedSources+=entries.length;
   while(results.size>16||cachedSources>32768&&results.size>1){const first=results.keys().next().value;cachedSources-=results.get(first).sources.length;results.delete(first);}
   return result;
  }};
 }
 function style(strength){
  const t=Math.max(0,Math.min(1,strength));
  return {fill:`rgba(${Math.round(145-125*t)},${Math.round(236-75*t)},${Math.round(250-40*t)},${.24+.34*t})`,stroke:'#68e9ff'};
 }
 const api={create,key,style};root.CrateTransferOrigins=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
