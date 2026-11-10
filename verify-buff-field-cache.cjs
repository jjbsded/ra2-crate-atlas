'use strict';
const assert=require('node:assert/strict'),C=require('./buff-field-cache.js');
const field=n=>({values:new Float64Array(n),positive:new Set([1,2]),bounds:{left:0,right:3,top:0,bottom:3},maximum:2}),cache=C.create({maxBytes:1100}),a=field(10),b=field(10),c=field(10);
cache.put(1,a);cache.put(2,b);assert.equal(cache.get(1),a);cache.put(3,c);assert.equal(cache.get(2),null,'Byte pressure removes the least recently used field');assert.equal(cache.get(1),a);assert.equal(cache.get(3),c);assert(cache.status.bytes<=1100);assert.equal(cache.status.entries,2);
cache.put(4,field(1000));assert.equal(cache.get(4),null,'An oversized field is not retained');cache.put(1,b);assert.equal(cache.get(1),b);assert(cache.status.bytes<=1100);cache.clear();assert.equal(cache.status.entries,0);assert.equal(cache.status.bytes,0);
console.log('PASS byte-bounded completed-field LRU, warm reuse, replacement, oversized entries and layout invalidation');
