/* Compare cached view to the unmodified direct renderer on a real report. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas'),M=require('./map-renderer.js'),D=require('./probability-display.js'),R=require('./region-statistics.js');
(async()=>{
 const file=process.argv[2]||'output/map-870461fa33c8/result.json',raw=fs.readFileSync(file),data=JSON.parse(file.endsWith('.gz')?require('node:zlib').gunzipSync(raw):raw),dir=path.dirname(file),[ox,oy]=data.rendering.origin;
 const image=await loadImage(path.join(dir,data.rendering.image)),objectImage=data.rendering.objectImage?await loadImage(path.join(dir,data.rendering.objectImage)):null;
 const cells=[...data.cells].sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x),lookup=new Map();
 for(const c of cells){c.px=30*(c.x-c.y)+ox;c.py=15*(c.x+c.y-c.level)+oy;lookup.set(`${c.x},${c.y}`,c);}
 const state={data,image,objectImage,cells,lookup,spatialIndex:R.createSelectionIndex(cells).screen,x:40,y:70,scale:.2,selected:null};
 const area={x:24,y:70,w:1552,h:820},display=D.map(data),cache=M.createViewCache(()=>createCanvas(1,1));
 const a=createCanvas(1600,1050),b=createCanvas(1600,1050),ca=a.getContext('2d'),cb=b.getContext('2d');
 let pixelRatio=1,panOrigin=null;
 const opts={heatmap:true,blocked:true,grid:true,potentialMarkers:true,markers:true,values:true,coords:false,objects:true,filter:'all',opacity:45,threshold:0,palette:'warm'};
 function check(label,rebuild){
  for(const ctx of [ca,cb]){ctx.fillStyle='#101c25';ctx.fillRect(0,0,1600,1050);}
  const reference=panOrigin?{...state,x:panOrigin.x+Math.round((state.x-panOrigin.x)*pixelRatio)/pixelRatio,y:panOrigin.y+Math.round((state.y-panOrigin.y)*pixelRatio)/pixelRatio}:state;
  const expected=M.render(ca,reference,area,display,opts),actual=cache.render(cb,state,area,display,opts);
  assert.equal(actual.colored,expected.colored,label+': cell count');assert.equal(actual.labels,expected.labels,label+': labels');assert.equal(actual.cacheRebuilt,rebuild,label+': invalidation');
  const read=ctx=>ctx.getImageData(24*pixelRatio,70*pixelRatio,1552*pixelRatio,820*pixelRatio).data;
  const x=read(ca),y=read(cb);
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
 state.x+=20;check('close-up pan',false);
 for(const [dx,dy]of [[240,0],[-510,170],[0,-440],[3000,0],[-2730,270]]){
  state.x+=dx;state.y+=dy;check('close-up newly exposed edges',false);
 }
 state.selected=null;opts.heatmap=false;opts.markers=false;opts.blocked=false;check('layer toggles',true);
 cache.clear();check('clear',true);
 state.scale=.2;state.x=40;state.y=70;
 opts.heatmap=true;opts.markers=true;opts.blocked=true;opts.grid=false;opts.coords=false;
 check('navigation source',true);
 for(const live of [false,true]){
  state.liveEditing=live;
  if(live)check('resident navigation source',true);
  opts.navigation=true;state.scale*=1.13;
  const expected=M.render(ca,state,area,display,opts),preview=cache.render(cb,state,area,display,opts);
  assert.equal(preview.preview,true);assert.equal(preview.colored,expected.colored);assert.equal(preview.labels,expected.labels);
  opts.navigation=false;check(live?'resident settled pixels':'settled pixels',true);
  opts.navigation=true;state.scale*=1.05;opts.palette=opts.palette==='warm'?'cool':'warm';
  assert.notEqual(cache.render(cb,state,area,display,opts).preview,true,'Changed palette must invalidate a navigation snapshot');
  state.data={...state.data};state.scale*=1.03;
  assert.notEqual(cache.render(cb,state,area,display,opts).preview,true,'Changed probability/layout data must invalidate a navigation snapshot');
  state.artworkRevision=(state.artworkRevision||0)+1;
  state.artworkDirty=[[0,0,60,30]];state.scale*=1.03;
  assert.notEqual(cache.render(cb,state,area,display,opts).preview,true,'Pending artwork edits must invalidate a navigation snapshot');
  state.overlayDirty=[[0,0,60,30]];state.scale*=1.03;
  assert.notEqual(cache.render(cb,state,area,display,opts).preview,true,'Pending probability edits must invalidate a navigation snapshot');
  state.overlayDirty=null;
  opts.navigation=false;check(live?'resident edit invalidation':'edit invalidation',false);
 }
 pixelRatio=1.5;
 for(const canvas of [a,b]){canvas.width=1600*pixelRatio;canvas.height=1050*pixelRatio;canvas.getContext('2d').setTransform(pixelRatio,0,0,pixelRatio,0,0);}
 state.scale=.55;state.selected=null;
 for(const live of [false,true]){
  state.liveEditing=live;state.x=800-focus.px*state.scale;state.y=480-focus.py*state.scale;cache.clear();
  panOrigin={x:state.x,y:state.y};
  check(live?'DPR resident source':'DPR cached source',true);
  for(const [dx,dy,rebuild]of [[15.25,-11.5,false],[260,-90,false],[-540,350,false],[0,-480,false],[4000,0,false],[-3735,231.5,false]]){
   state.x+=dx;state.y+=dy;check(live?'DPR resident edge repaint':'DPR cached edge repaint',rebuild);
  }
  opts.navigation=true;state.x+=.25;state.y-=.25;
  assert.equal(cache.render(cb,state,area,display,opts).cacheRebuilt,false,'Fractional gesture frames reuse the raster');
  opts.navigation=false;check('DPR persistent settled frame',false);
 }
 console.log('PASS: cached pixels, visible counts, top-layer labels/selection, panning and cache invalidation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
