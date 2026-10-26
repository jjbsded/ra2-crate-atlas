/* Lossless static transport, shared by the worker and its direct fallback. */
(function(root){
 'use strict';
 function ratio(n,d){
  if(n===0n)return 0;
  if(n<0n||d<=0n)throw Error('CODEC_RATIO');
  let exponent=n.toString(2).length-d.toString(2).length;
  if(exponent>=0?n<(d<<BigInt(exponent)):(n<<BigInt(-exponent))<d)exponent--;
  // Round the rational to IEEE 754, nearest with ties to even, just as Python
  // integer true division does. Never coerce enormous integers to Number.
  if(exponent>1023)return Infinity;
  const shift=52-Math.max(exponent,-1022),a=shift>=0?n<<BigInt(shift):n,b=shift>=0?d:d<<BigInt(-shift);
  let q=a/b;const remainder=a%b;
  if(remainder*2n>b||(remainder*2n===b&&(q&1n)))q++;
  return Number(q)*2**(-shift);
 }
 function columnValues(column,count){
  if(column[0]===0)return {get:()=>column[1],present:()=>true};
  const width=column[0];if(![1,2,4].includes(width))throw Error('CODEC_COLUMN_WIDTH');
  const raw=atob(column[2]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length!==width*count)throw Error('CODEC_COLUMN_LENGTH');
  const view=new DataView(bytes.buffer),index=i=>width===1?view.getUint8(i):width===2?view.getUint16(i*2,true):view.getUint32(i*4,true);
  return {present:i=>index(i)!==0,get:i=>{const v=index(i);if(v>column[1].length)throw Error('CODEC_COLUMN_INDEX');return column[1][v-1];}};
 }
 function probability(p,recipe){
  const n=BigInt(p.sampleCount),limit=BigInt(p.attemptLimit),base=n**limit,weights=new Map(),powers=new Map();
  for(const[t]of recipe.overall){const power=(n-BigInt(t))**limit;powers.set(t,power);weights.set(t,t?(base-power)/BigInt(t):0n);}
  const histograms=recipe.histograms.map(hist=>hist.reduce((sum,[t,frames])=>sum+BigInt(frames)*weights.get(t),0n));
  const numerators=recipe.ids.map(id=>histograms[id]),exact=p.exact,denominator=BigInt(p.period)*base;
  if(numerators.length!==exact.coefficients.length)throw Error('CODEC_COEFFICIENT_COUNT');
  exact.denominator=denominator.toString();
  exact.coefficients.forEach((c,i)=>c.numerator=numerators[i].toString());
  exact.failureNumerator=recipe.overall.reduce((sum,[t,frames])=>sum+BigInt(frames)*powers.get(t),0n).toString();
  exact.ghostNumerator=recipe.ghosts.reduce((sum,[i,hits])=>sum+BigInt(hits)*numerators[i],0n).toString();
  return {n,denominator,numerators};
 }
 async function report(value,loadBase){
  if(!value._static)return value;
  const transport=value._static;
  if(transport.codec!==1)throw Error('CODEC_VERSION');
  const table=await loadBase(transport.base),count=table.count;
  if(!Number.isInteger(count)||count<1||count>260100)throw Error('CODEC_CELL_COUNT');
  const columns={...table.columns};
  for(const[field,col]of Object.entries(transport.columns))if(col===null)delete columns[field];else columns[field]=col;
  const cells=Array.from({length:count},()=>({}));
  for(const[field,col]of Object.entries(columns)){
   const values=columnValues(col,count);
   for(let i=0;i<count;i++)if(values.present(i))cells[i][field]=values.get(i);
  }
  const {n,denominator,numerators}=probability(value.probability,transport.probability),derived=new Map();
  for(const cell of cells){
   const signature=JSON.stringify(cell.terms);
   let pair=derived.get(signature);
   if(!pair){const numerator=cell.terms.reduce((sum,[i,hits])=>sum+numerators[i]*BigInt(hits),0n);pair=[ratio(numerator,denominator),ratio(numerator*n,denominator)];derived.set(signature,pair);}
   [cell.probability,cell.multiplier]=pair;
  }
  delete value._static;value.cells=cells;
  return value;
 }
 function search(buffer){
  const bytes=new Uint8Array(buffer);
  if(bytes[0]!==67||bytes[1]!==83||bytes[2]!==67||bytes[3]!==49)return buffer;
  const view=new DataView(buffer),count=view.getUint32(4,true),size=view.getUint32(8,true),maximum=Math.sqrt(count);
  if(!Number.isInteger(maximum)||maximum<1||maximum>510||size>count)throw Error('CODEC_SEARCH_SIZE');
  let offset=12;
  const read=()=>{let value=0,factor=1;for(let i=0;i<5;i++){if(offset>=bytes.length)throw Error('CODEC_SEARCH_EOF');const b=bytes[offset++];value+=(b&127)*factor;if(b<128)return value;factor*=128;}throw Error('CODEC_SEARCH_VARINT');};
  const lists=[null];let length=0;
  for(let i=0;i<size;i++){
   if(offset>=bytes.length)throw Error('CODEC_SEARCH_EOF');
   const n=bytes[offset++];if(n>24)throw Error('CODEC_SEARCH_LIST');
   const list=[];let previous=0;
   for(let j=0;j<n;j++){const delta=read();previous+=delta%2?-(delta+1)/2:delta/2;if(previous<0||previous>=512*512)throw Error('CODEC_SEARCH_TARGET');list.push(previous);}
   lists.push(list);
  }
  const indices=new Uint32Array(count);
  for(let i=0;i<count;i++){const id=read();if(id>size)throw Error('CODEC_SEARCH_INDEX');indices[i]=id;length+=id?1+lists[id].length:2;}
  if(offset!==bytes.length)throw Error('CODEC_SEARCH_LENGTH');
  const result=new ArrayBuffer(length*4),output=new DataView(result);let pos=0;
  const write=n=>{output.setUint32(pos,n,true);pos+=4;};
  for(let i=0;i<count;i++)if(indices[i]){const list=lists[indices[i]];write(list.length);for(const target of list)write(target);}else{write(1);write((Math.floor(i/maximum)+1)*512+i%maximum+1);}
  return result;
 }
 const api={ratio,report,search};root.CrateStaticCodec=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
