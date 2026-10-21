/* Shared geometry for the canvas overview, viewport outline and drag-to-pan. */
(function(root){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 // Directions follow the isometric map on screen (before elevation), not the
 // raw X/Y axes. All eight offsets address adjacent logical cells.
 const directions=[
  {id:'NW',label:'↖',name:_t('向左上选格'),dx:-1,dy:0,col:0,row:0},
  {id:'N',label:'↑',name:_t('向上选格'),dx:-1,dy:-1,col:1,row:0},
  {id:'NE',label:'↗',name:_t('向右上选格'),dx:0,dy:-1,col:2,row:0},
  {id:'W',label:'←',name:_t('向左选格'),dx:-1,dy:1,col:0,row:1},
  {id:'E',label:'→',name:_t('向右选格'),dx:1,dy:-1,col:2,row:1},
  {id:'SW',label:'↙',name:_t('向左下选格'),dx:0,dy:1,col:0,row:2},
  {id:'S',label:'↓',name:_t('向下选格'),dx:1,dy:1,col:1,row:2},
  {id:'SE',label:'↘',name:_t('向右下选格'),dx:1,dy:0,col:2,row:2}
 ];
 function neighbor(lookup,cell,direction){return cell?lookup.get(`${cell.x+direction.dx},${cell.y+direction.dy}`)||null:null;}
 function position(area,p,w,h){return{x:Math.max(area.x,Math.min(area.x+area.w-w,p.x)),y:Math.max(area.y,Math.min(area.y+area.h-h,p.y))};}
 function layout(rendering,area,options={}){
  const minimized=!!options.minimized,w=minimized?72:254,h=minimized?36:332;
  const panel={...position(area,options.position||{x:area.x+area.w-266,y:area.y+12},w,h),w,h,minimized};
  const buttons={minimize:{x:panel.x+w-64,y:panel.y+6,w:24,h:24},close:{x:panel.x+w-32,y:panel.y+6,w:24,h:24}};
  if(minimized)return{...panel,buttons,image:null,navigation:null};
  const scale=Math.min((panel.w-16)/rendering.width,146/rendering.height);
  const nav={x:panel.x+134,y:panel.y+211,step:36,size:32};
  const navigation=directions.map(d=>({...d,box:{x:nav.x+d.col*nav.step,y:nav.y+d.row*nav.step,w:nav.size,h:nav.size}}));
  buttons.center={x:nav.x+nav.step,y:nav.y+nav.step,w:nav.size,h:nav.size};
  return {...panel,buttons,navigation,image:{x:panel.x+(panel.w-rendering.width*scale)/2,y:panel.y+36+(146-rendering.height*scale)/2,w:rendering.width*scale,h:rendering.height*scale,scale}};
 }
 function contains(box,p){return p.x>=box.x&&p.y>=box.y&&p.x<=box.x+box.w&&p.y<=box.y+box.h;}
 function viewport(mini,area,view,rendering){
  const x=Math.max(0,(area.x-view.x)/view.scale),y=Math.max(0,(area.y-view.y)/view.scale);
  const right=Math.min(rendering.width,(area.x+area.w-view.x)/view.scale),bottom=Math.min(rendering.height,(area.y+area.h-view.y)/view.scale);
  if(right<=x||bottom<=y)return null;
  return{x:mini.image.x+x*mini.image.scale,y:mini.image.y+y*mini.image.scale,w:(right-x)*mini.image.scale,h:(bottom-y)*mini.image.scale};
 }
 function pan(mini,p,area,scale,rendering){
  const x=Math.max(0,Math.min(rendering.width,(p.x-mini.image.x)/mini.image.scale));
  const y=Math.max(0,Math.min(rendering.height,(p.y-mini.image.y)/mini.image.scale));
  return{x:area.x+area.w/2-x*scale,y:area.y+area.h/2-y*scale};
 }
 const api={layout,position,contains,viewport,pan,directions,neighbor};root.CrateMinimap=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
