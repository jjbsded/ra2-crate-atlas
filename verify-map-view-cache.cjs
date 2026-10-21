/* Compare cached view to the unmodified direct renderer on a real report. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),M=require('./map-renderer.js'),D=require('./probability-display.js'),R=require('./region-statistics.js');
(async()=>{
 const file=process.argv[2]||'output/map-870461fa33c8/result.json',data=JSON.parse(fs.readFileSync(file,'utf8')),dir=path.dirname(file),[ox,oy]=data.rendering.origin;
 const image=await loadImage(path.join(dir,data.rendering.image)),objectImage=data.rendering.objectImage?await loadImage(path.join(dir,data.rendering.objectImage)):null;
 const cells=[...data.cells].sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x),lookup=new Map();
 for(const c of cells){c.px=30*(c.x-c.y)+ox;c.py=15*(c.x+c.y-c.level)+oy;lookup.set(`${c.x},${c.y}`,c);}
 const state={data,image,objectImage,cells,lookup,spatialIndex:R.createSelectionIndex(cells).screen,x:40,y:70,scale:.2,selected:null};
 const area={x:24,y:70,w:1552,h:820},display=D.map(data),cache=M.createViewCache(()=>createCanvas(1,1));
 const a=createCanvas(1600,1050),b=createCanvas(1600,1050),ca=a.getContext('2d'),cb=b.getContext('2d');
 const opts={heatmap:true,blocked:true,grid:true,potentialMarkers:true,markers:true,values:true,coords:false,objects:true,filter:'all',opacity:45,threshold:0,palette:'warm'};
 function check(label,rebuild){
  for(const ctx of [ca,cb]){ctx.fillStyle='#101c25';ctx.fillRect(0,0,1600,1050);}
  const expected=M.render(ca,state,area,display,opts),actual=cache.render(cb,state,area,display,opts);
  assert.equal(actual.colored,expected.colored,label+': cell count');assert.equal(actual.labels,expected.labels,label+': labels');assert.equal(actual.cacheRebuilt,rebuild,label+': invalidation');
  const x=ca.getImageData(24,70,1552,820).data,y=cb.getImageData(24,70,1552,820).data;
  let sum=0,large=0;for(let i=0;i<x.length;i++){const delta=Math.abs(x[i]-y[i]);sum+=delta;if(delta>40)large++;}
  const mean=sum/x.length,largeRatio=large/x.length;
  // Offscreen compositing can shift antialiased edges by a subpixel. Catch
  // missing/stale layers, not harmless rasterizer rounding at those edges.
  assert.ok(mean<3&&largeRatio<.025,`${label}: mean delta ${mean}, large ratio ${largeRatio}`);
  console.log(`${label}: cache ${rebuild?'rebuilt':'reused'}, ${actual.colored} colored, ${actual.labels} labels, mean RGBA delta ${mean.toFixed(4)}.`);
 }
 check('overview',true);check('unchanged pointer',false);
 state.x+=51;state.y-=19;check('overview pan',false);
 opts.players=true;check('start numbers shown',false);
 opts.players=false;check('start numbers hidden',false);
 opts.threshold=2;check('threshold',true);
 opts.filter='water';check('water filter',true);
 opts.objects=false;check('object artwork',true);
 opts.opacity=80;opts.palette='cool';check('opacity and palette',true);
 opts.threshold=0;opts.filter='all';opts.values=true;opts.coords=true;state.scale=2.5;const focus=lookup.get('84,87')||cells[12000];state.x=800-focus.px*state.scale;state.y=480-focus.py*state.scale;
 check('close-up',true);check('close-up pointer',false);
 state.selected=focus;check('selected cell above cached base',false);
 state.x+=20;check('close-up pan',true);
 state.selected=null;opts.heatmap=false;opts.markers=false;opts.blocked=false;check('layer toggles',true);
 cache.clear();check('clear',true);
 console.log('PASS: cached pixels, visible counts, top-layer labels/selection, panning and cache invalidation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
