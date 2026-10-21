const assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('./region-statistics.js'),D=require('./probability-display.js');
const cells=Array.from({length:441},(_,i)=>{const x=i%21,y=Math.floor(i/21);return{x,y,level:0,px:30*(x-y),py:15*(x+y),land:y<10?0:2};});
const lookup=new Map(cells.map(c=>[R.key(c),c])),valid=new Set(lookup.keys());
const pt=(x,y)=>({x:30*(x-y),y:15*(x+y),game:{x,y}});
let doc=R.defaults();
assert.equal(doc.regions.length,12);assert.equal(doc.overlap,false);
assert.ok(doc.regions.every(r=>r.cells.size===0));
assert.equal(new Set(R.colors).size,12);
assert.ok(!R.colors.includes(R.nextColor(doc.regions)));
const distance=(a,b)=>Math.hypot(...R.lab(a).map((v,i)=>v-R.lab(b)[i]));
for(let i=0;i<12;i++)for(let j=0;j<i;j++)assert.ok(distance(R.colors[i],R.colors[j])>.10);
const changedColors=doc.regions.map(r=>({...r,color:'#ffffff'}));
assert.notEqual(R.nextColor(changedColors),R.nextColor(doc.regions),'New colors must use actual custom colors.');
const legacy=JSON.parse(R.encode(doc));delete legacy.defaultRegionCount;legacy.regions=legacy.regions.slice(0,6);legacy.regions[0].name='保留旧名称';legacy.regions[0].color='#123456';legacy.regions[0].cells=[R.key(cells[12])];
const upgraded=R.decode(JSON.stringify(legacy),valid);
assert.equal(upgraded.regions.length,12);assert.equal(upgraded.regions[0].name,'保留旧名称');assert.equal(upgraded.regions[0].color,'#123456');assert.equal(upgraded.regions[0].cells.size,1);
upgraded.regions.pop();assert.equal(R.decode(R.encode(upgraded),valid).regions.length,11,'Do not resurrect intentionally deleted regions.');
const a=pt(3,5),b=pt(8,9),game=R.selected(cells,'box-game',a,b);
assert.equal(game.length,30);
assert.deepEqual(R.selected(cells,'box-game',b,a),game);
assert.equal(R.selected(cells,'brush-game',pt(10,10),pt(10,10),1,1).length,1);
for(let w=1;w<=10;w++)for(let h=1;h<=10;h++)assert.equal(R.selected(cells,'brush-game',pt(10,10),pt(10,10),w,h).length,w*h);
for(const tool of ['brush-screen','brush-game','brush-circle','brush-ellipse']){
 const swept=new Set(R.selected(cells,tool,pt(3,3),pt(17,17),3,3));
 for(let i=3;i<=17;i++)assert.ok(swept.has(R.key({x:i,y:i})),`${tool}: skipped cell on long stroke`);
}
// Screen tools use the actual raised position, independently of logical X/Y.
const raised={x:10,y:10,px:0,py:150},screenA={x:-5,y:145},screenB={x:5,y:155};
assert.ok(R.hit(raised,'box-screen',screenA,screenB));
assert.ok(!R.hit({...raised,py:300},'box-screen',screenA,screenB));
assert.ok(!R.hit({px:31,py:0},'brush-circle',{x:0,y:0},{x:0,y:0},1,1));
assert.ok(R.hit({px:29,py:0},'brush-ellipse',{x:0,y:0},{x:0,y:0},1));
assert.ok(R.hit({px:0,py:14},'brush-ellipse',{x:0,y:0},{x:0,y:0},1));
assert.ok(!R.hit({px:0,py:16},'brush-ellipse',{x:0,y:0},{x:0,y:0},1));
assert.ok(R.hit({px:30,py:15},'brush-ellipse',{x:0,y:0},{x:60,y:30},1),'Swept ellipse includes its diagonal centerline.');
// Indexed selection must preserve the exact old cell set AND drawing order.
const selectionIndex=R.createSelectionIndex(cells);
for(const tool of ['box-screen','box-game','brush-screen','brush-game','brush-circle','brush-ellipse'])for(let i=0;i<90;i++){
 const from=pt(i%23-1,(i*7)%23-1),to=pt((i*11)%23-1,(i*13)%23-1),w=i%9+1,h=i%6+1;
 assert.deepEqual(selectionIndex.selected(tool,from,to,w,h),R.selected(cells,tool,from,to,w,h));
}
assert.deepEqual(selectionIndex.screen.query(-1e8,-1e8,-1e7,-1e7),[]);
const allowed={usable:true,cameraCoverage:1,px:0,py:0,terms:[],land:3,occupied:true};
assert.ok(R.canSelect(allowed),'Zero probability / impassability / occupancy must not exclude normal in-bounds cells.');
assert.ok(!R.canSelect({...allowed,usable:false}));
assert.ok(!R.canSelect({...allowed,visibleBand:true}));
assert.ok(!R.canSelect({...allowed,cameraCoverage:0}));
assert.ok(R.canSelect({...allowed,cameraCoverage:.25}),'Partly visible boundary cells are retained.');
assert.ok(!R.canSelect({...allowed,cameraCoverage:undefined,px:200},{cameraRect:[0,0,100,100]}));
const restricted=R.createSelectionIndex(cells,c=>c.x===10);
assert.ok(restricted.selected('brush-ellipse',pt(10,10),pt(10,10),9).every(k=>lookup.get(k).x===10));
assert.equal(restricted.screen.query(-1e4,-1e4,1e4,1e4).length,cells.length,'Main-view render index must still contain forbidden cells.');
assert.ok(R.apply(doc,game));assert.equal(doc.regions[0].cells.size,30);
const revision=R.revision(doc.regions[0]);assert.ok(revision>0);R.apply(doc,game);assert.equal(R.revision(doc.regions[0]),revision,'No-op brush should reuse cached geometry.');
doc.active='r2';R.apply(doc,game.slice(0,7));assert.equal(doc.regions[0].cells.size,23);
doc.overlap=true;R.apply(doc,game);assert.equal(doc.regions[0].cells.size,23);assert.equal(doc.regions[1].cells.size,30);
R.apply(doc,game.slice(0,3),true);assert.equal(doc.regions[1].cells.size,27);
doc.overlap=false;assert.equal(R.exclusive(doc),23);assert.equal(doc.regions[0].cells.size,0);
const roundtrip=R.decode(R.encode(doc),valid);assert.equal(R.encode(roundtrip),R.encode(doc));
const dirty=JSON.parse(R.encode(doc));dirty.regions[0].cells=[9999999];dirty.regions[0].color='url(bad)';
assert.equal(R.decode(JSON.stringify(dirty),valid).regions[0].cells.size,0);
assert.equal(R.decode(JSON.stringify(dirty),valid).regions[0].color,R.colors[0]);
assert.throws(()=>R.decode('broken',valid));assert.throws(()=>R.decode('{"version":2,"regions":[]}',valid));
const selected=[{x:1,y:1,land:0,n:20n},{x:1,y:2,land:0,n:0n},{x:1,y:3,land:2,n:30n},{x:1,y:4,land:2,n:0n}];
const selLookup=new Map(selected.map(c=>[R.key(c),c])),region={cells:new Set(selLookup.keys())};
const display={baselineNumerator:10n,get:c=>({numerator:c.n})},stats=R.statistics(region,selLookup,display);
assert.equal(stats.land.total,2);assert.equal(stats.land.average,1);assert.equal(stats.sea.average,1.5);assert.equal(stats.all.total,5);assert.equal(stats.all.average,1.25);
const empty=R.statistics({cells:new Set()},selLookup,display);assert.equal(empty.all.average,null);assert.equal(empty.all.total,0);
// Sort by exact fractions, even when rounded display values coincide.
const regions=[{id:'a',name:'区域 1'},{id:'b',name:'区域 2'},{id:'c',name:'空'}];
const s=new Map([['a',{all:{n:10n**100n,count:2}}],['b',{all:{n:10n**100n+1n,count:2}}],['c',{all:{n:0n,count:0}}]]);
assert.deepEqual(R.sorted(regions,s,'all.average').map(r=>r.id),['b','a','c']);
assert.deepEqual(R.sorted(regions,s,'all.average',true).map(r=>r.id),['a','b','c']);
assert.deepEqual(R.sorted(regions,s,'name',true).map(r=>r.id),['c','a','b']);
// Real report: partition every cell; land + sea sum to all and match exact cell totals.
const report=process.argv[2];
if(report){
 const data=JSON.parse(fs.readFileSync(report,'utf8')),display=D.map(data),lookup=new Map(data.cells.map(c=>[R.key(c),c]));
 const all=R.statistics({cells:new Set(lookup.keys())},lookup,display);
 assert.equal(all.all.count,data.cells.length);
 assert.equal(all.all.n,data.cells.reduce((n,c)=>n+display.get(c).numerator,0n));
 assert.equal(all.all.n,all.land.n+all.sea.n);
 const parts=R.defaults();for(const c of data.cells){parts.active='r'+(c.x%6+1);R.apply(parts,[R.key(c)]);}
 const totals=parts.regions.map(r=>R.statistics(r,lookup,display));
 assert.equal(totals.reduce((n,s)=>n+s.all.n,0n),all.all.n);
 assert.equal(totals.reduce((n,s)=>n+s.all.count,0),all.all.count);
 console.log(`Real map: ${all.all.count} cells, land ${all.land.count}, sea ${all.sea.count}; exact partition conserved.`);
}
console.log('Region geometry, gap-free brushes, exclusive/overlap edits, persistence, zero-area averages and exact sorting passed.');
