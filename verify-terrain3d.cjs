const assert=require('node:assert/strict');
const {height,decorationSurface,bridgeFold,viewHalfSize,relationships,riskCategory,description,probabilityCells}=require('./terrain3d.js');
const low={x:99,y:105,level:2,corners:[0,0,0,0],land:7,postLand:3,marked:true,higher:[[98,106,6]],affected:[]};
const high={x:98,y:106,level:6,corners:[0,0,0,0],land:3,higher:[],affected:[[99,105,2]]};
const lookup=new Map([['99,105',low],['98,106',high]]),original=JSON.stringify([...lookup]);
const deck=decorationSurface(low,{bridge:'high',level:6});
assert.equal(height(deck,.5,.5),6);
assert.equal(height(low,.5,.5),2,'bridge geometry must not raise the underlying map cell');
assert.deepEqual(deck.corners,[0,0,0,0]);
assert.equal(decorationSurface(low,{bridge:'low',level:2}),low);
assert.equal(decorationSurface(low,{flat:true}),low);
for(const axis of ['x','y']){
 const c={x:23,y:23},d={bridge:'high',span:{axis,origin:20,minimum:-2,maximum:2}};
 const delta=bridgeFold(c,d,.5,.5);
 assert.equal(delta,-1.5);
 const u=.5,v=.5,h=4;
 assert.equal(u+delta-(v+delta),u-v,'side fold preserves projected X');
 assert.equal(u+delta+v+delta-(h+2*delta),u+v-h,'side fold preserves projected Y');
 assert.equal(bridgeFold({x:20,y:20},d,.5,.5),0,'road deck remains planar');
}
assert.equal(bridgeFold(low,{bridge:'high'},.5,.5),0,'older static teaching data stays readable');
assert.deepEqual(relationships(low,lookup),{higher:[high],affected:[]});
assert.deepEqual(relationships(high,lookup),{higher:[],affected:[low]});
assert.deepEqual(relationships(low,new Map()),{higher:[],affected:[]});
for(const [u,v,expected] of [[0,0,2],[1,0,3],[1,1,3],[0,1,2],[.5,.5,2.5]])assert.equal(height({...low,corners:[0,1,1,0]},u,v),expected);
assert.match(description(low,{predictionEnabled:true}),/Rough/);
assert.match(description(low,{predictionEnabled:true},true),/Rough → Rock/);
assert.match(description(low,{previewOnly:true,predictionEnabled:false}),/未验证/);
assert.match(description(low,{predictionEnabled:false}),/未启用/);
assert.match(description(high,{predictionEnabled:true}),/当前地面已禁行/);
const blocked={...low,marked:false,potentialMarked:true,probability:0,occupied:true};
const shadowed={...low,marked:false,probability:0,primary:false,clearance:{supported:false}};
assert.equal(riskCategory(low),'current');
assert.equal(riskCategory(blocked),'potential');
assert.equal(riskCategory(shadowed),'zero');
assert.equal(riskCategory({...low,probability:0}),'current','exact risk flags take precedence over rounded probability');
assert.equal(riskCategory({...shadowed,probability:1e-4}),'other','unclassified Rough must not be claimed to have zero probability');
assert.equal(riskCategory(high),null);
assert.match(description(blocked,{predictionEnabled:true}),/当前落箱概率为 0；清空对象后可随机落箱/);
assert.match(description({...blocked,land:3},{predictionEnabled:true}),/清空对象后可随机落箱/,'clearance risks must also describe cells whose current overlay already makes them Rock');
assert.match(description(shadowed,{predictionEnabled:true}),/高度投影判定未选中此低格；清空对象后仍无随机落箱路径/);
assert.equal(JSON.stringify([...lookup]),original,'inspection must not mutate map cells');
for(const radius of [4,6,8,10,15])for(const [w,h]of [[320,380],[736,410],[1180,460]]){
 const half=viewHalfSize(radius,1,w,h);assert.ok(Number.isFinite(half)&&half>0);
 assert.ok(half*w/h>(2*radius+1)*Math.SQRT2/2,'initial view must fit the complete patch at narrow widths');
 assert.equal(viewHalfSize(radius,2,w,h),half/2);
}
if(process.argv[2]){
 const report=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8')),cells=report.cells;
 for(const [category,expected] of [['current',report.markers],['potential',report.potentialMarkers]]){
  assert.deepEqual(cells.filter(c=>riskCategory(c)===category).map(c=>[c.x,c.y]),expected,`${category} must match main map markers exactly`);
 }
 const counts={current:0,potential:0,zero:0,other:0};for(const c of cells){const category=riskCategory(c);if(category)counts[category]++;}
 if(report.metadata.sourceSha256==='1098b6556114e5a6da206efc9090852cca4c96c2b683a399cd05aae75a416fa7'){
  assert.deepEqual(counts,{current:13,potential:1,zero:9,other:0},'ice map: preserve all three distinct risk classes');
  assert.equal(riskCategory(cells.find(c=>c.x===109&&c.y===69)),'zero');
 }
 console.log('Saved-map classification:',counts);
 const display=require('./probability-display.js').map(report),lookup=new Map(cells.map(c=>[`${c.x},${c.y}`,c]));
 const options={filter:'all',threshold:0,opacity:45,baselineValues:false,heatmap:false,values:false};
 // 3D receives different cell objects: map back to the exact main-map display
 // entries instead of reusing old N*P multipliers or rounded probabilities.
 const patch=cells.slice(0,2000).map(c=>({...c,multiplier:-1,probability:-1}));
 const before=JSON.stringify(patch),context={display,lookup,options};
 const entries=probabilityCells(patch,context);assert.ok(entries.length>0);
 for(const e of entries){
  const source=lookup.get(`${e.cell.x},${e.cell.y}`),value=display.get(source);
  assert.equal(e.multiplier,value.multiplier);
  assert.equal(e.alpha,display.cellAlpha(source,{opacity:.55}));
  assert.equal(e.label,display.showLabel(source,false)?value.multiplier.toFixed(1)+'×':null);
 }
 const water=probabilityCells(patch,{...context,options:{...options,filter:'water',threshold:2}});
 assert.ok(water.every(e=>e.cell.land===2&&display.meetsThreshold(lookup.get(`${e.cell.x},${e.cell.y}`),2)));
 const allLabels=probabilityCells(patch,{...context,options:{...options,baselineValues:true,opacity:100}});
 assert.ok(allLabels.every(e=>e.label&&e.alpha===0));
 assert.equal(JSON.stringify(patch),before,'3D probability display must not edit patch data');
 assert.deepEqual(probabilityCells([{x:900,y:900}],context),[]);
 console.log('3D probability: exact main-map multipliers, filters, baseline labels and independent toggle passed.');
}
console.log('3D terrain: height, relations, main-map risk alignment and immutable descriptions passed.');
