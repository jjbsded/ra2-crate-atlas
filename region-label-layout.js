/* Bounded, deterministic label placement. No per-frame force simulation. */
(function(root){
 'use strict';
 const defaults=Object.freeze({maxSpeed:8000,acceleration:20000});
 function createMotion({settle=50,tolerance=2}={}){
  let reference=null,changedAt=0,lastAt=0;
  return {reset(){reference=null;},setSettle(value){settle=Math.max(0,Math.min(5000,Number(value)||0));},observe(view,area,now){
   const shape=[area.x,area.y,area.w,area.h].join('|');
   if(!reference||now<lastAt){reference={x:view.x,y:view.y,scale:view.scale,shape};changedAt=now-settle;}
   else{
    const factor=view.scale/reference.scale,dx=view.x-reference.x*factor,dy=view.y-reference.y*factor;
    const distance=Math.max(...[area.x,area.x+area.w].flatMap(x=>[area.y,area.y+area.h].map(y=>Math.hypot(dx+x*(factor-1),dy+y*(factor-1)))));
    if(reference.shape!==shape||distance>tolerance){reference={x:view.x,y:view.y,scale:view.scale,shape};changedAt=now;}
   }
   lastAt=now;const remaining=Math.max(0,settle-(now-changedAt));return {settled:remaining===0,remaining};
  }};
 }
 function overlap(a,b,x=a.x,y=a.y){
  const w=Math.min(x+a.halfWidth,b.x+b.halfWidth)-Math.max(x-a.halfWidth,b.x-b.halfWidth);
  const h=Math.min(y+a.halfHeight,b.y+b.halfHeight)-Math.max(y-a.halfHeight,b.y-b.halfHeight);
  return Math.max(0,w)*Math.max(0,h);
 }
 const intersects=(x,y,w,h,c)=>x+w>=c.l&&x-w<=c.r&&y+h>=c.t&&y-h<=c.b;
 function transport(motion,view){
  if(motion.viewX===view.x&&motion.viewY===view.y&&motion.scale===view.scale)return false;
  const factor=view.scale/motion.scale;
  motion.x=view.x+(motion.x-motion.viewX)*factor;
  motion.y=view.y+(motion.y-motion.viewY)*factor;
  motion.targetX=view.x+(motion.targetX-motion.viewX)*factor;
  motion.targetY=view.y+(motion.targetY-motion.viewY)*factor;
  motion.vx=(motion.vx||0)*factor;motion.vy=(motion.vy||0)*factor;
  motion.viewX=view.x;motion.viewY=view.y;motion.scale=view.scale;
  // Relocation keeps its world-space destination when the camera moves.
  return true;
 }
 function advance(motion,clip,halfWidth,halfHeight,now,{maxSpeed=defaults.maxSpeed,acceleration=defaults.acceleration}={}){
  const dt=Math.min(.05,Math.max(0,(now-motion.frameAt)/1000));motion.frameAt=now;
  const visible=intersects(motion.x,motion.y,motion.halfWidth??halfWidth,motion.halfHeight??halfHeight,clip);
  motion.halfWidth=halfWidth;motion.halfHeight=halfHeight;
  let dx=motion.targetX-motion.x,dy=motion.targetY-motion.y,distance=Math.hypot(dx,dy);
  if(!visible){
   // Skip the invisible portion only. A single touching point counts as visible.
   const bounds={l:clip.l-halfWidth,r:clip.r+halfWidth,t:clip.t-halfHeight,b:clip.b+halfHeight};
   let enter=0,leave=1;
   for(const [position,delta,low,high]of [[motion.x,dx,bounds.l,bounds.r],[motion.y,dy,bounds.t,bounds.b]]){
    if(!delta){if(position<low||position>high){enter=2;break;}continue;}
    const a=(low-position)/delta,b=(high-position)/delta;enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
   }
   const fraction=enter<=leave&&enter<=1?Math.min(1,enter+1e-10):1;
   motion.x+=dx*fraction;motion.y+=dy*fraction;motion.vx=motion.vy=0;
   if(intersects(motion.x,motion.y,halfWidth,halfHeight,clip))motion.appearedAt=now;
   return Math.hypot(motion.targetX-motion.x,motion.targetY-motion.y)>.2;
  }
  if(distance<=.2){motion.x=motion.targetX;motion.y=motion.targetY;motion.vx=motion.vy=0;return false;}
  const ux=dx/distance,uy=dy/distance;
  // Only forward speed belongs to the new segment. Retaining sideways or
  // reverse velocity makes a moving camera's target orbit or fly past us.
  const start=Math.min(maxSpeed,Math.max(0,(motion.vx||0)*ux+(motion.vy||0)*uy));
  const desired=Math.min(maxSpeed,distance/.12,Math.sqrt(2*acceleration*distance));
  const speed=start+Math.sign(desired-start)*Math.min(Math.abs(desired-start),acceleration*dt);
  const travel=Math.min(maxSpeed*dt,(start+speed)*dt/2);
  if(travel>=distance){motion.x=motion.targetX;motion.y=motion.targetY;motion.vx=motion.vy=0;return false;}
  motion.vx=ux*speed;motion.vy=uy*speed;
  motion.x+=ux*travel;motion.y+=uy*travel;return true;
 }
 function avoid(items,{limit=64,budget=16000,gap=5}={}){
  const ordered=items.slice().sort((a,b)=>(a.priority||0)-(b.priority||0)||a.id.localeCompare(b.id,undefined,{numeric:true})),placed=[],result=new Map();let checks=0;
  for(const item of ordered){
   const valid=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&item.contains(x,y);
   const initial=valid(item.x,item.y)?{x:item.x,y:item.y}:{x:item.preferredX,y:item.preferredY};
   let best={...initial},originalArea=0;
   const score=(x,y)=>{
    let area=0;for(const box of placed){if(++checks>budget)break;area+=overlap(item,box,x,y);}
    return {area,cost:area*100+.05*((x-item.preferredX)**2+(y-item.preferredY)**2)+.02*((x-initial.x)**2+(y-initial.y)**2)};
   };
   if(placed.length<limit&&checks<budget){
    const first=score(initial.x,initial.y);let bestScore=first.cost;originalArea=first.area;
    const candidates=[{x:item.preferredX,y:item.preferredY}];
    for(const box of placed){
     if(!overlap(item,box,initial.x,initial.y)&&!overlap(item,box,item.preferredX,item.preferredY))continue;
     const dx=item.halfWidth+box.halfWidth+gap,dy=item.halfHeight+box.halfHeight+gap;
     candidates.push({x:box.x-dx,y:initial.y},{x:box.x+dx,y:initial.y},{x:initial.x,y:box.y-dy},{x:initial.x,y:box.y+dy});
     if(candidates.length>=25)break;
    }
    for(const p of candidates){
     if(checks>=budget)break;if(!valid(p.x,p.y))continue;const next=score(p.x,p.y);
     if(next.cost<bestScore){best=p;bestScore=next.cost;}
    }
    // Small changes in an unavoidable overlap must not make titles hunt.
    if(first.cost-bestScore<Math.max(25,originalArea*2))best=initial;
   }
   const value={...item,x:best.x,y:best.y};placed.push(value);result.set(item.id,value);
  }
  return {positions:result,checks:Math.min(checks,budget)};
 }
 const api={defaults,createMotion,avoid,overlap,advance,transport};root.CrateRegionLabelLayout=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
