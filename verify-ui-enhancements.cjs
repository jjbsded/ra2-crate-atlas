const assert=require('node:assert/strict');
const D=require('./probability-display.js'),M=require('./minimap.js');
for(const [p,expected]of [[0,'0%'],[.0000969255,'0.0097%'],[.001,'0.10%'],[.0996,'10%'],[.962239,'96%'],[1,'100%']])assert.equal(D.percent(p),expected);
assert.notEqual(D.percent(1e-12),'0%');
const area={x:24,y:70,w:1552,h:820},r={width:6000,height:4500};
const m=M.layout(r,area),center={x:m.image.x+m.image.w/2,y:m.image.y+m.image.h/2};
for(const scale of [.1,.5,2.5,6]){
 const p=M.pan(m,center,area,scale,r),v=M.viewport(m,area,{...p,scale},r);
 assert.ok(Math.abs(p.x+r.width/2*scale-area.x-area.w/2)<1e-9);
 assert.ok(Math.abs(p.y+r.height/2*scale-area.y-area.h/2)<1e-9);
 assert.ok(v.w>0&&v.h>0&&v.w<=m.image.w&&v.h<=m.image.h);
 assert.ok(Math.abs((v.x+v.w/2)-center.x)<1e-9);
}
assert.equal(M.viewport(m,area,{x:-1e6,y:-1e6,scale:1},r),null);
assert.equal(M.contains(m,center),true);
assert.equal(M.contains(m,{x:0,y:0}),false);
const clamped=M.pan(m,{x:-1e6,y:1e6},area,1,r);
assert.equal(clamped.x,area.x+area.w/2);assert.equal(clamped.y,area.y+area.h/2-r.height);
// Moving the overview changes its screen coordinates, not its camera mapping.
const moved=M.layout(r,area,{position:{x:180,y:230}}),movedCenter={x:moved.image.x+moved.image.w/2,y:moved.image.y+moved.image.h/2};
const movedView=M.pan(moved,movedCenter,area,2.5,r),originalView=M.pan(m,center,area,2.5,r);
for(const axis of ['x','y'])assert.ok(Math.abs(movedView[axis]-originalView[axis])<1e-9);
const compact=M.layout(r,area,{position:{x:180,y:230},minimized:true});
assert.equal(compact.image,null);assert.equal(compact.x,moved.x);assert.equal(compact.y,moved.y);
for(const minimized of [false,true])for(const position of [{x:-1000,y:-1000},{x:1e6,y:1e6}]){
 const edge=M.layout(r,area,{position,minimized});
 assert.ok(edge.x>=area.x&&edge.y>=area.y&&edge.x+edge.w<=area.x+area.w&&edge.y+edge.h<=area.y+area.h);
 for(const b of Object.values(edge.buttons))assert.ok(b.x>=edge.x&&b.y>=edge.y&&b.x+b.w<=edge.x+edge.w&&b.y+b.h<=edge.y+edge.h);
}
console.log('PASS: two significant digits, small nonzero probabilities, minimap pan/viewport alignment at four zoom scales, bounds and off-map view');
