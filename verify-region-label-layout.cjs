'use strict';
const assert=require('node:assert/strict'),L=require('./region-label-layout.js');
const area={x:0,y:0,w:1000,h:600},view={x:0,y:0,scale:1,drag:{mode:'pan'}},tracker=L.createMotion({settle:300});
const fixed=L.createMotion(),fixedView={x:0,y:0,scale:1};assert(fixed.observe(fixedView,area,0).settled);fixedView.x=20;assert(!fixed.observe(fixedView,area,100).settled);assert(!fixed.observe(fixedView,area,149).settled);assert(fixed.observe(fixedView,area,150).settled,'Production titles require exactly 50 ms of actual stillness');
assert(tracker.observe(view,area,0).settled);
view.x=40;assert(!tracker.observe(view,area,100).settled);
view.x=80;assert(!tracker.observe(view,area,200).settled);
assert(!tracker.observe(view,area,499).settled);
assert(tracker.observe(view,area,500).settled,'A held right button does not prevent actual camera stillness');
view.x=81;assert(tracker.observe(view,area,520).settled,'Small pointer noise does not restart settling');
view.x=79;assert(tracker.observe(view,area,550).settled);
view.scale=1.01;assert(!tracker.observe(view,area,600).settled);
assert(tracker.observe(view,area,900).settled);
assert(!tracker.observe(view,{...area,w:800},901).settled);
tracker.reset();assert(tracker.observe(view,area,1000).settled);
const carried={x:140,y:80,targetX:900,targetY:450,vx:500,vy:200,viewX:20,viewY:30,scale:1};
assert(L.transport(carried,{x:180,y:-70,scale:2}));
assert.equal((carried.x-180)/2,120);assert.equal((carried.y+70)/2,50);
assert.equal((carried.targetX-180)/2,880);assert.equal((carried.targetY+70)/2,420);assert.equal(carried.vx,1000);
assert.equal(L.transport(carried,{x:180,y:-70,scale:2}),false);
assert.deepEqual(L.defaults,{maxSpeed:8000,acceleration:20000});
const clip={l:0,r:1000,t:0,b:600},title={x:200,y:200,targetX:900,targetY:200,frameAt:0,appearedAt:0};
let previous=0,step=0;
for(let now=16;now<=4000;now+=16){const old={x:title.x,y:title.y};L.advance(title,clip,100,30,now);step=Math.hypot(title.x-old.x,title.y-old.y);assert(step<=8000*.016+1e-6,'Every visible frame obeys the speed limit');if(now===16)assert(step<=20000*.016**2/2+1e-6,'Start from rest at the configured acceleration');if(now===32)assert(step>previous,'Accelerate rather than teleport');previous=step;}
assert(Math.abs(title.x-title.targetX)<.21);
const fast={x:0,y:300,targetX:20000,targetY:300,frameAt:0};let peak=0;
for(let now=16;now<=2000;now+=16){const x=fast.x;L.advance(fast,{l:-100,r:30000,t:0,b:600},100,30,now);peak=Math.max(peak,(fast.x-x)/.016);}
assert(peak>7999&&peak<=8000.00001,'The default cap is 8000 px/s');
Object.assign(title,{x:-100,y:200,targetX:700,targetY:200,vx:0,vy:0,frameAt:4000});L.advance(title,clip,100,30,4016);assert(title.x<-97,'A single point touching the viewport still needs acceleration');
Object.assign(title,{x:-2000,y:200,targetX:700,targetY:200,vx:0,vy:0,frameAt:4016});L.advance(title,clip,100,30,4032);assert(Math.abs(title.x+100)<1e-6,'An offscreen title skips only to the viewport boundary');assert.equal(title.appearedAt,4032);L.advance(title,clip,100,30,4048);assert(title.x<-97);
Object.assign(title,{x:200,y:200,targetX:900,targetY:200,vx:0,vy:0,frameAt:4048});L.advance(title,clip,100,30,10000);assert(title.x-200<=30,'A suspended tab cannot create a visible jump');
for(const target of [[100,300],[500,500],[100,100],[500,100]]){
 const m={x:500,y:300,targetX:target[0],targetY:target[1],vx:1800,vy:900,frameAt:0};
 const dx=m.targetX-m.x,dy=m.targetY-m.y;L.advance(m,clip,40,20,16);
 const sx=m.x-500,sy=m.y-300;
 assert(sx*dx+sy*dy>=-1e-8,'Reversals must not retain velocity away from the target');
 assert(Math.abs(sx*dy-sy*dx)<1e-7,'Corners must not retain sideways velocity');
 assert(Math.hypot(sx,sy)<=8000*.016+1e-6);
}
const reverse={x:500,y:300,targetX:100,targetY:300,vx:2000,vy:0,frameAt:0};L.advance(reverse,clip,40,20,16);assert(reverse.x<500&&reverse.x>497,'A reversed direction starts accelerating from rest');
const line={x:100,y:200,targetX:800,targetY:500,frameAt:0};
for(let now=16;now<=8000;now+=16){const x=line.x,y=line.y;L.advance(line,clip,40,20,now,{maxSpeed:333,acceleration:777});assert(Math.abs((line.x-100)*300-(line.y-200)*700)<1e-6,'A settled relocation stays on one start-to-final line');assert(Math.hypot(line.x-x,line.y-y)<=333*.016+1e-6);}
assert.equal(line.x,800);assert.equal(line.y,500);
const item=(id,x=250,y=200)=>({id,x,y,preferredX:x,preferredY:y,halfWidth:100,halfHeight:30,priority:1,contains:(x,y)=>x>=110&&x<=690&&y>=40&&y<=560});
let input=[item('r1'),item('r2'),item('r3')],solved=L.avoid(input);
const boxes=[...solved.positions.values()];for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++)assert.equal(L.overlap(boxes[i],boxes[j]),0,'Avoidable title overlaps must be removed');
for(const box of boxes)assert(box.contains(box.x,box.y));
const restricted=Array.from({length:80},(_,i)=>({...item('r'+(i+1),250,200),contains:(x,y)=>x>=249&&x<=251&&y>=199&&y<=201}));
solved=L.avoid(restricted);const first=JSON.stringify([...solved.positions].map(([id,b])=>[id,b.x,b.y]));
input=restricted;
for(let n=0;n<60;n++){
 const result=L.avoid(input);assert(result.checks<=16000,'Dense scenes must obey a fixed pair-check budget');
 assert.equal(JSON.stringify([...result.positions].map(([id,b])=>[id,b.x,b.y])),first,'Impossible overlaps must not produce repeated positional hunting');
 input=input.map(box=>({...box,x:result.positions.get(box.id).x,y:result.positions.get(box.id).y}));
}
console.log('PASS actual-motion settling, held buttons, jitter/zoom/resize, constrained collision avoidance and stable bounded dense layouts');
