/* Bounded pixel compositor for custom scenes. Terrain must not erase an already
 * drawn bridge deck or a same-height object. The buffers are at most 512x512. */
(function(root){
 'use strict';
 function create(scene){
  const canvas=()=>typeof document==='undefined'?new OffscreenCanvas(1,1):document.createElement('canvas');
  const pixels=new Map();let bytes=0;const scratch=canvas();scratch.width=scratch.height=512;const context=scratch.getContext('2d');
  function page(n){if(scene.pixelPages?.[n])return scene.pixelPages[n];if(pixels.has(n)){const p=pixels.get(n);pixels.delete(n);pixels.set(n,p);return p;}const image=scene.images[n],imageCanvas=canvas();imageCanvas.width=image.width;imageCanvas.height=image.height;const ctx=imageCanvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const p={width:imageCanvas.width,data:ctx.getImageData(0,0,imageCanvas.width,imageCanvas.height).data};imageCanvas.width=imageCanvas.height=1;pixels.set(n,p);bytes+=p.data.length;while(bytes>64*1048576&&pixels.size>1){const key=pixels.keys().next().value;bytes-=pixels.get(key).data.length;pixels.delete(key);}return p;}
  return function paint(ctx,indices,sequence,origin={x:0,y:0},emit=null){
   const t=ctx.getTransform(),scale=t.a,scaleY=t.d;if(t.b||t.c||scale<=0||scaleY<=0)throw Error('Unsupported artwork transform');
   // Streamed exports retain global output coordinates for every floor/sample
   // operation. Subtracting each tile origin from the transform changes ties at
   // half-pixels and produces seams at non-integer export scales.
   const commands=Array.from(indices,i=>scene.commands[sequence[i]]).map(c=>{const a=scene.data.assets[c.id];return{...c,a,left:Math.max(origin.x,Math.floor(c.x*scale+t.e)),top:Math.max(origin.y,Math.floor(c.y*scaleY+t.f)),right:Math.min(origin.x+ctx.canvas.width,Math.ceil((c.x+a[3])*scale+t.e)),bottom:Math.min(origin.y+ctx.canvas.height,Math.ceil((c.y+a[4])*scaleY+t.f))};}).filter(c=>c.right>c.left&&c.bottom>c.top);
   const buckets=new Map();for(const c of commands)for(let y=Math.floor((c.top-origin.y)/512);y<Math.ceil((c.bottom-origin.y)/512);y++)for(let x=Math.floor((c.left-origin.x)/512);x<Math.ceil((c.right-origin.x)/512);x++){const key=x+','+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(c);}
   for(const[key,list]of buckets){const[localX,localY]=key.split(',').map(v=>+v*512),bx=origin.x+localX,by=origin.y+localY,w=Math.min(512,ctx.canvas.width-localX),h=Math.min(512,ctx.canvas.height-localY),image=context.createImageData(w,h),out=image.data,stencil=new Uint8Array(w*h),receiver=new Int16Array(w*h).fill(-32768),solid=new Uint8Array(w*h);
    for(const c of list){const p=page(c.a[0]),sx=c.a[1],sy=c.a[2],left=Math.max(bx,c.left),right=Math.min(bx+w,c.right),top=Math.max(by,c.top),bottom=Math.min(by+h,c.bottom);
     for(let y=top;y<bottom;y++){const py=Math.floor((y+.5-t.f)/scaleY-c.y);if(py<0||py>=c.a[4])continue;for(let x=left;x<right;x++){const px=Math.floor((x+.5-t.e)/scale-c.x);if(px<0||px>=c.a[3])continue;const from=((sy+py)*p.width+sx+px)*4,alpha=p.data[from+3];if(!alpha)continue;const pixel=(y-by)*w+x-bx,depth=stencil[pixel],threshold=(depth&127)-(depth&128?1:0);if(c.terrain&&threshold>c.level+1)continue;
      const to=pixel*4;
      if(c.shadow){if(solid[pixel]||receiver[pixel]!==c.level)continue;for(let k=0;k<3;k++)out[to+k]=Math.floor(out[to+k]*(255-alpha)/255+.5);continue;}
      if(alpha===255||!out[to+3]){out[to]=p.data[from];out[to+1]=p.data[from+1];out[to+2]=p.data[from+2];out[to+3]=alpha;}else{const a=alpha/255,b=out[to+3]/255*(1-a),v=a+b;for(let k=0;k<3;k++)out[to+k]=(p.data[from+k]*a+out[to+k]*b)/v;out[to+3]=v*255;}
      if(c.terrain){receiver[pixel]=c.receiver?c.level:-32768;solid[pixel]=0;}
      if(c.stencil&128){receiver[pixel]=c.stencil&127;solid[pixel]=0;}
      if(c.solid)solid[pixel]=1;
      if(c.stencil)stencil[pixel]=c.stencil;
     }}
    }
    if(emit){emit(image,localX,localY);continue;}
    context.putImageData(image,0,0);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(scratch,0,0,w,h,localX,localY,w,h);ctx.restore();
   }
  };
 }
 root.CrateLivePainter={create};
})(globalThis);
