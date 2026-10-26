/* Browser-only 3D adapter. Geometry is illustrative; analysis flags and heights
 * come unchanged from the currently loaded precomputed layout. No API/assets. */
(function(root){
 'use strict';
 const art=typeof module!=='undefined'?require('./terrain-artwork.js'):root.CrateToyTerrain;
 const symbols=typeof module!=='undefined'?require('./terrain-symbols.js'):root.CrateToySymbols;
 const indexes=new WeakMap(),edges=[[0,-1],[1,0],[0,1],[-1,0]],key=c=>`${c.x},${c.y}`;
 function index(data){
  if(indexes.has(data))return indexes.get(data);
  const lookup=new Map(data.cells.map(c=>[key(c),c])),affected=new Map();
  for(const c of data.cells)for(const[x,y]of c.higher||[]){const k=`${x},${y}`;if(!affected.has(k))affected.set(k,[]);affected.get(k).push([c.x,c.y,c.level]);}
  const value={lookup,affected};indexes.set(data,value);return value;
 }
 function patch(data,selected,{radius=10,signal,canvas=()=>document.createElement('canvas')}={}){
  signal?.throwIfAborted();
  const {lookup,affected}=index(data),meta=data.metadata;
  if(!lookup.has(key(selected)))throw Error('Selected cell is outside the map');
  radius=Math.max(1,Math.min(15,Math.floor(Number(radius)||10)));
  const enabled=!meta.previewOnly&&!meta.approximate&&meta.cliffBackImpassability===2;
  const palette=art.palettes[meta.theater]||art.palettes.TEMPERATE,textures={};
  // Shared tiny canvases, not full-map images. Texture ownership stays with the
  // bounded view so closing/recentering releases all GPU resources.
  function texture(id,paint){if(!textures[id]){const image=canvas();image.width=image.height=64;paint(image.getContext('2d'));textures[id]=image;}return id;}
  function ground(c){
   const kind=art.material(c),variant=(c.x*31+c.y*17)&3;
   return texture(`ground:${kind}:${variant}`,ctx=>{
    ctx.fillStyle=art.color(c,palette);ctx.fillRect(0,0,64,64);
    if(variant===0){ctx.fillStyle=kind==='water'?'#d5eeee33':'#40534520';ctx.fillRect(13,22,kind==='water'?22:5,2);ctx.fillRect(43,46,5,2);}
    if(kind==='road'){ctx.fillStyle='#e6deae70';ctx.fillRect(30,12,2,16);ctx.fillRect(30,40,2,12);}
   });
  }
  const wall=texture('wall',ctx=>{ctx.fillStyle=palette[2];ctx.fillRect(0,0,64,64);ctx.fillStyle='#10212b18';for(let i=12;i<64;i+=16)ctx.fillRect(0,i,64,1);});
  function icon(kind){return texture('icon:'+kind,ctx=>{ctx.scale(1.5,1.5);symbols.symbol(ctx,kind,64/3,40);});}
  function billboard(kind,scale=1){return {texture:icon(kind),width:64/1.5*scale,height:64/1.5*scale,offset:[0,-(64/3-8/3)*scale]};}
  const cells=[];
  for(let y=selected.y-radius;y<=selected.y+radius;y++)for(let x=selected.x-radius;x<=selected.x+radius;x++){
   const c=lookup.get(`${x},${y}`);if(!c)continue;
   const d={...c,corners:[...(art.ramps[c.slope]||art.ramps[0])],texture:ground(c),wallTexture:wall,
    higher:enabled?(c.higher||[]).map(p=>[...p]):[],affected:enabled?(affected.get(key(c))||[]).map(p=>[...p]):[],
    canPlace:!!(enabled&&c.status==='crate'&&c.probability>0&&c.overlay===255&&!c.occupied),decorations:[]};
   if(c.terrain)d.decorations.push(billboard(/^TREE\d+$/.test(c.terrain)?'tree':/^TIBTRE/.test(c.terrain)?'drill':/ROCK/.test(c.terrain)?'rock':'scenery'));
   if(/^[ST]ROCK/.test(c.overlayName||''))d.decorations.push(billboard('rock'));
   if(/^(TIB|GEM)\d+/.test(c.overlayName||'')){
    const gem=c.overlayName.startsWith('GEM');
    d.decorations.push({flat:true,texture:texture(gem?'gems':'ore',ctx=>{ctx.fillStyle=gem?'#ad79c7':'#e1b64e';for(const[x,y]of [[14,18],[42,13],[25,40],[48,45]]){ctx.beginPath();ctx.moveTo(x,y-5);ctx.lineTo(x+5,y);ctx.lineTo(x,y+5);ctx.lineTo(x-5,y);ctx.fill();}})});
   }
   if(c.wall)d.decorations.push(billboard('scenery'));
   if(c.bridge){
    const high=c.bridge.kind==='high',level=high?c.bridge.deckLevel:c.level;
    const rails=edges.flatMap(([dx,dy],edge)=>{const n=lookup.get(`${x+dx},${y+dy}`);return !n?.bridge&&(!n||n.level<level||!high&&n.rawLand===2)?[edge]:[];});
    d.decorations.push({flat:true,bridge:high?'high':'low',level,rails,
     texture:texture('bridge',ctx=>{ctx.fillStyle='#68767c';ctx.fillRect(0,0,64,64);ctx.fillStyle='#9ca9aa';ctx.fillRect(0,0,64,1);ctx.fillRect(0,0,1,64);})});
   }
   cells.push(d);
  }
  const local=new Map(cells.map(c=>[key(c),c]));
  for(const[x,y,level,kind,w,h,subcell]of data.rendering?.simplified?.objects||[]){
   const c=local.get(`${x},${y}`);if(!c)continue;
   const decoration=billboard(kind,Math.min(1.8,Math.max(1,(w+h)/3)));
   // Keep the same footprint center and infantry subcell as the 2D symbols;
   // level is already ground/deck-aware in the exported object descriptor.
   const offset=['civilian','soldier'].includes(kind)?[[0,0],[-.2,0],[0,-.2],[0,.2],[.2,0]][subcell]||[0,0]:[0,0];
   decoration.anchor={u:w/2+offset[0],v:h/2+offset[1],level};c.decorations.push(decoration);
  }
  signal?.throwIfAborted();
  return {version:1,simplified:true,center:[selected.x,selected.y],radius,cells,textures,
   metadata:{...meta,predictionEnabled:enabled,missing:[],uniqueTiles:Object.keys(textures).length}};
 }
 const api={patch};root.CrateToyTerrain3D=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
