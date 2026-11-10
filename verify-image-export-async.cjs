/* Independent export pixels, layer opacity, void/camera masks and fallback. */
'use strict';
const assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas');
const E=require('./map-image-export.js'),D=require('./probability-display.js');
const cell={x:5,y:5,px:150,py:75,level:0,usable:true,land:0,terms:[[0,1]],status:'crate'};
const data={metadata:{filename:'export.map',version:'yr',theater:'URBAN',size:[0,0,10,10]},rendering:{width:300,height:150,cameraRect:[10,10,280,130]},cells:[cell],probability:{sampleCount:10,exact:{denominator:'10',coefficients:[{n:1,numerator:'1'}]}}};
const display=D.map(data),plan=E.layout(data.rendering,{bounds:{x:-25,y:-15,w:350,h:180}});
let calls=0,fallback=false;
function layer(color){const pixels=createCanvas(300,150),ctx=pixels.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,300,150);ctx.clearRect(40,30,30,20);
 return{draw:(ctx,...args)=>ctx.drawImage(pixels,...args),async renderExport(ctx,view,area){calls++;await new Promise(r=>setImmediate(r));if(fallback)return false;ctx.save();ctx.imageSmoothingEnabled=view.scale<1;ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.drawImage(pixels,view.x,view.y,300*view.scale,150*view.scale);ctx.restore();return true;}};
}
const source={data,image:layer('#c4aa7380'),objectImage:layer('#45629f90'),cells:[cell],lookup:new Map([['5,5',cell]])};
const settings={scene:'all',objects:true,objectOpacity:.45,filter:'all',palette:'warm',heatmap:true,opacity:35,threshold:0,values:false,players:false,
 coordinateSpace:{clipTerrain(){},paint(ctx,view,area){ctx.fillStyle='#333344';ctx.fillRect(area.x,area.y,area.w,area.h);}},
 regionLayer(ctx,view){ctx.fillStyle='#30ec8040';ctx.fillRect(view.x+5,view.y+5,50,30);}};
async function compare(options){const a=createCanvas(plan.width,plan.height),b=createCanvas(plan.width,plan.height),before=JSON.stringify(data);const expected=E.render(a.getContext('2d'),source,display,options,plan),actual=await E.renderAsync(b.getContext('2d'),source,display,options,plan);
 assert.deepEqual(actual,expected);assert.equal(JSON.stringify(data),before);const aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
 for(let i=0;i<aa.length;i++)assert.equal(bb[i],aa[i],'Pixel channel '+i+' objects='+options.objects+' alpha='+options.objectOpacity+' scene='+options.scene);}
(async()=>{
 for(const objectOpacity of [0,.45,1])await compare({...settings,objectOpacity});
 await compare({...settings,objects:false});const completed=calls;
 for(const scene of ['off','units'])await compare({...settings,scene});assert.equal(calls,completed,'Hidden scenes do not allocate export workers');
 fallback=true;await compare(settings);assert(calls>completed,'Unavailable backend falls back to the unchanged synchronous renderer');
 const old=source.image.renderExport;source.image.renderExport=async()=>{throw Error('fixture error');};
 const c=createCanvas(plan.width,plan.height),ctx=c.getContext('2d');await assert.rejects(()=>E.renderAsync(ctx,source,display,settings,plan),/fixture error/);assert.equal(ctx.globalAlpha,1);source.image.renderExport=old;
 console.log('PASS async/sync export pixels, opacity, regions, void/camera masks, disabled scenes, fallback, source isolation and error cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
