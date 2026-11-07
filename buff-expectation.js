/* Independent one-unit counterfactuals. Re-search only origins that actually
 * inspected the removed candidate, including non-primary inspected cells.
 * Finite retries use the same residue histograms, evaluated numerically only
 * at the final display boundary. No simulation plans or map results mutate. */
(function(root){
 'use strict';
 const F=root.CrateFiniteRetry||(typeof require==='function'?require('./finite-retry.js'):null),SIZE=512,AREA=SIZE*SIZE;
 const reference=root.CrateBuffReference||(typeof require==='function'?require('./buff-reference.js'):null);
 const add=(m,k,n)=>{const value=(m.get(k)||0)+n;if(value)m.set(k,value);else m.delete(k);};
 function search(grid,x,y,maximum,blocked=-1){const raw=[],movement=grid[y*SIZE+x]&8?2:1;let primary=0;
  const consider=(x,y)=>{if(x<0||y<0||x>=SIZE||y>=SIZE||raw.length===24)return;const id=y*SIZE+x;if(id!==blocked&&(grid[id]&movement)){raw.push(id);if(grid[id]&4)primary++;}};
  for(let r=0;r<Math.min(maximum+1,32);r++){for(let d=-r;d<=r&&raw.length<24;d++){consider(x+d,y-r);consider(x+d,y+r);}for(let d=1-r;d<r&&raw.length<24;d++){consider(x-r,y+d);consider(x+r,y+d);}if(raw.length===24||primary)break;}
  return {raw,picks:primary?raw.filter(id=>grid[id]&4):raw};
 }
 // F.signature's exact integer decomposition, with small local counts kept as
 // safe JS integers. Equivalent candidate lengths cancel before any kernel.
 function signature(delta){const combined=new Map(),rows=new Map();for(const[pair,n]of delta){const d=Math.floor(pair/32),r=pair%32;if(!rows.has(d))rows.set(d,Array(d).fill(0));rows.get(d)[r]=n;}
  for(const[n,row]of rows){const parts=new Map();for(let d=1;d<=n;d++){if(n%d)continue;const value=Array(d).fill(0);for(let r=0;r<d;r++){for(let i=r;i<n;i+=d)value[r]+=row[i];value[r]*=F.PERIOD/(n/d);}for(const[e,part]of parts)if(d%e===0)for(let r=0;r<d;r++)value[r]-=part[r%e];parts.set(d,value);if(!combined.has(d))combined.set(d,Array(d).fill(0));const out=combined.get(d);for(let r=0;r<d;r++)out[r]+=value[r];}}
  return JSON.stringify([...combined].sort((a,b)=>a[0]-b[0]).filter(([,v])=>v.some(Boolean)));
 }
 function weights(terminal,N,limit){
  const rows=new Map(Array.from({length:24},(_,i)=>[i+1,Array.from({length:i+1},(_,r)=>terminal.get((i+1)*32+r)||0)])),hist=F.integrate(rows,[...rows.keys()],()=>{}),geometric=new Map();
  const weight=t=>{if(!geometric.has(t))geometric.set(t,t?-Math.expm1(limit*Math.log1p(-t/N))/t:limit/N);return geometric.get(t);};
  let baseline=0;for(const[t,n]of hist.overall)baseline+=n*weight(t);const out=new Float64Array(800);
  for(const[pair,terms]of hist.conditional){let value=0;for(const[t,n]of terms)value+=n*weight(t);out[pair]=baseline?value/baseline:0;}
  return out;
 }
 function* prepare(data){
  const maximum=data.metadata.size[2]+data.metadata.size[3]-1,N=maximum**2,grid=new Uint8Array(AREA),statuses=new Uint8Array(AREA),cells=new Map(),raw=new Uint32Array(N*24),counts=new Uint8Array(N),reverseCounts=new Uint32Array(AREA),terminal=new Map(),terms=new Map();let work=0;
  if(data.packed){grid.set(data.packed.grid);statuses.set(data.packed.statuses);for(let i=0;i<data.geometry.headers.length;i+=6){const id=data.geometry.headers[i];cells.set(id,{x:id&511,y:id>>>9});}}
  else for(const c of data.cells){const id=c.y*SIZE+c.x;cells.set(id,c);grid[id]=(c.candidate?(+c.track|(+c.float<<1)):0)|(+c.primary<<2)|(+ (c.land===2)<<3);statuses[id]=c.status==='crate'?1:c.status==='ghost'?2:0;}
  const last=new Int32Array(AREA).fill(-1);
  for(let i=0;i<N;i++){const x=i%maximum+1,y=Math.floor(i/maximum)+1,result=search(grid,x,y,maximum);counts[i]=result.raw.length;raw.set(result.raw,i*24);
   for(const id of result.raw)if(last[id]!==i){reverseCounts[id]++;last[id]=i;}
   const n=result.picks.length;for(let r=0;r<n;r++){const id=result.picks[r],pair=n*32+r;if(statuses[id])add(terminal,pair,1);if(statuses[id]===1){if(!terms.has(id))terms.set(id,new Map());add(terms.get(id),pair,1);}}
   if(++work%128===0)yield;
  }
  const offsets=new Uint32Array(AREA+1);for(let i=0;i<AREA;i++)offsets[i+1]=offsets[i]+reverseCounts[i];const reverse=new Uint32Array(offsets[AREA]),cursor=offsets.slice(0,AREA);last.fill(-1);
  for(let i=0;i<N;i++){for(let j=0;j<counts[i];j++){const id=raw[i*24+j];if(last[id]!==i){reverse[cursor[id]++]=i;last[id]=i;}}if(i%512===0)yield;}
  const baseWeights=new Float64Array(800),exact=data.probability.exact,coeff=exact.coefficients.map(c=>BigInt(c.numerator)),base=exact.coefficients.reduce((s,c,i)=>s+(c.n===1?coeff[i]:0n),0n);
  for(let i=0;i<coeff.length;i++){const c=exact.coefficients[i];baseWeights[c.n*32+c.r]=base?F.ratio(coeff[i],base):0;}
  const values=new Float64Array(AREA),hits=new Uint32Array(AREA),prefix=new Float64Array(513*513),prefixHits=new Uint32Array(513*513);
  for(const[id,row]of terms){let value=0;for(const[pair,n]of row){value+=baseWeights[pair]*n;hits[id]+=n;}values[id]=value;}
  for(let y=0;y<SIZE;y++){let sum=0,count=0;for(let x=0;x<SIZE;x++){sum+=values[y*SIZE+x];count+=hits[y*SIZE+x];prefix[(y+1)*513+x+1]=prefix[y*513+x+1]+sum;prefixHits[(y+1)*513+x+1]=prefixHits[y*513+x+1]+count;}if(y%16===0)yield;}
  return {data,maximum,N,grid,statuses,cells,raw,counts,offsets,reverse,terminal,terms,baseWeights,values,hits,prefix,prefixHits,kernels:new Map(),diagnostics:{origins:N,scenarios:0,searchedOrigins:0,kernels:0,reusedKernels:0}};
 }
 function square(model,x,y,r,p=model.prefix){const left=Math.max(0,x-r+1),top=Math.max(0,y-r+1),right=Math.min(SIZE,x+r),bottom=Math.min(SIZE,y+r);return p[bottom*513+right]-p[top*513+right]-p[bottom*513+left]+p[top*513+left];}
 function value(model,x,y,r){const {grid,statuses,maximum,raw,counts,reverse,offsets,baseWeights,cells}=model,id=y*SIZE+x,delta=new Map(),windowDelta=new Map();let baseValue=square(model,x,y,r)-model.values[id];
  let hitCount=square(model,x,y,r,model.prefixHits)-model.hits[id];
  const windowTerms=()=>{const result=new Map();for(let cy=Math.max(0,y-r+1);cy<Math.min(SIZE,y+r);cy++)for(let cx=Math.max(0,x-r+1);cx<Math.min(SIZE,x+r);cx++){const point=cy*SIZE+cx;if(point!==id)for(const[pair,n]of model.terms.get(point)||[])add(result,pair,n);}return result;};
  if(!(grid[id]&3)){if(!hitCount)return 0;if(baseValue<1e-8){baseValue=0;for(const[pair,n]of windowTerms())baseValue+=baseWeights[pair]*n;}return baseValue/reference.baseline(r);}
  const contribute=(row,sign)=>{const n=row.length;for(let rank=0;rank<n;rank++){const point=row[rank],pair=n*32+rank;if(statuses[point])add(delta,pair,sign);if(statuses[point]===1&&point!==id&&Math.abs((point&511)-x)<r&&Math.abs((point>>>9)-y)<r){add(windowDelta,pair,sign);hitCount+=sign;}}};
  for(let at=offsets[id];at<offsets[id+1];at++){const i=reverse[at],row=raw.subarray(i*24,i*24+counts[i]),hasPrimary=row.some(k=>grid[k]&4),old=hasPrimary?row.filter(k=>grid[k]&4):row,result=search(grid,i%maximum+1,Math.floor(i/maximum)+1,maximum,id).picks;
   contribute(old,-1);contribute(result,1);model.diagnostics.searchedOrigins++;
  }
  if(!hitCount)return 0;
  const sig=signature(delta);let weighted=baseWeights;
  if(sig!=='[]'){
   if(model.kernels.has(sig)){weighted=model.kernels.get(sig);model.diagnostics.reusedKernels++;}
   else{const terminal=new Map(model.terminal);for(const[pair,n]of delta)add(terminal,pair,n);weighted=weights(terminal,model.N,model.data.probability.attemptLimit||1000);model.kernels.set(sig,weighted);model.diagnostics.kernels++;if(model.kernels.size>256)model.kernels.delete(model.kernels.keys().next().value);}
   baseValue=0;for(let cy=Math.max(0,y-r+1);cy<Math.min(SIZE,y+r);cy++)for(let cx=Math.max(0,x-r+1);cx<Math.min(SIZE,x+r);cx++){const point=cy*SIZE+cx;if(point===id)continue;for(const[pair,n]of model.terms.get(point)||[])baseValue+=weighted[pair]*n;}
  }
  for(const[pair,n]of windowDelta)baseValue+=weighted[pair]*n;
  if(baseValue<1e-8){const terms=windowTerms();for(const[pair,n]of windowDelta)add(terms,pair,n);baseValue=0;for(const[pair,n]of terms)baseValue+=weighted[pair]*n;}
  model.diagnostics.scenarios++;
  return Math.max(0,baseValue)/reference.baseline(r);
 }
 function bounds(model,r){let left=511,top=511,right=0,bottom=0;for(const c of model.cells.values()){left=Math.min(left,c.x);top=Math.min(top,c.y);right=Math.max(right,c.x);bottom=Math.max(bottom,c.y);}return {left:Math.max(0,left-r+1),top:Math.max(0,top-r+1),right:Math.min(511,right+r-1),bottom:Math.min(511,bottom+r-1)};}
 const api={search,signature,weights,prepare,value,bounds};root.CrateBuffExpectation=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
