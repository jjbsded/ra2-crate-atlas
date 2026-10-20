/* Presentation only: divide all exact final probabilities by the same direct-
 * only reference. Keep finite retries BEFORE averaging the shared random frame.
 * This preserves pairwise probability ratios, unlike dropping retries per frame.
 */
(function(root){
 'use strict';
 const cache=new WeakMap();
 const percentFormatter=new Intl.NumberFormat('zh-CN',{minimumSignificantDigits:2,maximumSignificantDigits:2,useGrouping:false});
 const percent=value=>value===0?'0%':percentFormatter.format(value*100)+'%';
 const ratio=(n,d)=>d?Number(n*10000000000000000n/d)/1e16:0;
 function decimal(value){
  const [a,e='0']=String(value).toLowerCase().split('e'),[i,f='']=a.split('.');
  let n=BigInt(i+f),d=1n,s=f.length-Number(e);if(s>=0)d=10n**BigInt(s);else n*=10n**BigInt(-s);return[n,d];
 }
 function fraction(n,d){
  if(!d)return {numerator:'0',denominator:'1'};
  let a=n,b=d;while(b){const r=a%b;a=b;b=r;}return{numerator:String(n/a),denominator:String(d/a)};
 }
 // Input/output are opacity (alpha), while the user control is transparency.
 function alpha(opacity,isBaseline){
  const a=Math.max(0,Math.min(1,opacity));return isBaseline?1-Math.sqrt(1-a):a;
 }
 function make(cells,numerator,denominator,baselineNumerator){
  const entries=new WeakMap(),thresholds=new Map(),shared=new Map();let maxMultiplier=0;
  for(const c of cells){const n=numerator(c);let v=shared.get(n);if(!v){v={numerator:n,multiplier:ratio(n,baselineNumerator),isBaseline:baselineNumerator>0n&&n===baselineNumerator};shared.set(n,v);}entries.set(c,v);maxMultiplier=Math.max(maxMultiplier,v.multiplier);}
  const get=c=>entries.get(c);
  const meetsThreshold=(c,minimum)=>{
   if(minimum<=0)return true;
   if(!baselineNumerator)return false;
   if(!thresholds.has(minimum)){const[n,d]=decimal(minimum);thresholds.set(minimum,[n*baselineNumerator,d]);if(thresholds.size>32)thresholds.delete(thresholds.keys().next().value);}
   const[a,b]=thresholds.get(minimum);return get(c).numerator*b>=a;
  };
  const cellAlpha=(c,options={})=>options.enabled===false||!get(c).numerator||!meetsThreshold(c,options.minMultiplier||0)?0:alpha(options.opacity??.55,get(c).isBaseline);
  const showLabel=(c,includeBaseline=false)=>get(c).numerator>0n&&(!get(c).isBaseline||includeBaseline);
  const metadata={mode:'relative-to-direct-only-final-probability',baselineProbability:ratio(baselineNumerator,denominator),baseline: fraction(baselineNumerator,denominator),baselineNumerator:String(baselineNumerator),maxMultiplier,formula:'relativeMultiplier = finalProbability / baselineProbability; equivalently exactCellNumerator / baselineNumerator',rawMultiplier:'Existing multiplier fields retain N * finalProbability for compatibility.'};
  return{get,meetsThreshold,cellAlpha,showLabel,maxMultiplier,baselineNumerator,baselineProbability:metadata.baselineProbability,metadata,
   exactFraction:c=>fraction(get(c).numerator,baselineNumerator),
   exportCell:c=>({relativeMultiplier:get(c).multiplier,isBaseline:get(c).isBaseline})};
 }
 function map(data){
  if(data.metadata?.previewOnly)return {get:()=>({multiplier:null,isBaseline:false}),meetsThreshold:()=>false,
   cellAlpha:()=>0,showLabel:()=>false,maxMultiplier:0,baselineProbability:0,metadata:{mode:'uncomputed'},
   exportCell:()=>({relativeMultiplier:null,isBaseline:false})};
  if(cache.has(data))return cache.get(data);
  const e=data.probability.exact,coeff=e.coefficients.map(c=>BigInt(c.numerator));
  // Sum one complete residue group to recover sum_f G(T(f)), even if n=1
  // is absent or an origin contains duplicate occurrences of its direct cell.
  const n=e.coefficients[0]?.n;
  const baseline=e.coefficients.reduce((sum,c,i)=>sum+(c.n===n?coeff[i]:0n),0n);
  const numerators=new Map();
  const v=make(data.cells,c=>{const key=JSON.stringify(c.terms);if(!numerators.has(key))numerators.set(key,c.terms.reduce((sum,[i,count])=>sum+coeff[i]*BigInt(count),0n));return numerators.get(key);},BigInt(e.denominator),baseline);
  cache.set(data,v);return v;
 }
 function demo(result){
  if(cache.has(result))return cache.get(result);
  const e=result.exact,N=BigInt(result.sampleCount),L=BigInt(result.limit),base=N**L;
  let baseline;
  if(result.frameDistribution){
   const groups=new Map();for(const f of result.frameDistribution.frameSummaries)groups.set(f.successCount,(groups.get(f.successCount)||0)+1);
   baseline=0n;for(const[S,count]of groups)if(S)baseline+=BigInt(count)*(base-(N-BigInt(S))**L)/BigInt(S);
  }else baseline=BigInt(e.perHitNumerator);
  const v=make(Object.values(result.cells),c=>result.frameDistribution?BigInt(c.exactNumerator):BigInt(c.hits)*BigInt(e.perHitNumerator),BigInt(e.denominator),baseline);
  cache.set(result,v);return v;
 }
 const api={map,demo,alpha,ratio,percent};if(typeof module!=='undefined')module.exports=api;root.CrateProbabilityDisplay=api;
})(typeof globalThis!=='undefined'?globalThis:this);
