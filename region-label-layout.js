/* Bounded, deterministic label placement. No per-frame force simulation. */
(function(root){
 'use strict';
 const defaults=Object.freeze({maxSpeed:8000,acceleration:20000,lazy:true,insetEnabled:true,insetWidth:.25,insetHeight:.25,returnMargin:.08,returnVisible:.35,maxShrink:.5,sizeTime:120,edgeOnlyEnabled:false,edgeBand:.15});
 const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
 const nonnegative=(value,fallback)=>Number.isFinite(value)&&value>=0?value:fallback;
 function insetClip(clip,settings=defaults){
  if(settings.insetEnabled===false)return clip;
  const fraction=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
  const dx=(clip.r-clip.l)*(1-fraction(settings.insetWidth,defaults.insetWidth))/2,dy=(clip.b-clip.t)*(1-fraction(settings.insetHeight,defaults.insetHeight))/2;
  return {l:clip.l+dx,r:clip.r-dx,t:clip.t+dy,b:clip.b-dy};
 }
 function createMotion({settle=50,tolerance=2}={}){
  let reference=null,changedAt=0,lastAt=0;
  return {reset(){reference=null;},setSettle(value){settle=nonnegative(Number(value),settle);},observe(view,area,now){
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
  if(motion.sizeTravel){const p=motion.sizeTravel;p.fromX=view.x+(p.fromX-motion.viewX)*factor;p.fromY=view.y+(p.fromY-motion.viewY)*factor;p.toX=view.x+(p.toX-motion.viewX)*factor;p.toY=view.y+(p.toY-motion.viewY)*factor;}
  for(const p of motion.fade?.out||[]){p.x=view.x+(p.x-motion.viewX)*factor;p.y=view.y+(p.y-motion.viewY)*factor;}
  motion.vx=(motion.vx||0)*factor;motion.vy=(motion.vy||0)*factor;
  motion.viewX=view.x;motion.viewY=view.y;motion.scale=view.scale;
  // Relocation keeps its world-space destination when the camera moves.
  return true;
 }
 function advance(motion,clip,halfWidth,halfHeight,now,{maxSpeed=defaults.maxSpeed,acceleration=defaults.acceleration}={}){
  const dt=Math.min(.05,Math.max(0,(now-motion.frameAt)/1000));motion.frameAt=now;
  motion.entrySkipped=false;
  let dx=motion.targetX-motion.x,dy=motion.targetY-motion.y,distance=Math.hypot(dx,dy);
  const actualWidth=motion.halfWidth??halfWidth,actualHeight=motion.halfHeight??halfHeight;
  if(distance<=.2)motion.entryHalfWidth=motion.entryHalfHeight=undefined;
  if(motion.entryHalfWidth!==undefined){motion.entryHalfWidth=Math.max(motion.entryHalfWidth,actualWidth);motion.entryHalfHeight=Math.max(motion.entryHalfHeight,actualHeight);}
  // After the first offscreen skip, font shrink must not move the entry edge
  // inward and trigger another skip/reset. The guard only grows this leg.
  const visible=intersects(motion.x,motion.y,actualWidth,actualHeight,clip)||motion.entryHalfWidth!==undefined&&intersects(motion.x,motion.y,motion.entryHalfWidth,motion.entryHalfHeight,clip);
  motion.halfWidth=halfWidth;motion.halfHeight=halfHeight;
  if(!visible){
   // Skip the invisible portion only. A single touching point counts as visible.
   const bounds={l:clip.l-actualWidth,r:clip.r+actualWidth,t:clip.t-actualHeight,b:clip.b+actualHeight};
   let enter=0,leave=1;
   for(const [position,delta,low,high]of [[motion.x,dx,bounds.l,bounds.r],[motion.y,dy,bounds.t,bounds.b]]){
    if(!delta){if(position<low||position>high){enter=2;break;}continue;}
    const a=(low-position)/delta,b=(high-position)/delta;enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
   }
   const fraction=enter<=leave&&enter<=1?Math.min(1,enter+1e-10):1;
   motion.x+=dx*fraction;motion.y+=dy*fraction;motion.vx=motion.vy=0;
   motion.entrySkipped=fraction>0;
   if(distance>.2){motion.entryHalfWidth=Math.max(motion.entryHalfWidth||0,actualWidth);motion.entryHalfHeight=Math.max(motion.entryHalfHeight||0,actualHeight);}
   if(intersects(motion.x,motion.y,actualWidth,actualHeight,clip))motion.appearedAt=now;
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
  if(travel>=distance){motion.x=motion.targetX;motion.y=motion.targetY;motion.vx=motion.vy=0;motion.entryHalfWidth=motion.entryHalfHeight=undefined;return false;}
  motion.vx=ux*speed;motion.vy=uy*speed;
  motion.x+=ux*travel;motion.y+=uy*travel;return true;
 }
 function avoid(items,{limit=64,budget=16000,gap=5}={}){
  const ordered=items.slice().sort((a,b)=>Number(!!b.locked)-Number(!!a.locked)||(a.priority||0)-(b.priority||0)||a.id.localeCompare(b.id,undefined,{numeric:true})),placed=[],result=new Map();let checks=0;
  for(const item of ordered){
   const valid=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&item.contains(x,y);
   const initial=valid(item.x,item.y)?{x:item.x,y:item.y}:valid(item.preferredX,item.preferredY)?{x:item.preferredX,y:item.preferredY}:null;
   if(!initial)continue;
   let best={...initial},originalArea=0;
   const score=(x,y)=>{
    let area=0;for(const box of placed){if(++checks>budget)break;area+=overlap(item,box,x,y);}
    return {area,cost:area*100+.05*((x-item.preferredX)**2+(y-item.preferredY)**2)+.02*((x-initial.x)**2+(y-initial.y)**2)};
   };
   if(!item.locked&&placed.length<limit&&checks<budget){
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
 function fadeFrames(m,now){
  const f=m.fade;if(!f)return {frames:[{x:m.x,y:m.y,alpha:1}],active:false};
  const elapsed=Math.max(0,now-f.at),out=f.outTime?Math.max(0,1-elapsed/f.outTime):0,alpha=elapsed<f.delay?0:f.inTime?Math.min(1,(elapsed-f.delay)/f.inTime):1;
  const frames=f.out.map(p=>({...p,alpha:p.alpha*out})).filter(p=>p.alpha>0);if(alpha>0)frames.push({x:m.x,y:m.y,alpha});
  const active=elapsed<Math.max(f.outTime,f.delay+f.inTime);if(!active)m.fade=null;return {frames,active};
 }
 function fadeTo(m,x,y,now,settings,clip,halfWidth,halfHeight){
  if(m.visible&&!m.hidden&&Math.hypot(m.x-x,m.y-y)<.2){m.x=m.targetX=x;m.y=m.targetY=y;return;}
  const old=m.visible&&!m.hidden?fadeFrames(m,now).frames.filter(p=>p.alpha>0&&intersects(p.x,p.y,halfWidth,halfHeight,clip)).sort((a,b)=>b.alpha-a.alpha).slice(0,4):[];
  const outTime=old.length?Math.max(0,Number(settings.fadeOut)||0):0,inTime=Math.max(0,Number(settings.fadeIn)||0);
  m.x=m.targetX=x;m.y=m.targetY=y;m.vx=m.vy=0;m.hidden=false;m.visible=true;m.fade={at:now,out:old,outTime,inTime,delay:settings.simultaneous?0:outTime};
 }
 function fitRatio(fit,clip,region){return Math.min(1,(clip.r-clip.l)/(2*(fit.halfWidth+fit.pad)),(clip.b-clip.t)/(2*fit.height),.92*(region.r-region.l)/(2*(fit.halfWidth+fit.pad)),.92*(region.b-region.t)/(2*fit.height));}
 function fullyVisible(x,y,halfWidth,halfHeight,clip){return x-halfWidth>=clip.l&&x+halfWidth<=clip.r&&y-halfHeight>=clip.t&&y+halfHeight<=clip.b;}
 function edgeOnly(bounds,clip,settings=defaults){
  if(settings.edgeOnlyEnabled===false)return false;
  const band=nonnegative(settings.edgeBand,defaults.edgeBand),dx=(clip.r-clip.l)*band,dy=(clip.b-clip.t)*band;
  return bounds.r<=clip.l+dx||bounds.l>=clip.r-dx||bounds.b<=clip.t+dy||bounds.t>=clip.b-dy;
 }
 function returnAllowed(x,y,halfWidth,halfHeight,clip,visible,settings=defaults){
  if(!fullyVisible(x,y,halfWidth,halfHeight,clip))return false;
  if(visible>=finite(settings.returnVisible,defaults.returnVisible))return true;
  const margin=finite(settings.returnMargin,defaults.returnMargin),dx=(clip.r-clip.l)*margin,dy=(clip.b-clip.t)*margin;
  return fullyVisible(x,y,halfWidth,halfHeight,{l:clip.l+dx,r:clip.r-dx,t:clip.t+dy,b:clip.b-dy});
 }
 function edgeFit(x,y,fit,clip,measure,settings=defaults){
  if(fullyVisible(x,y,fit.halfWidth+fit.pad,fit.height,clip))return fit;
  const limit=nonnegative(settings.maxShrink,defaults.maxShrink);if(!limit)return fit;
  const width=Math.min(x-clip.l,clip.r-x),height=Math.min(y-clip.t,clip.b-y);
  // The 3 px fixed padding does not shrink with the font. Reject impossible
  // anchors before any text measurement, then try the largest useful size.
  const ratio=Math.min(1,(width-3)/(fit.halfWidth+fit.pad-3),(height-3)/(fit.height-3)),minimum=Math.max(1-limit,3/fit.size);
  let result=measure(fit.size*Math.max(minimum,ratio*.995));
  if(fullyVisible(x,y,result.halfWidth+result.pad,result.height,clip))return result;
  // Font hinting may round glyph heights. One bounded fallback is enough;
  // never search over sizes or cross the user's maximum shrink limit.
  result=measure(fit.size*minimum);
  return result;
 }
 function retainedFit(x,y,fit,clip,measure,settings=defaults){
  // Reject an impossible stay before measuring, but still let edgeFit render
  // the limited shrink while a relocating title travels back into view.
  const limit=nonnegative(settings.maxShrink,defaults.maxShrink),minimum=Math.max(1-limit,3/fit.size);
  if(!fullyVisible(x,y,fit.halfWidth+fit.pad,fit.height,clip)&&Math.min((Math.min(x-clip.l,clip.r-x)-3)/(fit.halfWidth+fit.pad-3),(Math.min(y-clip.t,clip.b-y)-3)/(fit.height-3))<minimum)return null;
  const result=edgeFit(x,y,fit,clip,measure,settings);
  return fullyVisible(x,y,result.halfWidth+result.pad,result.height,clip)?result:null;
 }
 function advanceSize(motion,target,now,settings=defaults){
  const previous=motion.displaySize??target,elapsed=Math.max(0,now-(motion.sizeAt??now));motion.sizeAt=now;motion.sizeTarget=target;
  const duration=nonnegative(settings.sizeTime,defaults.sizeTime);
  motion.displaySize=previous+(target-previous)*(duration>0?-Math.expm1(-elapsed/duration):1);
  if(Math.abs(motion.displaySize-target)<.01)motion.displaySize=target;
  return motion.displaySize!==target;
 }
 function prepareTravelSize(motion,target){
  const p=motion.sizeTravel;
  if(!p||p.targetSize!==target||p.toX!==motion.targetX||p.toY!==motion.targetY)motion.sizeTravel={fromX:motion.x,fromY:motion.y,toX:motion.targetX,toY:motion.targetY,fromSize:motion.displaySize??target,targetSize:target,progress:0};
  motion.sizeTarget=target;
 }
 function advanceTravelSize(motion,now,moving){
  const p=motion.sizeTravel;
  // The invisible skip is not part of the displayed animation. Start the
  // shared position/size progress at its first viewport-edge entry point.
  if(motion.entrySkipped){p.fromX=motion.x;p.fromY=motion.y;p.fromSize=motion.displaySize??p.targetSize;p.progress=0;}
  const length=Math.hypot(p.toX-p.fromX,p.toY-p.fromY),remaining=Math.hypot(p.toX-motion.x,p.toY-motion.y);
  p.progress=moving&&length?Math.max(p.progress,Math.max(0,Math.min(1,1-remaining/length))):1;
  const t=p.progress*p.progress*(3-2*p.progress);
  motion.displaySize=p.fromSize+(p.targetSize-p.fromSize)*t;motion.sizeTarget=p.targetSize;motion.sizeAt=now;
  if(!moving)motion.displaySize=p.targetSize;
  return motion.displaySize!==p.targetSize;
 }
 const api={defaults,insetClip,createMotion,avoid,overlap,advance,advanceSize,prepareTravelSize,advanceTravelSize,transport,fadeFrames,fadeTo,fitRatio,fullyVisible,returnAllowed,edgeOnly,edgeFit,retainedFit};root.CrateRegionLabelLayout=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
