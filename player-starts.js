/* Map-lobby start numbers, shared by the map, navigation and region previews. */
(function(root){
 'use strict';
 const cache=new WeakMap();
 function positions(state){
  const data=state.data;if(!data||data.metadata.multiplayerOnly===false)return [];
  const prior=cache.get(data);if(prior?.lookup===state.lookup)return prior.points;
  const points=[],origin=data.rendering.origin;
  for(const [id,raw]of Object.entries(data.metadata.waypoints||{})){
   // Only multiplayer slots 0..7. Other waypoints are mission/script locations.
   if(!/^[0-7]$/.test(id)||!/^\d+$/.test(String(raw).trim()))continue;
   const encoded=Number(raw),x=encoded%1000,y=Math.floor(encoded/1000),cell=state.lookup.get(`${x},${y}`);
   if(!cell)continue;
   points.push({number:Number(id)+1,x,y,px:30*(x-y)+origin[0],py:15*(x+y-cell.level)+origin[1]});
  }
  points.sort((a,b)=>a.number-b.number);cache.set(data,{lookup:state.lookup,points});return points;
 }
 function draw(ctx,state,view,{radius=13,offset=0,clip=null}={}){
  ctx.save();
  if(clip){ctx.beginPath();ctx.rect(clip.x,clip.y,clip.w,clip.h);ctx.clip();}
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${Math.round(radius*1.35)}px "Microsoft YaHei",sans-serif`;
  for(const p of positions(state)){
   const x=view.x+p.px*view.scale,y=view.y+p.py*view.scale-offset;
   if(clip&&(x+radius<clip.x||x-radius>clip.x+clip.w||y+radius<clip.y||y-radius>clip.y+clip.h))continue;
   if(offset){ctx.beginPath();ctx.moveTo(x,y+radius);ctx.lineTo(x,y+offset);ctx.strokeStyle='#102531';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#ffe39c';ctx.lineWidth=1;ctx.stroke();}
   ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle='#172b37';ctx.fill();
   ctx.strokeStyle='#091119';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#f5d484';ctx.lineWidth=1.3;ctx.stroke();
   ctx.fillStyle='#fff1be';ctx.fillText(String(p.number),x,y+.3);
  }
  ctx.restore();
 }
 const api={positions,draw};root.CratePlayerStarts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
