/* Shared-frame finite retries: exact geometric weights and CRT histograms.
 * No retries repeat the map search or enumerate the joint frame period. */
(function(root){'use strict';
 const MODEL='finite-retry-v2',LIMIT=1000,PERIOD=5354228880;
 const gcd=(a,b)=>b?gcd(b,a%b):a,lcm=(a,b)=>a/gcd(a,b)*b,add=(m,k,n)=>m.set(k,(m.get(k)||0)+n);
 const pairs=[],ids=new Map();for(let n=1;n<=24;n++)for(let r=0;r<n;r++){ids.set(n*32+r,pairs.length);pairs.push([n,r]);}
 const denominators=new Map(),nibbleBits=[0,1,2,2,3,3,3,3,4,4,4,4,4,4,4,4];
 function bitLength(value){const hex=value.toString(16);return (hex.length-1)*4+nibbleBits[parseInt(hex[0],16)];}
 function denominatorInfo(d){let entry=denominators.get(d);if(entry){denominators.delete(d);denominators.set(d,entry);return entry;}const bits=bitLength(d),drop=Math.max(0,bits-112);entry={bits,drop,head:d>>BigInt(drop)};denominators.set(d,entry);if(denominators.size>32)denominators.delete(denominators.keys().next().value);return entry;}
 // The truncated operands bound the exact quotient. If their floors differ
 // by one, a full-integer comparison resolves the boundary; wider intervals
 // use ordinary division. No rounded decimal approximation reaches callers.
 function positiveDivide(a,b,info=denominatorInfo(b),extraShift=0){const drop=info.drop+extraShift;if(drop<=0)return a/b;const head=a>>BigInt(drop),lo=head/(info.head+1n),hi=(head+1n)/info.head;return hi-lo<=1n?(a<hi*b?lo:hi):a/b;}
 function divide(n,d){if(!d)return n/d;const negative=(n<0n)!==(d<0n);if(n<0n)n=-n;if(d<0n)d=-d;const q=positiveDivide(n,d);return negative?-q:q;}
 function ratio(n,d){
  if(n===0n)return 0;
  if(n<0n||d<=0n)throw Error('CODEC_RATIO');
  const info=denominatorInfo(d);let exponent=bitLength(n)-info.bits;
  if(exponent>=0?n<(d<<BigInt(exponent)):(n<<BigInt(-exponent))<d)exponent--;
  // Round the rational to IEEE 754, nearest with ties to even, just as Python
  // integer true division does. Never coerce enormous integers to Number.
  if(exponent>1023)return Infinity;
  const shift=52-Math.max(exponent,-1022),a=shift>=0?n<<BigInt(shift):n,b=shift>=0?d:d<<BigInt(-shift);
  let q=positiveDivide(a,b,info,Math.max(0,-shift));const remainder=a-q*b;
  if(remainder*2n>b||(remainder*2n===b&&(q&1n)))q++;
  return Number(q)*2**(-shift);
 }
 function convolve(a,b){const out=new Map();for(const[x,n]of a)for(const[y,m]of b)add(out,x+y,n*m);return out;}
 function crt(core,base,p,r,n){let inverse=1;while(base*inverse%p!==1)inverse++;return(core+base*((((r-core)*inverse)%p+p)%p))%n;}
 function integrate(terminal,counts,progress){const period=counts.reduce(lcm,1),fundamental=row=>{for(let p=1;p<=row.length;p++)if(row.length%p===0&&row.every((v,i)=>v===row[i%p]))return p;};
  const reduced=counts.map(n=>fundamental(terminal.get(n))).reduce(lcm,1),overall=new Map(),conditional=new Map();for(const n of counts)for(let r=0;r<n;r++)conditional.set(n*32+r,new Map());
  if(reduced<=144){const gs=[...new Set(counts.map(n=>gcd(reduced,n)))],buckets=new Map(gs.map(g=>[g,Array.from({length:g},()=>new Map())]));
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

 function signature(terminal){
  const combined=Array.from({length:25},(_,d)=>Array(d).fill(0n));
  for(let n=1;n<=24;n++){const row=Array.from({length:n},(_,r)=>BigInt(terminal.get(n*32+r)||0)),parts=new Map();
   for(let d=1;d<=n;d++){if(n%d)continue;const value=Array.from({length:d},(_,r)=>{let sum=0n;for(let i=r;i<n;i+=d)sum+=row[i];return sum*BigInt(PERIOD/(n/d));});
    for(const[e,part]of parts)if(d%e===0)for(let r=0;r<d;r++)value[r]-=part[r%e];parts.set(d,value);for(let r=0;r<d;r++)combined[d][r]+=value[r];
   }
  }return combined.map((row,d)=>[d,row.map(String)]).filter(([,row])=>row.some(v=>v!=='0'));
 }
 function kernel(terminal,originCount,limit=LIMIT,progress=()=>{}){
  if(!Number.isInteger(originCount)||originCount<=0||!Number.isInteger(limit)||limit<1||limit>LIMIT)throw Error('Invalid retry dimensions');
  const rows=new Map(Array.from({length:24},(_,i)=>[i+1,Array.from({length:i+1},(_,r)=>terminal.get((i+1)*32+r)||0)]));
  const integrated=integrate(rows,[...rows.keys()],progress),{overall,conditional,period}=integrated,N=BigInt(originCount),base=N**BigInt(limit),denominator=BigInt(period)*base,weights=new Map(),powers=new Map();
  for(const t of overall.keys()){const power=(N-BigInt(t))**BigInt(limit);powers.set(t,power);weights.set(t,t?(base-power)/BigInt(t):BigInt(limit)*N**BigInt(limit-1));}
  const values=new Map(),coefficients=[];for(const[n,r]of pairs){const pair=n*32+r;let value=0n;for(const[t,frames]of conditional.get(pair))value+=BigInt(frames)*weights.get(t);values.set(pair,value);coefficients.push({n,r,numerator:value.toString()});}
  let exhausted=0n;for(const[t,frames]of overall)exhausted+=BigInt(frames)*powers.get(t);
  return{...integrated,denominator,values,coefficients,exhausted,terminalCountRange:[Math.min(...overall.keys()),Math.max(...overall.keys())]};
 }
 const api={MODEL,LIMIT,PERIOD,pairs,ids,signature,kernel,integrate,ratio,divide};root.CrateFiniteRetry=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
