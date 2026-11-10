/* Display exact final probabilities against the direct-only final reference. */
(function(root){
 'use strict';
 const cache=new WeakMap(),weighted=new WeakMap();
 const percentFormatter=new Intl.NumberFormat('zh-CN',{minimumSignificantDigits:2,maximumSignificantDigits:2,useGrouping:false});
 const percent=value=>value===0?'0%':percentFormatter.format(value*100)+'%';
 const finite=root.CrateFiniteRetry||(typeof require==='function'?require('./finite-retry.js'):null);
 const ratio=(n,d)=>d?Number(finite?.divide?finite.divide(n*10000000000000000n,d):n*10000000000000000n/d)/1e16:0;
 function decimal(value){
  const [a,e='0']=String(value).toLowerCase().split('e'),[i,f='']=a.split('.');
  let n=BigInt(i+f),d=1n,s=f.length-Number(e);if(s>=0)d=10n**BigInt(s);else n*=10n**BigInt(-s);return[n,d];
 }
 function fraction(n,d){
  if(!d)return {numerator:'0',denominator:'1'};
  let a=n,b=d;while(b){const r=a%b;a=b;b=r;}return{numerator:String(n/a),denominator:String(d/a)};
 }
 function lazyFraction(n,d){let value;return()=>value||=(fraction(n,d));}
 // Input/output are opacity (alpha), while the user control is transparency.
 function alpha(opacity,isBaseline,baselineFactor=.5){
  const a=Math.max(0,Math.min(1,opacity));if(!isBaseline)return a;
  const factor=Number.isFinite(baselineFactor)&&baselineFactor>=0?baselineFactor:.5;
  if(factor===0)return 0;if(factor===1)return a;
  return factor===.5?1-Math.sqrt(1-a):1-Math.pow(1-a,factor);
 }
 function* makeSteps(cells,numerator,denominator,baselineNumerator,reuse=null,maximum=0){
  const entries=reuse?._entries||new WeakMap(),thresholds=new Map(),shared=reuse?._shared||new Map();let maxMultiplier=maximum;
  let count=0;
  for(const c of cells){let v=entries.get(c);if(!v){const n=numerator(c);v=shared.get(n);if(!v){v={numerator:n,multiplier:ratio(n,baselineNumerator),isBaseline:baselineNumerator>0n&&n===baselineNumerator};shared.set(n,v);}entries.set(c,v);}maxMultiplier=Math.max(maxMultiplier,v.multiplier);if(++count%128===0)yield;}
  const outside={numerator:0n,multiplier:0,isBaseline:false};
  const get=c=>c?.virtual?outside:entries.get(c);
  const meetsThreshold=(c,minimum)=>{
   if(minimum<=0)return true;
   if(!baselineNumerator)return false;
   if(!thresholds.has(minimum)){const[n,d]=decimal(minimum);thresholds.set(minimum,[n*baselineNumerator,d]);if(thresholds.size>32)thresholds.delete(thresholds.keys().next().value);}
   const[a,b]=thresholds.get(minimum);return get(c).numerator*b>=a;
  };
  const cellAlpha=(c,options={})=>options.enabled===false||!get(c).numerator&&!options.includeZero||!meetsThreshold(c,options.minMultiplier||0)?0:options.opaque?1:alpha(options.opacity??.55,get(c).isBaseline,options.baselineFactor);
  const showLabel=(c,includeBaseline=false,includeZero=false)=>(includeZero||get(c).numerator>0n)&&(!get(c).isBaseline||includeBaseline);
  const metadata={mode:'relative-to-direct-only-final-probability',baselineProbability:reuse?.metadata.baselineProbability??ratio(baselineNumerator,denominator),baselineNumerator:reuse?.metadata.baselineNumerator||String(baselineNumerator),maxMultiplier,formula:'relativeMultiplier = finalProbability / baselineProbability; equivalently exactCellNumerator / baselineNumerator',rawMultiplier:'Existing multiplier fields retain N * finalProbability for compatibility.'};
  // Reducing a many-thousand-digit fraction is an export operation. Rendering
  // and edits only need its numeric baseline; keep the exact metadata lazy.
  const baselineFraction=reuse?._baselineFraction||lazyFraction(baselineNumerator,denominator);
  Object.defineProperty(metadata,'baseline',{enumerable:true,configurable:true,get:baselineFraction});
  return{_baselineFraction:baselineFraction,_entries:entries,_shared:shared,get,meetsThreshold,cellAlpha,showLabel,maxMultiplier,baselineNumerator,baselineProbability:metadata.baselineProbability,metadata,
   exactFraction:c=>fraction(get(c).numerator,baselineNumerator),
   exportCell:c=>({relativeMultiplier:get(c).multiplier,isBaseline:get(c).isBaseline})};
 }
 function drain(work){let step;do{step=work.next();}while(!step.done);return step.value;}
 const make=(...args)=>drain(makeSteps(...args));
 function* mapSteps(data,previous=null,changed=null,maximumNumerator=null){
  if(data.metadata?.previewOnly)return {get:()=>({multiplier:null,isBaseline:false}),meetsThreshold:()=>false,
   cellAlpha:()=>0,showLabel:()=>false,maxMultiplier:0,baselineProbability:0,metadata:{mode:'uncomputed'},
   exportCell:()=>({relativeMultiplier:null,isBaseline:false})};
  if(cache.has(data))return cache.get(data);
  const e=data.probability.exact,old=previous?._exact;
  const compatible=old&&(old===e||old.denominator===e.denominator&&old.coefficients.length===e.coefficients.length&&old.coefficients.every((c,i)=>c.n===e.coefficients[i].n&&c.r===e.coefficients[i].r&&c.numerator===e.coefficients[i].numerator));
  const prepared=weighted.get(data.probability);
  const coeff=compatible?previous._coeff:prepared?.coeff||e.coefficients.map(c=>BigInt(c.numerator));
  // Shared coefficients and baseline reduction are unchanged for local edits
  // using fixed candidate coefficients. Reuse these and unchanged cells.
  const n=e.coefficients[0]?.n;
  const baseline=compatible?previous.baselineNumerator:e.coefficients.reduce((sum,c,i)=>sum+(c.n===n?coeff[i]:0n),0n);
  const denominator=compatible?previous._denominator:prepared?.denominator||BigInt(e.denominator);
  const numerators=compatible?previous._numerators:prepared?.numerators||new Map();
  const local=compatible&&changed;
  const max=local?ratio(BigInt(maximumNumerator),baseline):0;
  const v=yield* makeSteps(local||data.cells,c=>{const key=JSON.stringify(c.terms);if(!numerators.has(key))numerators.set(key,c.terms.reduce((sum,[i,count])=>sum+coeff[i]*BigInt(count),0n));return numerators.get(key);},denominator,baseline,compatible?previous:null,max);
  v._exact=e;v._numerators=numerators;v._coeff=coeff;v._denominator=denominator;
  cache.set(data,v);return v;
 }
 const map=(...args)=>drain(mapSteps(...args));
 async function mapAsync(data,options={}){return cooperative(mapSteps(data),options);}
 function* reweightSteps(cells,probability){
  const F=root.CrateFiniteRetry||(typeof require==='function'?require('./finite-retry.js'):null),coeff=probability.exact.coefficients.map(c=>BigInt(c.numerator)),denominator=BigInt(probability.exact.denominator),N=BigInt(probability.sampleCount),shared=new Map(),numerators=new Map();
  const result=[];let count=0;
  for(const c of cells){const key=JSON.stringify(c.terms);let value=shared.get(key);if(!value){const numerator=c.terms.reduce((sum,[i,count])=>sum+coeff[i]*BigInt(count),0n);numerators.set(key,numerator);value={probability:F.ratio(numerator,denominator),multiplier:F.ratio(numerator*N,denominator)};shared.set(key,value);}result.push(c.probability===value.probability&&c.multiplier===value.multiplier?c:{...c,...value});if(++count%128===0)yield;}
  weighted.set(probability,{coeff,denominator,numerators});return result;
 }
 function reweight(cells,probability){const work=reweightSteps(cells,probability);let step;do{step=work.next();}while(!step.done);return step.value;}
 async function cooperative(work,{valid=()=>true,yieldToUI=()=>root.scheduler?.yield?root.scheduler.yield():root.scheduler?.postTask?root.scheduler.postTask(()=>{}):new Promise(r=>root.setTimeout(r,0)),now=()=>root.performance.now()}={}){
  let step;
  try{while(valid()){const start=now();do{step=work.next();if(step.done)return valid()?step.value:null;}while(now()-start<3);await yieldToUI();}return null;}
  finally{work.return();}
 }
 const reweightAsync=(cells,probability,options)=>cooperative(reweightSteps(cells,probability),options);
 function demo(result){
  if(cache.has(result))return cache.get(result);
  const e=result.exact,N=BigInt(result.sampleCount),L=BigInt(result.limit),base=N**L;
  const weight=S=>S?(base-(N-BigInt(S))**L)/BigInt(S):L*(N**(L-1n));
  const baseline=result.frameDistribution?result.frameDistribution.frameSummaries.reduce((sum,f)=>sum+weight(f.successCount),0n):BigInt(e.perHitNumerator);
  const v=make(Object.values(result.cells),c=>result.frameDistribution?BigInt(c.exactNumerator):BigInt(c.hits)*BigInt(e.perHitNumerator),BigInt(e.denominator),baseline);
  cache.set(result,v);return v;
 }
 const api={map,mapAsync,reweight,reweightAsync,demo,alpha,ratio,percent};if(typeof module!=='undefined')module.exports=api;root.CrateProbabilityDisplay=api;
})(typeof globalThis!=='undefined'?globalThis:this);
