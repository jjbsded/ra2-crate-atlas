/* Region selection and exact aggregation. No probability model is modified. */
(function(root){
 'use strict';
 // OKLab distance balances hue and lightness; avoid near-white / muddy candidates.
 function lab(hex){
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const [r,g,b]=rgb,l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
 }
 function hsl(h,s,l){
  const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  return '#'+[f(0),f(8),f(4)].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
 }
 const candidates=['#42c9b0'];
 for(const l of [.43,.58,.72])for(const s of [.7,.95])for(let h=0;h<360;h+=8){
  const hex=hsl(h,s,l),v=lab(hex);if(v[0]>=.51&&v[0]<=.88&&Math.hypot(v[1],v[2])>=.10)candidates.push(hex);
 }
 const candidateLabs=candidates.map(lab),distance=(a,b)=>a.reduce((n,v,i)=>n+(v-b[i])**2,0);
 function nextColor(regions){
  const used=regions.map(r=>typeof r==='string'?r:r.color).filter(c=>/^#[0-9a-f]{6}$/i.test(c)).map(lab);
  if(!used.length)return candidates[0];
  let best=0,score=-1;
  for(let i=0;i<candidates.length;i++){const d=Math.min(...used.map(v=>distance(v,candidateLabs[i])));if(d>score){best=i;score=d;}}
  return candidates[best];
 }
 const colors=[];for(let i=0;i<12;i++)colors.push(nextColor(colors));
 const revisions=new WeakMap(),revision=r=>revisions.get(r)||0,touch=r=>revisions.set(r,revision(r)+1);
 const key=c=>c.x*1024+c.y;
 const defaults=()=>({version:1,defaultRegionCount:12,selectionBoundsVersion:1,transparency:50,overlap:false,active:'r1',next:13,regions:colors.map((color,i)=>({id:`r${i+1}`,name:`区域 ${i+1}`,color,cells:new Set()}))});
 function encode(doc){return JSON.stringify({...doc,regions:doc.regions.map(r=>({...r,cells:[...r.cells].sort((a,b)=>a-b)}))});}
 function decode(raw,valid){
  const data=JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.regions)||!data.regions.length||data.regions.length>64)throw Error('区域记录格式不正确');
  const ids=new Set();
  const regions=data.regions.map((r,i)=>{
   if(!r||typeof r.id!=='string'||!/^r[1-9]\d{0,6}$/.test(r.id)||ids.has(r.id)||!Array.isArray(r.cells))throw Error('区域记录格式不正确');
   ids.add(r.id);
   return {id:r.id,name:String(r.name||`区域 ${i+1}`).slice(0,48),color:/^#[0-9a-f]{6}$/i.test(r.color)?r.color:colors[i%colors.length],
    cells:new Set(r.cells.filter(k=>Number.isInteger(k)&&valid.has(k)))};
  });
  const doc={version:1,defaultRegionCount:12,selectionBoundsVersion:1,transparency:Number.isFinite(data.transparency)?Math.max(0,Math.min(100,data.transparency)):50,overlap:data.overlap===true,active:ids.has(data.active)?data.active:regions[0].id,
   next:Math.max(Math.max(...regions.map(r=>Number(r.id.slice(1))))+1,Number.isInteger(data.next)&&data.next<10000000?data.next:1),regions};
  // One-time migration: preserve customized names/colors/cells. Later manual
  // deletion is respected, even when fewer than twelve regions remain.
  if(data.defaultRegionCount!==12)while(doc.regions.length<12){const n=doc.next++;doc.regions.push({id:`r${n}`,name:`区域 ${n}`,color:nextColor(doc.regions),cells:new Set()});}
  if(!doc.overlap)exclusive(doc);
  return doc;
 }
 // When overlap is switched off, the active region wins; remaining ties use list order.
 function exclusive(doc){
  const seen=new Set();let removed=0;
  for(const r of [...doc.regions].sort((a,b)=>Number(b.id===doc.active)-Number(a.id===doc.active))){
   let changed=false;for(const k of r.cells)if(seen.has(k)){r.cells.delete(k);removed++;changed=true;}else seen.add(k);
   if(changed)touch(r);
  }
  return removed;
 }
 function apply(doc,keys,remove=false){
  const r=doc.regions.find(r=>r.id===doc.active);if(!r)return false;const changed=new Set();
  for(const k of keys){
   if(remove){if(r.cells.delete(k))changed.add(r);}
   else{
    if(!r.cells.has(k)){r.cells.add(k);changed.add(r);}
    if(!doc.overlap)for(const other of doc.regions)if(other!==r&&other.cells.delete(k))changed.add(other);
   }
  }
  for(const r of changed)touch(r);return changed.size>0;
 }
 const ratio=(n,d)=>d?Number(n*1000000000000n/d)/1e12:0;
 function statistics(region,lookup,display){
  const land={count:0,n:0n},sea={count:0,n:0n};
  for(const k of region.cells){const c=lookup.get(k);if(!c)continue;const g=c.land===2?sea:land;g.count++;g.n+=display.get(c).numerator;}
  const all={count:land.count+sea.count,n:land.n+sea.n},base=display.baselineNumerator;
  for(const g of [land,sea,all]){g.total=ratio(g.n,base);g.average=g.count?ratio(g.n,base*BigInt(g.count)):null;}
  return {land,sea,all};
 }
 function sorted(regions,stats,metric='all.total',ascending=false){
  const [group,field]=metric.split('.');
  return [...regions].sort((a,b)=>{
   let cmp;
   if(metric==='name')cmp=a.name.localeCompare(b.name,'zh-CN',{numeric:true});
   else{
    const x=stats.get(a.id)[group],y=stats.get(b.id)[group];
    if(field==='average'&&(!x.count||!y.count))return x.count? -1:y.count?1:0; // Empty averages always last.
    const u=field==='average'?x.n*BigInt(y.count):field==='count'?BigInt(x.count):x.n;
    const v=field==='average'?y.n*BigInt(x.count):field==='count'?BigInt(y.count):y.n;
    cmp=u<v?-1:u>v?1:0;
   }
   return ascending?cmp:-cmp;
  });
 }
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 // Zero-probability / occupied cells remain selectable; this is a boundary rule.
 function canSelect(c,rendering){
  if(!c.usable||c.visibleBand)return false;
  if(Number.isFinite(c.cameraCoverage))return c.cameraCoverage>0;
  const r=rendering?.cameraRect;
  return !r||(c.px>=r[0]&&c.px<=r[0]+r[2]&&c.py>=r[1]&&c.py<=r[1]+r[3]);
 }
 function segmentDistance(p,a,b){
  const x=b.x-a.x,y=b.y-a.y,t=clamp(((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1),0,1);
  return Math.hypot(p.x-a.x-x*t,p.y-a.y-y*t);
 }
 function segmentBox(a,b,c,rx,ry){
  let lo=0,hi=1;
  for(const [axis,r]of [['x',rx],['y',ry]]){
   const d=b[axis]-a[axis],offset=a[axis]-c[axis];
   if(!d){if(Math.abs(offset)>r)return false;continue;}
   let t0=(-r-offset)/d,t1=(r-offset)/d;if(t0>t1)[t0,t1]=[t1,t0];
   lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return false;
  }
  return true;
 }
 // Rectangle/circle use projected cell centers (with height), game tools use X/Y.
 // Swept brush segments avoid holes when pointer events are far apart.
 function hit(c,tool,a,b,width=5,height=5){
  const game=tool.includes('game'),p=game?{x:c.x,y:c.y}:{x:c.px,y:c.py};
  let from=game?a.game:a,to=game?b.game:b;
  if(tool.startsWith('box')){
   const pad=game?.001:0;
   return p.x>=Math.min(from.x,to.x)-pad&&p.x<=Math.max(from.x,to.x)+pad&&p.y>=Math.min(from.y,to.y)-pad&&p.y<=Math.max(from.y,to.y)+pad;
  }
  if(tool==='brush-circle')return segmentDistance(p,from,to)<=width*30;
  if(tool==='brush-ellipse')return segmentDistance({x:p.x,y:p.y*2},{x:from.x,y:from.y*2},{x:to.x,y:to.y*2})<=width*30;
  if(game){const dx=width%2===0?.5:0,dy=height%2===0?.5:0;from={x:from.x+dx,y:from.y+dy};to={x:to.x+dx,y:to.y+dy};}
  return segmentBox(from,to,p,game?width/2-.001:width*30,game?height/2-.001:height*15);
 }
 function selected(cells,tool,a,b,width,height){return cells.filter(c=>hit(c,tool,a,b,width,height)).map(key);}
 function spatialIndex(cells,x,y,sx,sy){
  const buckets=new Map();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  cells.forEach((c,i)=>{const u=Math.floor(x(c)/sx),v=Math.floor(y(c)/sy),key=u+','+v;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);minX=Math.min(minX,u);maxX=Math.max(maxX,u);minY=Math.min(minY,v);maxY=Math.max(maxY,v);});
  return {query(left,top,right,bottom){
   const found=[],l=Math.max(minX,Math.floor(left/sx)),r=Math.min(maxX,Math.floor(right/sx)),t=Math.max(minY,Math.floor(top/sy)),b=Math.min(maxY,Math.floor(bottom/sy));
   for(let u=l;u<=r;u++)for(let v=t;v<=b;v++)for(const i of buckets.get(u+','+v)||[]){const c=cells[i],cx=x(c),cy=y(c);if(cx>=left&&cx<=right&&cy>=top&&cy<=bottom)found.push(i);}
   found.sort((a,b)=>a-b);return found.map(i=>cells[i]);
  }};
 }
 function createSelectionIndex(cells,eligible=()=>true){
  const screen=spatialIndex(cells,c=>c.px,c=>c.py,240,120),game=spatialIndex(cells,c=>c.x,c=>c.y,8,8);
  function selectedCells(tool,a,b,width=5,height=5){
   const logical=tool.includes('game'),box=tool.startsWith('box'),from=logical?a.game:a,to=logical?b.game:b;
   const dx=logical&&!box&&width%2===0?.5:0,dy=logical&&!box&&height%2===0?.5:0;
   const rx=box?(logical?.001:0):logical?width/2:width*30,ry=box?(logical?.001:0):logical?height/2:tool==='brush-circle'?width*30:tool==='brush-ellipse'?width*15:height*15;
   return (logical?game:screen).query(Math.min(from.x,to.x)+dx-rx,Math.min(from.y,to.y)+dy-ry,Math.max(from.x,to.x)+dx+rx,Math.max(from.y,to.y)+dy+ry).filter(c=>eligible(c)&&hit(c,tool,a,b,width,height));
  }
  return {screen,selectedCells,selected:(...args)=>selectedCells(...args).map(key)};
 }
 function bounds(region,lookup,surface){
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const k of region.cells){const c=lookup.get(k);if(!c)continue;
   for(const ring of surface(c,true))for(const [dx,dy]of ring){left=Math.min(left,c.px+dx);right=Math.max(right,c.px+dx);top=Math.min(top,c.py+dy);bottom=Math.max(bottom,c.py+dy);}
  }
  return Number.isFinite(left)?{x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)}:null;
 }
 const api={colors,nextColor,lab,key,defaults,encode,decode,exclusive,apply,revision,touch,statistics,sorted,selected,createSelectionIndex,canSelect,hit,bounds,segmentBox};
 root.CrateRegionStatistics=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
