/* Independent long division remains the oracle, including exact tie rounding. */
'use strict';
const assert=require('node:assert/strict'),F=require('./finite-retry.js'),D=require('./probability-display.js');
function original(n,d){if(n===0n)return 0;if(n<0n||d<=0n)throw Error('CODEC_RATIO');let e=n.toString(2).length-d.toString(2).length;if(e>=0?n<(d<<BigInt(e)):(n<<BigInt(-e))<d)e--;if(e>1023)return Infinity;const shift=52-Math.max(e,-1022),a=shift>=0?n<<BigInt(shift):n,b=shift>=0?d:d<<BigInt(-shift);let q=a/b;const r=a%b;if(r*2n>b||(r*2n===b&&(q&1n)))q++;return Number(q)*2**(-shift);}
let seed=123;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
const integer=bits=>{let n=1n;while(bits>0){n=(n<<32n)|BigInt(rand());bits-=32;}return n;};
const pairs=[];for(let i=0;i<180;i++){const d=integer(rand()%18000+1),n=integer(rand()%18000+1);pairs.push([n,d]);for(const q of [1n,123n,(1n<<53n)-1n])for(const r of [-1n,0n,1n])pairs.push([d*q+r,d]);}
for(const e of [-1100,-1075,-1074,-1023,-1022,-52,-1,0,52,1023,1024,1100])for(const n of [1n,3n,(1n<<53n)-1n])pairs.push(e<0?[n,1n<<BigInt(-e)]:[n<<BigInt(e),1n]);
for(const[n,d]of pairs){assert.equal(F.ratio(n,d),original(n,d));assert.equal(F.divide(n,d),n/d);assert.equal(F.divide(-n,d),-n/d);assert.equal(F.divide(n,-d),n/-d);assert.equal(D.ratio(n,d),Number(n*10000000000000000n/d)/1e16);}
for(const d of [1n,2n,1n<<1100n])for(const q of [(1n<<52n)+2n,(1n<<52n)+3n])for(const r of [-1n,0n,1n]){const n=(2n*q+1n)*d+r;assert.equal(F.ratio(n,2n*d),original(n,2n*d));}
console.log('PASS',pairs.length,'exact bounded quotients, signed divisions, large operands, subnormals, overflow and nearest-even ties');
