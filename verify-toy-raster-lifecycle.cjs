/* A completed old request must not cross the replacement worker boundary. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const workers=[],warnings=[];
class Worker{
 constructor(){this.messages=[];workers.push(this);}
 postMessage(message){if(this.throwSend)throw Error('Cannot clone scene');this.messages.push(message);}
 terminate(){this.terminated=true;}
 reply(message=this.messages.at(-1),images=[]){this.onmessage({data:{id:message.id,images}});}
}
const context={Worker,OffscreenCanvas:class{},createImageBitmap:async image=>({...image,close(){}}),URL,DOMException,performance,setTimeout,clearTimeout,document:{baseURI:'http://localhost/maps.html'},CrateWebConfig:{liveVersion:1},console:{warn:(...args)=>warnings.push(args)}};
vm.createContext(context);vm.runInContext(fs.readFileSync('toy-live/raster.js','utf8'),context);
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();},scene=()=>({data:{assets:[],size:[16,16]},commands:[],layers:[[],[]],images:[{}]}),result=promise=>promise.then(value=>({value}),error=>({error}));
(async()=>{
 const raster=context.CrateLiveRaster,a=scene(),b=scene();
 const old=result(raster.tile(a,[0,0,8,8]));await flush();const first=workers.at(-1);assert(first.messages[0].scene);
 first.reply();const next=result(raster.tile(b,[0,0,8,8]));await flush();
 assert.equal((await old).error?.name,'AbortError','A resolved prepare cannot send its tile to a replacement worker');
 const second=workers.at(-1);assert.equal(second.messages.length,1);assert(second.messages[0].scene);
 first.onerror();assert(!second.terminated,'Late errors from a terminated worker cannot disable its replacement');
 second.reply();await flush();assert(second.messages.at(-1).box);let closed=0;
 second.reply(undefined,[{close(){closed++;}},{close(){closed++;}}]);raster.reset();await flush();
 assert.equal((await next).error?.name,'AbortError','A resolved old tile is rejected before publication');assert.equal(closed,2,'Unpublished old bitmaps are closed');
 const final=result(raster.tile(b,[0,0,8,8]));await flush();const third=workers.at(-1);third.reply();await flush();third.reply(undefined,[{close(){}},{close(){}}]);assert((await final).value.ground);
 assert.equal(warnings.length,0,'Superseded work must not permanently disable background rendering');raster.dispose();
 console.log('PASS replacement during prepare/completed tile, stale worker errors, bitmap cleanup and subsequent raster reuse');
})().catch(error=>{console.error(error);process.exitCode=1;});
