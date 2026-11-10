/* Completed numerical fields only. Readers must retain immutable buffers;
 * replacement jobs copy before writing. Geometry/search models are not stored.
 * The Set allowance intentionally overestimates per-entry storage. */
(function(root){
 'use strict';
 function create({maxBytes=24*1024*1024}={}){const entries=new Map();let bytes=0,hits=0,misses=0,evictions=0;
  function remove(key){const entry=entries.get(key);if(entry){bytes-=entry.bytes;entries.delete(key);}}
  return {get(key){const entry=entries.get(key);if(!entry){misses++;return null;}hits++;entries.delete(key);entries.set(key,entry);return entry.value;},
   put(key,value){remove(key);const size=value.values.byteLength+value.positive.size*64+256;if(size>maxBytes)return;entries.set(key,{value,bytes:size});bytes+=size;while(bytes>maxBytes){remove(entries.keys().next().value);evictions++;}},
   clear(){entries.clear();bytes=0;},get status(){return {entries:entries.size,bytes,maxBytes,hits,misses,evictions};}};
 }
 const api={create};root.CrateBuffFieldCache=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
