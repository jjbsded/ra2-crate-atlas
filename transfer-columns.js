/* Display-only links from raised, missing-terrain origins to their level-zero
 * coordinates. Viewport-bounded surfaces separate real artwork occlusion;
 * no pixel readback, full-map bitmap or probability work is needed. */
(function(root){
 'use strict';
 const artwork=typeof module!=='undefined'?require('./map-artwork.js'):root.CrateMapArtwork;
 const defaults=Object.freeze({enabled:true,lineColor:'#35a0b1',lineOpacity:.8,lineWidth:3,widthMode:'map',dashLength:9,dashGap:0,dashOffset:0,fillFaces:true,faceColor:'#398d9d',faceOpacity:.12,hideOccluded:true,showHidden:false,hiddenOpacity:.22,hiddenBase:false});
 const corners=[[0,-15],[30,0],[0,15],[-30,0]],painters=new WeakMap(),wireCache=new WeakMap(),geometryCache=new WeakMap();
 const alpha=value=>Math.max(0,Math.min(1,value)); // Canvas output, not a cap on tuning settings.
 function geometry(sources){
  const cells=sources.filter(({s,c})=>!s.cell&&c.level>0).map(({c})=>c),neighbors=new Map(cells.map(c=>[c.x+','+c.y,c])),edges=new Map(),bases=new Map(),faces=[],occluders=[];
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const add=(map,a,b,levels)=>{const first=a.join(','),last=b.join(','),key=first<last?first+';'+last:last+';'+first;map.set(key,{points:[a,b],levels,offset:0});};
  for(const c of cells){
   const upper=corners.map(([x,y])=>[c.px+x,c.py+y]),lower=upper.map(([x,y])=>[x,y+15*c.level]);
   left=Math.min(left,c.px-30);right=Math.max(right,c.px+30);top=Math.min(top,c.py-15);bottom=Math.max(bottom,c.py+15+15*c.level);
   for(let i=0;i<4;i++){add(edges,upper[i],lower[i],[c.level,0]);add(bases,lower[i],lower[(i+1)%4],[0,0]);}
   occluders.push({points:upper,plane:[0,0,c.level]});
   // Only the two camera-facing sides can be exposed. Adjacent columns hide
   // their shared wall; unequal heights expose only the remaining upper part.
   for(const [a,b,dx,dy]of [[1,2,1,0],[2,3,0,1]]){
    const level=neighbors.get((c.x+dx)+','+(c.y+dy))?.level||0;if(level>=c.level)continue;
    const depth=15*(c.level-level),face=[upper[a],upper[b],[upper[b][0],upper[b][1]+depth],[upper[a][0],upper[a][1]+depth]],slope=dx?-1/30:1/30;
    faces.push(face);occluders.push({points:face,plane:[slope,-1/15,c.level-slope*upper[a][0]+upper[a][1]/15]});
   }
  }
  const wires={edges:[...edges.values()],bases:[...bases.values()]};
  return {cells:cells.length,edges:wires.edges.map(w=>w.points),bases:wires.bases.map(w=>w.points),wires,faces,occluders,bounds:{left,top,right,bottom}};
 }
 // The projection ray raises terrain height toward the viewer. Clip only the
 // portion strictly behind a virtual face; the face's own border stays visible.
 // Cache in map coordinates, independently of pan, zoom, opacity or line style.
 function visibleWires(shape){
  if(wireCache.has(shape))return wireCache.get(shape);
  const buckets=new Map(),size=60,epsilon=1e-7;
  const visit=(box,fn)=>{for(let y=Math.floor(box.top/size);y<=Math.floor(box.bottom/size);y++)for(let x=Math.floor(box.left/size);x<=Math.floor(box.right/size);x++)fn(x+','+y);};
  const bounds=points=>({left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))});
  for(const face of shape.occluders){
   face.bounds=bounds(face.points);face.orientation=Math.sign(face.points.reduce((sum,a,i)=>{const b=face.points[(i+1)%face.points.length];return sum+a[0]*b[1]-a[1]*b[0];},0));
   visit(face.bounds,key=>{if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(face);});
  }
  function clip(wire){
   const [a,b]=wire.points,dx=b[0]-a[0],dy=b[1]-a[1],dz=wire.levels[1]-wire.levels[0],box=bounds(wire.points),candidates=new Set(),hidden=[];
   visit(box,key=>{for(const face of buckets.get(key)||[])candidates.add(face);});
   for(const face of candidates){
    const f=face.bounds;if(f.left>box.right||f.right<box.left||f.top>box.bottom||f.bottom<box.top)continue;
    let lo=0,hi=1;
    const constrain=(start,change)=>{if(Math.abs(change)<epsilon)return start>=0;const t=-start/change;if(change>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);return hi-lo>epsilon;};
    for(let i=0;i<face.points.length&&hi-lo>epsilon;i++){
     const p=face.points[i],q=face.points[(i+1)%face.points.length],ex=q[0]-p[0],ey=q[1]-p[1],sign=face.orientation;
     if(!constrain(sign*(ex*(a[1]-p[1])-ey*(a[0]-p[0]))+epsilon,sign*(ex*dy-ey*dx))){hi=lo;break;}
    }
    const [px,py,pz]=face.plane;
    if(hi-lo>epsilon&&constrain(px*a[0]+py*a[1]+pz-wire.levels[0]-epsilon,px*dx+py*dy-dz)&&hi-lo>epsilon)hidden.push([lo,hi]);
   }
   hidden.sort((a,b)=>a[0]-b[0]);const visible=[];let start=0;
   const segment=(lo,hi)=>({points:[[a[0]+dx*lo,a[1]+dy*lo],[a[0]+dx*hi,a[1]+dy*hi]],offset:Math.hypot(dx,dy)*lo});
   for(const [lo,hi]of hidden){if(lo-start>epsilon)visible.push(segment(start,lo));start=Math.max(start,hi);}
   if(1-start>epsilon)visible.push(segment(start,1));return visible;
  }
  const result={edges:shape.wires.edges.flatMap(clip),bases:shape.wires.bases.flatMap(clip)};wireCache.set(shape,result);return result;
 }
 function createPainter(makeCanvas){
  let mask=null,layer=null,maskKey=null,resultKey=null,shape=null,shapeOwner=null,shapeData=null;
  let builds=0,masks=0,draws=0;
  function buffer(old,w,h){if(!old)old=makeCanvas(w,h);if(old.width!==w)old.width=w;if(old.height!==h)old.height=h;return old;}
  function clear(canvas){const c=canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.globalAlpha=1;c.clearRect(0,0,canvas.width,canvas.height);return c;}
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  function draw(ctx,state,area,sources,settings={},owner=sources){
   const style={...defaults,...settings};if(!style.enabled)return;
   if(shapeOwner!==owner||shapeData!==state.data){
    const cached=geometryCache.get(owner);shape=cached?.data===state.data?cached.shape:geometry(sources);
    if(cached?.shape!==shape)geometryCache.set(owner,{data:state.data,shape});
    shapeOwner=owner;shapeData=state.data;builds++;resultKey=null;
   }
   if(!shape.cells)return;
   const scale=state.scale,unit=style.widthMode==='map'?scale:1,pad=style.lineWidth*unit+2,box=shape.bounds;
   const ratio=Math.hypot(ctx.getTransform().a,ctx.getTransform().b)||1;
   const x=Math.floor(Math.max(area.x,state.x+box.left*scale-pad)*ratio)/ratio,y=Math.floor(Math.max(area.y,state.y+box.top*scale-pad)*ratio)/ratio;
   const right=Math.min(area.x+area.w,state.x+box.right*scale+pad),bottom=Math.min(area.y+area.h,state.y+box.bottom*scale+pad);
   if(!(right>x&&bottom>y))return;
   const w=Math.ceil((right-x)*ratio),h=Math.ceil((bottom-y)*ratio),view=[state.image,state.data.rendering,state.x,state.y,scale,x,y,w,h,ratio];
   const key=[...view,owner,JSON.stringify(style)];
   if(!same(resultKey,key)){
    mask=buffer(mask,w,h);layer=buffer(layer,w,h);
    if(!same(maskKey,view)){
     const m=clear(mask);m.setTransform(ratio,0,0,ratio,-x*ratio,-y*ratio);
     // Paint first with source-over, then use this complete alpha mask once.
     // Applying destination-in per Toy atlas tile would erase other tiles.
     if(state.image)artwork.crop(m,state.image,state.data.rendering,state,{x,y,w:w/ratio,h:h/ratio});
     maskKey=view;masks++;
    }
    const c=clear(layer),wires=style.hideOccluded?visibleWires(shape):shape.wires;
    function lines(target,includeBases){
     if(!style.dashGap){
      target.strokeStyle=style.lineColor;target.lineWidth=style.lineWidth*unit;target.lineCap='butt';target.lineJoin='round';target.setLineDash([]);target.beginPath();
      for(const wire of includeBases?[...wires.edges,...wires.bases]:wires.edges)wire.points.forEach(([px,py],i)=>target[i?'lineTo':'moveTo'](state.x+px*scale,state.y+py*scale));target.stroke();return;
     }
     const period=(style.dashLength+style.dashGap)*unit,groups=new Map();
     for(const wire of includeBases?[...wires.edges,...wires.bases]:wires.edges){
      const phase=period?wire.offset*scale%period:0;if(!groups.has(phase))groups.set(phase,[]);groups.get(phase).push(wire.points);
     }
     target.strokeStyle=style.lineColor;target.lineWidth=style.lineWidth*unit;target.lineCap='butt';target.lineJoin='round';target.setLineDash([style.dashLength*unit,style.dashGap*unit]);
     for(const [phase,paths]of groups){
      target.lineDashOffset=style.dashOffset*unit+phase;target.beginPath();
      for(const line of paths)line.forEach(([px,py],i)=>target[i?'lineTo':'moveTo'](state.x+px*scale,state.y+py*scale));target.stroke();
     }
     target.setLineDash([]);
    }
    c.setTransform(ratio,0,0,ratio,-x*ratio,-y*ratio);
    if(style.fillFaces&&style.faceOpacity>0){
     c.beginPath();for(const face of shape.faces){face.forEach(([px,py],i)=>c[i?'lineTo':'moveTo'](state.x+px*scale,state.y+py*scale));c.closePath();}
     c.fillStyle=style.faceColor;c.globalAlpha=alpha(style.faceOpacity);c.fill();
    }
    if(style.lineWidth>0){c.globalAlpha=alpha(style.lineOpacity);lines(c,true);}
    c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='destination-out';c.drawImage(mask,0,0);c.globalCompositeOperation='source-over';
    // Hidden strokes use one union before masking, so overlapping/shared edges
    // do not accumulate opacity. The terrain alpha stays reusable while tuning.
    if(style.showHidden&&style.hiddenOpacity>0&&style.lineWidth>0){
     const strokes=hiddenBuffer(w,h),s=clear(strokes);s.setTransform(ratio,0,0,ratio,-x*ratio,-y*ratio);
     lines(s,style.hiddenBase);
     s.setTransform(1,0,0,1,0,0);s.globalCompositeOperation='destination-in';s.drawImage(mask,0,0);s.globalCompositeOperation='source-over';c.globalAlpha=alpha(style.hiddenOpacity);c.drawImage(strokes,0,0);c.globalAlpha=1;
    }
    resultKey=key;draws++;
   }
   ctx.save();ctx.drawImage(layer,x,y,w/ratio,h/ratio);ctx.restore();
  }
  let hidden=null;function hiddenBuffer(w,h){hidden=buffer(hidden,w,h);return hidden;}
  function release(){for(const c of [mask,layer,hidden])if(c)c.width=c.height=1;mask=layer=hidden=maskKey=resultKey=shape=shapeOwner=shapeData=null;}
  return {draw,release,stats:()=>({builds,masks,draws,cells:shape?.cells||0,pixels:(mask?mask.width*mask.height:0)+(layer?layer.width*layer.height:0)+(hidden?hidden.width*hidden.height:0)})};
 }
 function draw(ctx,...args){
  let painter=painters.get(ctx.canvas);if(!painter){
   const makeCanvas=(w,h)=>{if(root.OffscreenCanvas)return new root.OffscreenCanvas(w,h);if(root.document){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}return new ctx.canvas.constructor(w,h);};
   painter=createPainter(makeCanvas);painters.set(ctx.canvas,painter);
  }
  painter.draw(ctx,...args);
 }
 function release(ctx){const painter=painters.get(ctx.canvas);if(painter){painter.release();painters.delete(ctx.canvas);}}
 const api={defaults,geometry,visibleWires,createPainter,draw,release};root.CrateTransferColumns=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
