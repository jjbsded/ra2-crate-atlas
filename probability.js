/* Exact enumeration for the demo's static flat world; no scripted retry points. */
(function(root){
 'use strict';
 const M=typeof module!=='undefined'?require('./model.js'):root.CrateModel;
 const I=typeof module!=='undefined'?require('./probability-index.js'):root.CrateProbabilityIndex;
 const FILTERS=['all','water','land'];
 const PALETTES=['multi','warm','cool'];
 const PALETTE_NAMES={multi:'多色',warm:'暖色',cool:'冷色'};
 const MAX_MULTIPLIER=(M.MAP.w+M.MAP.h-1)**2;
 const cache=new Map(),randomCache=new Map(),exactForCell=new WeakMap(),exactCache=new Map();
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 function fraction(numerator,denominator){
  let a=numerator,b=denominator;while(b){const r=a%b;a=b;b=r;}
  return {numerator:String(numerator/a),denominator:String(denominator/a)};
 }
 function decimalFraction(value){
  const [mantissa,exponent='0']=String(value).toLowerCase().split('e'),parts=mantissa.split('.');
  let n=BigInt(parts.join('')),d=1n,scale=(parts[1]?.length||0)-Number(exponent);
  if(scale>=0)d=10n**BigInt(scale);else n*=10n**BigInt(-scale);
  return [n,d];
 }
 function exactWeights(N,S,limit){
  const key=`${N}/${S}/${limit}`;if(exactCache.has(key))return exactCache.get(key);
  const denominator=BigInt(N)**BigInt(limit),failureNumerator=BigInt(N-S)**BigInt(limit);
  // (N^L - F^L) / (N-F) is the integer geometric sum. Keep even tiny F^L/N^L.
  const perHitNumerator=S?(denominator-failureNumerator)/BigInt(S):0n;
  const value={denominator,perHitNumerator,failureNumerator,multiplierPerHit:perHitNumerator*BigInt(N),thresholds:new Map()};
  if(exactCache.size>=32)exactCache.delete(exactCache.keys().next().value);exactCache.set(key,value);return value;
 }
 function meetsThreshold(cell,minimum){
  if(minimum<=0)return true;
  const exact=exactForCell.get(cell);if(!exact)return cell.multiplier>=minimum;
  if(exact.multiplierNumerator!==undefined){
   if(!exact.thresholds.has(minimum)){
    const [n,d]=decimalFraction(minimum);
    if(exact.thresholds.size>=16)exact.thresholds.delete(exact.thresholds.keys().next().value);
    exact.thresholds.set(minimum,exact.multiplierNumerator*d>=n*exact.denominator);
   }
   return exact.thresholds.get(minimum);
  }
  if(!exact.multiplierPerHit)return false;
  if(!exact.thresholds.has(minimum)){
   const [n,d]=decimalFraction(minimum),a=n*exact.denominator,b=d*exact.multiplierPerHit;
   if(exact.thresholds.size>=16)exact.thresholds.delete(exact.thresholds.keys().next().value);
   exact.thresholds.set(minimum,(a+b-1n)/b);
  }
  return BigInt(cell.hits)>=exact.thresholds.get(minimum);
 }
 // JSON stores one shared denominator, not thousands of repeated digit strings.
 function exactFraction(result,key,kind='probability'){
  if(!['probability','multiplier','oneAttemptProbability'].includes(kind))throw Error('无效概率字段');
  const cell=result.cells[key];if(!cell)throw Error('无效格子坐标');
  if(result.frameDistribution){
   if(kind==='oneAttemptProbability')return fraction(BigInt(cell.originFrameHits),BigInt(result.sampleCount)*BigInt(result.frameDistribution.period));
   return fraction(BigInt(cell.exactNumerator)*(kind==='multiplier'?BigInt(result.sampleCount):1n),BigInt(result.exact.denominator));
  }
  const hits=BigInt(cell.hits);
  if(kind==='oneAttemptProbability')return fraction(hits,BigInt(result.sampleCount));
  return fraction(hits*BigInt(result.exact.perHitNumerator)*(kind==='multiplier'?BigInt(result.sampleCount):1n),BigInt(result.exact.denominator));
 }
 function compute(world,frame=600,limit=1000){
  if(!Number.isSafeInteger(frame)||frame<0||frame>999999999)throw Error('无效逻辑帧');
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('无效重试上限');
  const signature=JSON.stringify([I.signature(world),frame,limit]);if(cache.has(signature))return cache.get(signature);
  const index=I.prepare(world),N=index.N,cells={};
  const {hits,origins,failures,successCount}=index.resolve(frame),exact=exactWeights(N,successCount,limit);
  index.cells.forEach((c,i)=>{const cell={...c,cell:[...c.cell],hits:hits[i]};cells[M.key(c.cell)]=cell;exactForCell.set(cell,exact);});
  const successPerAttempt=successCount/N,q=1-successPerAttempt;
  // Stable even when success is rare. A failed attempt leaves the map unchanged.
  const finalSuccess=successCount===0?0:successCount===N?1:-Math.expm1(limit*Math.log1p(-successPerAttempt));
  let maxMultiplier=0;
  for(const cell of Object.values(cells)){
   cell.oneAttemptProbability=cell.hits/N;
   cell.probability=successCount?cell.hits/successCount*finalSuccess:0;
   cell.multiplier=cell.probability*N;
   maxMultiplier=Math.max(maxMultiplier,cell.multiplier);
  }
  const result={worldId:world.id,frame,limit,sampleCount:N,baseline:1/N,successCount,failures,
   successPerAttempt,failedPerAttempt:q,finalSuccess,finalFailure:successCount?Math.pow(q,limit):1,maxMultiplier,
   method:'exhaustive-exact-rational',framePolicy:'fixed',
   exact:{representation:'shared-denominator',denominator:String(exact.denominator),perHitNumerator:String(exact.perHitNumerator),failureNumerator:String(exact.failureNumerator),
    probability:'cells[key].hits * perHitNumerator / denominator',multiplier:'cells[key].hits * perHitNumerator * sampleCount / denominator',finalFailure:'failureNumerator / denominator',
    note:'Decimal number fields are display approximations. These integer strings and hits define the exact finite-retry probabilities.'},
   scope:`全部 ${N} 个起点精确枚举；放箱前静态平地地图，固定逻辑帧；均匀独立起点模型；最多 ${limit} 轮；不是固定种子实机 RNG 分布`,cells,origins};
  if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(signature,result);return result;
 }
 function computeRandom(world,limit=1000){
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('无效重试上限');
  const signature=JSON.stringify([I.signature(world),limit]);if(randomCache.has(signature))return randomCache.get(signature);
  const index=I.prepare(world),N=index.N;
  // Uniform over a complete joint residue cycle, not a finite arbitrary frame
  // interval and not independent candidate choices for each origin/attempt.
  const period=index.candidateCounts.reduce((p,n)=>p/gcd(p,n)*n,1);
  if(period>100000)throw Error('该布局的联合帧周期过大；需要进一步优化精确平均，不能退化为随机抽样。');
  const groups=new Map(),frameSummaries=[],originFrameHits=new Uint32Array(N);
  let totalSuccess=0,totalOverlay=0,totalNoCandidate=0;
  for(let frame=0;frame<period;frame++){
   const r=index.resolve(frame),S=r.successCount;
   if(!groups.has(S))groups.set(S,{frames:0,hits:new Uint32Array(N)});
   const group=groups.get(S);group.frames++;
   for(let i=0;i<N;i++){group.hits[i]+=r.hits[i];originFrameHits[i]+=r.hits[i];}
   totalSuccess+=S;totalOverlay+=r.failures.overlay;totalNoCandidate+=r.failures['no-candidate'];
   frameSummaries.push({residue:frame,successCount:S,failures:r.failures});
  }
  const denominator=BigInt(period)*BigInt(N)**BigInt(limit),numerators=Array(N).fill(0n),probabilities=new Float64Array(N);
  let failureNumerator=0n,finalFailure=0,finalSuccess=0;
  // Group frames by S: the finite-retry geometric sum depends on S, not on c.
  // Average AFTER the fixed-frame retry calculation. Averaging S first is wrong.
  for(const [S,group] of groups){
   const exact=exactWeights(N,S,limit),success=S===0?0:S===N?1:-Math.expm1(limit*Math.log1p(-S/N));
   failureNumerator+=BigInt(group.frames)*exact.failureNumerator;
   finalFailure+=group.frames/period*Math.pow((N-S)/N,limit);finalSuccess+=group.frames/period*success;
   for(let i=0;i<N;i++)if(group.hits[i]){
    numerators[i]+=BigInt(group.hits[i])*exact.perHitNumerator;
    probabilities[i]+=group.hits[i]/period/S*success;
   }
  }
  const cells={};let maxMultiplier=0;
  index.cells.forEach((source,i)=>{
   const cell={...source,cell:[...source.cell],hits:originFrameHits[i]/period,originFrameHits:originFrameHits[i],
    oneAttemptProbability:originFrameHits[i]/(period*N),probability:probabilities[i],multiplier:probabilities[i]*N,exactNumerator:String(numerators[i])};
   cells[M.key(cell.cell)]=cell;maxMultiplier=Math.max(maxMultiplier,cell.multiplier);
   exactForCell.set(cell,{denominator,multiplierNumerator:numerators[i]*BigInt(N),thresholds:new Map()});
  });
  const successCount=totalSuccess/period;
  const result={worldId:world.id,frame:null,framePolicy:'uniform-cycle',limit,sampleCount:N,baseline:1/N,
   successCount,successCountRange:[Math.min(...groups.keys()),Math.max(...groups.keys())],failures:{overlay:totalOverlay/period,'no-candidate':totalNoCandidate/period},
   successPerAttempt:totalSuccess/(period*N),failedPerAttempt:1-totalSuccess/(period*N),finalSuccess,finalFailure,maxMultiplier,
   method:'exhaustive-exact-rational-frame-average',
   frameDistribution:{type:'uniform-modulo-joint-period',period,candidateCounts:index.candidateCounts,weightPerResidue:{numerator:'1',denominator:String(period)},sharedWithinCall:true,frameSummaries},
   exact:{representation:'per-cell-numerators-shared-denominator',denominator:String(denominator),failureNumerator:String(failureNumerator),
    probability:'cells[key].exactNumerator / denominator',multiplier:'cells[key].exactNumerator * sampleCount / denominator',
    oneAttemptProbability:'cells[key].originFrameHits / (frameDistribution.period * sampleCount)',finalFailure:'failureNumerator / denominator',
    note:'Average fixed-frame finite-retry probabilities over all joint-period residues. Decimal fields, including hits and successCount, are display approximations / means.'},
   scope:`全部 ${N} 个起点 × ${period} 个等权帧余数精确平均；每次调用固定同一个帧至最多 ${limit} 轮结束；均匀独立起点、静态平地模型；不是实际游戏的时间或 PRNG 分布`,cells};
  if(randomCache.size>=8)randomCache.delete(randomCache.keys().next().value);randomCache.set(signature,result);return result;
 }
 function decorate(trace){
  if(trace.probability)return trace;
  trace.probability=computeRandom(trace.world);
  const duration=10,start=trace.duration;
  trace.steps.push({i:trace.steps.length,phase:'heatmap',title:'最终落点 · 概率倍率热力图',
   text:'1× = 仅直接抽中、无邻格转入的基准格。保留随机帧与最多 1000 轮重抽的精确概率，统一归一化倍率；格子之间的最终概率比例不变。',
   candidates:[],visits:[],start,end:start+duration,duration});
  trace.duration+=duration;return trace;
 }
 function matches(cell,filter){return filter==='all'||cell.inside&&(filter==='water'?cell.land==='Water':cell.land!=='Water');}
 function alpha(cell,options={}){
  const {enabled,opacity,filter,minMultiplier}=settings(options);
  if(!enabled||cell.multiplier<=0||!matches(cell,filter)||!meetsThreshold(cell,minMultiplier))return 0;
  return opacity;
 }
 const stops=[[0,[24,34,46]],[1,[44,119,167]],[2,[39,190,198]],[4,[116,211,151]],[8,[242,213,105]],[16,[247,145,79]],[32,[231,76,100]],[169,[217,119,237]]];
 const ramps={warm:[[0,[255,247,188]],[.35,[254,196,79]],[.7,[227,74,51]],[1,[128,0,38]]],cool:[[0,[235,249,255]],[.35,[158,202,225]],[.7,[49,130,189]],[1,[8,48,107]]]};
 function color(value,palette='multi',maximum=MAX_MULTIPLIER){
  const ramp=ramps[palette]||stops;
  const position=ramps[palette]?(maximum>0?Math.log1p(Math.max(0,value))/Math.log1p(maximum):0):value;
  let i=1;while(i<ramp.length-1&&position>ramp[i][0])i++;
  const [lo,a]=ramp[i-1],[hi,b]=ramp[i],fraction=ramps[palette]?(position-lo)/(hi-lo):(Math.log1p(position)-Math.log1p(lo))/(Math.log1p(hi)-Math.log1p(lo));
  const t=Math.max(0,Math.min(1,fraction));
  return '#'+a.map((v,k)=>Math.round(v+(b[k]-v)*t).toString(16).padStart(2,'0')).join('');
 }
 function legend(palette,maximum){return palette==='multi'?stops.map(s=>s[0]):Array.from({length:8},(_,i)=>Math.expm1(Math.log1p(Math.max(0,maximum))*i/7));}
 const format=value=>value===0?'0':value>=10?value.toFixed(1):value.toFixed(2).replace(/\.?0+$/,'');
 function settings(value={}){return {enabled:value.enabled!==false,showBaselineValues:value.showBaselineValues===true,showBlocked:value.showBlocked!==false,opacity:typeof value.opacity==='number'&&Number.isFinite(value.opacity)?Math.max(0,Math.min(1,value.opacity)):.55,filter:FILTERS.includes(value.filter)?value.filter:'all',palette:PALETTES.includes(value.palette)?value.palette:'warm',minMultiplier:typeof value.minMultiplier==='number'&&Number.isFinite(value.minMultiplier)?Math.max(0,Math.min(MAX_MULTIPLIER,value.minMultiplier)):0};}
 function clearCache(){cache.clear();randomCache.clear();exactCache.clear();I.clearCache();}
 const api={compute,computeRandom,decorate,exactFraction,meetsThreshold,clearCache,matches,alpha,color,legend,format,settings,FILTERS,PALETTES,PALETTE_NAMES,MAX_MULTIPLIER};
 if(typeof module!=='undefined')module.exports=api;root.CrateProbability=api;
})(typeof globalThis!=='undefined'?globalThis:this);
