/* Display parsed building foundations / unit cells; never infer occupancy from
 * sprite extents or from zero probability alone. Does not change the model.
 */
(function(root){
 'use strict';
 function mapCell(c){
  return c.occupied===true&&c.terms.length===0&&c.objects.some(kind=>kind!==c.terrain);
 }
 function demoCell(cell,world){return ['building','unit'].includes(world.objects[cell.join(',')]);}
 function path(ctx,rings,radius){
  ctx.beginPath();
  for(const ring of rings){
   if(ring.length<3)continue;
   const corners=ring.map((p,i)=>{
    const prev=ring[(i+ring.length-1)%ring.length],next=ring[(i+1)%ring.length];
    const before=Math.hypot(prev[0]-p[0],prev[1]-p[1]),after=Math.hypot(next[0]-p[0],next[1]-p[1]);
    const cut=Math.min(radius,before/3,after/3);
    return{p,enter:[p[0]+(prev[0]-p[0])*(before?cut/before:0),p[1]+(prev[1]-p[1])*(before?cut/before:0)],exit:[p[0]+(next[0]-p[0])*(after?cut/after:0),p[1]+(next[1]-p[1])*(after?cut/after:0)]};
   });
   ctx.moveTo(...corners.at(-1).exit);
   for(const c of corners){ctx.lineTo(...c.enter);ctx.quadraticCurveTo(...c.p,...c.exit);}
   ctx.closePath();
  }
 }
 function draw(ctx,rings,scale=1){
  ctx.save();
  // Keep rounded corners and outlines inside the actual visible slope surface,
  // including holes and cells partly covered by foreground cliffs.
  ctx.beginPath();for(const ring of rings){ring.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...p));ctx.closePath();}ctx.clip('evenodd');
  path(ctx,rings,6*scale);ctx.fillStyle='rgba(25,205,112,.16)';ctx.fill('evenodd');
  ctx.strokeStyle='rgba(59,227,135,.5)';ctx.lineWidth=Math.min(1.5,.75*scale);ctx.stroke();ctx.restore();
 }
 const api={mapCell,demoCell,path,draw};if(typeof module!=='undefined')module.exports=api;root.CrateOccupancyOverlay=api;
})(typeof globalThis!=='undefined'?globalThis:this);
