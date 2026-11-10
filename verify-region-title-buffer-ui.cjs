/* Compare relocation frequency and edge-only fallbacks in the native renderer. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.route('**/region-statistics-ui.js*',async route=>{
  const response=await route.fetch(),body=await response.text();
  const hook=`window.titleBufferQA={settings:titleTuning.settings,run:async function(){
   const oldSchedule=schedule,oldNow=Object.getOwnPropertyDescriptor(performance,'now'),settings={...titleTuning.settings},fixture={...settings,insetWidth:.5,insetHeight:.5,returnVisible:.85,maxShrink:.2,edgeOnlyEnabled:true};
   let clock=100000;schedule=()=>{};Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
   const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=600;const ctx=canvas.getContext('2d'),viewport={x:0,y:0,w:1000,h:600},clip={l:0,r:1000,t:0,b:600};
   const fromCells=(id,points,center)=>{
    const boxes=points.map(cellSurfaceBox),tiles=new Map();let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity,reachX=0,reachY=0;
    for(const box of boxes){const c=box.cell,key=Math.floor(c.px/480)+','+Math.floor(c.py/240);if(!tiles.has(key))tiles.set(key,{points:[]});tiles.get(key).points.push(c);l=Math.min(l,box.l);r=Math.max(r,box.r);t=Math.min(t,box.t);b=Math.max(b,box.b);reachX=Math.max(reachX,c.px-box.l,box.r-c.px);reachY=Math.max(reachY,c.py-box.t,box.b-c.py);}
    return {id,center,bounds:{x:l,y:t,w:r-l,h:b-t},boxes,tiles,reachX,reachY,color:'#33cc77',strokes:{outer:'#000',inner:'#fff'},name:'区:',probability:'1%'};
   };
   const label=(id,left,right,center)=>{
    const boxes=[],tiles=new Map();for(let py=30;py<=570;py+=30)for(let px=left;px<=right;px+=30){
     const cell={px,py};boxes.push(cellSurfaceBox(cell));const key=Math.floor(px/480)+','+Math.floor(py/240);if(!tiles.has(key))tiles.set(key,{points:[]});tiles.get(key).points.push(cell);
    }
    return {id,center:{x:center,y:300},bounds:{x:left-30,y:15,w:right-left+60,h:570},boxes,tiles,reachX:30,reachY:15,color:'#33cc77',strokes:['#000','#fff'],name:'陆地 1:',probability:'≈25%'};
   };
   const broad=label('buffer',-1600,1200,-300),edge=label('edge',-500,80,-200);
   function locate(samples,width=1000){
    resetTitleTracking();Object.assign(titleTuning.settings,settings,{insetEnabled:true,insetWidth:.5,insetHeight:.5,lazy:false,returnMargin:0,returnVisible:2,maxShrink:0,edgeOnlyEnabled:false});
    const view={x:0,y:0,scale:1},motions=new Map(),area={...viewport,w:width};
    for(let i=0;i<40;i++){clock+=50;ctx.clearRect(0,0,1400,600);paintLabels(ctx,view,samples,area,null,motions,true);}
    return samples.map(sample=>{const m=motions.get(sample.id);if(!m?.visible||m.hidden||!titleContains(sample,view,m.x,m.y))throw Error('Anchor escaped its own region '+sample.id);return {id:sample.id,x:m.x,y:m.y,size:m.displaySize};});
   }
   function run(sample,enabled,extra={}){
    resetTitleTracking();Object.assign(titleTuning.settings,{insetEnabled:enabled,insetWidth:.5,insetHeight:.5,lazy:true,returnMargin:0,returnVisible:1,maxShrink:0},extra);
    const view={x:0,y:0,scale:1},motions=new Map();let previous=null,changes=0;const anchors=[];
    const frame=()=>{clock+=50;ctx.clearRect(0,0,1000,600);paintLabels(ctx,view,[sample],viewport,null,motions,true);};
    for(let step=0;step<=(sample.id.startsWith('edge')?2:8);step++){
     view.x=-20*step;for(let i=0;i<35;i++)frame();const m=motions.get(sample.id);
     if(!m?.visible||m.hidden||!root.CrateRegionLabelLayout.fullyVisible(m.x,m.y,m.halfWidth-1e-6,m.halfHeight-1e-6,clip)||!titleContains(sample,view,m.x,m.y))throw Error('Buffered title must remain visible and inside its region '+JSON.stringify({id:sample.id,step,enabled,m:m&&{visible:m.visible,hidden:m.hidden,x:m.x,y:m.y,w:m.halfWidth,h:m.halfHeight,tx:m.targetX,ty:m.targetY},contains:m&&titleContains(sample,view,m.x,m.y)}));
     const world=m.targetX-view.x;if(previous!==null&&Math.abs(world-previous)>.2)changes++;previous=world;
     anchors.push({world,x:m.x,y:m.y,width:2*m.halfWidth,height:2*m.halfHeight});
    }
    return {changes,anchors};
   }
   function seeded(sample,x,options={},pan=null,target=null,initialSize=68){
    resetTitleTracking();Object.assign(titleTuning.settings,fixture,options);
    const view={x:0,y:0,scale:1},motions=new Map([[sample.id,{x,y:300,targetX:target??x,targetY:300,visible:true,hidden:false,viewX:0,viewY:0,scale:1,frameAt:clock,sizeAt:clock,displaySize:initialSize,appearedAt:clock-1000,label:sample}]]),frames=[];
    const settle=()=>{for(let i=0;i<40;i++){clock+=50;ctx.clearRect(0,0,1000,600);paintLabels(ctx,view,[sample],viewport,null,motions,true);const m=motions.get(sample.id);frames.push({size:m.displaySize,target:m.sizeTarget,moving:Math.hypot(m.x-m.targetX,m.y-m.targetY)>.2,appearedAt:m.appearedAt,x:m.x});}};
    const snapshot=()=>{const m=motions.get(sample.id);return {x:m.x,y:m.y,world:(m.x-view.x),width:2*m.halfWidth,height:2*m.halfHeight,visible:m.visible&&!m.hidden};};
    settle();const before=snapshot();if(pan!==null){view.x=pan;settle();}return {before,after:snapshot(),frames};
   }
   try{
    const comparison={normal:run(broad,false),buffered:run(broad,true),edgeNormal:run(edge,false),edgeBuffered:run(edge,true)};
    const near={...broad,id:'near',center:{x:200,y:300}},safe={...broad,id:'safe',center:{x:300,y:300}},compact=label('compact',30,900,200);
    const edgeRule={...label('edge-rule',-500,250,-200),name:'1',probability:'1'},edgeSpecial=run(edgeRule,true,{edgeOnlyEnabled:true,edgeBand:.3}),edgeWithInset=run(edgeRule,true,{edgeOnlyEnabled:false,edgeBand:.3}),edgeNarrow=run(edgeRule,true,{edgeOnlyEnabled:true,edgeBand:.1});
    const source=label('source',-500,900,-200),points=source.boxes.map(b=>b.cell);
    const offcenter=fromCells('offcenter',points.filter(c=>c.px<=-100||c.px>=100&&c.py>=120&&c.py<=390),{x:-200,y:300});
    const concave=fromCells('concave',[{px:400,py:300,visibleSurface:[[[-180,-120],[180,-120],[180,-70],[-70,-70],[-70,70],[180,70],[180,120],[-180,120]]]}],{x:427.5,y:300});
    const foreign=fromCells('foreign',[{px:450,py:300,visibleSurface:[[[-100,-60],[100,-60],[100,60],[-100,60]]]}],{x:450,y:300});
    const islands=fromCells('islands',points.filter(c=>(c.px>=100&&c.px<=220||c.px>=780)&&c.py>=120&&c.py<=390),{x:500,y:300});
    const overlapping=fromCells('overlap',offcenter.boxes.map(b=>b.cell),{x:-200,y:300});
    const clippedCell={px:-10,py:0},clippedExtent=visibleTitleBounds([clippedCell],{x:0,y:0,scale:1},clip);
    const regionBasis={narrow:locate([offcenter]),padded:locate([offcenter],1400),concave:locate([concave,foreign]),islands:locate([islands,foreign]),overlap:locate([offcenter,overlapping]),clippedExtent};
    const natural=seeded(broad,500),normalSize=natural.frames.at(-1).target;
    return {...comparison,regionBasis,edgeSpecial,edgeWithInset,edgeNarrow,deferred:seeded(near,500),clear:seeded(safe,500),covered:seeded(compact,500),marginOff:seeded(near,500,{returnMargin:0}),natural,shrunk:seeded(broad,170,{},120),overLimit:seeded(broad,70),shrinkOff:seeded(broad,170,{maxShrink:0}),entryPlanned:seeded(broad,-400,{},null,250),entrySmall:seeded(broad,-400,{},null,250,normalSize*.8),growOnRoute:seeded(broad,170,{},null,500,normalSize*.8),shrinkOnRoute:seeded(broad,500,{},null,170,normalSize)};
   }
   finally{schedule=oldSchedule;if(oldNow)Object.defineProperty(performance,'now',oldNow);else delete performance.now;Object.assign(titleTuning.settings,settings);resetTitleTracking();schedule();}
  }};\n`;
  await route.fulfill({response,body:body.replace('create({host:document.body,','create({host:document.body,enabled:true,').replace('  return {load,beforeLoad:',hook+'  return {load,beforeLoad:')});
 });
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy&&!CrateMapViewer.state.regionPending,null,{timeout:120000});
 assert(await p.locator('#regionTitleInsetEnabled').isChecked());assert(await p.locator('#regionTitleLazy').isChecked());
 assert.equal(await p.locator('#regionTitleInsetWidth').inputValue(),'25');assert.equal(await p.locator('#regionTitleInsetHeight').inputValue(),'25');
 assert.equal(await p.locator('#regionTitleEdgeOnly').isChecked(),false);assert.equal(await p.locator('#regionTitleShrinkDuringMove').count(),0);assert.equal(await p.locator('#regionTitleEdgeBand').inputValue(),'15');
 await p.locator('#regionTitleInsetWidth').fill('65');assert.equal(await p.evaluate(()=>titleBufferQA.settings.insetWidth),.65);
 await p.locator('#regionTitleInsetHeight').fill('40');assert.equal(await p.evaluate(()=>titleBufferQA.settings.insetHeight),.4);
 assert.equal(await p.locator('#regionTitleReturnMargin').inputValue(),'8');assert.equal(await p.locator('#regionTitleReturnVisible').inputValue(),'35');assert.equal(await p.locator('#regionTitleMaxShrink').inputValue(),'50');
 await p.locator('#regionTitleReturnMargin').fill('10');assert.equal(await p.evaluate(()=>titleBufferQA.settings.returnMargin),.1);
 await p.locator('#regionTitleReturnVisible').fill('90');assert.equal(await p.evaluate(()=>titleBufferQA.settings.returnVisible),.9);
 await p.locator('#regionTitleMaxShrink').fill('25');assert.equal(await p.evaluate(()=>titleBufferQA.settings.maxShrink),.25);
 await p.locator('#regionTitleMotionReset').click();assert.equal(await p.locator('#regionTitleInsetWidth').inputValue(),'25');
 const result=await p.evaluate(()=>titleBufferQA.run());
 assert(result.normal.changes>=6,JSON.stringify(result.normal));
 assert(result.buffered.changes<result.normal.changes/2,JSON.stringify(result));
 assert(result.buffered.anchors[0].x>=250-1e-6,'The broad region fills this viewport, so its center margin is a quarter of the viewport');
 assert(result.buffered.anchors[0].x>result.normal.anchors[0].x+50,'Inset positioning still changes a newly selected destination');
 assert.equal(result.buffered.anchors[0].width,result.normal.anchors[0].width,'Center range must never affect normal font size');
 assert.deepEqual(result.edgeBuffered,result.edgeNormal,'Edge-only regions keep their normal size, visibility and placement');
 assert(result.edgeSpecial.anchors[0].x<70&&result.edgeWithInset.anchors[0].x>=70,'Edge-only toggle skips the region-visible center rectangle '+JSON.stringify({special:result.edgeSpecial.anchors[0],inset:result.edgeWithInset.anchors[0]}));
 assert.equal(result.edgeNarrow.anchors[0].x,result.edgeWithInset.anchors[0].x,'The edge band parameter controls classification');
 assert.equal(result.edgeSpecial.anchors[0].width,result.edgeWithInset.anchors[0].width,'Special positioning does not alter normal font size');
 const basis=result.regionBasis;
 assert(Math.abs(basis.narrow[0].x-280)<1e-6&&basis.narrow[0].y>=180&&basis.narrow[0].y<=330,'Inset uses both axes of the region visible extent');
 assert.deepEqual(basis.padded,basis.narrow,'Adding empty viewport space must not change the region center range or font');
 const ownC=basis.concave[0];assert(ownC.x<=330+1e-6||ownC.y<=230+1e-6||ownC.y>=370-1e-6,'A concave gap occupied by another region is not a legal anchor');
 assert(basis.islands[0].x<=250+1e-6||basis.islands[0].x>=750-1e-6,'An empty center range falls back to one of the same region islands');
 assert.equal(basis.overlap.length,2,'Overlapping regions retain both valid anchors');
 assert.deepEqual(basis.clippedExtent,{l:0,r:20,t:0,b:10},'Visible extent clips actual terrain polygons rather than their empty bounding-box corners');
 assert(Math.abs(result.deferred.after.x-500)<1e-6,'Barely visible center does not pull a title to the edge');
 assert(Math.abs(result.clear.after.x-300)<1e-6,'Center reclaims a title after gaining clearance');
 assert(Math.abs(result.covered.after.x-200)<1e-6,'High region coverage waives extra clearance');
 assert(Math.abs(result.marginOff.after.x-200)<1e-6,'Zero margin restores the plain full-visibility rule');
 assert(Math.abs(result.shrunk.before.world-170)<1e-6,'A small shrink keeps the original map anchor');
 assert(result.shrunk.before.width<result.natural.before.width&&result.shrunk.before.width>=result.natural.before.width*.8,'Shrinking respects the 20% limit');
 assert(Math.abs(result.shrunk.after.world-170)<1e-6&&Math.abs(result.shrunk.after.width-result.natural.before.width)<1,'Font size recovers without moving the map anchor');
 assert(Math.abs(result.overLimit.after.world-70)>10&&result.overLimit.after.visible,'Exceeding the shrink limit chooses a normal visible anchor');
 assert(Math.abs(result.shrinkOff.after.world-170)>10,'Zero shrink disables retention by scaling');
 assert(result.shrunk.frames[0].size>result.shrunk.frames[0].target,'Shrinking interpolates from the previously displayed size');
 assert(result.overLimit.frames.some(f=>f.moving&&Math.abs(f.size-f.target)>.01),'A moving title interpolates its edge-adjusted font target');
 assert(result.overLimit.frames.every(f=>f.target>=result.natural.frames.at(-1).target*.8-1e-6),'Edge targets use the normal final size as their shrink reference');
 for(const entry of [result.entryPlanned,result.entrySmall])assert.equal(new Set(entry.frames.map(f=>f.appearedAt)).size,1,'Reentry does not repeatedly restart fading while size changes');
 for(const trip of [result.growOnRoute,result.shrinkOnRoute,result.entrySmall]){
  const arrival=trip.frames.findIndex(f=>!f.moving);assert(arrival>0);assert(trip.frames.slice(0,arrival).some(f=>Math.abs(f.size-f.target)>.01),'Size changes during the route');
  assert.equal(trip.frames[arrival].size,trip.frames[arrival].target,'Position arrival also finishes the size transition');
  assert(trip.frames.slice(arrival).every(f=>Math.abs(f.size-trip.frames[arrival].size)<1e-6),'No second font change starts after arrival');
 }
 assert(result.growOnRoute.frames[0].target>result.natural.frames.at(-1).target*.99,'The unshrunk destination size is known before moving in');
 assert(result.shrinkOnRoute.frames[0].target<result.natural.frames.at(-1).target,'A clipped destination also precomputes its final shrink');
 assert.deepEqual(errors,[]);fs.mkdirSync('output/title-buffer-qa',{recursive:true});fs.writeFileSync('output/title-buffer-qa/'+(toy?'toy':'full')+'.json',JSON.stringify({status:'PASS',...result},null,2));
 await p.screenshot({path:'output/title-buffer-qa/'+(toy?'toy':'full')+'.png',fullPage:false});
 console.log('PASS title buffer, center clearance/coverage, bounded shrinking/recovery, edge fallback and tuning controls',{normalMoves:result.normal.changes,bufferedMoves:result.buffered.changes,shrink:1-result.shrunk.before.width/result.natural.before.width});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
