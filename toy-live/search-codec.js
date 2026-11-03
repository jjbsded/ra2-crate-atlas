/* Lossless anchored candidate patterns. Retains order and repeated candidates. */
(function(root){
 'use strict';const codec=root.CrateStaticCodec,original=codec.search;
 codec.search=function(buffer){
  const bytes=new Uint8Array(buffer);if(bytes.length<4||String.fromCharCode(...bytes.subarray(0,4))!=='CSP2')return original(buffer);
  if(bytes.length<12)throw Error('CSP2_HEADER');const v=new DataView(buffer),count=v.getUint32(4,true),size=v.getUint32(8,true),maximum=Math.sqrt(count);let at=12;
  if(!Number.isInteger(maximum)||maximum<1||maximum>510||size>count)throw Error('CSP2_SIZE');
  const read=()=>{let n=0,factor=1;for(let j=0;j<5;j++){if(at>=bytes.length)throw Error('CSP2_EOF');const b=bytes[at++];n+=(b&127)*factor;if(b<128)return n;factor*=128;}throw Error('CSP2_VARINT');},signed=()=>{const n=read();return n%2?-(n+1)/2:n/2;};
  const patterns=[];for(let i=0;i<size;i++){const n=bytes[at++];if(!(n>=1&&n<=24))throw Error('CSP2_LIST');let prev=0;const row=[];for(let j=0;j<n;j++)row.push(prev+=signed());patterns.push(row);}
  const ids=new Uint32Array(count);let length=0;for(let i=0;i<count;i++){const id=read();if(id>size+1)throw Error('CSP2_ID');ids[i]=id;length+=id<2?2-id:patterns[id-2].length+1;}
  const out=new Uint32Array(length);let pos=0;
  for(let i=0;i<count;i++){const id=ids[i],origin=(Math.floor(i/maximum)+1)*512+i%maximum+1;if(id===0){out[pos++]=1;out[pos++]=origin;}else if(id===1)out[pos++]=0;else{const anchor=origin+signed(),row=patterns[id-2];out[pos++]=row.length;for(const delta of row){const target=anchor+delta;if(target<0||target>=262144)throw Error('CSP2_TARGET');out[pos++]=target;}}}
  if(at!==bytes.length)throw Error('CSP2_LENGTH');return out.buffer;
 };
})(globalThis);
