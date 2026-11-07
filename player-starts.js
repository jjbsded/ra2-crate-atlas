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
 function markerBounds(m,radius){
  const badgeX=m.style?.empty?radius*1.5:radius+1.5,badgeY=radius+1.5;
  let left=m.x-badgeX,right=m.x+badgeX,top=m.y-badgeY,bottom=m.y+badgeY;
  if(m.stem){const reach=m.square?m.side/2+1.5:1.5;left=Math.min(left,m.anchorX-reach);right=Math.max(right,m.anchorX+reach);top=Math.min(top,m.anchorY-reach);bottom=Math.max(bottom,m.anchorY+reach);}
  return {x:left,y:top,w:right-left,h:bottom-top};
 }
 function fitMarker(marker,clip,radius){
  let best=null,score=Infinity;
  for(const [direction,dx,dy]of [['up',0,-1],['right',1,0],['down',0,1],['left',-1,0]]){
   const m={...marker,direction,dx,dy,x:marker.anchorX+dx*marker.distance,y:marker.anchorY+dy*marker.distance},b=markerBounds(m,radius);
   const x=Math.max(clip.x+1,Math.min(b.x,clip.x+clip.w-b.w-1))-b.x,y=Math.max(clip.y+1,Math.min(b.y,clip.y+clip.h-b.h-1))-b.y,d=x*x+y*y;
   if(d>=score)continue;score=d;m.x+=x;m.y+=y;m.anchorX+=x;m.anchorY+=y;m.bounds=markerBounds(m,radius);best=m;
  }
  return best;
 }
 function draw(ctx,state,view,{radius=13,offset=0,clip=null,regionStyles=null,focusPlayers=[],includePlayers=null,fit=false}={}){
  ctx.save();
  if(clip){ctx.beginPath();ctx.rect(clip.x,clip.y,clip.w,clip.h);ctx.clip();}
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${Math.round(radius*1.35)}px "Microsoft YaHei",sans-serif`;
  const priority=new Set(Array.isArray(focusPlayers)?focusPlayers:[focusPlayers]),included=includePlayers===null?null:new Set(includePlayers),markers=[],sx=view.scaleX??view.scale,sy=view.scaleY??view.scale;
  for(const p of positions(state)){
   if(included&&!included.has(p.number))continue;
   const style=regionStyles?.[p.number],stem=style?Math.max(offset,radius*1.65):offset,side=radius*1.3;
   const point={x:view.x+p.px*sx,y:view.y+p.py*sy},x=point.x,y=point.y-stem;
   const reach=style?radius*1.4:radius,bottom=style?stem+side:radius;
   if(fit&&clip){
    const cell=state.lookup.get(`${p.x},${p.y}`),rings=cell?.surface||[[[0,-15],[30,0],[0,15],[-30,0]]];let left=Infinity,top=Infinity,right=-Infinity,below=-Infinity;
    for(const ring of rings)for(const [dx,dy]of ring){left=Math.min(left,point.x+dx*sx);right=Math.max(right,point.x+dx*sx);top=Math.min(top,point.y+dy*sy);below=Math.max(below,point.y+dy*sy);}
    if(right<clip.x||left>clip.x+clip.w||below<clip.y||top>clip.y+clip.h)continue;
   }else if(clip&&(x+reach<clip.x||x-reach>clip.x+clip.w||y+bottom<clip.y||y-radius>clip.y+clip.h))continue;
   const square=!!style&&!style.empty,marker={p,style,x,y,point,stem,side,square,anchorX:point.x,anchorY:point.y+(square?side/2:0),distance:stem+(square?side/2:0),direction:'up',dx:0,dy:-1};
   marker.bounds=markerBounds(marker,radius);markers.push(fit&&clip?fitMarker(marker,clip,radius):marker);
  }
  function colors({style,x,y,stem,side,anchorX,anchorY,dx,dy,square}){
   ctx.save();if(style?.empty)ctx.globalAlpha*=.42;
   if(stem){ctx.beginPath();ctx.moveTo(x-dx*radius,y-dy*radius);ctx.lineTo(anchorX+dx*(square?side/2:0),anchorY+dy*(square?side/2:0));ctx.strokeStyle=style?'#050a0b':'#102531';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle=style?'#fff':'#ffe39c';ctx.lineWidth=1;ctx.stroke();}
   if(style&&!style.empty){
    ctx.beginPath();ctx.rect(anchorX-side/2,anchorY-side/2,side,side);ctx.fillStyle=style.color;ctx.fill();
    ctx.strokeStyle='#050a0b';ctx.lineWidth=Math.max(3,radius*.25);ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(1,radius*.1);ctx.stroke();
    if(style.team){ctx.font=`800 ${radius*1.12}px "Microsoft YaHei",sans-serif`;ctx.lineJoin='round';ctx.strokeStyle='#050a0b';ctx.lineWidth=Math.max(1.5,radius*.16);ctx.strokeText(style.team,anchorX,anchorY+.3);ctx.fillStyle='#fff';ctx.fillText(style.team,anchorX,anchorY+.3);}
   }
   ctx.restore();
  }
  function badge({style,x,y}){
   ctx.save();if(style?.empty)ctx.globalAlpha*=.42;
   ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle='#172b37';ctx.fill();
   ctx.strokeStyle='#091119';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle=style?'#fff':'#f5d484';ctx.lineWidth=1.3;ctx.stroke();ctx.restore();
   if(style?.empty){ctx.save();ctx.globalAlpha*=.65;ctx.strokeStyle='#f24b53';ctx.lineWidth=Math.max(2,radius*.25);ctx.lineCap='round';const dy=radius+1.5-ctx.lineWidth/2;ctx.beginPath();ctx.moveTo(x-radius*1.35,y-dy);ctx.lineTo(x+radius*1.35,y+dy);ctx.moveTo(x+radius*1.35,y-dy);ctx.lineTo(x-radius*1.35,y+dy);ctx.stroke();ctx.restore();}
  }
  function number({p,style,x,y}){ctx.save();if(style?.empty)ctx.globalAlpha*=.42;ctx.fillStyle=style?'#fff':'#fff1be';ctx.fillText(String(p.number),x,y+.3);ctx.restore();}
  for(const focused of [false,true]){
   const layer=markers.filter(m=>priority.has(m.p.number)===focused);
   for(const marker of layer)colors(marker);
   for(const marker of layer){badge(marker);number(marker);}
  }
  ctx.restore();return markers;
 }
 const api={positions,draw};root.CratePlayerStarts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
