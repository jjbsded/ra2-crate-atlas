'use strict';
const assert=require('node:assert/strict'),F=require('./finite-retry.js'),K=require('./buff-weight-kernel.js');
function oracle(terminal,N,limit){const rows=new Map(Array.from({length:24},(_,i)=>[i+1,Array.from({length:i+1},(_,r)=>terminal.get((i+1)*32+r)||0)])),hist=F.integrate(rows,[...rows.keys()],()=>{}),weight=t=>t?-Math.expm1(limit*Math.log1p(-t/N))/t:limit/N;let baseline=0;for(const[t,n]of hist.overall)baseline+=n*weight(t);const out=new Float64Array(800);for(const[pair,terms]of hist.conditional)for(const[t,n]of terms)out[pair]+=n*weight(t)/baseline;return out;}
let seed=17;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
for(let test=0;test<12;test++){
 const terminal=new Map([[32,12000]]);for(let n=2;n<=24;n++)for(let r=0;r<n;r++)terminal.set(n*32+r,Math.floor(random()*(n<5?2000:30)));
 const N=57121,actual=K.calculate(terminal,N,1000),expected=oracle(terminal,N,1000);assert(actual,'Dense map uses the bounded convergent kernel');
 for(let n=1;n<=24;n++){let sum=0;for(let r=0;r<n;r++){const pair=n*32+r;assert(Math.abs(actual[pair]-expected[pair])<3e-14,JSON.stringify({test,n,r,a:actual[pair],e:expected[pair]}));sum+=actual[pair];}assert(Math.abs(sum-1)<3e-14,'Residue weights conserve mass');}
 const delta=new Map([[32,1],[5*32+2,-1],[8*32+3,2]]),base=new Map(terminal);for(const[pair,n]of delta)base.set(pair,base.get(pair)-n);const prepared=K.prepare(base,N,1000),selected=(1<<1)|(1<<3)|(1<<5)|(1<<8),partial=prepared.calculate(delta,selected);
 assert(partial);for(let n=1;n<=24;n++)for(let r=0;r<n;r++){const pair=n*32+r;if(selected&(1<<n))assert(Math.abs(partial[pair]-expected[pair])<3e-14,'Prepared delta and partial projections preserve the CRT result');else assert.equal(partial[pair],0);}
}
assert.equal(K.calculate(new Map(),100,1000),null,'No terminating outcome uses the finite-retry fallback');
assert.equal(K.calculate(new Map([[32,1]]),1000,1000),null,'A non-negligible finite-retry tail is never omitted');
assert.equal(K.calculate(new Map([[32,30],[64,10],[65,20]]),100,3),null,'A small attempt limit keeps the original finite sum');
console.log('PASS bounded reciprocal kernel vs independent CRT histograms, all 300 residues, mass conservation and exact fallbacks');
