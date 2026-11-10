/* Floating-point retry weights for independent Buff counterfactuals.
 * Condition on the 2/3 residue, then combine the independent prime factors.
 * A convergent centered reciprocal series avoids rebuilding CRT histograms.
 * Both its remainder and the omitted finite-retry tail must be below 2e-17;
 * otherwise the caller uses the original finite-retry histogram calculation.
 * This does not replace the exact integer probabilities of the actual map. */
(function(root){
 'use strict';
 const BASE=144,PRIMES=[5,7,11,13,17,19,23],EPSILON=2e-17,MAX_ORDER=10;
 const binomial=Array.from({length:MAX_ORDER+1},(_,n)=>{const row=[1];for(let k=1;k<=n;k++)row[k]=row[k-1]*(n-k+1)/k;return row;});
 let layout;
 function projections(){if(layout)return layout;const fixed=[],groups=PRIMES.map(p=>({p,counts:[]}));
  for(let n=1;n<=24;n++){const group=groups.find(g=>n%g.p===0);if(group)group.counts.push(n);else fixed.push(n);}
  layout=Array.from({length:BASE},(_,core)=>({fixed:fixed.map(n=>n*32+core%n),groups:groups.map(({p,counts})=>{
   let inverse=1;while(BASE*inverse%p!==1)inverse++;
   return {p,pairs:Array.from({length:p},(_,r)=>counts.map(n=>n*32+(core+BASE*((((r-core)*inverse)%p+p)%p))%n))};
  })}));return layout;
 }
 function combine(a,b,order){const out=new Float64Array(order+1);for(let k=0;k<=order;k++)for(let j=0;j<=k;j++)out[k]+=binomial[k][j]*a[j]*b[k-j];return out;}
 function coefficients(moments,order){const out=new Float64Array(order+1);for(let j=0;j<=order;j++)for(let k=j;k<=order;k++)out[j]+=(k%2?-1:1)*binomial[k][j]*moments[k-j];return out;}
 function polynomial(coefficients,x){let value=0;for(let i=coefficients.length-1;i>=0;i--)value=value*x+coefficients[i];return value;}
 function moments(offsets,order=MAX_ORDER){const out=new Float64Array(order+1);out[0]=1;for(const y of offsets){let power=1/offsets.length;for(let k=1;k<=order;k++){power*=y;out[k]+=power;}}return out;}
 function prepare(terminal,N,limit){const rows=new Float64Array(800);for(const[pair,n]of terminal)rows[pair]=n;const states=[];
  for(const core of projections()){
   let fixed=0;for(const pair of core.fixed)fixed+=rows[pair];let center=fixed,lower=fixed,upper=fixed;
   const groups=core.groups.map(group=>{const values=group.pairs.map(pairs=>{let value=0;for(const pair of pairs)value+=rows[pair];return value;}),mean=values.reduce((a,b)=>a+b,0)/group.p,min=Math.min(...values),max=Math.max(...values);center+=mean;lower+=min;upper+=max;return {group,values,mean,min,max};});
   if(!(center>0))return null;
   for(const g of groups){g.offsets=g.values.map(v=>(v-g.mean)/center);g.moments=moments(g.offsets);}
   const cached=new Map(),polynomials=new Map(),unit=new Float64Array(MAX_ORDER+1);unit[0]=1;
   const complement=mask=>{if(cached.has(mask))return cached.get(mask);let m=unit;for(let i=0;i<groups.length;i++)if(!(mask&(1<<i)))m=combine(m,groups[i].moments,MAX_ORDER);cached.set(mask,m);return m;};
   const projected=(mask,order)=>{const key=mask*16+order;if(!polynomials.has(key))polynomials.set(key,coefficients(complement(mask),order));return polynomials.get(key);};
   states.push({core,groups,center,lower,upper,complement,projected});
  }
  return {calculate(delta,requested=0x1fffffe){const out=new Float64Array(800),changes=new Float64Array(800);let mask=0,baseline=0;for(const[pair,n]of delta){changes[pair]=n;const group=PRIMES.findIndex(p=>Math.floor(pair/32)%p===0);if(group>=0&&n)mask|=1<<group;}
   for(const state of states){const {core,groups,center}=state;let shift=0;for(const pair of core.fixed)shift+=changes[pair];let lower=state.lower+shift,upper=state.upper+shift;
    const changed=new Map();
    for(let i=0;i<groups.length;i++)if(mask&(1<<i)){
     const g=groups[i],values=g.values.map((value,r)=>{for(const pair of g.group.pairs[r])value+=changes[pair];return value;}),offsets=values.map(v=>(v-g.mean)/center);
     lower+=Math.min(...values)-g.min;upper+=Math.max(...values)-g.max;changed.set(i,{offsets});
    }
    const rho=Math.max(Math.abs(center-lower),Math.abs(upper-center))/center;
    if(!(lower>0)||upper>N||rho>=1||limit*Math.log1p(-lower/N)>Math.log(EPSILON))return null;
    let order=0;while(order<=MAX_ORDER&&rho**(order+1)*(1+rho)/(1-rho)>EPSILON)order++;if(order>MAX_ORDER)return null;
    for(const g of changed.values())g.moments=moments(g.offsets,order);
    const projected=excluded=>{if(!mask)return state.projected(excluded,order);let m=state.complement(mask|excluded);for(const[i,g]of changed)if(!(excluded&(1<<i)))m=combine(m,g.moments,order);return coefficients(m,order);};
    const fixedOffset=shift/center,weight=polynomial(projected(0),fixedOffset)/center/BASE;baseline+=weight;for(const pair of core.fixed)if(requested&(1<<(pair>>>5)))out[pair]+=weight;
    for(let i=0;i<groups.length;i++){
     const g=groups[i];if(!g.group.pairs[0].some(pair=>requested&(1<<(pair>>>5))))continue;
     const offsets=changed.get(i)?.offsets||g.offsets,coeff=projected(1<<i);
     for(let r=0;r<g.group.p;r++){const weight=polynomial(coeff,offsets[r]+fixedOffset)/center/BASE/g.group.p;for(const pair of g.group.pairs[r])if(requested&(1<<(pair>>>5)))out[pair]+=weight;}
    }
   }
   if(!(baseline>0))return null;for(let i=0;i<out.length;i++)out[i]/=baseline;return out;
  }};
 }
 const calculate=(terminal,N,limit)=>prepare(terminal,N,limit)?.calculate(new Map())||null;
 const api={calculate,prepare};root.CrateBuffWeightKernel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
