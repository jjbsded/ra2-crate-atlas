/* Flat RA2/YR crate placement: standard Clear/Water/Tiberium, no bridges or game RNG emulation. */
(function (root) {
  'use strict';
  const MAP = { w: 8, h: 6, local: [1, 1, 6, 3] };
  const PRESETS = [
    { id: 'outside', name: '01 · 地图外', start: [2, 3], subtitle: '越界起点仍进入附近搜索' },
    { id: 'margin', name: '02 · 地图内，模型可用边界外', start: [1, 8], subtitle: '从地图边缘向可用区搜索' },
    { id: 'building', name: '03 · 建筑占格', start: [7, 7], subtitle: '占用格被排除，检查下一圈' },
    { id: 'terrain', name: '04 · 不可通行地形', start: [6, 8], subtitle: '通行检查拒绝该格' },
    { id: 'unit', name: '05 · 地面单位占格', start: [8, 6], subtitle: '不挤走单位，寻找附近空格' },
    { id: 'crate', name: '06 · 已有工具箱', start: [9, 6], subtitle: '附近搜索可选中，最终放置失败后重抽' },
    { id: 'empty', name: '07 · 普通空地', start: [6, 7], subtitle: '半径 0 即可找到原格' },
    { id: 'ore', name: '08 · 矿石覆盖物', start: [9, 7], subtitle: '可通行的矿石仍会阻止最终放置' },
    { id: 'water_margin', name: '09 · 模型可用边界外抽到海水', start: [1, 8], world: 'coast', subtitle: '真实水格 → Float → 向内寻找水域' },
    { id: 'outside_water', name: '10 · 地图外起点附近只有海水', start: [2, 3], world: 'ocean', subtitle: '默认 Clear → Track 失败 → 重抽水格' },
    { id: 'outside_island', name: '11 · 地图外起点，中央小岛', start: [2, 3], world: 'island', subtitle: 'Track 逐圈排除海水，找到中央陆地' }
  ];
  const CORE_PRESETS=PRESETS.map(p=>p.id);
  const objects = { '7,7': 'building', '6,8': 'terrain', '8,6': 'unit', '9,6': 'crate', '9,7': 'ore' };
  const WORLDS={
    land:{id:'land',name:'陆地示例',objects},
    coast:{id:'coast',name:'左侧水域示例',objects:{'7,7':'building','8,6':'unit','9,6':'crate','9,7':'ore','4,9':'watercrate'}},
    ocean:{id:'ocean',name:'全海水示例',objects:{}},
    island:{id:'island',name:'中央小岛示例',objects:{},landCells:[[7,7],[7,8],[8,7],[8,8]]}
  };
  const key = c => c.join(',');
  function inside([x,y]) { return x+y>MAP.w && x-y<MAP.w && y-x<MAP.w && x+y<=MAP.w+2*MAP.h; }
  function usable([x,y]) { const [l,t,w,h]=MAP.local; return x+y>MAP.w+2*t && x+y<=MAP.w+2*(t+h)+2 && x-y<2*(l+w)-MAP.w && y-x<MAP.w-2*l; }
  function landType(c,world=WORLDS.land) {
    if(!inside(c))return 'Clear'; // Default InvalidCell, not the nearest real tile.
    const o=world.objects[key(c)];
    if(o==='watercrate')return 'Water';
    if(o==='ore')return 'Tiberium';
    if(o==='terrain')return 'Rock';
    if(world.id==='island')return world.landCells.some(p=>p[0]===c[0]&&p[1]===c[1])?'Clear':'Water';
    return world.id==='ocean'||(world.id==='coast'&&c[0]-c[1]<=-2)?'Water':'Clear';
  }
  const speedFor=type=>type==='Water'?'Float':'Track';
  const crateFor=type=>type==='Water'?'watercrate':'crate';
  function classify(c,world=WORLDS.land,speed='Track') {
    const land=landType(c,world);
    if (!inside(c)) return { ok:false, land, reason:'实际地图外：候选无效' };
    if (!usable(c)) return { ok:false, land, reason:'模型可用边界外' };
    const o=world.objects[key(c)];
    if (['building','unit','terrain'].includes(o)) return { ok:false, land, reason: o==='terrain'?'地形不可通行':o==='unit'?'地面单位占用':'建筑基础占用' };
    if(speed==='Track'&&land==='Water')return {ok:false,land,reason:'海水不允许 Track（通行倍率 0%）'};
    if(speed==='Float'&&land!=='Water')return {ok:false,land,reason:'非水格不允许 Float（通行倍率 0%）'};
    return { ok:true, land, reason:['crate','watercrate'].includes(o)?'已有箱子：附近检查仍通过':o==='ore'?'矿石：附近检查仍通过':land==='Water'?'兼容水格：Float 通过':'可用空格：Track 通过' };
  }
  function ring([x,y],r) {
    const a=[];
    for(let dx=-r;dx<=r;dx++) { a.push([x+dx,y-r]); a.push([x+dx,y+r]); }
    for(let dy=1-r;dy<=r-1;dy++) { a.push([x-r,y+dy]); a.push([x+r,y+dy]); }
    return a;
  }
  // Shared by the teaching trace and exhaustive probability calculation.
  function scanRing(origin,r,world,speed) {
    const visits=[],candidates=[];
    for(const c of ring(origin,r)) {
      const result=classify(c,world,speed);visits.push({cell:c,...result});
      if(result.ok)candidates.push(c);
      if(candidates.length>=24)break;
    }
    return {visits,candidates};
  }
  function hasOverlay(c,world) { return ['crate','watercrate','ore'].includes(world.objects[key(c)]); }
  function resolveAttempt(origin,world,frame) {
    const speed=speedFor(landType(origin,world));
    for(let radius=0;radius<Math.min(MAP.w+MAP.h,32);radius++) {
      const {candidates}=scanRing(origin,radius,world,speed);
      if(!candidates.length)continue;
      const selected=candidates[frame%candidates.length];
      return {selected,radius,speed,success:!hasOverlay(selected,world),failure:hasOverlay(selected,world)?'overlay':null};
    }
    return {selected:null,speed,success:false,failure:'no-candidate'};
  }
  function buildTrace(options={}) {
    let preset=PRESETS.find(p=>p.id===options.preset)||PRESETS[0];
    const world=WORLDS[preset.world||'land'];
    const initial=(options.start||preset.start).map(Number);
    const frame=options.frame===undefined?600:options.frame;
    if(!Number.isSafeInteger(frame)||frame<0||frame>999999999) throw Error('逻辑帧必须是 0～999999999 的整数。');
    if(initial.length!==2 || initial.some(v=>!Number.isInteger(v)||v<1||v>13)) throw Error('X、Y 必须是 1～13 的整数。');
    if(key(initial)!==key(preset.start))preset={id:'custom',name:'自定义起点 · '+world.name,world:world.id,start:initial,subtitle:classify(initial,world,speedFor(landType(initial,world))).reason};
    let seed=(Number(options.seed)||2026)>>>0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return 1+Math.floor(seed/4294967296*13);};
    const steps=[];
    const push=(s)=>steps.push({ frame, preset:preset.id, attempt:1, candidates:[], visits:[], duration:2, ...s });
    let placed=null;
    for(let attempt=1;attempt<=1000;attempt++) {
      // The first point is explicitly forced for teaching. The second point is
      // scripted so an overlay failure has a short, reproducible recovery.
      const origin=attempt===1?initial:attempt===2?[6,7]:[random(),random()];
      const initialLand=landType(origin,world),speed=speedFor(initialLand),cellSource=inside(origin)?'真实 Cell':'InvalidCell';
      const base={attempt,origin,initialLand,speed,cellSource};
      const explanation=cellSource==='InvalidCell'?'取不到真实格，默认 Clear → Track。':`真实格为 ${initialLand} → ${speed}。`;
      push({...base,phase:'origin',title:attempt===1?'指定初始坐标':'外层重新抽取 X、Y',text:attempt===1?`起点 (${origin})：${classify(origin,world,speed).reason}。${explanation}`:`演示指定下一组坐标 (${origin})，重新判断地形。${explanation}`,duration:4});
      let candidates=[], radius=-1;
      for(let r=0;r<Math.min(MAP.w+MAP.h,32);r++) {
        const scanned=scanRing(origin,r,world,speed),visits=scanned.visits;candidates=scanned.candidates;
        const islandSearch=world.id==='island'&&speed==='Track';
        const searchText=candidates.length?(islandSearch?`本圈找到中央陆地，共 ${candidates.length} 个候选记录。无需从地图边缘走到这里，也不要求陆路连通。`:`本圈有 ${candidates.length} 个候选记录；完成本圈（或达到 24 条上限）后再选择。`):r===13?'半径上限 13 已检查，仍无候选。附近搜索返回 Empty。':islandSearch&&visits.some(v=>v.reason.includes('海水不允许'))?'本圈海水被 Track 排除，但海水不会阻断外圈扫描。继续扩大半径。':`${speed} 本圈没有候选，继续向外扩大；这一轮不会切换移动类型。`;
        push({...base,phase:'search',radius:r,visits,candidates:[...candidates],title:`附近搜索 · 半径 ${r}`,text:searchText,duration:islandSearch&&candidates.length?4.5:r===0?1.8:r>4?1.5:Math.min(4.2,1.6+visits.length*.055)});
        if(candidates.length) { radius=r; break; }
      }
      if(radius<0) {
        push({...base,phase:'put',failed:true,failure:'no-candidate',nearbyResult:'Empty',title:'无有效落点，放置失败',text:'全部 14 个半径都没有候选。返回 Empty 后，最终放置无法通过边界检查。',duration:3.8});
        push({...base,phase:'retry',failure:'no-candidate',title:'回到外层，重新随机',text:'本轮 Track 搜索失败。重新抽 X、Y 后，才会重新读取初始格地面类型。',duration:4});
        continue;
      }
      const index=frame%candidates.length;
      const selected=candidates[index];
      push({...base,phase:'choose',radius,candidates,selected,index,title:'从候选记录中选择',text:`固定逻辑帧 ${frame} % ${candidates.length} = ${index}，取第 ${index+1} 条。附近选择不再抽随机数。`,duration:3});
      const overlay=hasOverlay(selected,world);
      const finalLand=landType(selected,world),crateKind=crateFor(finalLand);
      push({...base,phase:'put',radius,candidates,selected,index,finalLand,crateKind,failed:overlay,failure:overlay?'overlay':null,title:overlay?'最终放置失败':'最终放置检查通过',text:overlay?'选中格已有 Overlay，不能叠放。结束本轮，重抽起点；不接着搜索更外圈。':`可用边界与 Overlay 检查通过。再读最终格 ${finalLand}，创建${crateKind==='watercrate'?'水箱 WCRATE':'陆地箱 CRATE'}。`,duration:3.8});
      if(overlay) {
        push({...base,phase:'retry',selected,failed:true,failure:'overlay',title:'回到外层，重新随机',text:'附近搜索与外层重抽是两个步骤。已有覆盖物保留，下一轮从新起点重新搜索。',duration:2.8});
        continue;
      }
      placed=selected;
      push({...base,phase:'done',selected,placed,finalLand,crateKind,title:crateKind==='watercrate'?'水箱生成成功':'陆地箱生成成功',text:world.id==='island'&&speed==='Track'?`初始 (${initial}) → 中央陆地 (${selected})，第 ${attempt} 轮成功。附近扫描不要求陆路连通；本例无需重抽。`:`初始 (${initial}) → 最终 (${selected})；共 ${attempt} 轮。最终格 ${finalLand} 决定箱子类型。`,duration:world.id==='island'&&speed==='Track'?4.5:3.8});
      break;
    }
    if(!placed) push({phase:'exhausted',origin:initial,attempt:1000,title:'1000 轮均失败',text:'本次调用返回失败，不保证生成。'});
    let time=0;
    steps.forEach((s,i)=>{s.i=i;s.start=time;time+=s.duration;s.end=time;});
    return {preset,world,initial,frame,steps,duration:time,placed};
  }
  function atTime(trace,t) {
    const s=trace.steps.find(s=>t<s.end)||trace.steps.at(-1);
    return {step:s,progress:Math.max(0,Math.min(1,(t-s.start)/s.duration))};
  }
  const api={MAP,PRESETS,CORE_PRESETS,WORLDS,objects,key,inside,usable,landType,speedFor,crateFor,classify,ring,scanRing,hasOverlay,resolveAttempt,buildTrace,atTime};
  if(typeof module!=='undefined') module.exports=api;
  root.CrateModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
