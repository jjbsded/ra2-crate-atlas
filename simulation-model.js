/* Immutable source map + portable delta. No probability or artwork decisions here. */
(function(root){
 'use strict';
 const yes=v=>/^(yes|true|1)$/i.test(String(v)),num=(v,d=0)=>{const n=Number(String(v??'').replace(/%$/,''));return v!==undefined&&v!==null&&Number.isFinite(n)?n:d;};
 const key=(x,y)=>`${x},${y}`,clone=v=>structuredClone(v),own=(o,k)=>Object.hasOwn(o,k);
 const bridgesAPI=root.CrateSimulationBridges||(typeof require==='function'?require('./simulation-bridges.js'):null);
 const sections=['STRUCTURES','UNITS','INFANTRY','AIRCRAFT'];
 const infantrySlots=[3,4,2],infantryOffsets=[[-15,0],[0,7],[15,0]];
 function infantrySlotsUsed(occupants,onBridge){
  const used=new Set();
  let center=0;
  for(const o of occupants){
   if(o.category!=='INFANTRY'||!!o.onBridge!==onBridge)continue;
   const slot=o.placed?o.subcell:infantrySlots.indexOf(num(o.fields?.[5]));
   if(slot<0)center++;else used.add(slot);
  }
  for(let i=0;i<3&&center;i++)if(!used.has(i)){used.add(i);center--;}
  return used;
 }
 const landNames=['CLEAR','ROAD','WATER','ROCK','WALL','TIBERIUM','BEACH','ROUGH','ICE','RAILROAD','TUNNEL'];
 function foundation(art){const m=/^(\d+)x(\d+)$/i.exec(art?.FOUNDATION||'1x1');if(!m||+m[1]>10||+m[2]>10)return null;return Array.from({length:+m[1]},(_,x)=>Array.from({length:+m[2]},(_,y)=>[x,y])).flat();}
 const foundationKey=(footprint,water)=>JSON.stringify([footprint,water]);
 function tree(kind,cfg){return !['SPAWNSTIBERIUM','ISVEINHOLE','WATERBOUND'].some(k=>yes(cfg[k]))&&!/^(TIBTRE|VEINTREE)/i.test(kind)&&(/^TREE\d+$/i.test(cfg.IMAGE||kind)||/\b(tree|trees|palm|palms)\b|树|樹/i.test(cfg.NAME||''));}
 function empty(source){return {schema:1,map:{sha256:source.sourceSha256,version:source.version},objects:{},overlays:{},placements:[]};}
 function objects(source){const result=[];for(const category of sections)for(const[id,line]of Object.entries(source.map[category]||{})){
  const f=line.split(',').map(v=>v.trim()),type=f[1]?.toUpperCase(),cfg=source.rules[type]||{},art=source.art[(cfg.IMAGE||type)?.toUpperCase()]||{},x=Number(f[3]),y=Number(f[4]);
  if(!Number.isInteger(x)||!Number.isInteger(y))continue;const footprint=category==='STRUCTURES'?foundation(art):[[0,0]];
  result.push({id:category+'/'+id,category,type,x,y,fields:f,footprint:footprint||[[0,0]],unknownFoundation:!footprint,immune:yes(cfg.IMMUNE)||num(cfg.STRENGTH,1)<=0,rubble:yes(cfg.LEAVERUBBLE),onBridge:yes(f[category==='INFANTRY'?12:11])});
 }for(const[position,typeValue]of Object.entries(source.map.TERRAIN||{})){const n=Number(position),type=typeValue.toUpperCase(),cfg=source.rules[type]||{};if(!Number.isInteger(n))continue;result.push({id:'TERRAIN/'+position,category:'TERRAIN',type,x:n%1000,y:Math.floor(n/1000),footprint:[[0,0]],immune:yes(cfg.IMMUNE)||num(cfg.STRENGTH,1)<=0,tree:tree(type,cfg),mine:yes(cfg.SPAWNSTIBERIUM)});}return result;}
 function catalog(source){const list=[['MTNK','灰熊坦克'],['HYD','海蝎'],['YHVR','尤里气垫船']].map(([type,label])=>({type,category:'UNITS',label,footprint:[[0,0]]})).filter(o=>source.rules[o.type]);const seen=new Map();
  for(const type of Object.values(source.rules.BUILDINGTYPES||{})){const name=type.toUpperCase(),cfg=source.rules[name]||{},art=source.art[(cfg.IMAGE||name).toUpperCase()]||{},fp=foundation(art),yard=name==='NACNST';
   // Construction yards deploy from MCVs: stock TechLevel=-1 / no BuildCat.
   // Include the requested Soviet yard, retaining terrain and footprint checks.
   if(!fp||!cfg.OWNER||yes(cfg.WALL)||cfg.POWERSUPBUILDING||!yard&&(num(cfg.TECHLEVEL,-1)<0||!cfg.BUILDCAT))continue;
   const water=yes(cfg.WATERBOUND),signature=foundationKey(fp,water);if(seen.has(signature)&&!yard)continue;
   const w=Math.max(...fp.map(p=>p[0]))+1,h=Math.max(...fp.map(p=>p[1]))+1,prefix=w===4&&h===4?`4x4[${water?'Water':'Land'}]`:`${w}×${h}`;
   const choice={type:name,category:'STRUCTURES',footprint:fp,label:`${prefix} · ${yard?'苏军基地':cfg.NAME||name}`,water};
   if(seen.has(signature))list[seen.get(signature)]=choice;else{seen.set(signature,list.length);list.push(choice);}
  }const overlays=Object.values(source.rules.OVERLAYTYPES||{}).map(v=>v.toUpperCase());if(overlays.includes('GAWALL'))list.push({type:'GAWALL',category:'OVERLAY',label:'盟军围墙',footprint:[[0,0]],wall:true});const treeType=[source.simulationAssets?.tree,...source.simulationAssets?.legacyTrees||[],'TREE01'].find(n=>source.rules[n]);if(source.rules[treeType])list.push({type:treeType,category:'TERRAIN',label:'树木',footprint:[[0,0]],tree:true});const ore=overlays.find(n=>/^(TIB|GOLD)\d+$/.test(n)&&yes(source.rules[n]?.TIBERIUM));if(ore)list.push({type:ore,category:'OVERLAY',label:'矿石',footprint:[[0,0]],ore:true});return list;
 }
 function create(source){
  const baseline=new Map(source.cells.map(c=>[key(c.x,c.y),c])),original=objects(source),byId=new Map(original.map(o=>[o.id,o])),choices=catalog(source),choiceMap=new Map(choices.map(o=>[o.type,o]));
  if(source.rules.E2)choiceMap.set('E2',{type:'E2',category:'INFANTRY',label:'动员兵',footprint:[[0,0]],unplaceable:true});
  for(const type of source.simulationAssets?.legacyTrees||[])if(!choiceMap.has(type)&&source.rules[type]&&tree(type,source.rules[type]))choiceMap.set(type,{type,category:'TERRAIN',label:'树木',footprint:[[0,0]],tree:true,legacy:true});
  const overlayTypes=Object.entries(source.rules.OVERLAYTYPES||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(p=>p[1].toUpperCase());
  const cfgFor=c=>source.rules[overlayTypes[c?.overlay]]||{},points=o=>o.footprint.map(([x,y])=>key(o.x+x,o.y+y));
  const buildings=new Map(choices.filter(c=>c.category==='STRUCTURES').map(c=>[foundationKey(c.footprint,c.water),c.type]));
  const ore=choices.find(c=>c.ore)?.type,wall=choices.find(c=>c.wall)?.type,shrub=choices.find(c=>c.tree)?.type;
  const unitSamples=new Map();
  function sampleObject(o){
   if(!o||o.isRubble)return null;
   let type,priority;
   if(o.category==='UNITS'||o.category==='INFANTRY'||o.category==='AIRCRAFT'){
    const token=o.category+'/'+o.type;
    if(unitSamples.has(token))return unitSamples.get(token);
    const cfg=source.rules[o.type]||{},zone=String(cfg.MOVEMENTZONE||'').toUpperCase(),locomotor=String(cfg.LOCOMOTOR||'').toUpperCase();
    const flying=o.category==='AIRCRAFT'||zone==='FLY'||yes(cfg.JUMPJET)||['{92612C46-F71F-11D1-AC9F-006008055BB5}','{4A582746-9839-11D1-B709-00A024DDAFD1}','{B7B49766-E576-11D3-9BD9-00104B972FE8}'].includes(locomotor);
    const speed=String(cfg.SPEEDTYPE||(zone==='WATER'?'Float':zone.startsWith('AMPHIBIOUS')||locomotor==='{4A582742-9839-11D1-B709-00A024DDAFD1}'?'Amphibious':o.category==='INFANTRY'?'Foot':'Track')).toUpperCase();
    // Naval=yes also applies to hover transports. Use terrain passage costs,
    // including embedded rules, rather than the object table or targeting flag.
    const water=num(source.rules.WATER?.[speed],['FLOAT','FLOATBEACH','HOVER','AMPHIBIOUS'].includes(speed)?1:0)>0;
    const land=['CLEAR','ROAD','ROUGH','ICE'].some(name=>num(source.rules[name]?.[speed],['FLOAT','FLOATBEACH'].includes(speed)?0:1)>0);
    const movement=flying?2:water?(land?2:1):0;
    type=['MTNK','HYD','YHVR'][movement];priority=5+movement;
    const result=choiceMap.has(type)?{type,priority}:null;
    unitSamples.set(token,result);return result;
   }
   if(o.category==='STRUCTURES'&&!o.unknownFoundation){type=buildings.get(foundationKey(o.footprint,yes(source.rules[o.type]?.WATERBOUND)));priority=4;}
   else if(o.category==='OVERLAY'){const cfg=source.rules[o.type]||{};if(yes(cfg.WALL)){type=wall;priority=3;}else if(yes(cfg.TIBERIUM)){type=ore;priority=1;}}
   else if(o.tree){type=shrub;priority=2;}
   return type?{type,priority}:null;
  }
  function sample(x,y,{fallback='MTNK',state=current(),hitObject=null}={}){
   const position=key(x,y),cell=state.cells.get(position);
   let selected=sampleObject(hitObject);
   for(const o of state.occupants.get(position)||[]){
    const candidate=sampleObject(o);
    if(candidate&&(!selected||candidate.priority>selected.priority))selected=candidate;
   }
   const overlay=cfgFor(cell);
   if(yes(overlay.WALL)&&wall&&(!selected||selected.priority<3))selected={type:wall,priority:3};
   if(yes(overlay.TIBERIUM)&&ore&&!selected)selected={type:ore,priority:1};
   return selected?.type??fallback;
  }
  let plan=empty(source),undo=[],redo=[],cachedPlan=null,cachedState=null,transaction=null;const bridges=bridgesAPI.segments(source,baseline),bridgeAt=new Map();for(const b of bridges)for(const p of b.cells){if(!bridgeAt.has(p))bridgeAt.set(p,[]);bridgeAt.get(p).push(b);}
  function normalized(value){
   if(!value||value.schema!==1||value.map?.sha256!==source.sourceSha256||value.map?.version!==source.version)throw Error('增量方案与当前地图或游戏版本不匹配');
   if(!value.objects||Array.isArray(value.objects)||!value.overlays||Array.isArray(value.overlays)||!Array.isArray(value.placements)||value.placements.length>20000)throw Error('增量方案格式无效');
   const out=empty(source);for(const[id,mode]of Object.entries(value.objects)){const o=byId.get(id);if(!o||!['remove','rubble','delete'].includes(mode)||mode==='delete'&&!['UNITS','INFANTRY','AIRCRAFT'].includes(o.category)||o.immune&&mode!=='delete'||mode==='rubble'&&(!o.rubble||o.category!=='STRUCTURES'))throw Error('方案包含无效或不可摧毁的对象');out.objects[id]=mode;}
   for(const[p,pair]of Object.entries(value.overlays)){if(!baseline.has(p)||!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isInteger)||pair[0]<0||pair[0]>255||pair[1]<0||pair[1]>255||pair[0]!==255&&!source.rules[overlayTypes[pair[0]]])throw Error('方案包含无效覆盖物');out.overlays[p]=pair.slice();}
   const ids=new Set();for(const o of value.placements){const c=choiceMap.get(o.type);if(!c||c.category!==o.category||typeof o.id!=='string'||!/^sim-[a-z0-9-]{1,64}$/.test(o.id)||ids.has(o.id)||![o.x,o.y,o.facing,o.subcell].every(Number.isInteger)||o.facing<0||o.facing>255||o.subcell<0||o.subcell>2||typeof o.onBridge!=='boolean'||!points({...o,footprint:c.footprint}).every(p=>baseline.has(p)))throw Error('方案包含无效放置对象');ids.add(o.id);out.placements.push({id:o.id,type:o.type,category:o.category,x:o.x,y:o.y,facing:o.facing,subcell:o.subcell,onBridge:o.onBridge});}
   const state=current({...out,placements:[]});for(const o of out.placements){const check=placement(o.type,o.x,o.y,{ignoreLand:true,existing:true,state});if(!check.allowed||!!check.onBridge!==o.onBridge)throw Error('方案中的放置位置被占用或地形不允许');const entry={...o,...choiceMap.get(o.type),placed:true};for(const p of points(entry)){const occupants=state.occupants.get(p)||[];if(o.category==='INFANTRY'&&infantrySlotsUsed(occupants,o.onBridge).has(o.subcell))throw Error('方案中的步兵位置重复');if(o.category==='OVERLAY'){const c=state.cells.get(p);c.overlay=overlayTypes.indexOf(o.type);c.overlayName=o.type;c.overlayData=entry.ore?11:0;c.simulationOverlay=o.id;}else{occupants.push(entry);state.occupants.set(p,occupants);}}}
   return out;
  }
  function current(value=plan){if(value===plan&&value===cachedPlan)return cachedState;const cells=new Map([...baseline].map(([k,c])=>[k,{...c}]));for(const[p,[overlay,overlayData]]of Object.entries(value.overlays)){const c=cells.get(p);c.overlay=overlay;c.overlayData=overlayData;c.overlayName=overlayTypes[overlay]||null;}
   const active=[];for(const o of original){const mode=value.objects[o.id];if(mode==='remove'||mode==='delete')continue;if(mode==='rubble'){const index=overlayTypes.indexOf('RUBBLE_OVERLAY');for(const p of points(o)){const c=cells.get(p);if(c){c.overlay=index;c.overlayData=0;c.overlayName='RUBBLE_OVERLAY';}}active.push({...o,isRubble:true});}else active.push(o);}
   for(const o of value.placements){const entry={...o,...choiceMap.get(o.type),placed:true,immune:yes(source.rules[o.type]?.IMMUNE)||num(source.rules[o.type]?.STRENGTH,1)<=0};active.push(entry);if(o.category==='OVERLAY'){const c=cells.get(key(o.x,o.y));c.overlay=overlayTypes.indexOf(o.type);c.overlayName=o.type;c.overlayData=entry.ore?11:0;c.simulationOverlay=o.id;}}
   for(const c of cells.values()){c.terrain=null;c.simulationTerrain=null;}for(const o of active)if(o.category==='TERRAIN'&&!o.isRubble){const c=cells.get(key(o.x,o.y));if(c){c.terrain=o.type;c.simulationTerrain=o.placed?o.id:null;}}
   const wallPoints=new Set(Object.keys(value.overlays));for(const o of value.placements)if(o.category==='OVERLAY')wallPoints.add(key(o.x,o.y));for(const p of [...wallPoints]){const c=cells.get(p);if(c)for(const[dx,dy]of [[0,-1],[1,0],[0,1],[-1,0]])wallPoints.add(key(c.x+dx,c.y+dy));}for(const p of wallPoints){const c=cells.get(p);if(c&&yes(cfgFor(c).WALL)){let mask=0;for(const[dx,dy,bit]of [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]])if(cells.get(key(c.x+dx,c.y+dy))?.overlay===c.overlay)mask|=bit;c.overlayData=(c.overlayData&~15)|mask;}}
   const occupants=new Map();for(const o of active)if(!o.isRubble&&o.category!=='OVERLAY')for(const p of points(o)){if(!occupants.has(p))occupants.set(p,[]);occupants.get(p).push(o);}
   for(const c of cells.values()){c.bridge=/^LOBRD[GB]/.test(c.overlayName||'')?{kind:'low'}:null;c.bridgeProjection=false;}
   for(const c of cells.values())if([24,25,237,238].includes(c.overlay)){const [dx,dy]=[24,237].includes(c.overlay)?[0,-1]:[-1,0];for(const n of [-1,0,1,2,3]){const t=cells.get(key(c.x+n*dx,c.y+n*dy));if(t){t.bridgeProjection=n!==-1;if(n!==3)t.bridge={kind:'high',owner:[c.x,c.y],deckLevel:t.level+4};}}}
   const state={cells,objects:active,occupants};if(value===plan){cachedPlan=value;cachedState=state;}return state;
  }
  function oreAllowed(c,occupants){return c&&c.usable&&c.overlay===255&&!c.bridge&&c.slope===0&&yes(source.rules[landNames[c.tileLand??c.rawLand]]?.BUILDABLE)&&source.simulationAssets?.allowOre?.[c.file]!==false&&!occupants.some(o=>o.category==='STRUCTURES'&&!yes(source.rules[o.type]?.INVISIBLE)&&!yes(source.rules[o.type]?.INVISIBLEINGAME)||o.mine||yes(source.rules[o.type]?.SPAWNSTIBERIUM));}
  function placement(type,x,y,{ignoreLand=false,existing=false,state=current()}={}){const choice=choiceMap.get(type);if(!choice||choice.unplaceable&&!existing)return {allowed:false,cells:[],reason:'未支持的对象'};const base=state.cells.get(key(x,y)),results=[];
   for(const[dx,dy]of choice.footprint){const c=state.cells.get(key(x+dx,y+dy));let reason='';if(!c||!c.usable)reason='地图可用范围之外';else if(c.terrainError||c.rawLand==null)reason='地形未知，无法验证放置条件';else if(c.overlayError&&c.overlay!==255)reason='覆盖物未知，无法验证放置条件';else{
    const speed=String(source.rules[type]?.SPEEDTYPE||(choice.category==='INFANTRY'?'Foot':'Track')).toUpperCase(),cfg=cfgFor(c),occupants=state.occupants.get(key(c.x,c.y))||[],bridge=c.bridge?.kind==='high',deck=choice.category==='UNITS'&&speed!=='FLOAT'&&bridge||choice.category==='INFANTRY'&&bridge,blocking=occupants.filter(o=>deck?o.onBridge:!o.onBridge);
    if(choice.ore){if(!oreAllowed(c,occupants))reason='矿石不能在此生成';}
    else if(choice.category==='INFANTRY'?blocking.some(o=>o.category!=='INFANTRY')||blocking.length>=3:blocking.length)reason='已有对象占用';
    else if((choice.category==='STRUCTURES'||choice.wall||choice.tree)&&(c.slope!==0||c.level!==base?.level||c.bridge))reason='建筑要求平整地面且不能压在桥上';
    else if(yes(cfg.WALL)||yes(cfg.ISVEINS)||(choice.category==='STRUCTURES'||choice.wall||choice.tree)&&c.overlay!==255)reason='覆盖物阻挡';
    else if(!choice.ore&&!deck){const overlayLand=landNames.indexOf((cfg.LAND||'Clear').toUpperCase()),usesOverlay=c.overlay!==255&&(yes(cfg.NOUSETILELANDTYPE??'yes')||[4,9].includes(overlayLand)),land=landNames[usesOverlay?overlayLand:c.rawLand],cost=source.rules[land]||{},water=land==='WATER';
     if(choice.category==='STRUCTURES'||choice.wall||choice.tree){if(!(ignoreLand&&choice.category==='STRUCTURES')&&water!==!!choice.water)reason=choice.water?'需要水面':'需要陆地';else if(!water&&!yes(cost.BUILDABLE)&&!(ignoreLand&&choice.category==='STRUCTURES'&&land==='BEACH'))reason='地形不能建造';}
     else if(num(cost[speed])===0)reason='单位不能通过该地形';
    }
   }results.push({x:x+dx,y:y+dy,allowed:!reason,reason});}
   const occ=state.occupants.get(key(x,y))||[],subcells=infantrySlotsUsed(occ,base?.bridge?.kind==='high');
   return {allowed:results.every(c=>c.allowed),cells:results,reason:results.find(c=>c.reason)?.reason||'',onBridge:['UNITS','INFANTRY'].includes(choice.category)&&String(source.rules[type]?.SPEEDTYPE||'Track').toUpperCase()!=='FLOAT'&&base?.bridge?.kind==='high',subcell:[0,1,2].find(n=>!subcells.has(n))??0};
  }
  function change(fn){const before=JSON.stringify(plan),next=clone(plan);fn(next);if(JSON.stringify(next)===before)return false;if(!transaction){undo.push(plan);if(undo.length>100)undo.shift();redo=[];}plan=next;return true;}
  // One stroke owns one history entry. Terrain/bridge indexes are unchanged by
  // placement: update only the occupied footprint, never clone the map per tank.
  function beginPlacement(){if(transaction)throw Error('已有放置笔画');const state=current();transaction=plan;plan={...plan,placements:plan.placements.slice()};cachedPlan=plan;cachedState=state;}
  function appendPlacement(type,x,y,options){if(!transaction)throw Error('尚未开始放置笔画');if(plan.placements.length>=20000)return false;const check=placement(type,x,y,options);if(!check.allowed)return false;const item={id:'sim-'+crypto.randomUUID(),type,category:choiceMap.get(type).category,x,y,facing:64,subcell:check.subcell,onBridge:!!check.onBridge},entry={...item,...choiceMap.get(type),placed:true,immune:yes(source.rules[type]?.IMMUNE)||num(source.rules[type]?.STRENGTH,1)<=0};plan.placements.push(item);cachedState.objects.push(entry);if(entry.category==='OVERLAY'){const c=cachedState.cells.get(key(x,y));c.overlay=overlayTypes.indexOf(type);c.overlayName=type;c.overlayData=entry.ore?11:0;c.simulationOverlay=item.id;for(const [dx,dy] of [[0,0],[0,-1],[1,0],[0,1],[-1,0]]){const n=cachedState.cells.get(key(x+dx,y+dy));if(!n||!yes(cfgFor(n).WALL))continue;let mask=0;for(const[a,b,bit] of [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]])if(cachedState.cells.get(key(n.x+a,n.y+b))?.overlay===n.overlay)mask|=bit;n.overlayData=(n.overlayData&~15)|mask;}return true;}if(entry.category==='TERRAIN'){const c=cachedState.cells.get(key(x,y));c.terrain=type;c.simulationTerrain=item.id;}for(const p of points(entry)){if(!cachedState.occupants.has(p))cachedState.occupants.set(p,[]);cachedState.occupants.get(p).push(entry);}return true;}
  function endPlacement(cancel=false){if(!transaction)return false;const before=transaction;transaction=null;const changed=before.placements.length!==plan.placements.length;if(cancel||!changed){plan=before;cachedPlan=null;cachedState=null;return false;}undo.push(before);if(undo.length>100)undo.shift();redo=[];return true;}
  function beginPaint(){if(transaction)throw Error('已有放置笔画');transaction=plan;}
  function endPaint(){if(!transaction)return false;const before=transaction;transaction=null;if(JSON.stringify(before)===JSON.stringify(plan))return false;undo.push(before);if(undo.length>100)undo.shift();redo=[];return true;}
  function brush(x,y,size=1,shape='square'){
   const points=[],radius=(size-1)/2,start=-Math.floor(radius);
   for(let i=0;i<size;i++)for(let j=0;j<size;j++){
    if(shape==='circle'&&(i-radius)**2+(j-radius)**2>(radius+.3)**2)continue;
    const p=key(x+start+i,y+start+j);
    if(baseline.has(p))points.push(p);
   }
   return points;
  }
  function removeOverlay(next,p,pair=[255,0]){const c=baseline.get(p);if(!c)return;if(c.overlay===pair[0]&&c.overlayData===pair[1])delete next.overlays[p];else next.overlays[p]=pair;}
  function editBridges(next,state,targets,restoring=false){
   if(![...targets].some(p=>bridgeAt.has(p)))return {fallen:new Set(),selected:[]};
   const copies=new Map();
   const cells={get(p){
    if(!copies.has(p)){const c=state.cells.get(p);copies.set(p,c?{...c}:undefined);}
    return copies.get(p);
   }};
   return bridgesAPI.edit(bridges,cells,targets,(p,pair)=>removeOverlay(next,p,pair),restoring?baseline:false);
  }
  function destroy(next,area,mode,filter=null){const state=current(),targets=new Set(area);for(const o of state.objects){if(o.immune&&mode!=='delete'||o.isRubble&&mode==='normal'||filter&&!filter(o)||!points(o).some(p=>targets.has(p)))continue;if(o.placed)next.placements=next.placements.filter(p=>p.id!==o.id);else next.objects[o.id]=mode==='delete'?'delete':mode==='normal'&&o.rubble&&!o.isRubble?'rubble':'remove';}
   if(filter)return;const {fallen}=editBridges(next,state,targets);
   if(fallen.size)for(const o of state.objects)if((o.onBridge||points(o).some(p=>baseline.get(p)?.bridge?.kind==='low'))&&points(o).some(p=>fallen.has(p))&&!o.immune){if(o.placed)next.placements=next.placements.filter(p=>p.id!==o.id);else next.objects[o.id]='remove';}
   for(const p of targets){if(bridgeAt.has(p))continue;const c=state.cells.get(p);if(!c||c.simulationOverlay)continue;const cfg=cfgFor(c);if(!yes(cfg.IMMUNE)&&(yes(cfg.TIBERIUM)||yes(cfg.WALL)||mode==='chrono'&&yes(cfg.ISRUBBLE)||yes(cfg.LEGALTARGET)))removeOverlay(next,p);}

   wallConnections(next);
  }
  function wallConnections(next){} // Derived locally by current(); never rewrite unchanged source wall frames.
  function restore(next,area){const targets=new Set(area),changed=editBridges(next,current(),targets,true);for(const p of changed.selected)targets.add(p);
   // Restoring a footprint is atomic; include overlapping originals until stable.
   let grew=true;while(grew){grew=false;for(const o of original)if(points(o).some(p=>targets.has(p))){delete next.objects[o.id];for(const p of points(o))if(!targets.has(p)){targets.add(p);grew=true;}}}
   next.placements=next.placements.filter(o=>!points({...o,footprint:choiceMap.get(o.type).footprint}).some(p=>targets.has(p)));for(const p of targets)if(!bridgeAt.has(p))delete next.overlays[p];wallConnections(next);
  }
  function quick(action,mode='normal'){return change(next=>{const all=[...baseline.keys()];if(action==='mine'){next.placements=next.placements.filter(o=>!choiceMap.get(o.type).ore);const state=current(next);for(const[p,c]of state.cells)if(yes(cfgFor(c).TIBERIUM)){removeOverlay(next,p);c.overlay=255;c.overlayData=0;c.overlayName=null;}const ore=overlayTypes.findIndex(n=>/^(TIB|GOLD)\d+$/i.test(n));for(const o of state.objects)if(o.mine&&!o.isRubble)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const p=key(o.x+dx,o.y+dy),c=state.cells.get(p);if(ore>=0&&oreAllowed(c,state.occupants.get(p)||[]))removeOverlay(next,p,[ore,11]);}}
    else if(action==='trees')destroy(next,all,mode,o=>o.tree);else if(action==='buildings')destroy(next,all,mode,o=>o.category==='STRUCTURES');else if(action==='units')destroy(next,all,'delete',o=>['UNITS','INFANTRY','AIRCRAFT'].includes(o.category));else throw Error('未知快捷操作');});}
  function count(){const set=new Set(Object.keys(plan.overlays));for(const id of Object.keys(plan.objects))for(const p of points(byId.get(id)))set.add(p);for(const o of plan.placements)for(const p of points({...o,footprint:choiceMap.get(o.type).footprint}))set.add(p);return set.size;}
  // Compare edits with the plan behind the displayed probability snapshot.
  // This is an edit footprint, not a bound on nearby-search dependencies.
  // Work scales with the delta, without rebuilding/copying the source map.
  function changesSince(value,after=plan){
   const before=value||empty(source),changed=new Set(),add=o=>{if(o){for(const p of points(o))if(baseline.has(p))changed.add(p);if(o.category==='OVERLAY')for(const[dx,dy]of [[0,-1],[1,0],[0,1],[-1,0]]){const p=key(o.x+dx,o.y+dy);if(baseline.has(p))changed.add(p);}}};
   for(const id of new Set([...Object.keys(before.objects),...Object.keys(after.objects)]))if(before.objects[id]!==after.objects[id])add(byId.get(id));
   for(const p of new Set([...Object.keys(before.overlays),...Object.keys(after.overlays)]))if(String(before.overlays[p])!==String(after.overlays[p])){changed.add(p);const c=baseline.get(p);for(const[dx,dy]of [[0,-1],[1,0],[0,1],[-1,0]]){const n=key(c.x+dx,c.y+dy);if(baseline.has(n))changed.add(n);}}
   const previous=new Map(before.placements.map(o=>[o.id,o]));
   for(const o of after.placements){const old=previous.get(o.id);if(!old||['type','x','y','facing','subcell','onBridge','regionColor'].some(k=>old[k]!==o[k])){add({...o,footprint:choiceMap.get(o.type).footprint});if(old)add({...old,footprint:choiceMap.get(old.type).footprint});}previous.delete(o.id);}
   for(const o of previous.values())add({...o,footprint:choiceMap.get(o.type).footprint});
   return changed;
  }
  return {source,choices,choice:type=>choiceMap.get(type),baseline,bridges,current,placement,brush,sample,sampleObject,normalized,changesSince,beginPaint,endPaint,beginPlacement,appendPlacement,endPlacement,eachPlacement:fn=>plan.placements.forEach(fn),checkpoint:()=>clone({plan,undo,redo}),rollback:value=>{({plan,undo,redo}=clone(value));cachedPlan=null;cachedState=null;},get plan(){return clone(plan);},get count(){return count();},get canUndo(){return !!undo.length;},get canRedo(){return !!redo.length;},
   place:(type,x,y,options)=>{beginPlacement();appendPlacement(type,x,y,options);return endPlacement();},
   paint:(area,mode)=>change(p=>mode==='restore'?restore(p,area):destroy(p,area,mode)),quick,
   import:value=>{const next=normalized(value);return change(p=>{Object.assign(p,next);});},
   reset:()=>change(p=>Object.assign(p,empty(source))),
   undo:()=>{if(!undo.length)return false;redo.push(plan);plan=undo.pop();return true;},redo:()=>{if(!redo.length)return false;undo.push(plan);plan=redo.pop();return true;}
  };
 }
 function materialize(source,value){const model=create(source),plan=model.normalized(value),map=clone(source.map),rubble=new Set(),state=model.current(plan);
  for(const[id,mode]of Object.entries(plan.objects)){const slash=id.indexOf('/'),section=id.slice(0,slash),entry=id.slice(slash+1);if(mode==='rubble'){const f=map[section][entry].split(',');f[2]='0';map[section][entry]=f.join(',');rubble.add(id);}else delete map[section][entry];}
  const colors=new Map(value.placements.map(o=>[o.id,o.regionColor]));
  for(const o of plan.placements){if(o.category==='OVERLAY')continue;if(o.category==='TERRAIN'){(map.TERRAIN||={})[o.y*1000+o.x]=o.type;continue;}
   const color=colors.get(o.id);
   let house='CRATE_ATLAS_SIMULATION';
   if((o.category==='STRUCTURES'||['E2','MTNK','HYD','YHVR'].includes(o.type))&&/^[0-9a-f]{6}$/.test(color)){
    house+='_'+color.toUpperCase();map[house]={COLOR:house};
    (map.COLORS||={})[house]='stripe-3-region-'+color;
   }
   const prefix=[house,o.type,'256',o.x,o.y];let f;
   if(o.category==='STRUCTURES')f=[...prefix,o.facing,'None',1,0,1,0,0,'None','None','None',0,0];
   else if(o.category==='INFANTRY')f=[...prefix,infantrySlots[o.subcell],'Guard',o.facing,'None',0,-1,0,+o.onBridge];
   else f=[...prefix,o.facing,'Guard','None',0,-1,0,+o.onBridge,1,0];(map[o.category]||={})[o.id]=f.join(',');
  }map.CRATE_ATLAS_SIMULATION={COLOR:'CRATE_ATLAS_SIMULATION_COLOR'};map.COLORS={...map.COLORS,CRATE_ATLAS_SIMULATION_COLOR:'stripe-3-yellow-black-fixed'};
  return {map,cells:[...state.cells.values()],rubble,plan};
 }
 root.CrateSimulationModel={create,empty,foundation,objects,catalog,infantryOffsets,bridgeGroups:bridgesAPI.segments,materialize};if(typeof module!=='undefined')module.exports=root.CrateSimulationModel;
})(globalThis);
