/* Bounded camera transforms. Elastic input is separate from the return path. */
(function(root){
 'use strict';
 function limits(bounds,area,scale){
  const axis=(start,length,screen,size)=>{const margin=Math.min(length*scale*.1,size*.1),span=length*scale;
   if(span<=size){const center=screen+size/2-(start+length/2)*scale,extra=Math.max(0,margin-(size-span)/2);return [center-extra,center+extra];}
   return [screen+size-(start+length)*scale-margin,screen-start*scale+margin];
  };
  return {x:axis(bounds.x,bounds.w,area.x,area.w),y:axis(bounds.y,bounds.h,area.y,area.h)};
 }
 function minimum(bounds,area){return Math.max(area.w/bounds.w,area.h/bounds.h)/1.2;}
 function target(view,bounds,area){
  const scale=Math.max(minimum(bounds,area),Math.min(6,view.scale)),factor=scale/view.scale,cx=area.x+area.w/2,cy=area.y+area.h/2;
  const x=cx+(view.x-cx)*factor,y=cy+(view.y-cy)*factor,ranges=limits(bounds,area,scale),clamp=(v,[a,b])=>Math.max(a,Math.min(b,v));
  return {x:clamp(x,ranges.x),y:clamp(y,ranges.y),scale};
 }
 function elastic(value,[low,high],distance){
  const edge=Math.max(low,Math.min(high,value)),delta=value-edge;return edge+Math.sign(delta)*distance*(1-Math.exp(-Math.abs(delta)/distance));
 }
 function input(view,bounds,area){
  const ranges=limits(bounds,area,view.scale);return {...view,x:elastic(view.x,ranges.x,Math.max(24,area.w*.08)),y:elastic(view.y,ranges.y,Math.max(24,area.h*.08))};
 }
 function zoomScale(value,bounds,area){const low=minimum(bounds,area);return Math.exp(elastic(Math.log(Math.max(1e-6,value)),[Math.log(low),Math.log(Math.max(6,low))],.15));}
 function create({getView,getBounds,getArea,onChange,request=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),now=()=>performance.now()}){
  let frame=null,start=null;
  function stop(){if(frame!==null)cancel(frame);frame=null;start=null;}
  function tick(){frame=null;if(!start)return;const s=getView(),b=getBounds(),a=getArea();if(!b){stop();return;}
   const dest=target(start.view,b,a),t=(now()-start.at)/1000,k=1-(1+20*t)*Math.exp(-20*t);
   s.x=start.view.x+(dest.x-start.view.x)*k;s.y=start.view.y+(dest.y-start.view.y)*k;s.scale=Math.exp(Math.log(start.view.scale)+(Math.log(dest.scale)-Math.log(start.view.scale))*k);
   if(Math.hypot(s.x-dest.x,s.y-dest.y)<.08&&Math.abs(Math.log(s.scale/dest.scale))<.0001){Object.assign(s,dest);start=null;}
   onChange();if(start)frame=request(tick);
  }
  function settle(){stop();const view=getView(),bounds=getBounds();if(!bounds)return;const destination=target(view,bounds,getArea());if(Math.hypot(view.x-destination.x,view.y-destination.y)<.08&&Math.abs(Math.log(view.scale/destination.scale))<.0001)return;start={view:{x:view.x,y:view.y,scale:view.scale},at:now()};frame=request(tick);}
  return {stop,settle,get active(){return !!start;},drag(view){stop();const b=getBounds();return b?input(view,b,getArea()):view;},zoom(value){const b=getBounds();return b?zoomScale(value,b,getArea()):Math.max(.06,Math.min(6,value));},clamp(){stop();const b=getBounds();if(b)Object.assign(getView(),target(getView(),b,getArea()));}};
 }
 const api={limits,minimum,target,input,zoomScale,create};root.CrateMapNavigation=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
