/* Static data loading stays off the UI thread. No server or external CDN. */
'use strict';
importScripts('static-codec.js');
const requests=new Map();
async function read(url,type,signal){
 const response=await fetch(url,{signal,cache:'force-cache'});
 if(!response.ok)throw Error('ASSET_HTTP_'+response.status);
 let bytes=await response.arrayBuffer();
 const header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
 if(header[0]===31&&header[1]===139){
  if(typeof DecompressionStream==='undefined')throw Error('BROWSER_GZIP_UNAVAILABLE');
  bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 }
 signal.throwIfAborted();
 return type==='json'?JSON.parse(new TextDecoder().decode(bytes)):bytes;
}
self.onmessage=async({data})=>{
 const {id,url,type,cancel}=data;
 if(cancel){requests.get(id)?.abort();return;}
 const controller=new AbortController();requests.set(id,controller);
 try{
  const raw=await read(url,type,controller.signal);
  const value=type==='json'?await CrateStaticCodec.report(raw,path=>{
   const target=new URL(path,url),base=new URL('./',self.location.href);
   if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname))throw Error('CODEC_BASE_URL');
   return read(target.href,'json',controller.signal);
  }):CrateStaticCodec.search(raw);
  controller.signal.throwIfAborted();
  if(type==='json')self.postMessage({id,value});
  else self.postMessage({id,value},[value]);
 }catch(error){self.postMessage({id,error:error.message});}
 finally{requests.delete(id);}
};
