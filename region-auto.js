/* Terrain route partition. No probability model or original report is mutated. */
(function(root){
 'use strict';
 const GROUND=1,WATER=2,SHORE=4,DECK=8,CORE=16,SQRT2=Math.SQRT2,EPS=1e-8;
 const defaults={maxSea:0,exclusive:true,maxStraight:40,maxPath:70};
 const ramps=[[0,0,0,0],[0,1,1,0],[0,0,1,1],[1,0,0,1],[1,1,0,0],[0,0,1,0],[0,0,0,1],[1,0,0,0],[0,1,0,0],[0,1,1,1],[1,0,1,1],[1,1,0,1],[1,1,1,0],[0,1,2,1],[1,0,1,2],[2,1,0,1],[1,2,1,0],[0,1,0,1],[1,0,1,0],[0,1,0,1],[1,0,1,0]];
 const key=c=>c.x*1024+c.y;
 function teams(value={}){const out={};for(let n=1;n<=8;n++)if(['A','B','C','D','empty'].includes(value?.[n]))out[n]=value[n];return out;}
 function options(value={}){value=value&&typeof value==='object'?value:{};const out={exclusive:value.exclusive!==false,teams:teams(value.teams)};for(const field of ['maxSea','maxStraight','maxPath'])out[field]=Number.isFinite(Number(value[field]))?Math.max(0,Math.min(10000,Number(value[field]))):defaults[field];return out;}
 const before=(a,b)=>Math.abs(a.distance-b.distance)>EPS?a.distance<b.distance:(a.player??0)<(b.player??0);
 class Heap{
  constructor(){this.items=[];}
  push(value){const a=this.items;let i=a.length;a.push(value);while(i){const p=(i-1)>>1;if(!before(value,a[p]))break;a[i]=a[p];i=p;}a[i]=value;}
  pop(){const a=this.items,out=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&before(a[child+1],a[child]))child++;if(!before(a[child],last))break;a[i]=a[child];i=child;}a[i]=last;}return out;}
  get length(){return this.items.length;}
 }
 function flags(navigation,count){
  if(navigation?.version!==2||navigation.count!==count)throw Error('REGION_NAVIGATION_INVALID');
  const raw=typeof navigation.flags==='string'?Uint8Array.from(atob(navigation.flags),c=>c.charCodeAt(0)):navigation.flags;
  if(raw.length!==count)throw Error('REGION_NAVIGATION_LENGTH');return raw;
 }
 async function partition({cells,navigation,starts,eligible,settings}, {signal,onProgress=()=>{},yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
  const config=options(settings),bits=flags(navigation,cells.length),nodes=[],at=new Map();let work=0,tick=Date.now();
  async function pause(){signal?.throwIfAborted();if(Date.now()-tick>12){await yieldControl();tick=Date.now();signal?.throwIfAborted();}}
  for(let i=0;i<cells.length;i++){
   const c=cells[i],mask=bits[i];if(eligible&&!eligible.has(key(c)))continue;
   const list=[];
   for(const deck of [false,true])if(deck?mask&DECK:mask&(GROUND|WATER)){
    const node={id:nodes.length,index:i,c,deck,water:!deck&&!!(mask&WATER),shore:!deck&&!!(mask&SHORE),core:!!(mask&CORE),z:deck?c.bridge.deckLevel:c.level,corners:deck?ramps[0]:ramps[c.slope]||ramps[0],edges:[]};
    nodes.push(node);list.push(node);
   }
   if(list.length)at.set(key(c),list);if((++work&2047)===0)await pause();
  }
  // Equal heights along the shared edge connect ground/ramp/deck surfaces.
  // Separate nodes prevent going vertically through the deck at one X/Y.
  const edges=[[[1,0],[1,2],[0,3]],[[0,1],[2,3],[1,0]],[[-1,0],[0,3],[1,2]],[[0,-1],[1,0],[2,3]]];
  function joins(a,b,side){return side[1].every((corner,i)=>Math.abs(a.z+a.corners[corner]-b.z-b.corners[side[2][i]])<EPS);}
  for(const a of nodes){
   for(const side of edges){const [dx,dy]=side[0];for(const b of at.get((a.c.x+dx)*1024+a.c.y+dy)||[])if(joins(a,b,side))a.edges.push([b.id,1]);}
   if((++work&2047)===0)await pause();
  }
  for(const a of nodes){
   for(const dx of [-1,1])for(const dy of [-1,1])for(const b of at.get((a.c.x+dx)*1024+a.c.y+dy)||[]){
    // Both orthogonal routes must exist: never cut through blocked corners.
    const through=(x,y)=>(at.get(x*1024+y)||[]).filter(mid=>(a.water||b.water||!mid.water)&&a.edges.some(([id,w])=>id===mid.id&&w===1)&&mid.edges.some(([id,w])=>id===b.id&&w===1)).map(mid=>mid.id);
    const via=[through(a.c.x+dx,a.c.y),through(a.c.x,a.c.y+dy)];
    if(via.every(side=>side.length))a.edges.push([b.id,SQRT2,via]);
   }
   if((++work&1023)===0)await pause();
  }
  onProgress(18);
  const components=[],component=new Int32Array(nodes.length).fill(-1);
  for(const node of nodes)if(!node.water&&component[node.id]<0){
   const id=components.length,queue=[node.id],members=[];component[node.id]=id;
   for(let head=0;head<queue.length;head++){
    const a=nodes[queue[head]];members.push(a.id);
    for(const[next]of a.edges)if(!nodes[next].water&&component[next]<0){component[next]=id;queue.push(next);}
    if((++work&4095)===0)await pause();
   }
   components.push({members,players:[]});
  }
  const groups=[],groupIds=new Map();
  const players=[...starts].sort((a,b)=>a.number-b.number).filter(start=>config.teams[start.number]!=='empty').map((start,index)=>{
   const team=config.teams[start.number],id=team?'team:'+team:'player:'+start.number;
   if(!groupIds.has(id)){groupIds.set(id,groups.length);groups.push({kind:team?'team':'player',number:start.number,...(team?{team}:{}),players:[]});}
   const group=groupIds.get(id);groups[group].players.push(start.number);
   // Never teleport a blocked start across walls, water or cliffs.
   const best=(at.get(key(start))||[]).filter(n=>!n.water).sort((a,b)=>Number(a.deck)-Number(b.deck))[0];
   if(best)components[component[best.id]].players.push(index);
   return {number:start.number,x:start.x,y:start.y,group,seed:best?.id??-1};
  });
  // One simultaneous expansion: rivals block both layers at a coordinate;
  // allies share ownership, but route/crossing distances stay source-specific.
  const owner=new Int32Array(cells.length).fill(-1),reached=new Int32Array(nodes.length).fill(-1);
  const fronts=Array.from({length:nodes.length},()=>[]),heap=new Heap();let visited=0;
  for(let player=0;player<players.length;player++){
   const start=players[player];if(start.seed<0)continue;
   const i=nodes[start.seed].index;
   if(owner[i]>=0&&owner[i]!==start.group){start.seed=-1;continue;}
   owner[i]=start.group;
  }
  const exclusive=players.map(p=>p.seed>=0&&config.exclusive&&components[component[p.seed]].players.every(i=>players[i].group===p.group));
  function permitted(node,player,d){const p=players[player];return exclusive[player]&&component[node.id]===component[p.seed]||d<=config.maxPath+EPS&&Math.hypot(node.c.x-p.x,node.c.y-p.y)<=config.maxStraight+EPS;}
  function add(label){
   const node=nodes[label.node];if(owner[node.index]>=0&&owner[node.index]!==players[label.player].group||!permitted(node,label.player,label.distance))return;
   const front=fronts[label.node],same=old=>old.player===label.player&&old.wet===label.wet;
   if(front.some(old=>same(old)&&old.distance<=label.distance+EPS&&old.sea<=label.sea+EPS))return;
   heap.push(label);
  }
  for(let player=0;player<players.length;player++)if(players[player].seed>=0)add({node:players[player].seed,player,distance:0,sea:0,wet:false});
  while(heap.length){
   const label=heap.pop();
   const a=nodes[label.node],player=label.player,group=players[player].group;
   if(owner[a.index]>=0&&owner[a.index]!==group)continue;
   // Cardinal neighbors settle before a sqrt(2) step. Both corner clearances
   // must also belong to this group, so later claims cannot sever the route.
   if(label.via&&!label.via.every(side=>side.some(id=>reached[id]===group)))continue;
   // Only validated, settled routes may dominate alternatives. A diagonal
   // waiting on corner ownership must not suppress a valid longer edge route.
   const front=fronts[label.node],same=old=>old.player===player&&old.wet===label.wet;
   if(front.some(old=>same(old)&&old.distance<=label.distance+EPS&&old.sea<=label.sea+EPS))continue;
   for(let i=front.length-1;i>=0;i--)if(same(front[i])&&front[i].distance>=label.distance-EPS&&front[i].sea>=label.sea-EPS)front.splice(i,1);
   front.push(label);
   owner[a.index]=group;if(reached[a.id]<0){reached[a.id]=group;visited++;}
   for(const[next,w,via]of a.edges){
    const b=nodes[next],d=label.distance+w;
    if(owner[b.index]>=0&&owner[b.index]!==group)continue;
    let sea=label.sea,wet=label.wet;
    if(b.water){sea+=w;wet=true;if(sea>config.maxSea+EPS)continue;}
    else if(b.shore){sea=wet?sea+w:Math.min(config.maxSea+1,sea+w);if(wet&&sea>config.maxSea+EPS)continue;}
    else{if(wet&&sea+w>config.maxSea+EPS)continue;sea=0;wet=false;}
    add({node:next,player,distance:d,sea,wet,via});
   }
   if((++work&1023)===0){onProgress(20+65*visited/Math.max(1,nodes.length));await pause();}
  }
  const regions=groups.map(g=>({...g,keys:[]}));
  // Split remaining unowned land again: a player's territory can divide an
  // otherwise connected island. Never aggregate disconnected scraps into >35.
  const extra=[],seen=new Set();
  const vacant=id=>!nodes[id].water&&owner[nodes[id].index]<0;
  for(const c of components)if(!c.players.length)for(const id of c.members){
   if(seen.has(id)||!vacant(id))continue;
   const members=[id],core=new Set();seen.add(id);
   for(let head=0;head<members.length;head++){
    const a=nodes[members[head]];if(a.core&&!a.shore)core.add(key(a.c));
    for(const[next,,via]of a.edges)if(!seen.has(next)&&vacant(next)&&(!via||via.every(side=>side.some(vacant)))){seen.add(next);members.push(next);}
    if((++work&2047)===0)await pause();
   }
   if(core.size>35)extra.push({members,area:core.size});
  }
  extra.sort((a,b)=>b.area-a.area||key(nodes[a.members[0]].c)-key(nodes[b.members[0]].c));
  for(const c of extra){
   const available=c.members.filter(id=>owner[nodes[id].index]<0);
   const core=new Set(available.filter(id=>nodes[id].core&&!nodes[id].shore).map(id=>key(nodes[id].c)));
   if(core.size<=35)continue;
   const id=regions.length;regions.push({kind:'land',number:regions.length-groups.length+1,keys:[]});
   for(const node of available)owner[nodes[node].index]=id;
  }
  // Water is allocated after land/decks. A coordinate already claimed by a
  // player or land region cannot be borrowed through the bridge layer below.
  // Coast and land cannot join water diagonally or inflate the >35 threshold.
  const waters=[],waterSeen=new Set(),vacantWater=id=>nodes[id].water&&owner[nodes[id].index]<0;
  for(const seed of nodes){
   if(!vacantWater(seed.id)||waterSeen.has(seed.id))continue;
   const members=[seed.id];let first=key(seed.c);waterSeen.add(seed.id);
   for(let head=0;head<members.length;head++){
    const a=nodes[members[head]];first=Math.min(first,key(a.c));
    for(const[next,,via]of a.edges)if(!waterSeen.has(next)&&vacantWater(next)&&(!via||via.every(side=>side.some(vacantWater)))){waterSeen.add(next);members.push(next);}
    if((++work&2047)===0)await pause();
   }
   if(members.length>35)waters.push({members,first});
  }
  waters.sort((a,b)=>b.members.length-a.members.length||a.first-b.first);
  for(const water of waters){
   const id=regions.length;regions.push({kind:'water',number:id+1,keys:[]});
   for(const node of water.members)owner[nodes[node].index]=id;
  }
  for(let i=0;i<cells.length;i++)if(owner[i]>=0)regions[owner[i]].keys.push(key(cells[i]));
  onProgress(100);signal?.throwIfAborted();
  return {regions,players:groups.length,activePlayers:players.length,unreachablePlayers:players.filter(p=>p.seed<0).map(p=>p.number),unassigned:cells.filter((c,i)=>(!eligible||eligible.has(key(c)))&&owner[i]<0).length,settings:config};
 }
 const api={defaults,options,teams,partition,ramps};root.CrateRegionAuto=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
