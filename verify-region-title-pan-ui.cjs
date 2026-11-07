/* Native right-drag reversals and corners must not send titles away or sideways. */
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.SIM_BASE||'http://127.0.0.1:8767/',toy=process.env.SIM_EDITION==='toy',baseline=!!process.env.TITLE_BASELINE;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-renderer-backgrounding','--disable-background-timer-throttling']});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300},deviceScaleFactor:1.5}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.addInitScript(()=>{
  window.titlePanQA={record:false,rows:[],world:[],legs:new WeakMap(),lastOptions:null};let api;
  document.addEventListener('pointermove',e=>{if(e.target.id==='map'&&(e.buttons&2))titlePanQA.lastPanAt=performance.now();},true);
  Object.defineProperty(window,'CrateRegionLabelLayout',{configurable:true,get:()=>api,set(value){api=value;const advance=api.advance;
   api.advance=(m,clip,w,h,now,...rest)=>{titlePanQA.lastOptions={...rest[0]};const b={x:m.x,y:m.y,tx:m.targetX,ty:m.targetY,at:m.frameAt},visible=m.x+(m.halfWidth??w)>=clip.l&&m.x-(m.halfWidth??w)<=clip.r&&m.y+(m.halfHeight??h)>=clip.t&&m.y-(m.halfHeight??h)<=clip.b,result=advance(m,clip,w,h,now,...rest);
    if(titlePanQA.record&&visible){let leg=titlePanQA.legs.get(m);if(!leg||leg.at!==m.targetAt)titlePanQA.legs.set(m,leg={at:m.targetAt,x:b.x,y:b.y,tx:b.tx,ty:b.ty});const dx=m.x-b.x,dy=m.y-b.y,tx=b.tx-b.x,ty=b.ty-b.y,d=Math.hypot(tx,ty),length=Math.hypot(leg.tx-leg.x,leg.ty-leg.y);titlePanQA.rows.push({name:m.label?.name,now,dt:Math.min(.05,Math.max(0,(now-b.at)/1000)),distance:Math.hypot(dx,dy),away:dx*tx+dy*ty,lateral:d?Math.abs(dx*ty-dy*tx)/d:0,lineError:length?Math.abs((m.x-leg.x)*(leg.ty-leg.y)-(m.y-leg.y)*(leg.tx-leg.x))/length:0,limit:rest[0]?.maxSpeed??8000,...b,x:m.x,y:m.y});}return result;
   };
  }});
 });
 await p.route('**/region-statistics-ui.js*',async route=>{const response=await route.fetch();let body=await response.text();const hook=`
 window.forceTitleRelocation=()=>{const s=state(),items=[...titleMotion.values()].filter(m=>m.visible&&m.label?.bounds).map(m=>{const b=m.label.bounds,left=m.x-(s.x+b.x*s.scale),right=s.x+(b.x+b.w)*s.scale-m.x;return {m,left,right,reach:Math.max(left,right)};}).sort((a,b)=>b.reach-a.reach),item=items.find(p=>p.reach>p.m.halfWidth+40);if(!item)throw Error('No wide visible region for relocation');const x=item.right>=item.left?area.x-10:area.x+area.w+10;s.x+=x-item.m.x;schedule();return item.m.label.name;};
 const titleLabelsQA=labels;labels=function(ctx,view,viewport=area){const before=new Map([...titleMotion].map(([id,m])=>[id,{...m}])),result=titleLabelsQA(ctx,view,viewport);if(titlePanQA.record&&view===state())for(const[id,m]of titleMotion){const old=before.get(id);if(!old?.visible||!m.visible||old.appearedAt!==m.appearedAt)continue;const camera=old.viewX!==view.x||old.viewY!==view.y||old.scale!==view.scale;if(camera)titlePanQA.world.push({camera:true,error:Math.hypot((m.x-view.x)/view.scale-(old.x-old.viewX)/old.scale,(m.y-view.y)/view.scale-(old.y-old.viewY)/old.scale)});else if(performance.now()-titlePanQA.lastPanAt<250)titlePanQA.world.push({camera:false,error:Math.hypot(m.x-old.x,m.y-old.y)});}return result;};
 `;body=body.replace('  return {load,beforeLoad:',hook+'  return {load,beforeLoad:');await route.fulfill({response,body});});
 await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
 if(!baseline){assert.equal(await p.locator('#opacity').inputValue(),'70.0');assert.equal(await p.locator('#opacityRange').inputValue(),'70');assert.equal(await p.locator('#regionTransparency').inputValue(),'80');}
 await p.locator('#regionToggle').click();await p.waitForFunction(()=>!CrateMapViewer.state.regionPending&&document.getElementById('regionAutoStatus').textContent.includes('自动划分完成'),null,{timeout:120000});await p.locator('#viewMode').click();
 for(const id of ['regionColorOverlay','regionShowTotals'])if(await p.locator('#'+id).getAttribute('aria-pressed')!=='true')await p.locator('#'+id).click();
 await p.locator('#map').scrollIntoViewIfNeeded();
 const start=await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,a=v.area,r=s.data.rendering;s.scale=a.w/(r.width*.6);s.x=a.x+a.w/2-r.width*s.scale/2;s.y=a.y+a.h/2-r.height*s.scale/2;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=b.width/v.viewport.width;return [b.x+(a.x+a.w*.45)*k,b.y+(a.y+a.h*.43)*k];});
 await p.waitForTimeout(1000);
 assert.equal(await p.locator('#regionTitleTuning').count(),0);assert.equal(await p.evaluate(()=>typeof CrateRegionTitleControls),'undefined');
 assert.deepEqual(await p.evaluate(()=>titlePanQA.lastOptions),{maxSpeed:8000,acceleration:20000});
 await p.mouse.move(...start);await p.mouse.down({button:'right'});await p.evaluate(()=>{titlePanQA.record=true;});
 let previous=[0,0];
 for(const next of [[220,0],[-180,0],[-180,130],[180,-80],[-120,90]]){
  for(let i=1;i<=12;i++){await p.mouse.move(start[0]+previous[0]+(next[0]-previous[0])*i/12,start[1]+previous[1]+(next[1]-previous[1])*i/12);await p.waitForTimeout(12);}
  previous=next;
 }
 await p.waitForTimeout(800);await p.mouse.up({button:'right'});
 await p.evaluate(()=>forceTitleRelocation());await p.waitForTimeout(1600);
 const capture=await p.evaluate(()=>{titlePanQA.record=false;return {rows:titlePanQA.rows,world:titlePanQA.world};}),rows=capture.rows,moving=rows.filter(r=>r.distance>.001),summary={edition:toy?'Toy':'Full',frames:rows.length,moving:moving.length,away:moving.filter(r=>r.away<-.001).length,lateral:moving.filter(r=>r.lateral>.001).length,lineViolations:moving.filter(r=>r.lineError>.001).length,cameraSamples:capture.world.filter(r=>r.camera).length,maxWorldDrift:Math.max(0,...capture.world.filter(r=>r.camera).map(r=>r.error)),freezeViolations:capture.world.filter(r=>!r.camera&&r.error>.001).length,speedViolations:moving.filter(r=>r.distance>r.limit*r.dt+.21).length};
 const out=path.resolve('output/title-pan-qa');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,(baseline?'before-':'after-')+(toy?'toy':'full')+'.json'),JSON.stringify({summary,rows},null,2));
 assert(summary.cameraSamples>100);assert(moving.length>10);assert.equal(summary.maxWorldDrift<1e-6,true);assert.equal(summary.freezeViolations,0);assert.equal(summary.speedViolations,0);assert.equal(summary.lineViolations,0);assert.equal(summary.away,0);assert.equal(summary.lateral,0);assert.deepEqual(errors,[]);
 console.log('PASS rigid camera anchors, single-segment relocation, 8000 px/s speed, 20000 px/s² acceleration and no tuning-panel entry',summary);
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
