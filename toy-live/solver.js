/* Exact ordered search and finite-retry probability solver. Mirrors
 * realmap-search.c / realmap_exact.py, without native executables or sampling. */
(function(root){
 'use strict';
 const codec=root.CrateStaticCodec||(typeof require==='function'?require('../toy/static-codec.js'):null);
 const gcd=(a,b)=>b?gcd(b,a%b):a,lcm=(a,b)=>a/gcd(a,b)*b,add=(m,k,n)=>m.set(k,(m.get(k)||0)+n);
 // Match Python 3.12's compensated sum for the diagnostic single-attempt
 // float too. Final probabilities below use exact integers throughout.
 function sumFloat(values){let hi=0,lo=0;for(const x of values){const t=hi+x;lo+=Math.abs(hi)>=Math.abs(x)?(hi-t)+x:(x-t)+hi;hi=t;}return hi+lo;}
 function search(grid,maximum,progress=()=>{}){const out=new Uint32Array(maximum*maximum*25),picked=new Uint32Array(24);let at=0;
  for(let sy=1;sy<=maximum;sy++){for(let sx=1;sx<=maximum;sx++){let count=0,primary=0;const movement=grid[sy*512+sx]&8?2:1;
   const consider=(x,y)=>{if(x<0||y<0||x>=512||y>=512||count===24)return;const id=y*512+x;if(!(grid[id]&movement))return;picked[count++]=id;if(grid[id]&4)primary++;};
   for(let r=0;r<Math.min(maximum+1,32);r++){for(let d=-r;d<=r&&count<24;d++){consider(sx+d,sy-r);consider(sx+d,sy+r);}for(let d=1-r;d<=r-1&&count<24;d++){consider(sx-r,sy+d);consider(sx+r,sy+d);}if(count===24||primary)break;}
   out[at++]=primary||count;for(let i=0;i<count;i++)if(!primary||(grid[picked[i]]&4))out[at++]=picked[i];
  }if(sy%24===0)progress('附近搜索 / Searching nearby cells',30+15*sy/maximum);}return out.slice(0,at);
 }
 function convolve(a,b){const out=new Map();for(const[x,n]of a)for(const[y,m]of b)add(out,x+y,n*m);return out;}
 function crt(core,base,p,r,n){let inverse=1;while(base*inverse%p!==1)inverse++;return(core+base*((((r-core)*inverse)%p+p)%p))%n;}
 function integrate(terminal,counts,progress){const period=counts.reduce(lcm,1),fundamental=row=>{for(let p=1;p<=row.length;p++)if(row.length%p===0&&row.every((v,i)=>v===row[i%p]))return p;};
  const reduced=counts.map(n=>fundamental(terminal.get(n))).reduce(lcm,1),overall=new Map(),conditional=new Map();for(const n of counts)for(let r=0;r<n;r++)conditional.set(n*32+r,new Map());
  if(reduced<=200000){const gs=[...new Set(counts.map(n=>gcd(reduced,n)))],buckets=new Map(gs.map(g=>[g,Array.from({length:g},()=>new Map())]));
   for(let f=0;f<reduced;f++){const total=counts.reduce((s,n)=>s+terminal.get(n)[f%n],0);add(overall,total,period/reduced);for(const g of gs)add(buckets.get(g)[f%g],total,1);}
   for(const n of counts){const g=gcd(reduced,n),factor=period/lcm(n,reduced);for(let r=0;r<n;r++)for(const[t,m]of buckets.get(g)[r%g])conditional.get(n*32+r).set(t,m*factor);}
   return{period,reduced,overall,conditional,method:'reduced-period-residue-aggregation'};
  }
  let base=1;for(const p of [2,3]){let power=1;while(period%(power*p)===0)power*=p;base*=power;}const primes=[5,7,11,13,17,19,23].filter(p=>period%p===0),factor=new Map(counts.map(n=>[n,primes.find(p=>n%p===0)]));
  for(let core=0;core<base;core++){const fixed=counts.filter(n=>!factor.get(n)).reduce((s,n)=>s+terminal.get(n)[core%n],0),values=primes.map(p=>Array.from({length:p},(_,r)=>counts.filter(n=>factor.get(n)===p).reduce((s,n)=>s+terminal.get(n)[crt(core,base,p,r,n)],0))),distributions=values.map(row=>{const m=new Map();for(const v of row)add(m,v,1);return m;}),prefix=[new Map([[fixed,1]])],suffix=new Array(primes.length+1);for(const d of distributions)prefix.push(convolve(prefix.at(-1),d));suffix[primes.length]=new Map([[0,1]]);for(let i=primes.length-1;i>=0;i--)suffix[i]=convolve(distributions[i],suffix[i+1]);
   for(const[t,m]of prefix.at(-1))add(overall,t,m);for(const n of counts)if(!factor.get(n))for(const[t,m]of prefix.at(-1))add(conditional.get(n*32+core%n),t,m);
   for(let i=0;i<primes.length;i++){const p=primes[i],others=convolve(prefix[i],suffix[i+1]);for(let r=0;r<p;r++)for(const n of counts)if(factor.get(n)===p){const target=conditional.get(n*32+crt(core,base,p,r,n));for(const[t,m]of others)add(target,t+values[i][r],m);}}
   if(core%12===0)progress('合并随机帧余数 / Integrating frame residues',55+15*core/base);
  }
  if([...overall.values()].reduce((a,b)=>a+b,0)!==period)throw Error('Frame conservation failed');return{period,reduced,overall,conditional,method:'crt-factor-convolution'};
 }
 function calculate(binary,cells,originCount,progress=()=>{}){const statuses=new Map(cells.map(c=>[c.y*512+c.x,c.status])),terms=new Map(),ghostTerms=new Map(),terminal=new Map();let at=0,count=0,noCandidate=0;
  while(at<binary.length){const n=binary[at++];if(n>24||at+n>binary.length)throw Error('Invalid candidate records');count++;if(!n){noCandidate++;continue;}if(!terminal.has(n))terminal.set(n,new Array(n).fill(0));const row=terminal.get(n);for(let r=0;r<n;r++){const id=binary[at++],status=statuses.get(id),pair=n*32+r;if(status==='crate'){if(!terms.has(id))terms.set(id,new Map());add(terms.get(id),pair,1);row[r]++;}else if(status==='ghost'){add(ghostTerms,pair,1);row[r]++;}}}
  if(count!==originCount)throw Error('Origin count mismatch');const counts=[...terminal.keys()].sort((a,b)=>a-b);progress('计算有限重抽概率 / Computing finite retries',55);const integrated=integrate(terminal,counts,progress),{period,overall,conditional}=integrated,N=BigInt(originCount),base=N**1000n,denominator=BigInt(period)*base,weights=new Map(),powers=new Map();for(const t of overall.keys()){const power=(N-BigInt(t))**1000n;powers.set(t,power);weights.set(t,t?(base-power)/BigInt(t):0n);}
  const coefficients=[],ids=new Map(),values=new Map();for(const[pair,histogram]of conditional){let value=0n;for(const[t,frames]of histogram)value+=BigInt(frames)*weights.get(t);ids.set(pair,coefficients.length);values.set(pair,value);coefficients.push({n:Math.floor(pair/32),r:pair%32,numerator:value.toString()});}
  let failure=0n,ghost=0n,total=0n;for(const[t,frames]of overall)failure+=BigInt(frames)*powers.get(t);for(const[pair,hits]of ghostTerms)ghost+=BigInt(hits)*values.get(pair);const distributions=new Map(),results=new Map();
  for(const[id,hits]of terms){const sorted=[...hits].sort((a,b)=>a[0]-b[0]),signature=JSON.stringify(sorted);let result=distributions.get(signature);if(!result){const numerator=sorted.reduce((s,[pair,n])=>s+BigInt(n)*values.get(pair),0n);result={numerator,probability:codec.ratio(numerator,denominator),multiplier:codec.ratio(numerator*N,denominator),terms:sorted.map(([pair,n])=>[ids.get(pair),n]),oneAttemptProbability:sumFloat([...hits].map(([pair,n])=>n/Math.floor(pair/32)))/originCount};distributions.set(signature,result);}total+=result.numerator;const{numerator,...fields}=result;results.set(id,fields);}
  if(total+ghost+failure!==denominator)throw Error('Exact probability conservation failed');
  return {results,probability:{sampleCount:originCount,attemptLimit:1000,framePolicy:'uniform-cycle',period,weightPeriod:integrated.reduced,method:integrated.method,candidateCounts:counts,terminalCountRange:[Math.min(...overall.keys()),Math.max(...overall.keys())],noCandidateOrigins:noCandidate,positiveCellCount:results.size,sharedDistributionCount:distributions.size,maxMultiplier:[...distributions.values()].reduce((m,v)=>Math.max(m,v.multiplier),0),finalSuccess:codec.ratio(total,denominator),finalGhost:codec.ratio(ghost,denominator),finalFailure:codec.ratio(failure,denominator),exact:{representation:'shared-residue-coefficients',conservationVerified:true,denominator:denominator.toString(),coefficients,failureNumerator:failure.toString(),ghostNumerator:ghost.toString(),formula:'P(cell)=sum(count*coefficients[id].numerator for id,count in cell.terms)/denominator'}}};
 }
 const api={search,calculate,integrate};root.CrateLiveSolver=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
