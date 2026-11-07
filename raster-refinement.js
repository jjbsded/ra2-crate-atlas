/* Shared, bounded background raster work. Old complete images stay visible. */
(function(root){
 'use strict';
 const jobs=new Set();let frame=null;
 const request=fn=>root.requestAnimationFrame(fn),cancel=id=>root.cancelAnimationFrame(id);
 function pump(){
  frame=null;let pixels=0,steps=0;const start=performance.now();
  while(jobs.size&&steps<8&&performance.now()-start<5){
   const job=jobs.values().next().value;
   if(!job.valid()){jobs.delete(job);job.abort();continue;}
   const cost=job.cost();
   if(steps&&pixels+cost>524288)break;
   jobs.delete(job);
   try{job.step();}catch(error){job.fail(error);continue;}pixels+=cost;steps++;
   if(job.remaining())jobs.add(job);else job.finish();
  }
  if(jobs.size)frame=request(pump);
 }
 function wake(){if(frame===null)frame=request(pump);}
 // Tile previews share the same frame/pixel budget as exact refinements.
 function enqueue(job){jobs.add(job);wake();return ()=>{jobs.delete(job);if(!jobs.size&&frame!==null){cancel(frame);frame=null;}};}
 function create({makeCanvas=()=>document.createElement('canvas'),schedule=null}={}){
  let active=null,failed=false;
  const enabled=typeof root.requestAnimationFrame==='function'&&typeof schedule==='function';
  function abort(){
   if(!active)return;const p=active;active=null;jobs.delete(p.job);
   for(const image of p.images){image.width=1;image.height=1;}
   if(!jobs.size&&frame!==null){cancel(frame);frame=null;}
  }
  function start(spec){
   if(!enabled||failed||active?.key===spec.key)return;
   abort();
   const images=Array.from({length:spec.layers||1},()=>makeCanvas());
   const parts=[];
   for(let y=0;y<spec.height;y+=512)for(let x=0;x<spec.width;x+=512)parts.push({x:x/spec.ratio,y:y/spec.ratio,w:Math.min(512,spec.width-x)/spec.ratio,h:Math.min(512,spec.height-y)/spec.ratio});
   const p=active={key:spec.key,images,allocated:0,index:0,job:null};
   p.job={
    valid:()=>active===p&&spec.valid(),abort,
    fail(error){failed=true;abort();console.warn('Display raster refinement:',error);schedule();},
    remaining:()=>active===p&&(p.allocated<images.length||p.index<parts.length),
    cost:()=>{if(p.allocated<images.length)return spec.width*spec.height;const part=parts[p.index];return part.w*part.h*spec.ratio**2*images.length;},
    step(){
     if(p.allocated<images.length){const image=images[p.allocated++];image.width=spec.width;image.height=spec.height;image.getContext('2d').setTransform(spec.ratio,0,0,spec.ratio,0,0);return;}
     const part=parts[p.index++],contexts=images.map(image=>image.getContext('2d'));
     for(const ctx of contexts){ctx.save();ctx.beginPath();ctx.rect(part.x,part.y,part.w,part.h);ctx.clip();}
     try{spec.paint(contexts,part);}finally{for(const ctx of contexts)ctx.restore();}
    },
    finish(){if(active!==p)return;if(!spec.valid()){abort();return;}active=null;spec.publish(images);schedule();}
   };
   jobs.add(p.job);wake();
  }
  return {get available(){return enabled&&!failed;},start,cancel:abort,check(){if(active&&!active.job.valid())abort();},get pending(){return !!active;}};
 }
 function uncovered(area,rect){
  const l=Math.max(area.x,rect.x),r=Math.min(area.x+area.w,rect.x+rect.w),t=Math.max(area.y,rect.y),b=Math.min(area.y+area.h,rect.y+rect.h);
  if(l>=r||t>=b)return [{...area}];
  const parts=[];
  if(t>area.y)parts.push({x:area.x,y:area.y,w:area.w,h:t-area.y});
  if(b<area.y+area.h)parts.push({x:area.x,y:b,w:area.w,h:area.y+area.h-b});
  if(l>area.x)parts.push({x:area.x,y:t,w:l-area.x,h:b-t});
  if(r<area.x+area.w)parts.push({x:r,y:t,w:area.x+area.w-r,h:b-t});
  return parts;
 }
 function composite(ctx,area,rect,ratio,background,detail){
  // Keep the previous high-resolution pixels. Only the newly exposed area
  // comes from the overview. Disjoint physical-pixel clips avoid doubling
  // translucent probability/region layers at the source transition.
  const l=Math.max(area.x,Math.ceil(rect.x*ratio+1)/ratio),t=Math.max(area.y,Math.ceil(rect.y*ratio+1)/ratio);
  const r=Math.min(area.x+area.w,Math.floor((rect.x+rect.w)*ratio-1)/ratio),b=Math.min(area.y+area.h,Math.floor((rect.y+rect.h)*ratio-1)/ratio);
  if(l>=r||t>=b){background();return false;}
  const coverage={x:l,y:t,w:r-l,h:b-t};
  const paint=(part,fn)=>{
   const x=part.x===area.x?Math.floor(part.x*ratio)/ratio:part.x,y=part.y===area.y?Math.floor(part.y*ratio)/ratio:part.y;
   const right=part.x+part.w===area.x+area.w?Math.ceil((part.x+part.w)*ratio)/ratio:part.x+part.w,bottom=part.y+part.h===area.y+area.h?Math.ceil((part.y+part.h)*ratio)/ratio:part.y+part.h;
   ctx.save();ctx.beginPath();ctx.rect(x,y,right-x,bottom-y);ctx.clip();fn();ctx.restore();
  };
  for(const part of uncovered(area,coverage))paint(part,background);
  paint(coverage,detail);return true;
 }
 const api={create,enqueue,uncovered,composite};root.CrateRasterRefinement=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
