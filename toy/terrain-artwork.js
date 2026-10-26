/* Display-only materials assembled cell by cell at the original 60x30 pitch.
 * Generated at the requested zoom/export scale; no map bitmap or traced art. */
(function(root){
 'use strict';
 const {polygon,line,symbol}=typeof module!=='undefined'?require('./terrain-symbols.js'):root.CrateToySymbols;
 const ramps=[[0,0,0,0],[0,1,1,0],[0,0,1,1],[1,0,0,1],[1,1,0,0],[0,0,1,0],[0,0,0,1],[1,0,0,0],[0,1,0,0],[0,1,1,1],[1,0,1,1],[1,1,0,1],[1,1,1,0],[0,1,2,1],[1,0,1,2],[2,1,0,1],[1,2,1,0],[0,1,0,1],[1,0,1,0],[0,1,0,1],[1,0,1,0]];
 const palettes={
  SNOW:['#e7eeed','#d0dede','#79909a','#526a76','#b8a88a','#527c91'],
  TEMPERATE:['#8f9d66','#8c936a','#928064','#6e6955','#c0b183','#427f91'],
  URBAN:['#a5ab99','#969b89','#8d8774','#64695f','#c9b994','#4a7b8e'],
  NEWURBAN:['#a6ad9c','#969d8d','#8f8d7e','#646e69','#ccbe9a','#447f90'],
  DESERT:['#d4bd89','#c5aa78','#a88d62','#7d7054','#e5ce9e','#458190'],
  LUNAR:['#9693a5','#817f93','#777688','#555568','#aaa6b6','#45546e']
 };
 const hash=(x,y)=>((Math.imul(x,374761393)^Math.imul(y,668265263))>>>0);
 function top(c,origin){const h=ramps[c.slope]||ramps[0],x=30*(c.x-c.y)+origin[0],y=15*(c.x+c.y-c.level)+origin[1];return [[x,y-15-h[0]*15],[x+30,y-h[1]*15],[x,y+15-h[2]*15],[x-30,y-h[3]*15]];}
 function material(c){return ({2:'water',6:'shore',8:'ice',1:'road',9:'road',3:'rock',7:'rough'})[c.rawLand]||'ground';}
 function color(c,p){return ({water:p[5],shore:p[4],ice:'#b8d9df',road:'#8b9390',rock:p[2],rough:p[1],ground:p[0]})[material(c)];}
 function create(data){
  const r=data.rendering,origin=r.origin,p=palettes[data.metadata.theater]||palettes.TEMPERATE;
  const lookup=new Map(data.cells.map(c=>[`${c.x},${c.y}`,c])),commands=[];
  function add(points,paint,order,objects=false){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);commands.push({box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],paint,order,objects});}
  for(const c of data.cells){
   const points=top(c,origin),cx=30*(c.x-c.y)+origin[0],cy=15*(c.x+c.y-c.level)+origin[1],order=(c.x+c.y)*10;
   const heights=ramps[c.slope]||ramps[0];
   for(const [edge,dx,dy,a,b] of [[1,1,0,0,3],[2,0,1,1,0]]){
    const n=lookup.get(`${c.x+dx},${c.y+dy}`),nh=ramps[n?.slope]||ramps[0],j=(edge+1)%4;
    const dropA=Math.max(0,c.level+heights[edge]-(n?(n.level+nh[a]):0))*15;
    const dropB=Math.max(0,c.level+heights[j]-(n?(n.level+nh[b]):0))*15;
    if(dropA||dropB){const face=[points[edge],points[j],[points[j][0],points[j][1]+dropB],[points[edge][0],points[edge][1]+dropA]];
     add(face,ctx=>polygon(ctx,face,p[edge===1?2:3]),order+.1);
    }
   }
   add(points,ctx=>{
    polygon(ctx,points,color(c,p));
    // Seal anti-alias seams between adjacent cells at overview scale.
    const transform=ctx.getTransform();ctx.lineWidth=.65/Math.hypot(transform.a,transform.b);ctx.strokeStyle=color(c,p);ctx.stroke();
    ctx.save();ctx.clip();
    if(c.slope)polygon(ctx,points,`rgba(27,44,52,${[0,.035,.07,.025][c.slope%4]})`);
    const surfaceY=points.reduce((sum,p)=>sum+p[1],0)/4;
    ctx.translate(0,surfaceY-cy);
    const kind=material(c),v=hash(c.x,c.y)%4;
    if(kind==='water'&&v===0)line(ctx,[[cx-9,cy],[cx+5,cy]],'rgba(213,238,238,.20)',.7);
    else if((kind==='ground'||kind==='rough'||kind==='shore')&&v===0){ctx.fillStyle='rgba(64,83,69,.12)';ctx.fillRect(cx-7,cy-3,3,1);ctx.fillRect(cx+4,cy+2,2,1);}
    if(kind==='road')line(ctx,[[cx-8,cy-4],[cx+8,cy+4]],'rgba(230,222,174,.45)',1);
    const name=c.overlayName||'';
    if(/^(TIB|GEM)\d+/.test(name)){
     const gem=name.startsWith('GEM');for(const [dx,dy]of [[-10,0],[1,-4],[10,1],[-1,5]])polygon(ctx,[[cx+dx-3,cy+dy],[cx+dx,cy+dy-3],[cx+dx+3,cy+dy],[cx+dx,cy+dy+2]],gem?'#a778b6':'#d7ae4d');
    }
    if(c.wall){polygon(ctx,[[cx-12,cy-4],[cx,cy+2],[cx+12,cy-4],[cx,cy-10]],'#b6b8a5');line(ctx,[[cx-12,cy-4],[cx-12,cy-12],[cx,cy-6],[cx+12,cy-12],[cx+12,cy-4]],'#66736c',2);}
    ctx.restore();
   },order);
   if(c.terrain){const kind=/^TREE\d+$/.test(c.terrain)?'tree':/^TIBTRE/.test(c.terrain)?'drill':/ROCK/.test(c.terrain)?'rock':'scenery',y=points.reduce((sum,p)=>sum+p[1],0)/4;add([[cx-12,y-32],[cx+12,y+3]],ctx=>symbol(ctx,kind,cx,y),order+3);}
   if(/^[ST]ROCK/.test(c.overlayName||''))add([[cx-12,cy-22],[cx+12,cy+3]],ctx=>symbol(ctx,'rock',cx,cy),order+2);
   if(c.bridge){
    const high=c.bridge.kind==='high',level=high?c.bridge.deckLevel:c.level;
    const deck=top({...c,level,slope:0},origin),deckY=15*(c.x+c.y-level)+origin[1];
    const edges=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy],i)=>{const n=lookup.get(`${c.x+dx},${c.y+dy}`);return !n?.bridge&&(!n||n.level<level||!high&&n.rawLand===2)?i:-1;}).filter(i=>i>=0);
    add([[cx-31,deckY-22],[cx+31,deckY+20]],ctx=>{
     polygon(ctx,deck,'#6c797e');
     for(const edge of edges){const a=deck[edge],b=deck[(edge+1)%4];
      polygon(ctx,[a,b,[b[0],b[1]+3],[a[0],a[1]+3]],'#3a4d55');line(ctx,[[a[0],a[1]-3],[b[0],b[1]-3]],'#cad4ca',1.5);
      for(const t of [.15,.75]){const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;line(ctx,[[x,y],[x,y-4]],'#c6d0c7',1);}
     }
    },order+4);
   }
  }
  for(const [x,y,level,kind,w,h,subcell]of r.simplified.objects){
   const xx=x+(w-1)/2,yy=y+(h-1)/2,offset=kind==='civilian'||kind==='soldier'?[[0,0],[-6,-3],[6,-3],[-6,3],[6,3]][subcell]||[0,0]:[0,0];
   const cx=30*(xx-yy)+origin[0]+offset[0],cy=15*(xx+yy-level)+origin[1]+offset[1],scale=Math.min(1.8,Math.max(1,(w+h)/3));
   add([[cx-14*scale,cy-40*scale],[cx+14*scale,cy+4*scale]],ctx=>symbol(ctx,kind,cx,cy,scale),(x+y+w+h-2)*10+5,true);
  }
  commands.sort((a,b)=>a.order-b.order);
  // Spatial buckets include tall faces/symbols; queries retain painter order.
  const buckets=new Map(),size=240;
  commands.forEach((c,i)=>{for(let y=Math.floor(c.box[1]/size);y<=Math.floor(c.box[3]/size);y++)for(let x=Math.floor(c.box[0]/size);x<=Math.floor(c.box[2]/size);x++){const k=`${x},${y}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(i);}});
  function image(objects){return {width:r.width,height:r.height,draw(ctx,...args){
   let sx=0,sy=0,sw=r.width,sh=r.height,dx,dy,dw,dh;
   if(args.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=args;else [dx,dy,dw=r.width,dh=r.height]=args;
   if(!(sw>0&&sh>0&&dw>0&&dh>0))return;
   ctx.save();ctx.beginPath();ctx.rect(dx,dy,dw,dh);ctx.clip();ctx.translate(dx-sx*dw/sw,dy-sy*dh/sh);ctx.scale(dw/sw,dh/sh);
   const inverse=ctx.getTransform().inverse(),corners=[[0,0],[ctx.canvas.width,0],[ctx.canvas.width,ctx.canvas.height],[0,ctx.canvas.height]].map(([x,y])=>({x:inverse.a*x+inverse.c*y+inverse.e,y:inverse.b*x+inverse.d*y+inverse.f}));
   const left=Math.max(sx,Math.min(...corners.map(c=>c.x))),right=Math.min(sx+sw,Math.max(...corners.map(c=>c.x))),upper=Math.max(sy,Math.min(...corners.map(c=>c.y))),bottom=Math.min(sy+sh,Math.max(...corners.map(c=>c.y)));
   const ids=new Set();for(let y=Math.floor(upper/size);y<=Math.floor(bottom/size);y++)for(let x=Math.floor(left/size);x<=Math.floor(right/size);x++)for(const id of buckets.get(`${x},${y}`)||[])ids.add(id);
   for(const id of [...ids].sort((a,b)=>a-b)){const c=commands[id];if((objects||!c.objects)&&c.box[0]<=right&&c.box[2]>=left&&c.box[1]<=bottom&&c.box[3]>=upper)c.paint(ctx);}
   ctx.restore();
  }};}
  return {im:image(false),objectImage:image(true),stats:{cells:data.cells.length,commands:commands.length,objects:r.simplified.objects.length}};
 }
 const api={create,top,material,ramps,palettes,color};root.CrateToyTerrain=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
