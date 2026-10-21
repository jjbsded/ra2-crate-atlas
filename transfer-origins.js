/* Reverse native search lists. Display P(destination | this search origin),
 * averaging the random frame. Retain finite-retry weights only for auditing
 * the original final probabilities; never redistribute failed placements. */
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
  const byDestination=new Map(),direct=new Map();let offset=0;
  for(let i=0;i<count;i++){
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
    if(!cell||cell.status!=='crate')continue;
    const weight=coefficients.get(n+','+r);
    if(weight===undefined)throw Error(_t('来源候选与概率结果不匹配'));
    if(target===y*512+x)direct.set(target,(direct.get(target)||0n)+weight);
    else {weights.set(target,(weights.get(target)||0n)+weight);hits.set(target,(hits.get(target)||0)+1);}
   }
   for(const[target,numerator]of weights)if(numerator>0n){
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
  return {directNumerator:cell=>direct.get(key(cell))||0n,get(cell){
   const entries=byDestination.get(key(cell))||[];
   if(!entries.length)return null;
   // Uniform frames give each candidate residue equal weight. Repeated
   // occurrences of the same destination count separately; failures remain
   // in the denominator, with no retry or success-only renormalization.
   const maximum=Math.max(...entries.map(c=>c.candidateHits/c.candidateCount));
   const total=entries.reduce((sum,c)=>sum+c.numerator,0n);
   const selected=exactNumerator(cell);
   return {key:key(cell),sources:entries.map(c=>({...c,strength:(c.candidateHits/c.candidateCount)/maximum,transferProbability:c.candidateHits/c.candidateCount,
     contributionProbability:D.ratio(c.numerator,denominator)})),
    contributionProbability:D.ratio(total,denominator),shareOfSelected:D.ratio(total,selected),maximumTransferProbability:maximum};
  }};
 }
 function style(strength){
  const t=Math.max(0,Math.min(1,strength));
  return {fill:`rgba(${Math.round(145-125*t)},${Math.round(236-75*t)},${Math.round(250-40*t)},${.24+.34*t})`,stroke:'#68e9ff'};
 }
 const api={create,key,style};root.CrateTransferOrigins=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
