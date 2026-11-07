'use strict';
const assert=require('node:assert/strict'),B=require('./buff-expectation.js'),S=require('./toy-live/solver.js'),F=require('./finite-retry.js');
const cells=[];for(let y=1;y<=7;y++)for(let x=1;x<=7;x++)if(!(x===1&&y===1))cells.push({x,y,land:x>5?2:0,candidate:(x*5+y)%7!==0,track:x<=5,float:x>5,primary:(x+y)%3!==0,status:(x+2*y)%11===0?'ghost':(x*3+y)%7===0?'retry':'crate'});
const grid=new Uint8Array(262144);for(const c of cells)grid[c.y*512+c.x]=(c.candidate?(+c.track|(+c.float<<1)):0)|(+c.primary<<2)|(+ (c.land===2)<<3);
{
 const flat=cells.map(c=>({...c,land:0,candidate:true,track:true,float:false,primary:true,status:'crate'})),g=new Uint8Array(262144);for(const c of flat)g[c.y*512+c.x]=5;
 const result=S.calculate(S.search(g,7),flat,49),it=B.prepare({metadata:{size:[0,0,4,4]},cells:flat,probability:result.probability});let p;do{p=it.next();}while(!p.done);
 assert(Math.abs(B.value(p.value,4,4,2)-1)<1e-10,'The occupied open-field reference includes redistributed center mass and is exactly 1x');
 assert(B.value(p.value,1,1,3)>0&&B.value(p.value,0,0,3)>0,'Positive expectation extends across missing terrain and outside the origin-sampling square');
}
for(const limit of [3,1000]){
 const initial=S.calculate(S.search(grid,7),cells,49,()=>{},limit),data={metadata:{size:[0,0,4,4]},cells,probability:initial.probability},iterator=B.prepare(data);let part;do{part=iterator.next();}while(!part.done);const model=part.value;
 const headers=new Int32Array(cells.length*6),statuses=new Uint8Array(262144);cells.forEach((c,i)=>{headers[i*6]=c.y*512+c.x;statuses[c.y*512+c.x]=c.status==='crate'?1:c.status==='ghost'?2:0;});const packed=B.prepare({metadata:data.metadata,probability:data.probability,packed:{grid,statuses},geometry:{headers}});let encoded;do{encoded=packed.next();}while(!encoded.done);assert.equal(B.value(model,3,2,3),B.value(encoded.value,3,2,3),'Compact typed transport preserves every search input');
 for(const [x,y]of [[3,3],[3,2],[4,4],[6,4],[5,4],[6,5],[1,1],[0,2],[8,7]]){
  const modified=grid.slice();modified[y*512+x]&=~3;const full=S.calculate(S.search(modified,7),cells,49,()=>{},limit),e=full.probability.exact,coeff=e.coefficients.map(c=>BigInt(c.numerator)),base=e.coefficients.reduce((s,c,i)=>s+(c.n===1?coeff[i]:0n),0n);
  for(const r of [1,2,3]){let numerator=0n;for(const[id,c]of full.results)if(id!==y*512+x&&Math.abs((id&511)-x)<r&&Math.abs((id>>>9)-y)<r)numerator+=c.terms.reduce((n,[i,h])=>n+coeff[i]*BigInt(h),0n);const expected=F.ratio(numerator,base*BigInt((2*r-1)**2)),actual=B.value(model,x,y,r);assert(Math.abs(actual-expected)<1e-10,JSON.stringify({limit,x,y,r,actual,expected}));}
 }
 assert.deepEqual(B.signature(new Map([[2*32,-1],[2*32+1,-1],...[0,1,2,3,4,5,6,7].map(r=>[8*32+r,1])])),'[]');
 console.log('PASS counterfactual field vs complete search/retry oracle',limit,'attempts',model.diagnostics);
}
