/* Offline canvas workload, not a browser FPS claim. NODE_PATH needs @napi-rs/canvas. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const {performance}=require('node:perf_hooks'),{createCanvas,loadImage,Path2D}=require('@napi-rs/canvas');
global.Path2D=Path2D;
const before=process.argv.includes('--before'),root=__dirname;
const R=require(before?'./output/region-performance/region-statistics-before.cjs':'./region-statistics.js');
let renderer;
if(before){const m=new Module(path.join(root,'renderer-before.cjs'),module);m.filename=path.join(root,'renderer-before.cjs');m.paths=module.paths;m._compile(fs.readFileSync('output/region-performance/map-renderer-before.txt','utf8'),m.filename);renderer=m.exports;}
else renderer=require('./map-renderer.js');
function timing(fn,n=16){for(let i=0;i<3;i++)fn(i);const a=[];for(let i=0;i<n;i++){const t=performance.now();fn(i+3);a.push(performance.now()-t);}a.sort((a,b)=>a-b);return {medianMs:+a[Math.floor(n/2)].toFixed(3),p95Ms:+a[Math.min(n-1,Math.floor(n*.95))].toFixed(3)};}
function element(tag='div'){
 const e=tag==='canvas'?createCanvas(180,90):{};
 return Object.assign(e,{value:'',checked:false,hidden:false,style:{setProperty(){}},classList:{toggle(){}},setAttribute(){},append(){},replaceChildren(){},addEventListener(){},click(){this.onclick?.();},closest(){return null;}});
}
(async()=>{
 const file=process.argv.find(v=>v.endsWith('result.json'))||'output/map-870461fa33c8/result.json',data=JSON.parse(fs.readFileSync(file,'utf8')),dir=path.dirname(file),[ox,oy]=data.rendering.origin;
 const image=await loadImage(path.join(dir,data.rendering.image));
 const cells=[...data.cells].sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x),lookup=new Map();
 for(const c of cells){c.px=30*(c.x-c.y)+ox;c.py=15*(c.x+c.y-c.level)+oy;lookup.set(`${c.x},${c.y}`,c);}
 const area={x:24,y:70,w:1552,h:820},state={data,cells,lookup,image,objectImage:null,selected:null,x:24,y:70,scale:Math.min(1552/data.rendering.width,820/data.rendering.height)};
 const display=require('./probability-display.js').map(data);
 const doc=R.defaults();while(doc.regions.length<12){const n=doc.regions.length+1;doc.regions.push({id:`r${n}`,name:`区域 ${n}`,color:R.colors[(n-1)%R.colors.length],cells:new Set()});}doc.next=13;
 for(const c of cells)if(c.x%4!==0)doc.regions[Math.floor(c.x/20)%12].cells.add(R.key(c));
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 $('regionTool').value='brush-circle';$('regionOperation').value='add';$('regionWidth').value=$('regionHeight').value='5';$('regionSort').value='all.total';
 const memory=new Map([['crate-atlas.regions.v1.'+data.metadata.sourceSha256,R.encode(doc)]]);
 const context={CrateRegionStatistics:R,CrateMapRenderer:renderer,Path2D,performance,console,document:{getElementById:$,createElement:element,createTextNode:s=>s,addEventListener(){},activeElement:null,querySelector(){return null;}},
  window:{addEventListener(){}},localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(before?'output/region-performance/region-statistics-ui-before.js':'region-statistics-ui.js','utf8'),context);
 const ui=context.CrateRegionStatisticsUI.create({getState:()=>state,getDisplay:()=>display,schedule(){},pick:()=>cells[12000],area,onMode(){}});
 ui.load();ui.setMode(true);
 const cv=createCanvas(1600,1050),ctx=cv.getContext('2d'),mini={x:0,y:0,w:238,h:146,scale:Math.min(238/data.rendering.width,146/data.rendering.height)};
 const opts={heatmap:true,blocked:true,grid:true,potentialMarkers:true,markers:true,values:true,coords:false,objects:false,filter:'all',opacity:45,threshold:0,palette:'warm'};
 const visible=cells;
 const base=timing(()=>{ctx.clearRect(0,0,1600,1050);renderer.render(ctx,state,area,display,opts);});
 const regions=timing(()=>{ctx.clearRect(0,0,1600,1050);ui.render(ctx,state,visible);});
 const miniRegions=timing(()=>{ctx.clearRect(0,0,1600,1050);ui.minimap(ctx,mini);});
 const a=cells[12000],b=cells[12020],from={x:a.px,y:a.py,game:a},to={x:b.px,y:b.py,game:b};
 const index=R.createSelectionIndex?.(cells);
 const brush=timing(()=>index?index.selected('brush-circle',from,to,5,5):R.selected(cells,'brush-circle',from,to,5,5),60);
 const options={...opts,regionLayer:(ctx,v,c)=>ui.render(ctx,v,c)},view=renderer.createViewCache?.(()=>createCanvas(1600,1050));
 const draw=()=>{ctx.clearRect(0,0,1600,1050);if(view)view.render(ctx,state,area,display,options);else renderer.render(ctx,state,area,display,options);ui.minimap(ctx,mini);};
 const frame=timing(draw);
 ui.down({x:280,y:345});
 const paintingFrame=timing(i=>{ui.move({x:300+i*18,y:350+i*5});draw();},24);ui.up();
 const panFrame=timing(()=>{state.x+=3;draw();},12);
 const edit=timing(i=>{ui.down({x:650+i,y:450});ui.move({x:670+i,y:465});ui.up();},6);
 const result={mode:before?'before':'after',scope:'Node @napi-rs/canvas, 1600x1050 full-map view, 12 regions; warmed CPU/canvas workload, not browser FPS or GPU presentation time.',map:data.metadata.filename,cells:cells.length,base,regions,miniRegions,brush,frame,paintingFrame,panFrame,edit};
 fs.mkdirSync('output/region-performance',{recursive:true});fs.writeFileSync(`output/region-performance/${result.mode}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
