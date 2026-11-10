/* The existing solver samples the square 1..(Size.width+Size.height-1).
 * Missing terrain here is a selectable origin, never a synthetic map cell. */
(function(root){
 'use strict';
 const diamond=[[0,-15],[30,0],[0,15],[-30,0]];
 const defaults=Object.freeze({dark:'#202329',light:'#5f656d',lineWidth:1,widthMode:'map',borderStyle:'solid'});
 function hitTest(state,x,y,contains){
  const candidates=state.spatialIndex?state.spatialIndex.query(x-65,y-130,x+65,y+130):state.cells;
  for(let i=candidates.length-1;i>=0;i--){
   const record=candidates[i],c=state.lookup?state.lookup.get(record.x+','+record.y):record;
   if(c&&Math.abs(x-c.px)<=65&&Math.abs(y-c.py)<=130&&contains(c,x,y))return c;
  }
  const flat=state.coordinateSpace?.point(x,y);return flat?.virtual?flat:null;
 }
 function create(data,lookup,{makeCanvas=()=>document.createElement('canvas'),makePath=()=>new Path2D()}={}){
  const size=data.metadata?.size,origin=data.rendering?.origin;if(!Array.isArray(size)||!origin)return null;
  const max=size[2]+size[3]-1;if(!Number.isInteger(max)||max<1||max>511)return null;
  const [ox,oy]=origin,virtuals=new Map(),bounds={x:ox-30*max,y:oy+15,w:60*max,h:30*max};let path=null,terrainMask=null,grid=null,style={...defaults};
  for(const c of lookup.values())if(c.py-15<bounds.y){bounds.h+=bounds.y-c.py+15;bounds.y=c.py-15;}
  const valid=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=1&&y>=1&&x<=max&&y<=max;
  function get(x,y){
   if(!valid(x,y))return null;const key=x+','+y,real=lookup.get(key);if(real)return real;
   if(!virtuals.has(key))virtuals.set(key,{x,y,px:30*(x-y)+ox,py:15*(x+y)+oy,virtual:true,level:0,slope:0,land:null,rawLand:null,postLand:null,usable:false,primary:false,candidate:false,status:'outside',objects:[],terms:[],terrain:null,overlay:255,overlayData:0,overlayName:null,occupied:false,probability:0,multiplier:0,oneAttemptProbability:0,surface:[diamond],visibleSurface:[diamond]});
   return virtuals.get(key);
  }
  function point(x,y,nearest=false){
   const a=(x-ox)/30,b=(y-oy)/15,rawX=(a+b)/2,rawY=(b-a)/2,gx=Math.round(rawX),gy=Math.round(rawY);
   if(!nearest||valid(gx,gy))return get(gx,gy);
   const clamp=v=>Math.max(1,Math.min(max,v)),candidates=[];
   // Isometric axes are oblique. Project onto each boundary instead of just
   // clamping X/Y independently, which can select a farther edge cell.
   for(const edge of [1,max])for(const value of [Math.floor(rawY+.6*(edge-rawX)),Math.ceil(rawY+.6*(edge-rawX))])candidates.push(get(edge,clamp(value)));
   for(const edge of [1,max])for(const value of [Math.floor(rawX+.6*(edge-rawY)),Math.ceil(rawX+.6*(edge-rawY))])candidates.push(get(clamp(value),edge));
   return candidates.sort((c,d)=>(c.px-x)**2+(c.py-y)**2-((d.px-x)**2+(d.py-y)**2))[0];
  }
  function geometry(){
   if(path)return path;path=makePath();terrainMask=makePath();const rows=new Map();
   for(const c of lookup.values())if(valid(c.x,c.y)){if(!rows.has(c.y))rows.set(c.y,[]);rows.get(c.y).push(c.x);}
   const run=(first,last,y,target=path)=>{if(first>last)return;const points=[[first-.5,y-.5],[last+.5,y-.5],[last+.5,y+.5],[first-.5,y+.5]];for(let i=0;i<4;i++){const[x,y]=points[i];target[i?'lineTo':'moveTo'](ox+30*(x-y),oy+15*(x+y));}target.closePath();};
   for(let y=1;y<=max;y++){let start=1,first=null,previous=null;for(const x of (rows.get(y)||[]).sort((a,b)=>a-b)){run(start,x-1,y);start=x+1;if(first===null)first=x;else if(x!==previous+1){run(first,previous,y,terrainMask);first=x;}previous=x;}run(start,max,y);if(first!==null)run(first,previous,y,terrainMask);}
   return path;
  }
  function gridGeometry(){
   if(grid)return grid;grid=makePath();const at=(x,y,move)=>grid[move?'moveTo':'lineTo'](ox+30*(x-y),oy+15*(x+y));
   // Every shared edge occurs once. Two line families replace up to M²
   // individual diamond strokes; terrain holes are clipped by geometry().
   for(let i=0;i<=max;i++){const edge=i+.5;at(edge,.5,true);at(edge,max+.5,false);at(.5,edge,true);at(max+.5,edge,false);}return grid;
  }
  function painter(settings){return function(ctx,view,area){
   if(!(view.scale>0))return;ctx.save();ctx.beginPath();ctx.rect(area.x,area.y,area.w,area.h);ctx.clip();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);ctx.clip(geometry());
   ctx.fillStyle=settings.dark;ctx.fillRect((area.x-view.x)/view.scale,(area.y-view.y)/view.scale,area.w/view.scale,area.h/view.scale);
   if(settings.lineWidth>0){const unit=settings.widthMode==='screen'?1/view.scale:1;ctx.strokeStyle=settings.light;ctx.lineWidth=settings.lineWidth*unit;ctx.lineCap='butt';ctx.setLineDash(settings.borderStyle==='dashed'?[6*unit,4*unit]:[]);ctx.stroke(gridGeometry());}ctx.restore();
  };}
  let paint=painter(style);
  function configure(value){const width=Number(value.lineWidth),next={dark:/^#[0-9a-f]{6}$/i.test(value.dark)?value.dark:defaults.dark,light:/^#[0-9a-f]{6}$/i.test(value.light)?value.light:defaults.light,lineWidth:Number.isFinite(width)&&width>=0?width:defaults.lineWidth,widthMode:value.widthMode==='screen'?'screen':'map',borderStyle:value.borderStyle==='dashed'?'dashed':'solid'};if(JSON.stringify(style)===JSON.stringify(next))return false;style=next;paint=painter(style);return true;}
  function clipTerrain(ctx,view){
   geometry();const transform=ctx.getTransform();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);ctx.clip(terrainMask);ctx.setTransform(transform);
  }
  const key=[data.metadata.sourceSha256,max,ox,oy].join('|');
  const styleKey=()=>key+'|'+JSON.stringify(style);
  return {max,bounds,get key(){return styleKey();},valid,get,point,paint:(...args)=>paint(...args),configure,clipTerrain,snapshot(){geometry();return {key:styleKey(),bounds:{...bounds},paint,clipTerrain};},getKey:key=>{const[x,y]=key.split(',').map(Number);return get(x,y);}};
 }
 const api={create,defaults,hitTest};root.CrateMapCoordinates=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
