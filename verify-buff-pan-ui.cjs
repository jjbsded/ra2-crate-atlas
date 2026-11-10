/* Bering Strait: native right-drag on both sides of the numeric-label threshold. */
'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const edition=process.env.SIM_EDITION||'full',toy=edition==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/',stage=process.env.BUFF_STAGE||'after';
const stats=values=>{const sorted=values.slice().sort((a,b)=>a-b);return Object.fromEntries([['p50',.5],['p95',.95],['max',1]].map(([name,p])=>[name,+(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0).toFixed(2)]));};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:Number(process.env.BUFF_DPR)||2}),errors=[];
 p.on('pageerror',e=>errors.push(e.stack));await p.addInitScript(()=>window.buffPanQA={record:false,current:null,rows:[]});
 await p.route('**/map-label-cache.js*',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:body+`\n{const make=CrateMapLabelCache.create;CrateMapLabelCache.create=(...args)=>{const cache=make(...args),render=cache.render;cache.render=(ctx,view,area,spec)=>buffPanQA.directLabels?spec.paint(ctx,view,area):render(ctx,view,area,spec);return cache;};}`});});
 await p.route('**/buff-expectation-ui.js*',async route=>{const response=await route.fetch();let body=await response.text();
  body=body.replace('if(labelSprites.has(key)){','if(labelSprites.has(key)){if(root.buffPanQA?.current)root.buffPanQA.current.hits++;');
  body=body.replace('labelSprites.set(key,item);labelPixels+=pixels;','labelSprites.set(key,item);labelPixels+=pixels;if(root.buffPanQA?.current)root.buffPanQA.current.created++;');
  body+=`\n{const make=CrateBuffExpectationUI.create;CrateBuffExpectationUI.create=(...args)=>{const api=make(...args),paint=api.paint;api.paint=function(ctx,view,area,options,...other){if(options.labelsOnly)buffPanQA.labelOptions=options;const t=performance.now(),out=paint(ctx,view,area,options,...other),row=buffPanQA.current;if(row){row.buffMs+=performance.now()-t;row.labels+=out.labels||0;row.colored+=out.colored||0;}return out;};return api;};}`;
  await route.fulfill({response,body});
 });
 await p.route('**/realmap-ui.js*',async route=>{const response=await route.fetch(),body=await response.text(),needle='  window.CrateMapViewer={state';assert(body.includes(needle));
  const hook=`if(!buffPanQA.hooked){buffPanQA.hooked=true;const original=draw;draw=function(...args){if(!buffPanQA.record||buffPanQA.current)return original(...args);const row=buffPanQA.current={at:performance.now(),ms:0,buffMs:0,labels:0,colored:0,created:0,hits:0,navigating:!!state.navigating};try{return original(...args);}finally{row.ms=performance.now()-row.at;buffPanQA.rows.push(row);buffPanQA.current=null;}};const paintBase=mapViewCache.render;mapViewCache.render=function(...args){const t=performance.now(),out=paintBase(...args);if(buffPanQA.current){buffPanQA.current.baseMs=performance.now()-t;buffPanQA.current.baseRebuilt=out.cacheRebuilt;}return out;};}\n`;
  await route.fulfill({response,body:body.replace(needle,hook+needle)});
 });
 await p.goto(base+(toy?'index.html':'maps.html'));if(toy)await p.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.locator('#loadHeck').click();await p.locator('#officialMapSearch').fill('白令海峡');await p.locator('#officialMapMode').selectOption('standard');await p.locator('#officialMapList .official-map-row').first().click();await p.locator('#officialMapAnalysisVersion').selectOption('yr');await p.locator('#officialMapAnalyze').click();
 await p.waitForFunction(()=>window.CrateMapViewer?.state.data.metadata.filename==='xmp26s6.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.locator('#minimap').uncheck();await p.locator('#viewMode').click();
 await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,r=s.data.rendering,a=v.area;s.scale=.88;s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;buffPanQA.cacheDuringCalculation=0;buffPanQA.pendingProbe=setInterval(()=>{const f=v.buffExpectation.status;if(f.pending&&f.labelRaster?.pending)buffPanQA.cacheDuringCalculation++;},50);});
 await p.locator('#probabilityToggle').click();
 await p.waitForFunction(()=>CrateMapViewer.buffExpectation.status.rasterReady&&!CrateMapViewer.buffExpectation.status.pending,null,{timeout:120000});
 const cacheDuringCalculation=await p.evaluate(()=>{clearInterval(buffPanQA.pendingProbe);return buffPanQA.cacheDuringCalculation;});assert.equal(cacheDuringCalculation,0,'Progressive value batches must not repeatedly allocate full text rasters');
 const cases=[];
 for(const [scale,values] of [[.86,true],[.88,true],[.88,false],[1.05,true]]){
  if(await p.locator('#values').isChecked()!==values)await p.locator('#values').setChecked(values);
  await p.evaluate(scale=>{const v=CrateMapViewer,s=v.state,r=s.data.rendering,a=v.area;s.scale=scale;s.x=a.x+a.w/2-r.width*scale/2;s.y=a.y+a.h/2-r.height*scale/2;s.selected=null;v.draw();},scale);
  await p.locator('#map').scrollIntoViewIfNeeded();await p.waitForTimeout(1200);
  const start=await p.evaluate(()=>{const v=CrateMapViewer,r=document.getElementById('map').getBoundingClientRect(),k=r.width/v.viewport.width;return [r.x+(v.area.x+v.area.w/2)*k,r.y+(v.area.y+v.area.h/2)*k];});
  await p.mouse.move(...start);await p.mouse.down({button:'right'});await p.evaluate(()=>{buffPanQA.rows=[];buffPanQA.record=true;});
  for(let i=1;i<=48;i++){await p.mouse.move(start[0]+180*Math.sin(i*Math.PI/24),start[1]+65*Math.sin(i*Math.PI/12));await p.waitForTimeout(8);}
  await p.mouse.up({button:'right'});await p.waitForTimeout(80);
  const sample=await p.evaluate(()=>{buffPanQA.record=false;return {rows:buffPanQA.rows,status:CrateMapViewer.buffExpectation.status,source:CrateMapViewer.state.data.metadata.filename,pixelRatio:CrateMapViewer.viewport.pixelRatio};});
  const rows=sample.rows.filter(r=>r.navigating),result={scale,values,source:sample.source,pixelRatio:sample.pixelRatio,frames:rows.length,draw:stats(rows.map(r=>r.ms)),buff:stats(rows.map(r=>r.buffMs)),base:stats(rows.map(r=>r.baseMs||0)),cadence:stats(rows.slice(1).map((r,i)=>r.at-rows[i].at)),labels:stats(rows.map(r=>r.labels)),created:stats(rows.map(r=>r.created)),hits:stats(rows.map(r=>r.hits)),rebuilds:rows.filter(r=>r.baseRebuilt).length,status:sample.status,worst:rows.slice().sort((a,b)=>b.ms-a.ms).slice(0,3)};
  if(stage!=='before'&&values&&scale>=.87){assert(result.labels.p50>500);assert(result.buff.p95<4,'Buff label work must stay within its frame budget: '+JSON.stringify(result.buff));}
  cases.push(result);console.log(JSON.stringify(result));
 }
 const qa=path.resolve('output/buff-pan-qa');fs.mkdirSync(qa,{recursive:true});let quality=null;
 if(stage!=='before'){
  await p.waitForFunction(()=>!CrateMapViewer.buffExpectation.status.labelRaster.pending,null,{timeout:15000});
  quality=await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,ratio=v.viewport.pixelRatio,options=buffPanQA.labelOptions,images=[];let width=0;for(const [direct,moving]of [[false,false],[true,false],[false,true]]){buffPanQA.directLabels=direct;const cv=document.createElement('canvas');cv.width=width=Math.round(v.viewport.width*ratio);cv.height=Math.round(v.viewport.height*ratio);const ctx=cv.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);v.buffExpectation.paint(ctx,{...s,navigating:moving},v.area,options);images.push(ctx.getImageData(0,0,cv.width,cv.height).data);}buffPanQA.directLabels=false;let total=0,movingTotal=0,ink=0,unmatched=0;for(let i=0;i<images[0].length;i++){total+=Math.abs(images[0][i]-images[1][i]);movingTotal+=Math.abs(images[2][i]-images[1][i]);}for(const [a,b]of [[images[1],images[2]],[images[2],images[1]]])for(let i=3;i<a.length;i+=4)if(a[i]>64){ink++;const x=((i-3)/4)%width,y=Math.floor((i-3)/4/width);let match=false;for(let dy=-1;dy<=1&&!match;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&b[((y+dy)*width+x+dx)*4+3]>16){match=true;break;}if(!match)unmatched++;}return {stationaryMean:total/images[0].length,movingMean:movingTotal/images[0].length,unmatchedInk:unmatched/Math.max(1,ink),ratio};});
  assert.equal(quality.stationaryMean,0,'Stationary labels retain exact original sampling');assert(quality.unmatchedInk<.005,JSON.stringify(quality));await p.locator('#canvasHost').screenshot({path:path.join(qa,edition+'-labels.png')});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,edition+'-'+stage+'.json'),JSON.stringify({status:'PASS',stage,edition,cases,quality,cacheDuringCalculation,errors},null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
