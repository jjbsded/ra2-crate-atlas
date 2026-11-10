/* Immutable numeric/geometry transport. Live edits send changed slots only. */
(function(root){
 'use strict';
 const SIZE=512,AREA=SIZE*SIZE,id=c=>c.y*SIZE+c.x;
 const flags=c=>(c.candidate?(+c.track|(+c.float<<1)):0)|(+c.primary<<2)|(+ (c.land===2)<<3);
 const status=c=>c.status==='crate'?1:c.status==='ghost'?2:0;
 const probability=data=>({attemptLimit:data.probability.attemptLimit,exact:{coefficients:data.probability.exact.coefficients}});
 function* pack(data,sourceId){
  const headers=new Int32Array(data.cells.length*6),points=[],index=new Int32Array(AREA).fill(-1),grid=new Uint8Array(AREA),statuses=new Uint8Array(AREA);
  for(let i=0;i<data.cells.length;i++){
   const c=data.cells[i],key=id(c),start=points.length;grid[key]=flags(c);statuses[key]=status(c);index[key]=i*6;
   for(const ring of c.visibleSurface||c.surface||[]){points.push(ring.length);for(const p of ring)points.push(...p);}
   headers.set([key,c.px,c.py,c.land??-1,start,points.length],i*6);if((i&255)===255)yield;
  }
  return {wire:{id:sourceId,metadata:{size:data.metadata.size},probability:probability(data),packed:{grid,statuses},geometry:{headers,points:Float32Array.from(points)}},index,count:data.cells.length};
 }
 function* patch(base,data,sourceId,changed){
  if(base.count!==data.cells.length)return null;
  const old=base.wire,delta=[],lands=[];let grid=old.packed.grid,statuses=old.packed.statuses,headers=old.geometry.headers,work=0;
  for(const c of changed){
   const key=id(c),slot=base.index[key];if(slot<0)return null;
   const g=flags(c),s=status(c);if(grid[key]!==g||statuses[key]!==s){if(grid===old.packed.grid){grid=grid.slice();statuses=statuses.slice();}grid[key]=g;statuses[key]=s;delta.push(key,g,s);}
   if(headers[slot+3]!== (c.land??-1)){if(headers===old.geometry.headers)headers=headers.slice();headers[slot+3]=c.land??-1;lands.push(slot+3,c.land??-1);}
   if((++work&255)===0)yield;
  }
  const p=probability(data),wire={id:sourceId,metadata:old.metadata,probability:p,packed:{grid,statuses},geometry:{headers,points:old.geometry.points}};
  const sameProbability=p.attemptLimit===old.probability.attemptLimit&&p.exact.coefficients===old.probability.exact.coefficients;
  return {wire,index:base.index,count:base.count,update:{baseId:old.id,id:sourceId,delta:Uint32Array.from(delta),lands:Int32Array.from(lands),probability:sameProbability?null:p}};
 }
 function apply(base,update){
  if(!base||base.id!==update.baseId)return null;
  const packed=update.delta.length?{grid:base.packed.grid.slice(),statuses:base.packed.statuses.slice()}:base.packed;
  for(let i=0;i<update.delta.length;i+=3){const key=update.delta[i];packed.grid[key]=update.delta[i+1];packed.statuses[key]=update.delta[i+2];}
  const headers=update.lands.length?base.geometry.headers.slice():base.geometry.headers;
  for(let i=0;i<update.lands.length;i+=2)headers[update.lands[i]]=update.lands[i+1];
  return {...base,id:update.id,probability:update.probability||base.probability,packed,geometry:{headers,points:base.geometry.points}};
 }
 const api={pack,patch,apply};root.CrateBuffSource=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
