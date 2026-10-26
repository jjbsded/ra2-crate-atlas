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
 function draw(ctx,state,view,{radius=13,offset=0,clip=null,regionStyles=null}={}){
  ctx.save();
  if(clip){ctx.beginPath();ctx.rect(clip.x,clip.y,clip.w,clip.h);ctx.clip();}
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${Math.round(radius*1.35)}px "Microsoft YaHei",sans-serif`;
  for(const p of positions(state)){
   const style=regionStyles?.[p.number],stem=style?Math.max(offset,radius*1.65):offset,side=radius*1.3;
   const x=view.x+p.px*view.scale,y=view.y+p.py*view.scale-stem;
   const reach=style?radius*1.4:radius,bottom=style?stem+side:radius;
   if(clip&&(x+reach<clip.x||x-reach>clip.x+clip.w||y+bottom<clip.y||y-radius>clip.y+clip.h))continue;
   ctx.save();if(style?.empty)ctx.globalAlpha*=.42;
   if(stem){ctx.beginPath();ctx.moveTo(x,y+radius);ctx.lineTo(x,y+stem);ctx.strokeStyle=style?'#050a0b':'#102531';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle=style?'#fff':'#ffe39c';ctx.lineWidth=1;ctx.stroke();}
   ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle='#172b37';ctx.fill();
   ctx.strokeStyle='#091119';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle=style?'#fff':'#f5d484';ctx.lineWidth=1.3;ctx.stroke();
   ctx.fillStyle=style?'#fff':'#fff1be';ctx.fillText(String(p.number),x,y+.3);
   if(style&&!style.empty){
    ctx.beginPath();ctx.rect(x-side/2,y+stem,side,side);ctx.fillStyle=style.color;ctx.fill();
    ctx.strokeStyle='#050a0b';ctx.lineWidth=Math.max(3,radius*.25);ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(1,radius*.1);ctx.stroke();
    if(style.team){ctx.font=`800 ${radius*1.12}px "Microsoft YaHei",sans-serif`;ctx.lineJoin='round';ctx.strokeStyle='#050a0b';ctx.lineWidth=Math.max(1.5,radius*.16);ctx.strokeText(style.team,x,y+stem+side/2+.3);ctx.fillStyle='#fff';ctx.fillText(style.team,x,y+stem+side/2+.3);}
   }
   ctx.restore();
   if(style?.empty){ctx.save();ctx.globalAlpha*=.65;ctx.strokeStyle='#f24b53';ctx.lineWidth=Math.max(2,radius*.25);ctx.lineCap='round';const dy=radius+1.5-ctx.lineWidth/2;ctx.beginPath();ctx.moveTo(x-radius*1.35,y-dy);ctx.lineTo(x+radius*1.35,y+dy);ctx.moveTo(x+radius*1.35,y-dy);ctx.lineTo(x-radius*1.35,y+dy);ctx.stroke();ctx.restore();}
  }
  ctx.restore();
 }
 const api={positions,draw};root.CratePlayerStarts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
