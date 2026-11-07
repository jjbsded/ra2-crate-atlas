/* Compatibility for lossless RGB reports generated before transparent margins.
 * Only flood the exact old matte connected to the image border. Matching dark
 * pixels enclosed inside real artwork are retained. This runs once at load,
 * off the UI thread; navigation and edits never scan the complete map raster. */
(function(root){
 'use strict';
 function clearMatte(data,width,height){
  const match=p=>data[p*4]===24&&data[p*4+1]===35&&data[p*4+2]===43&&data[p*4+3]===255,stack=[];
  for(let x=0;x<width;x++){if(match(x))stack.push(x);const p=(height-1)*width+x;if(match(p))stack.push(p);}
  for(let y=1;y<height-1;y++){const p=y*width;if(match(p))stack.push(p);if(match(p+width-1))stack.push(p+width-1);}
  while(stack.length){const seed=stack.pop();if(!match(seed))continue;const y=Math.floor(seed/width),start=y*width,end=start+width;let p=seed,up=false,down=false;
   while(p>start&&match(p-1))p--;
   for(;p<end&&match(p);p++){
    data[p*4+3]=0;
    const a=y>0&&match(p-width),b=y<height-1&&match(p+width);
    if(a&&!up)stack.push(p-width);if(b&&!down)stack.push(p+width);up=a;down=b;
   }
  }
  return data;
 }
 if(typeof module!=='undefined')module.exports={clearMatte};
 else root.onmessage=async({data:{url}})=>{
  try{
   const response=await fetch(url);if(!response.ok)throw Error('Artwork HTTP '+response.status);
   const source=await createImageBitmap(await response.blob()),canvas=new OffscreenCanvas(source.width,source.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.drawImage(source,0,0);source.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
   clearMatte(pixels.data,canvas.width,canvas.height);ctx.putImageData(pixels,0,0);
   const image=canvas.transferToImageBitmap();root.postMessage({image},[image]);
  }catch(error){root.postMessage({error:error.message});}
 };
})(typeof globalThis!=='undefined'?globalThis:this);
