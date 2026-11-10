'use strict';
const assert=require('node:assert/strict'),T=require('./toy-live/report-transfer.js');
for(const size of [0,1,256,257,24572])for(const includeSource of [false,true]){
 const cells=Array.from({length:size},(_,x)=>({x,y:x%512,terms:[[1,x]],visibleSurface:[[[0,1],[1,0]]]}));
 const value={report:{cells,metadata:{filename:'test.map'}},search:new Uint8Array([3,9,12]).buffer};
 if(includeSource)value.source={cells,rules:{MTNK:{}}};
 const expected=structuredClone({...value,id:7}),messages=[];
 T.send((packet,transfer)=>messages.push(structuredClone(packet,{transfer})),7,value);
 assert.equal(value.search.byteLength,0);const job={};let actual;
 for(const packet of messages){const result=T.receive(job,packet);if(result)actual=result;}
 assert.deepEqual(actual,expected);assert.equal(job.reportTransfer,undefined);
 assert(messages.every(m=>(m.reportCells?.length||m.sourceCells?.length||0)<=256));
}
const legacy={report:{cells:[]}},job={};assert.equal(T.receive(job,legacy),legacy);
T.receive(job,{reportHeader:true,report:{cells:[]},cellCount:1,sourceCellCount:0});
assert.throws(()=>T.receive(job,{reportDone:true}),/Incomplete/);
T.receive(job,{reportHeader:true,report:{cells:[]},cellCount:1,sourceCellCount:0});
assert.throws(()=>T.receive(job,{reportCells:[{}],offset:1}),/Invalid/);
console.log('PASS chunked report transfer: empty/large reports, prepared source, order/count validation, exact DTO parity, transferred search and legacy compatibility');
(async()=>{
 const message={id:9,preview:true,source:{cells:Array.from({length:20000},(_,x)=>({x})),rules:{}},plan:{placements:[]}};
 const job={},packets=[];let result,clock=0,yields=0;
 await T.postSource(data=>{packets.push(data);const value=T.receiveSource(job,structuredClone(data));if(value)result=value;},message,{now:()=>++clock,yieldToUI:async()=>{yields++;}});
 assert.deepEqual(result,message);assert(yields>10);assert.equal(job.sourceTransfer,undefined);
 packets.length=0;yields=0;clock=0;
 await T.postSource(data=>packets.push(data),message,{valid:()=>yields<2,now:()=>++clock,yieldToUI:async()=>{yields++;}});
 assert.equal(yields,2);assert(!packets.some(p=>p.sourceDone));assert.equal(message.source.cells.length,20000);
 packets.length=0;await T.postSource(data=>packets.push(data),message,{valid:()=>false});assert.equal(packets.length,0);
 console.log('PASS cooperative source transfer: 20,000 unchanged cells, small message tasks, yields, cancellation and no incomplete publication');
})().catch(error=>{console.error(error);process.exitCode=1;});
