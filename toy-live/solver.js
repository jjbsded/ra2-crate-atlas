/* Exact ordered nearby search and single-attempt probabilities.
 * Mirrors realmap-search.c / realmap_exact.py; no native runtime or sampling. */
(function(root){
 'use strict';
 const codec=root.CrateStaticCodec||(typeof require==='function'?require('../toy/static-codec.js'):null);
 const gcd=(a,b)=>b?gcd(b,a%b):a,lcm=(a,b)=>a/gcd(a,b)*b,add=(m,k,n)=>m.set(k,(m.get(k)||0)+n);
 const F=root.CrateFiniteRetry||(typeof require==='function'?require('../finite-retry.js'):null),MODEL=F.MODEL;
 function sumFloat(values){let hi=0,lo=0;for(const x of values){const t=hi+x;lo+=Math.abs(hi)>=Math.abs(x)?(hi-t)+x:(x-t)+hi;hi=t;}return hi+lo;}
 function search(grid,maximum,progress=()=>{}){const out=new Uint32Array(maximum*maximum*25),picked=new Uint32Array(24);let at=0;
  for(let sy=1;sy<=maximum;sy++){for(let sx=1;sx<=maximum;sx++){let count=0,primary=0;const movement=grid[sy*512+sx]&8?2:1;
   const consider=(x,y)=>{if(x<0||y<0||x>=512||y>=512||count===24)return;const id=y*512+x;if(!(grid[id]&movement))return;picked[count++]=id;if(grid[id]&4)primary++;};
   for(let r=0;r<Math.min(maximum+1,32);r++){for(let d=-r;d<=r&&count<24;d++){consider(sx+d,sy-r);consider(sx+d,sy+r);}for(let d=1-r;d<=r-1&&count<24;d++){consider(sx-r,sy+d);consider(sx+r,sy+d);}if(count===24||primary)break;}
   out[at++]=primary||count;for(let i=0;i<count;i++)if(!primary||(grid[picked[i]]&4))out[at++]=picked[i];
  }if(sy%24===0)progress('附近搜索 / Searching nearby cells',30+15*sy/maximum);}return out.slice(0,at);
 }
 function calculate(binary,cells,originCount,progress=()=>{},limit=F.LIMIT){
  const statuses=new Map(cells.map(c=>[c.y*512+c.x,c.status])),terms=new Map(),ghost=new Map(),counts=new Map(),terminal=new Map();let at=0,count=0;
  while(at<binary.length){const n=binary[at++];if(n>24||at+n>binary.length)throw Error('Invalid candidate records');count++;add(counts,n,1);for(let r=0;r<n;r++){const id=binary[at++],status=statuses.get(id),pair=n*32+r;if(status==='crate'){if(!terms.has(id))terms.set(id,new Map());add(terms.get(id),pair,1);}else if(status==='ghost')add(ghost,pair,1);if(status==='crate'||status==='ghost')add(terminal,pair,1);}}
  if(count!==originCount)throw Error('Origin count mismatch');return evaluate(terms,ghost,counts,originCount,counts.get(0)||0,progress,{},null,terminal,limit);
 }
 function evaluate(terms,ghostTerms,candidateCounts,originCount,noCandidate,progress=()=>{},cache={},dirty=null,terminal=null,limit=F.LIMIT){
  if(!terminal){terminal=new Map(ghostTerms);for(const hits of terms.values())for(const[pair,count]of hits)add(terminal,pair,count);}
  const key=JSON.stringify([originCount,limit,F.signature(terminal)]),reused=cache.key===key;
  progress('正在计算生成概率',55);
  if(!reused){for(const key of Object.keys(cache))delete cache[key];Object.assign(cache,{key,kernel:F.kernel(terminal,originCount,limit,progress),distributions:new Map()});}
  const k=cache.kernel,{denominator,values}=k,N=BigInt(originCount),{distributions}=cache;let local=reused&&dirty!==null&&!!cache.results;
  if(distributions.size>4096){distributions.clear();local=false;}
  const results=local?cache.results:new Map(),used=local?cache.used:new Map(),signatures=local?cache.signatures:new Map();
  for(const id of local?dirty:terms.keys()){
   if(signatures.has(id)){const old=signatures.get(id);add(used,old,-1);if(!used.get(old))used.delete(old);signatures.delete(id);}
   const hits=terms.get(id);if(!hits){results.delete(id);continue;}
   const sorted=[...hits].sort((a,b)=>a[0]-b[0]),signature=JSON.stringify(sorted);let result=distributions.get(signature);
   if(!result){const numerator=sorted.reduce((s,[pair,n])=>s+BigInt(n)*values.get(pair),0n),one=sumFloat(sorted.map(([pair,n])=>n/Math.floor(pair/32)))/originCount;result={numerator,fields:{probability:codec.ratio(numerator,denominator),multiplier:codec.ratio(numerator*N,denominator),terms:sorted.map(([pair,n])=>[F.ids.get(pair),n]),oneAttemptProbability:one}};distributions.set(signature,result);}
   add(used,signature,1);signatures.set(id,signature);results.set(id,{...result.fields});
  }
  Object.assign(cache,{results,used,signatures,coefficientsReused:reused,evaluatedDestinations:local?dirty.size:terms.size});
  let total=0n,ghost=0n,maxMultiplier=0;for(const[signature,count]of used){const result=distributions.get(signature);total+=result.numerator*BigInt(count);maxMultiplier=Math.max(maxMultiplier,result.fields.multiplier);}for(const[pair,hits]of ghostTerms)ghost+=BigInt(hits)*values.get(pair);
  const failure=k.exhausted+ghost;if(total+failure!==denominator)throw Error('Exact retry probability conservation failed');
  const counts=[...candidateCounts].filter(([n,count])=>n&&count).map(([n])=>n).sort((a,b)=>a-b);
  return{results:new Map(results),probability:{model:MODEL,sampleCount:originCount,attemptLimit:limit,framePolicy:'uniform-cycle',period:counts.reduce(lcm,1),coefficientPeriod:F.PERIOD,weightPeriod:k.reduced,method:k.method,candidateCounts:counts,terminalCountRange:k.terminalCountRange,noCandidateOrigins:noCandidate,positiveCellCount:results.size,sharedDistributionCount:used.size,maxMultiplier,finalSuccess:codec.ratio(total,denominator),finalFailure:codec.ratio(failure,denominator),exact:{representation:'shared-residue-coefficients',conservationVerified:true,denominator:denominator.toString(),coefficients:k.coefficients,failureNumerator:failure.toString(),ghostNumerator:ghost.toString(),exhaustedNumerator:k.exhausted.toString(),formula:'P(cell)=sum(count*coefficients[id].numerator for id,count in cell.terms)/denominator'}}};
 }
 const api={search,calculate,evaluate,MODEL};root.CrateLiveSolver=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
