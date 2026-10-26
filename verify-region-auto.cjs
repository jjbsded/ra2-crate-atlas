'use strict';
const assert=require('node:assert/strict'),A=require('./region-auto.js');
const key=(x,y)=>x*1024+y;
function grid(w,h){const cells=Array.from({length:w*h},(_,i)=>({x:i%w+1,y:Math.floor(i/w)+1,level:0,slope:0}));return {cells,navigation:{version:2,count:cells.length,flags:new Uint8Array(cells.length).fill(17)},starts:[{number:1,x:1,y:1}]};}
function change(g,x,y,mask,props={}){const i=g.cells.findIndex(c=>c.x===x&&c.y===y);g.navigation.flags[i]=mask;Object.assign(g.cells[i],props);}
const run=(g,settings={})=>A.partition({...g,settings},{yieldControl:async()=>{}}),owns=(r,region,x,y)=>r.regions[region]?.keys.includes(key(x,y));
(async()=>{
 let g=grid(8,8),r=await run(g,{exclusive:false,maxPath:Math.SQRT2});assert.ok(owns(r,0,2,2));assert.ok(!owns(r,0,3,1));
 r=await run(g,{exclusive:false,maxPath:1.4});assert.ok(!owns(r,0,2,2),'Diagonal costs sqrt(2)');
 g=grid(80,1);r=await run(g,{exclusive:true,maxPath:1,maxStraight:1});assert.equal(r.regions[0].keys.length,80);
 r=await run(g,{exclusive:false,maxPath:1,maxStraight:1});assert.equal(r.regions[0].keys.length,2);
 g=grid(7,3);g.starts.push({number:2,x:7,y:1});r=await run(g,{exclusive:true,maxPath:0,maxStraight:0});assert.equal(r.regions[0].keys.length,1);assert.equal(r.regions[1].keys.length,1,'Shared land respects distance caps');
 for(let y=1;y<=3;y++)change(g,4,y,0);r=await run(g,{exclusive:true,maxPath:0,maxStraight:0});assert.equal(r.regions[0].keys.length,9);assert.equal(r.regions[1].keys.length,9,'Disconnected single-player land ignores caps');
 g=grid(3,3);change(g,2,1,0);change(g,1,2,0);r=await run(g);assert.ok(!owns(r,0,2,2),'No diagonal corner cutting');
 g=grid(3,1);change(g,2,1,17,{level:4});change(g,3,1,17,{level:4});r=await run(g);assert.ok(!owns(r,0,2,1),'Passable high terrain is not reachable through a cliff');
 g=grid(3,1);change(g,1,1,17,{slope:1});change(g,2,1,17,{level:1});change(g,3,1,17,{level:1});r=await run(g);assert.ok(owns(r,0,3,1),'A matching ramp joins the upper level');
 g=grid(5,1);change(g,2,1,5);change(g,3,1,2);change(g,4,1,5);
 r=await run(g,{maxSea:0});assert.ok(owns(r,0,2,1));assert.ok(!owns(r,0,3,1),'Shore can be owned without allowing a sea crossing');
 r=await run(g,{maxSea:3.99});assert.ok(!owns(r,0,5,1));r=await run(g,{maxSea:4});assert.ok(owns(r,0,5,1),'Both shore edges count towards the crossing');
 g=grid(9,1);for(const x of [2,4,6,8])change(g,x,1,5);for(const x of [3,7])change(g,x,1,2);
 r=await run(g,{maxSea:4});assert.ok(owns(r,0,9,1),'The limit resets after each continuous crossing');
 g=grid(26,8);for(let y=1;y<=8;y++){change(g,6,y,2);change(g,16,y,2);}r=await run(g);
 assert.equal(r.regions.length,3);assert.equal(r.regions[0].keys.length,40);assert.equal(r.regions[1].keys.length,80);assert.equal(r.regions[2].keys.length,72,'Unowned land sorts by decreasing core area');
 g=grid(5,8);g.starts=[];for(let y=1;y<=8;y++)change(g,5,y,5);r=await run(g);assert.equal(r.regions.length,0,'Coast does not push 32 land cells over the >35 threshold');
 // Standalone water ignores the player's sea-crossing cap, but keeps physical
 // connectivity, category boundaries and coordinate ownership restrictions.
 g=grid(6,6);g.starts=[];g.navigation.flags.fill(2);r=await run(g,{maxSea:0});assert.equal(r.regions[0].kind,'water');assert.equal(r.regions[0].keys.length,36);
 change(g,6,6,5);r=await run(g);assert.equal(r.regions.length,0,'35 water cells plus coast is below the large-water threshold');
 g=grid(13,6);g.starts=[];g.navigation.flags.fill(2);for(let y=1;y<=6;y++)change(g,7,y,0);r=await run(g);assert.deepEqual(r.regions.map(p=>[p.kind,p.keys.length]),[['water',36],['water',36]]);
 g=grid(10,10);g.starts=[];g.navigation.flags.fill(0);for(const c of g.cells)if(c.x<=5&&c.y<=5||c.x>5&&c.y>5)change(g,c.x,c.y,2);change(g,6,5,5);change(g,5,6,5);r=await run(g);assert.equal(r.regions.length,0,'Two small pools cannot connect diagonally through coast corners');
 g=grid(7,6);g.starts=[];g.navigation.flags.fill(2);for(const c of g.cells)if(c.x>3)c.level=2;r=await run(g);assert.equal(r.regions.length,0,'Different water heights cannot join across a cliff');
 g=grid(12,10);g.navigation.flags.fill(2);g.starts=[{number:1,x:1,y:5}];for(const x of [1,12])change(g,x,5,17,{level:4});for(let x=2;x<=11;x++)change(g,x,5,10,{bridge:{kind:'high',deckLevel:4}});
 r=await run(g);assert.deepEqual(r.regions.map(p=>p.keys.length),[12,60,48]);assert.deepEqual(r.regions.slice(1).map(p=>p.kind),['water','water']);assert.ok(r.regions.slice(1).every(p=>p.keys.every(k=>k%1024!==5)),'Water cannot borrow a claimed bridge coordinate');
 g.starts=[];r=await run(g);assert.equal(r.regions.length,1);assert.equal(r.regions[0].keys.length,118,'Unclaimed high decks do not split the continuous water below');
 g=grid(97,6);g.starts=[];g.navigation.flags.fill(2);for(const c of g.cells)if(c.x%7===0)change(g,c.x,c.y,0);r=await run(g);assert.equal(r.regions.length,14,'Automatic water areas are not limited to 12');assert.ok(r.regions.every(p=>p.keys.length===36));assert.equal(r.regions[6].number,7);
 g=grid(7,3);g.starts=[{number:1,x:1,y:2},{number:2,x:4,y:1}];change(g,1,2,17,{level:4});change(g,7,2,17,{level:4});for(let x=2;x<=6;x++)change(g,x,2,25,{bridge:{kind:'high',deckLevel:4}});
 r=await run(g);assert.ok(!owns(r,0,7,2),'A coordinate claimed by another player also blocks borrowing its deck route');assert.ok(owns(r,1,4,2),'The ground route remains separate and nearer at this coordinate');assert.ok(!owns(r,0,4,1),'A deck cannot leak onto ground below');
 g.starts.length=1;r=await run(g);assert.ok(owns(r,0,7,2),'Without a competing owner the intact deck joins its banks');
 g=grid(7,3);g.starts=[{number:1,x:1,y:2}];change(g,1,2,17,{level:4});change(g,7,2,17,{level:4});for(let x=2;x<=6;x++)change(g,x,2,10,{bridge:{kind:'high',deckLevel:4}});r=await run(g,{maxSea:0});assert.ok(owns(r,0,7,2),'A bridge crosses water with sea limit zero');
 const abort=new AbortController();abort.abort();await assert.rejects(A.partition(grid(3,3),{signal:abort.signal}));
 assert.deepEqual(A.defaults,{maxSea:0,exclusive:true,maxStraight:40,maxPath:70});
 g=grid(2,2);change(g,2,1,2);change(g,1,2,2);r=await run(g,{maxSea:0});assert.ok(!owns(r,0,2,2),'Diagonal land cannot jump a sea corner at crossing limit zero');
 g=grid(12,1);change(g,1,1,0);r=await run(g);assert.deepEqual(r.unreachablePlayers,[1]);assert.equal(r.regions[0].keys.length,0,'Blocked starts cannot teleport to nearby land');
 g=grid(12,1);g.starts=[{number:2,x:6,y:1},{number:1,x:1,y:1}];r=await run(g,{exclusive:false,maxStraight:40,maxPath:70});assert.ok(!owns(r,0,7,1),'Player 1 cannot reach beyond player 2 territory');
 assert.ok(owns(r,0,3,1)&&owns(r,1,4,1));
 const reversed=await run({...g,starts:[...g.starts].reverse()},{exclusive:false});assert.deepEqual(reversed.regions,r.regions,'Input player order does not determine claims');
 const joined=await run(g,{exclusive:false,teams:{1:'A',2:'A'}});
 assert.equal(joined.regions.length,1);assert.equal(joined.regions[0].kind,'team');assert.equal(joined.regions[0].team,'A');assert.deepEqual(joined.regions[0].players,[1,2]);assert.equal(joined.regions[0].keys.length,12,'Allied players share one region and never block each other');
 const empty=await run(g,{exclusive:false,teams:{2:'empty'}});assert.equal(empty.regions.length,1);assert.equal(empty.activePlayers,1);assert.ok(owns(empty,0,12,1),'An empty start is neither a source nor a territory barrier');
 const allEmpty=await run(g,{teams:{1:'empty',2:'empty'}});assert.equal(allEmpty.regions.length,0);assert.deepEqual(allEmpty.unreachablePlayers,[]);
 g=grid(50,1);g.starts.push({number:2,x:50,y:1});r=await run(g,{maxPath:0,maxStraight:0,teams:{1:'B',2:'B'}});assert.equal(r.regions[0].keys.length,50,'A landmass exclusive to one team ignores caps');
 r=await run(g,{exclusive:false,maxPath:2,maxStraight:2,teams:{1:'B',2:'B'}});assert.deepEqual(r.regions[0].keys,[key(1,1),key(2,1),key(3,1),key(48,1),key(49,1),key(50,1)],'Distance limits are measured from actual member starts, not the team centroid');
 g=grid(12,1);g.starts=[{number:1,x:1,y:1},{number:2,x:12,y:1},{number:3,x:6,y:1}];r=await run(g,{exclusive:false,teams:{1:'A',2:'A',3:'D'}});assert.equal(r.regions.length,2);assert.ok(!owns(r,0,6,1));assert.equal(r.regions[1].team,'D');
 g=grid(7,3);g.starts=[{number:1,x:1,y:2},{number:2,x:4,y:1}];change(g,1,2,17,{level:4});change(g,7,2,17,{level:4});for(let x=2;x<=6;x++)change(g,x,2,25,{bridge:{kind:'high',deckLevel:4}});
 r=await run(g,{teams:{1:'A',2:'A'}});assert.ok(owns(r,0,7,2),'An allied ground claim does not block the independent bridge deck route');
 g=grid(7,1);g.starts.push({number:2,x:7,y:1});change(g,4,1,0);r=await run(g,{teams:{1:'C',2:'C'}});assert.equal(r.regions[0].keys.length,6);assert.ok(!owns(r,0,4,1),'Shared regions do not make impassable cells traversable');
 assert.deepEqual(A.options({teams:{1:'A',2:'neutral',3:'empty',4:'X',9:'D'}}).teams,{1:'A',3:'empty'});
 // Every claimed region must remain reachable without borrowing a rival's
 // cells; random narrow passages exercise diagonal ownership races too.
 let seed=93217;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let trial=0;trial<80;trial++){
  g=grid(12,12);g.starts=[{number:1,x:1,y:1},{number:2,x:12,y:12},{number:3,x:12,y:1}];
  for(const c of g.cells)if(!g.starts.some(p=>p.x===c.x&&p.y===c.y)&&random()<.25)change(g,c.x,c.y,0);
  r=await run(g,{exclusive:false,maxStraight:40,maxPath:70});
  for(let i=0;i<3;i++){
   const keys=new Set(r.regions[i].keys),queue=[key(g.starts[i].x,g.starts[i].y)],seen=new Set(queue);
   for(let head=0;head<queue.length;head++){const x=Math.floor(queue[head]/1024),y=queue[head]%1024;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const k=key(x+dx,y+dy);if(keys.has(k)&&!seen.has(k)){seen.add(k);queue.push(k);}}}
   assert.equal(seen.size,keys.size,'A player region must be connected through its own cells');
  }
 }
 if(process.argv.includes('--package')){
  const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),codec=require('./toy/static-codec.js'),R=require('./region-statistics.js'),P=require('./player-starts.js');
  const root=path.resolve(process.argv[process.argv.indexOf('--package')+1]),catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json')));
  for(const name of ['冰天雪地','白令海峡','加州','德州，奥斯汀','酷热乾旱']){
   const entry=catalog.maps.find(e=>e.name===name);assert.ok(entry,name);
   for(const [version,variant]of Object.entries(entry.variants)){
    const file=path.join(root,variant.reports.ore),folder=path.dirname(file),read=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)));
    const data=await codec.report(read(file),async p=>read(path.resolve(folder,p))),starts=P.positions({data,lookup:new Map(data.cells.map(c=>[c.x+','+c.y,c]))});
    const eligible=new Set(data.cells.filter(c=>R.canSelect(c,data.rendering)).map(R.key)),result=await A.partition({cells:data.cells,navigation:data.regionNavigation,starts,eligible});
    assert.deepEqual(result.regions.slice(0,starts.length).map(r=>r.number),starts.map(p=>p.number));
    const assigned=result.regions.flatMap(r=>r.keys);assert.equal(new Set(assigned).size,assigned.length);
    const indices=new Map(data.cells.map((c,i)=>[R.key(c),i])),mask=Buffer.from(data.regionNavigation.flags,'base64');
    for(const region of result.regions)for(const k of region.keys){assert.ok(eligible.has(k));assert.ok(mask[indices.get(k)]&(region.kind==='water'?2:9),'Water regions use water; default player/land routes use ground or decks');}
    for(const region of result.regions.filter(p=>p.kind==='water'))assert.ok(region.keys.length>35);
    console.log('PASS official partition',entry.label,version,'players',starts.length,'assigned',assigned.length,'water regions',result.regions.filter(p=>p.kind==='water').length);
   }
  }
 }
 console.log('PASS region routes: edge/diagonal distances, caps/exclusivity, cliffs/ramps, no corner cutting, per-crossing sea/shore limits, island order and independent high-bridge layers.');
})().catch(e=>{console.error(e);process.exitCode=1;});
