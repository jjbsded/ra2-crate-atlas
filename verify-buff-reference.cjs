'use strict';
const assert=require('node:assert/strict'),Ref=require('./buff-reference.js'),B=require('./buff-expectation.js'),S=require('./toy-live/solver.js'),D=require('./probability-display.js'),P=require('./probability.js'),R=require('./region-statistics.js');
global.CrateProbabilityDisplay=D;global.CrateRegionStatistics=R;const U=require('./unit-buff.js');
assert.deepEqual([1,2,3,32].map(Ref.baseline),[1,9,25,3969]);
const cells=[];for(let y=1;y<=7;y++)for(let x=1;x<=7;x++)cells.push({x,y,px:30*(x-y)+210,py:15*(x+y),land:0,candidate:true,track:true,float:false,primary:true,status:'crate'});
const grid=new Uint8Array(262144);for(const c of cells)grid[c.y*512+c.x]=5;
const initial=S.calculate(S.search(grid,7),cells,49),iterator=B.prepare({metadata:{size:[0,0,4,4]},cells,probability:initial.probability});let step;do{step=iterator.next();}while(!step.done);const model=step.value;
for(const radius of [2,3])assert(Math.abs(B.value(model,4,4,radius)-1)<1e-12,'Placing the center unit in an ideal 1x field defines 1x');assert.equal(B.value(model,4,4,1),0);
grid[4*512+4]&=~3;const placed=S.calculate(S.search(grid,7),cells,49),data={metadata:{simulationPlan:{placements:[{id:'sim-ref',type:'MTNK',x:4,y:4}]}},cells:cells.map(c=>({...c,terms:placed.results.get(c.y*512+c.x)?.terms||[]})),probability:placed.probability},state={data,cells:data.cells,lookup:new Map(data.cells.map(c=>[c.x+','+c.y,c]))},display=D.map(data),members=new Map([[R.key({x:4,y:4}),[{id:'all'}]]]);let radius=2;
const buffs=U.create(()=>state,()=>display,()=>radius,()=>members);for(radius of [2,3]){const stats=buffs.statistics().get('all').tank;assert.equal(stats.count,1);assert.equal(stats.n,stats.denominator,'Placed-unit and region totals share the occupied-center 1x reference');}
const drawn=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},strokeText(){},fillText(text,x,y){drawn.push({text,color:this.fillStyle});}},view={x:0,y:0,scale:1},area={x:0,y:0,w:1000,h:1000};
buffs.paint(ctx,view,area,undefined,{baselineValues:false});assert.equal(drawn.length,0,'The crate 1x-label option also controls placed-unit labels');
for(const palette of ['warm','cool','multi']){drawn.length=0;buffs.paint(ctx,view,area,undefined,{baselineValues:true,palette,maximum:4});assert.equal(drawn[0].text,'1×');assert.equal(drawn[0].color,P.labelColor(1,palette,4),'Unit text follows the expectation palette and base-color mix');}
drawn.length=0;buffs.paint(ctx,view,area,undefined,{baselineValues:true,palette:'warm',maximum:4,colorText:false});assert.equal(drawn[0].color,'#fef371','The shared toggle disables placed-unit text coloring');
const textStyle={...P.paletteSettings(),labelBase:'#204060',labelMix:.5,labelStrokeRatio:.3,warmStart:'#4488cc'};
drawn.length=0;buffs.paint(ctx,{...view,scale:4},area,undefined,{baselineValues:true,palette:'warm',maximum:4,paletteColors:textStyle});assert.equal(drawn[0].color,'#326496');assert(Math.abs(ctx.lineWidth-10.8)<1e-10,'Unit text outline grows with its 36px font');
drawn.length=0;buffs.paint(ctx,view,area,undefined,{baselineValues:true,palette:'warm',colorText:false,paletteColors:textStyle});assert.equal(drawn[0].color,'#204060');
console.log('PASS shared 1x references, palette/base/mixed unit labels, variable outlines and common text-color toggle');
