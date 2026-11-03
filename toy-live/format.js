/* Bounded map readers. LZO instruction layout follows lzokay (MIT), see
 * lzokay-LICENSE.txt and https://github.com/AxioDL/lzokay. No native runtime. */
(function(root){
 'use strict';
 const fail=message=>{throw Error(message);};
 function text(bytes){for(const name of ['utf-8','gb18030','windows-1252'])try{return new TextDecoder(name,{fatal:true}).decode(bytes);}catch{}fail('无法识别地图文字编码 / Unknown text encoding');}
 // Strict by default. A caller opting into recovery receives every conflict;
 // the last occurrence is retained as an explicit assumption, not engine parity.
 function ini(value,onConflict=null){const out=Object.create(null),positions=Object.create(null);let section=null,name='',number=0;
  for(const raw of value.split(/\r?\n/)){number++;const line=raw.split(';')[0].trim();if(/^\[.*\]$/.test(line)){name=line.slice(1,-1).trim().toUpperCase();section=out[name]||=(Object.create(null));positions[name]||=Object.create(null);}else if(section&&line.includes('=')){const at=line.indexOf('='),key=line.slice(0,at).trim().toUpperCase(),v=line.slice(at+1).trim();
   if(Object.hasOwn(section,key)&&section[key]!==v){const detail={section:name,key,previousLine:positions[name][key],line:number,previousValue:section[key],selectedValue:v};if(onConflict)onConflict(detail);else{const error=Error(`重复且冲突的 INI 键 / Conflicting INI key: [${name}] ${key} · lines ${detail.previousLine}, ${number} · ${detail.previousValue} → ${v}`);error.context=detail;throw error;}}
   section[key]=v;positions[name][key]=number;
  }}return out;
 }
 function integer(value){const s=String(value??'').trim();if(s.startsWith('$'))return parseInt(s.slice(1),16)||0;if(/h$/i.test(s))return parseInt(s.slice(0,-1),16)||0;return parseInt(s.match(/^[+-]?\d+/)?.[0]||'0',10);}
 const yes=v=>/^(yes|true|1)$/i.test(String(v)),number=v=>{const n=Number(String(v??0).replace(/%$/,''));if(!Number.isFinite(n))fail('无效的数值 / Invalid number');return n;};
 function reader(input,length){let ip=0,op=0;const out=new Uint8Array(length),byte=()=>{if(ip>=input.length)fail('压缩数据截断 / Truncated compressed data');return input[ip++];},word=()=>byte()|byte()<<8;
  const literal=n=>{if(n<0||ip+n>input.length||op+n>length)fail('解压字面数据越界 / Literal overrun');out.set(input.subarray(ip,ip+n),op);ip+=n;op+=n;};
  const copy=(start,n)=>{if(start<0||start>=op||n<0||op+n>length)fail('解压回溯越界 / Match overrun');for(let i=0;i<n;i++)out[op++]=out[start+i];};
  return {out,byte,word,literal,copy,get ip(){return ip;},get op(){return op;},finish:()=>{if(ip!==input.length||op!==length)fail('解压长度不符 / Decompressed length mismatch');return out;},fill:(v,n)=>{if(op+n>length)fail('解压填充越界 / Fill overrun');out.fill(v,op,op+n);op+=n;}};
 }
 function lcw(input,length){const r=reader(input,length),relative=input[0]===0;if(relative)r.byte();while(r.ip<input.length){const c=r.byte();if(c===128)break;if(c<128)r.copy(r.op-(((c&15)<<8)|r.byte()),(c>>4)+3);else if(c<192)r.literal(c&63);else if(c===254){const n=r.word();r.fill(r.byte(),n);}else{const n=c===255?r.word():(c&63)+3,p=r.word();r.copy(relative?r.op-p:p,n);}}return r.finish();}
 function lzo(input,length){const r=reader(input,length);let state=0;if(input[0]>=18){state=r.byte()-17;r.literal(state);if(state>=4)state=4;}
  const extended=base=>{let n=base,b;while((b=r.byte())===0){n+=255;if(n>length)fail('LZO length overrun');}return n+b;};
  while(true){const c=r.byte();let n,p,next;
   if(c>=64){p=r.op-((r.byte()<<3)+((c>>2)&7)+1);n=(c>>5)+1;next=c&3;}
   else if(c>=32){n=(c&31)+2;if(n===2)n=extended(33);const d=r.word();p=r.op-(d>>2)-1;next=d&3;}
   else if(c>=16){n=(c&7)+2;if(n===2)n=extended(9);const d=r.word();p=r.op-((c&8)<<11)-(d>>2);next=d&3;if(p===r.op){if(n!==3)fail('Invalid LZO terminator');break;}p-=16384;}
   else if(state===0){n=c+3;if(n===3)n=extended(18);r.literal(n);state=4;continue;}
   else{next=c&3;p=r.op-(c>>2)-(r.byte()<<2)-(state===4?2049:1);n=state===4?3:2;}
   r.copy(p,n);r.literal(next);state=next;
  }return r.finish();
 }
 function pack(map,name,required=true){const cfg=map[name.toUpperCase()];if(!cfg){if(required)fail('缺少地图区块 / Missing map section: '+name);return null;}const keys=Object.keys(cfg);if(keys.some(k=>!/^\d+$/.test(k)))fail('Invalid packed section key');const encoded=keys.sort((a,b)=>Number(a)-Number(b)).map(k=>cfg[k]).join('');if(encoded.length>6000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('Invalid packed Base64');let binary;try{binary=atob(encoded);}catch{fail('Invalid packed Base64');}const raw=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(raw.buffer),blocks=[];let pos=0,total=0;
  while(pos<raw.length){if(pos+4>raw.length)fail('Truncated pack header');const size=view.getUint16(pos,true),expanded=view.getUint16(pos+2,true);pos+=4;if(!size||!expanded||expanded>8192||pos+size>raw.length||(total+=expanded)>4000000)fail('Invalid pack bounds');blocks.push([pos,size,expanded]);pos+=size;}
  if(!total)fail('Empty packed section');const out=new Uint8Array(total);pos=0;for(const[start,size,n]of blocks){out.set((name.startsWith('Overlay')?lcw:lzo)(raw.subarray(start,start+size),n),pos);pos+=n;}return out;
 }
 const api={text,ini,integer,yes,number,lcw,lzo,pack};root.CrateLiveFormat=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
