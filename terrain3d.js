/* Local 3D inspection of a bounded patch. Probability results are never edited. */
(function(root){
 'use strict';
 const H=1/Math.sqrt(6),key=c=>`${c.x},${c.y}`;
 function viewHalfSize(radius,zoom,width,heightPx){const size=radius*1.15+2,horizontal=(2*radius+1)*Math.SQRT2/2+1;return Math.max(size*.68,horizontal/(Math.max(1,width)/Math.max(1,heightPx)))/zoom;}
 function height(c,u,v){const[a,b,d,e]=c.corners||[0,0,0,0];return c.level+a*(1-u)*(1-v)+b*u*(1-v)+d*u*v+e*(1-u)*v;}
 function decorationSurface(c,d){return d.bridge==='high'?{...c,level:d.level,slope:0,corners:[0,0,0,0]}:c;}
 function relationships(c,lookup){return {higher:(c.higher||[]).map(([x,y])=>lookup.get(`${x},${y}`)).filter(Boolean),affected:(c.affected||[]).map(([x,y])=>lookup.get(`${x},${y}`)).filter(Boolean)};}
 function probabilityCells(cells,{display,lookup,options}){
  return cells.flatMap(c=>{
   const source=lookup.get(key(c));
   if(!source||options.filter!=='all'&&(options.filter==='water'?source.land!==2:source.land===2)||!display.meetsThreshold(source,options.threshold||0))return [];
   const value=display.get(source);
   if(!(value.multiplier>0))return [];
   return [{cell:c,multiplier:value.multiplier,alpha:display.cellAlpha(source,{opacity:1-options.opacity/100}),
    label:display.showLabel(source,options.baselineValues)?value.multiplier.toFixed(1)+'×':null}];
  });
 }
 const land=['Clear','Road','Water','Rock','Wall','Tiberium','Beach','Rough','Ice','Railroad','Tunnel'];
 // Risk flags come from the same exact analysis as the main map. Do not infer
 // an anomaly from Rough/high differences or from a rounded probability alone.
 const riskStyles={
  current:{color:0xff77c6,alpha:.34,pattern:'solid',label:'放箱后禁行'},
  potential:{color:0xed9dca,alpha:.22,pattern:'hatch',label:'清空后潜在禁行'},
  zero:{color:0xf0ad69,alpha:.13,pattern:'dots',label:'Rough · 落箱概率 0'},
  other:{color:0xb6bdc7,alpha:.13,pattern:'dots',label:'Rough · 未归入异常点'}
 };
 function riskCategory(c){
  if(c.marked)return 'current';
  if(c.potentialMarked)return 'potential';
  if(c.land===7&&c.higher?.length)return c.probability===0?'zero':'other';
  return null;
 }
 function description(c,meta,after=false){
  if(meta.demonstration==='single'){
   if(after)return `${land[c.land]} → ${land[c.postLand]} · ${c.postLand===3?'放箱后地面禁行':'放箱后地面类型允许通行'}`;
   if(c.land===7&&c.higher.length)return 'Rough 例外 · 放箱前地面类型允许通行';
   return `${land[c.land]} · ${c.land===3?'当前地面已禁行':'地面类型允许通行'}${c.higher.length?' · 命中高差判定':''}`;
  }
  if(meta.previewOnly)return (meta.partialAnalysis?'部分地图预览':'地图外观预览')+' · 未验证禁行规则';
  if(meta.approximate)return '近似概率，不保证准确 · 未验证禁行规则';
  if(!meta.predictionEnabled)return '本图未启用四级高差禁行判定';
  if(after)return `${land[c.land]} → ${land[c.postLand]} · ${c.postLand===3?'放箱后地面禁行':'放箱后未变为 Rock 地面'}`;
  const category=riskCategory(c),prefix=c.land===7?'Rough 例外 · ':'';
  if(category==='current')return `${prefix}当前可随机落箱，放箱后禁行 · 对应主图实色粉标`;
  if(category==='potential')return `${prefix}当前落箱概率为 0；清空对象后可随机落箱，随后禁行 · 对应主图斜纹粉标`;
  if(category==='zero'){
   const reason=c.primary===false?'；高度投影判定未选中此低格':c.status==='ghost'?'；此坡型不生成实体箱':'';
   const cleared=c.clearance?.supported===false?'；清空对象后仍无随机落箱路径':'';
   return `${prefix}随机落箱概率为 0${reason}${cleared} · 不属于主图异常点`;
  }
  if(category==='other')return `${prefix}未归入主图异常点；不能仅凭高差条件判断放箱风险`;
  if(c.land===3)return `Rock · 当前地面已禁行${c.higher.length?'，命中高差判定':''}`;
  return `${land[c.land]||'未知地面'} · ${c.higher.length?'命中高差位置；当前地面类型未变为 Rock':'未命中高差判定'}`;
 }
 let library;
 function loadLibrary(){
  if(root.THREE)return Promise.resolve(root.THREE);
  if(!library)library=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='lib/three-r160.min.js';s.onload=()=>root.THREE?resolve(root.THREE):reject(Error('3D 绘图库未能初始化'));s.onerror=()=>{s.remove();library=null;reject(Error('3D 绘图库缺失，请检查工具文件是否完整'));};document.head.append(s);});
  return library;
 }
 async function fetchPatch(context,{radius,signal}){
  const query=new URLSearchParams({result:context.result,x:context.cell.x,y:context.cell.y,radius});
  const response=await fetch('/api/maps/terrain3d?'+query,{signal}),text=await response.text();let data;
  try{data=JSON.parse(text);}catch{throw Error('3D 接口尚未启动，请重新启动工具后重试');}
  if(!response.ok)throw Error(data.error||'地形读取失败');return data;
 }
 function create({getContext,onSelect,loadPatch=fetchPatch,embedded=false}){
  const $=id=>document.getElementById(id),dialog=$('terrain3dDialog'),stage=$('terrain3dStage'),canvas=$('terrain3dCanvas');
  let revision=0,controller=null,view=null,busy=false,probabilityOn=false;
  const controls=['terrain3dRecenter','terrain3dReset','terrain3dLeft','terrain3dRight','terrain3dCrate','terrain3dProbability'];
  function loading(value){busy=value;stage.classList.toggle('is-loading',value);$('terrain3dLoading').hidden=!value;for(const id of controls)$(id).disabled=value;}
  async function show(){
   const context=getContext();if(!context?.cell)return;
   if(!dialog.open){probabilityOn=false;if(embedded)dialog.setAttribute('open','');else dialog.showModal();}$('terrain3dProbability').textContent='概率:'+(probabilityOn?'开':'关');$('terrain3dProbability').setAttribute('aria-pressed',String(probabilityOn));if(!embedded)document.body.classList.add('terrain3d-open');
   const ticket=++revision;controller?.abort();controller=new AbortController();view?.dispose();view=null;
   loading(true);$('terrain3dError').textContent='';$('terrain3dLabels').replaceChildren();$('terrain3dRelations').replaceChildren();$('terrain3dSource').textContent='';$('terrain3dWarnings').hidden=true;$('terrain3dLegend').hidden=$('terrain3dRiskScope').hidden=true;canvas.setAttribute('aria-label','正在读取选中格附近地形');$('terrain3dCrate').textContent='预览放箱后';$('terrain3dCrate').setAttribute('aria-pressed','false');
   $('terrain3dProbabilityNote').hidden=true;$('terrain3dTitle').textContent=`3D 地形 · (${context.cell.x}, ${context.cell.y})`;
   $('terrain3dDetail').textContent='正在读取选中格附近的原始地块…';
   try{
    const [T,data]=await Promise.all([loadLibrary(),loadPatch(context,{radius:$('terrain3dRadius').value,signal:controller.signal})]);
    if(ticket!==revision||!dialog.open)return;
    const next=await makeView(T,data,context,ticket);
    if(ticket!==revision||!dialog.open){next?.dispose();return;}
    view=next;loading(false);view.update();
   }catch(error){if(ticket!==revision||error.name==='AbortError')return;loading(false);$('terrain3dError').textContent=error.message;$('terrain3dDetail').textContent=embedded?'地形未能载入，可点击“重新加载演示”重试。':'地形未能载入。关闭后可重新打开重试。';for(const id of controls)$(id).disabled=true;}
  }
  function close(){++revision;controller?.abort();view?.dispose();view=null;busy=false;$('terrain3dLabels').replaceChildren();document.body.classList.remove('terrain3d-open');}
  $('terrain3dClose').onclick=()=>dialog.close();dialog.addEventListener('close',close);
  $('terrain3dRadius').onchange=show;$('terrain3dRecenter').onclick=show;
  $('terrain3dReset').onclick=()=>view?.reset();$('terrain3dLeft').onclick=()=>view?.rotate(-Math.PI/6);$('terrain3dRight').onclick=()=>view?.rotate(Math.PI/6);
  $('terrain3dCrate').onclick=()=>view?.toggleCrate();
  $('terrain3dMarkers').onchange=()=>view?.update();$('terrain3dDecorations').onchange=()=>view?.update();
  $('terrain3dRelief').onchange=()=>view?.update();
  $('terrain3dProbability').onclick=()=>{if(view&&!busy){probabilityOn=!probabilityOn;view.update();}};
  async function makeView(T,data,context,ticket){
   const initial=context.cell,probability=context.probability,hasProbability=!!probability&&!data.metadata.previewOnly;
   const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=T.SRGBColorSpace;
   const scene=new T.Scene(),terrain=new T.Group(),coarse=new T.Group(),relief=new T.Group(),marks=new T.Group(),decor=new T.Group(),links=new T.Group(),probabilityLayer=new T.Group(),probabilityLabels=new T.Group();scene.add(terrain,coarse,relief,marks,decor,links,probabilityLayer);probabilityLayer.add(probabilityLabels);probabilityLayer.visible=false;
   scene.add(new T.AmbientLight(0xffffff,.85));const sun=new T.DirectionalLight(0xffffff,.65);sun.position.set(-5,15,10);scene.add(sun);
   const cells=data.cells,lookup=new Map(cells.map(c=>[key(c),c])),baseLevel=Math.min(...cells.map(c=>c.level)),textures={},materials=new Set(),geometries=new Set();
   let selected=lookup.get(key(initial)),after=false,disposed=false,frame=0,width=1,heightPx=1,yaw=Math.PI/4,pitch=Math.PI/6,zoom=1,labels=[];
   const camera=new T.OrthographicCamera(-8,8,8,-8,.1,150),pan=new T.Vector3(),center=data.center;
   const target=new T.Vector3(0,(height(selected,.5,.5)-baseLevel)*H,0),ray=new T.Raycaster(),pickables=[];
   const point=(c,u=.5,v=.5,offset=0)=>new T.Vector3(c.x-center[0]+u-.5,(height(c,u,v)-baseLevel)*H+offset,c.y-center[1]+v-.5);
   const material=options=>{const m=new T.MeshBasicMaterial(options);materials.add(m);return m;};
   const geometry=g=>{geometries.add(g);return g;};
   function cleanupGroup(group){for(const child of [...group.children]){group.remove(child);child.traverse(o=>{if(o.geometry){o.geometry.dispose();geometries.delete(o.geometry);}if(o.material){o.material.dispose();materials.delete(o.material);}});}}
   function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer?.disconnect();events.abort();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of Object.values(textures))t.dispose();renderer.dispose();for(const l of labels)l.node.remove();}
   const events=new AbortController();let observer=null;
   try{
    await Promise.all(Object.entries(data.textures).map(([id,url])=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{if(disposed){resolve();return;}const tex=new T.Texture(im);tex.needsUpdate=true;tex.colorSpace=T.SRGBColorSpace;tex.magFilter=T.NearestFilter;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures[id]=tex;resolve();};im.onerror=()=>reject(Error('部分地形贴图无法解码'));im.src=url;})));
    if(ticket!==revision){dispose();return null;}
    function surface(c,mat,offset=0,inset=0){
     const positions=[],uv=[],indices=[],n=c.slope?6:1;
     for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const u=inset+(1-2*inset)*i/n,v=inset+(1-2*inset)*j/n;positions.push(...point(c,u,v,offset).toArray());uv.push(u,1-v);}
     for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+1,d=a+n+1,e=d+1;indices.push(a,d,b,b,d,e);}
     const g=geometry(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return new T.Mesh(g,mat);
    }
    const corners=[[0,0],[1,0],[1,1],[0,1]],steps=[[0,-1],[1,0],[0,1],[-1,0]];
    const topMats=new Map(),wallMats=new Map(),reliefAssets=new Map();
    function decode(encoded,Type){const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new Type(bytes.buffer);}
    for(const[id,detail]of Object.entries(data.reliefs||{})){
     const raw=decode(detail.vertices,Float32Array),positions=new Float32Array(detail.vertexCount*3),uv=new Float32Array(detail.vertexCount*2);
     for(let i=0;i<detail.vertexCount;i++){positions.set([raw[i*5]-.5,raw[i*5+1]*H,raw[i*5+2]-.5],i*3);uv.set([raw[i*5+3],raw[i*5+4]],i*2);}
     const g=geometry(new T.BufferGeometry());g.setAttribute('position',new T.BufferAttribute(positions,3));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setIndex(new T.BufferAttribute(decode(detail.indices,Uint32Array),1));g.computeVertexNormals();g.computeBoundingSphere();
     const rear=new T.MeshLambertMaterial({map:textures[detail.texture],alphaTest:.5,color:0xd3d4d0,side:T.BackSide});materials.add(rear);
     reliefAssets.set(id,{geometry:g,material:material({map:textures[detail.texture],alphaTest:.5,side:T.FrontSide}),rear});
    }
    for(const c of cells){
     if(!topMats.has(c.texture))topMats.set(c.texture,material({map:textures[c.texture]||null,color:c.texture?0xffffff:0x7c8990,side:T.DoubleSide}));
     const detail=reliefAssets.get(c.relief);
     const top=surface(c,topMats.get(c.texture));top.userData.cell=c;(detail?coarse:terrain).add(top);pickables.push(top);
     if(detail){
      for(const mat of [detail.material,detail.rear]){const mesh=new T.Mesh(detail.geometry,mat);mesh.position.set(c.x-center[0],(c.level-baseLevel)*H,c.y-center[1]);mesh.userData.cell=c;relief.add(mesh);pickables.push(mesh);}
      const backing=surface(c,topMats.get(c.texture),-.025);backing.userData.cell=c;relief.add(backing);pickables.push(backing);
     }
     for(let edge=0;edge<4;edge++){
      const [dx,dy]=steps[edge],n=lookup.get(`${c.x+dx},${c.y+dy}`),a=corners[edge],b=corners[(edge+1)%4];
      const pa=point(c,...a),pb=point(c,...b),na=n?point(n,a[0]-dx,a[1]-dy):new T.Vector3(pa.x,-.7,pa.z),nb=n?point(n,b[0]-dx,b[1]-dy):new T.Vector3(pb.x,-.7,pb.z);
      if(pa.y<=na.y+.005&&pb.y<=nb.y+.005)continue;
      na.y=Math.min(na.y,pa.y);nb.y=Math.min(nb.y,pb.y);
      const id=n?(c.walls?.[edge]||c.wallTexture):'cut';
      // The game camera looks from +X/+Z. Its visible cliff art already has
      // painted shading, so preserve those texels without darkening them again.
      // Keep the original Lambert light on rear faces and patch cut boundaries.
      const gameFacing=!!n&&(edge===1||edge===2),matKey=`${id}:${gameFacing?'game':'rear'}`;
      if(!wallMats.has(matKey)){const options={map:n?textures[id]||null:null,color:gameFacing?0xffffff:n?0xd3d4d0:0x293945,side:T.DoubleSide};const m=gameFacing?new T.MeshBasicMaterial(options):new T.MeshLambertMaterial(options);materials.add(m);wallMats.set(matKey,m);}
      const g=geometry(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute([...pa.toArray(),...pb.toArray(),...nb.toArray(),...na.toArray()],3));g.setAttribute('uv',new T.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();
      const wall=new T.Mesh(g,wallMats.get(matKey));wall.userData.cell=c;
      const detailedWall=n&&(detail||reliefAssets.has(n.relief));
      (detailedWall?coarse:terrain).add(wall);pickables.push(wall);
      // TMPs only paint what the game camera sees. A slightly recessed solid
      // backing closes unseen gaps when orbiting without flattening rock tips.
      if(detailedWall){
       const fillId=c.wallFillTexture||n.wallFillTexture||id,fillKey=`fill:${fillId}:${gameFacing}`;
       if(!wallMats.has(fillKey)){const options={map:textures[fillId]||null,color:gameFacing?0xffffff:0xd3d4d0,side:T.DoubleSide};const m=gameFacing?new T.MeshBasicMaterial(options):new T.MeshLambertMaterial(options);materials.add(m);wallMats.set(fillKey,m);}
       const backing=new T.Mesh(g,wallMats.get(fillKey));backing.position.set(-dx*.045,0,-dy*.045);backing.userData.cell=c;relief.add(backing);pickables.push(backing);
      }
     }
     for(const d of c.decorations){
      if(d.flat){
       const mesh=surface(decorationSurface(c,d),material({map:textures[d.texture],transparent:true,alphaTest:.05,depthWrite:!!d.bridge,side:T.DoubleSide}),d.bridge ? .018 : .012);
       decor.add(mesh);
       if(d.bridge==='high'){mesh.userData.cell=c;pickables.push(mesh);}
      }
      else {const m=new T.SpriteMaterial({map:textures[d.texture],transparent:true,alphaTest:.12});materials.add(m);const sprite=new T.Sprite(m),pixels=30*Math.sqrt(2);sprite.position.copy(point(c,.5,.5,.02));sprite.scale.set(d.width/pixels,d.height/pixels,1);sprite.center.set(.5-d.offset[0]/d.width,.5+d.offset[1]/d.height);decor.add(sprite);}
     }
    }
    let probabilityBuilt=false;
    function buildProbability(){
     if(probabilityBuilt||!hasProbability)return;probabilityBuilt=true;
     const labelMaterials=new Map();
     for(const entry of probabilityCells(cells,probability)){
      const c=entry.cell;
      if(entry.alpha>0)probabilityLayer.add(surface(c,material({color:root.CrateProbability.color(entry.multiplier,probability.options.palette,probability.display.maxMultiplier),transparent:true,opacity:entry.alpha,depthWrite:false,side:T.DoubleSide}),.016,.025));
      if(!entry.label)continue;
      if(!labelMaterials.has(entry.label)){
       const image=document.createElement('canvas');image.width=192;image.height=64;const ctx=image.getContext('2d');
       ctx.font='bold 52px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=7;ctx.strokeStyle='#10212cee';ctx.fillStyle='#fff';ctx.strokeText(entry.label,96,34,184);ctx.fillText(entry.label,96,34,184);
       const tex=new T.CanvasTexture(image);tex.colorSpace=T.SRGBColorSpace;textures['probability:'+entry.label]=tex;
       const m=new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false});materials.add(m);labelMaterials.set(entry.label,m);
      }
      const sprite=new T.Sprite(labelMaterials.get(entry.label));sprite.position.copy(point(c,.5,.5,.04));sprite.center.set(.5,0);sprite.scale.set(1.4,1.4/3,1);probabilityLabels.add(sprite);
     }
    }
    function line(points,color,{group=marks,dashed=false,depthTest=true,opacity=1}={}){
     const g=geometry(new T.BufferGeometry().setFromPoints(points)),params={color,transparent:true,opacity,depthTest,depthWrite:false};
     const m=dashed?new T.LineDashedMaterial({...params,dashSize:.10,gapSize:.07}):new T.LineBasicMaterial(params);materials.add(m);
     const obj=new T.Line(g,m);if(dashed)obj.computeLineDistances();group.add(obj);return obj;
    }
    function perimeter(c,offset=.03,inset=.025){const points=[];for(let e=0;e<4;e++){const a=corners[e],b=corners[(e+1)%4];for(let j=0;j<6;j++){const t=j/6;points.push(point(c,inset+(1-2*inset)*(a[0]+(b[0]-a[0])*t),inset+(1-2*inset)*(a[1]+(b[1]-a[1])*t),offset));}}return [...points,points[0]];}
    function mark(c,color,alpha,pattern='solid'){
     marks.add(surface(c,material({color,transparent:true,opacity:alpha,depthWrite:false,side:T.DoubleSide}),.022,.025));line(perimeter(c),color,{opacity:.85,dashed:pattern==='dots'});
     if(pattern==='hatch')for(let t=-.6;t<=.61;t+=.25){const lo=Math.max(.05,t+.05),hi=Math.min(.95,t+.95),ps=[];for(let k=0;k<=8;k++){const u=lo+(hi-lo)*k/8;ps.push(point(c,u,u-t,.034));}line(ps,color,{opacity:.8});}
     if(pattern==='dots')for(const u of [.25,.5,.75])for(const v of [.25,.5,.75])line([point(c,u-.025,v,.034),point(c,u+.025,v,.034)],color,{opacity:.9});
    }
    function label(c,text,selectedLabel=false){const node=document.createElement('span');node.className='terrain3d-label'+(selectedLabel?' selected':'');node.textContent=text;node.hidden=true;$('terrain3dLabels').append(node);labels.push({node,position:point(c,.5,.5,after&&selectedLabel?.62:.25)});}
    function update(){
     if(disposed)return;cleanupGroup(marks);cleanupGroup(links);labels=[];$('terrain3dLabels').replaceChildren();
     if(!selected.canPlace)after=false;decor.visible=$('terrain3dDecorations').checked;
     const fine=$('terrain3dRelief').checked&&reliefAssets.size>0;relief.visible=fine;coarse.visible=!fine;
     if(probabilityOn&&hasProbability)buildProbability();probabilityLayer.visible=probabilityOn&&hasProbability;
     $('terrain3dProbability').disabled=busy||!hasProbability;$('terrain3dProbability').textContent='概率:'+(probabilityLayer.visible?'开':'关');$('terrain3dProbability').setAttribute('aria-pressed',String(probabilityLayer.visible));
     $('terrain3dProbability').title=hasProbability?'同时显示概率着色和倍率；沿用主图配色、筛选、透明度及 1× 标签设置，放大可查看倍率':'本图未计算概率';
     $('terrain3dProbabilityNote').hidden=!probabilityLayer.visible;
     $('terrain3dProbabilityNote').textContent=hasProbability?`${data.metadata.approximate?'近似概率，不保证准确；未知格按放箱失败重抽。':''}概率与主图使用同一结果；1× 基准 ${root.CrateProbabilityDisplay.percent(probability.display.baselineProbability)}。放大可查看倍率；仅切换显示，不重新计算。`:'';
     const enabled=data.metadata.predictionEnabled,show=$('terrain3dMarkers').checked;
     const rel=relationships(selected,lookup);
     if(show&&enabled){
      for(const c of cells){const style=riskStyles[riskCategory(c)];if(style)mark(c,style.color,style.alpha,style.pattern);else if(c.higher.length)mark(c,0x60b7f0,.31);}
      for(const c of rel.higher)mark(c,0x79e0b7,.42);
      if(rel.affected.length)mark(selected,0x79e0b7,.38);
      for(const c of [...rel.higher,...rel.affected]){const a=point(selected,.5,.5,.08),b=point(c,.5,.5,.08),mid=a.clone().lerp(b,.5);mid.y=Math.max(a.y,b.y)+.65;line(new T.QuadraticBezierCurve3(a,mid,b).getPoints(28),0x92e8cd,{group:links,dashed:true,depthTest:false,opacity:.8});}
      for(const c of rel.higher.slice(0,3))label(c,`高格 (${c.x}, ${c.y}) · L${c.level}`);
     }
     line(perimeter(selected,.055,.01),0x8fffaf,{group:links,dashed:true,depthTest:false,opacity:.45});line(perimeter(selected,.06,.01),0x58f495,{group:links});
     if(after){mark(selected,selected.postLand===3?0xff77c6:0x79e0b7,.43);const g=geometry(new T.BoxGeometry(.27,.27,.27)),box=new T.Mesh(g,material({color:0xd9a85b}));box.position.copy(point(selected,.5,.5,.16));marks.add(box);const edges=geometry(new T.EdgesGeometry(g)),edge=new T.LineSegments(edges,new T.LineBasicMaterial({color:0x47311a}));materials.add(edge.material);edge.position.copy(box.position);marks.add(edge);}
     const selectedRisk=riskStyles[riskCategory(selected)];
     label(selected,`选中 (${selected.x}, ${selected.y}) · L${selected.level}${enabled&&selectedRisk?' · '+selectedRisk.label:''}`,true);
     $('terrain3dTitle').textContent=`3D 地形 · (${selected.x}, ${selected.y})`;
     $('terrain3dCrate').disabled=busy||!selected.canPlace;$('terrain3dCrate').setAttribute('aria-pressed',String(after));$('terrain3dCrate').textContent=after?'恢复放箱前':'预览放箱后';
     $('terrain3dCrate').title=data.metadata.demonstration==='single'?(selected.canPlace?'只比较放箱前后的地面类型，不代表已计算随机落点概率':'此格地面已禁行，请选择 Rough 例外或普通可通行格'):selected.canPlace?'只比较地面类型，分析结果保持不变':'当前格没有已验证的实体箱随机落点，无法预览放箱';
     $('terrain3dMarkers').disabled=!enabled;
     $('terrain3dDetail').textContent=`(${selected.x}, ${selected.y}) · 高度 ${selected.level} / 坡型 ${selected.slope} · ${description(selected,data.metadata,after)}${selected.occupied?' · 当前有对象占用':''}`;
     $('terrain3dRelations').replaceChildren();
     const refs=selected.higher.length?selected.higher:selected.affected;
     const prefix=document.createElement('span');prefix.textContent=!enabled?'':selected.higher.length?'相关高格：':selected.affected.length?'受此高格影响：':'附近没有与此格关联的高差判定。';$('terrain3dRelations').append(prefix);
     for(const[x,y,l]of refs){const button=document.createElement('button');button.textContent=`(${x}, ${y}) L${l}`;button.disabled=!lookup.has(`${x},${y}`);button.title=button.disabled?'位于当前局部范围外，居中或扩大范围后查看':'选中此格';button.onclick=()=>choose(lookup.get(`${x},${y}`));$('terrain3dRelations').append(button);}
     $('terrain3dSource').textContent=data.metadata.sourceDescription||`${data.metadata.filename} · ${data.metadata.theater} · 矿石${data.metadata.mineralsEnabled===false?'关（无矿石布局）':'开'} · ${cells.length} 格 / ${data.metadata.uniqueTiles} 种实际地块 · ${fine?'崖壁按原图轮廓与深度细分重建，未绘制的背面使用补面':'崖壁使用简化模型'}；坡面与树木为贴图重建。${data.metadata.missing.length?' '+data.metadata.missing.length+' 项资源缺失，使用占位或省略外观。':''}${data.metadata.bridgeNote?' '+data.metadata.bridgeNote:''}`;
     const warnings=data.metadata.missing;
     $('terrain3dWarnings').hidden=!warnings.length;$('terrain3dWarningsText').textContent=warnings.join('\n');
     const counts={current:0,potential:0,zero:0,other:0};for(const c of cells){const category=riskCategory(c);if(category)counts[category]++;}
     for(const category of Object.keys(counts)){$(`terrain3dCount-${category}`).textContent=counts[category];}
     $('terrain3dLegendOther').hidden=!counts.other;
     $('terrain3dLegend').hidden=$('terrain3dRiskScope').hidden=!enabled;canvas.setAttribute('aria-label',`可旋转的附近地形。${$('terrain3dDetail').textContent}`);requestDraw();
    }
    function choose(c,notify=true){if(!c)return;selected=c;after=false;update();if(notify)onSelect(c.x,c.y);}
    function setCamera(){const focus=target.clone().add(pan),distance=35;camera.position.set(focus.x+distance*Math.cos(pitch)*Math.sin(yaw),focus.y+distance*Math.sin(pitch),focus.z+distance*Math.cos(pitch)*Math.cos(yaw));camera.lookAt(focus);const half=viewHalfSize(data.radius,zoom,width,heightPx);camera.left=-half*width/heightPx;camera.right=half*width/heightPx;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();camera.updateMatrixWorld();}
    function draw(){
     frame=0;if(disposed||!dialog.open)return;
     const nextWidth=Math.max(1,stage.clientWidth),nextHeight=Math.max(1,stage.clientHeight);
     // setSize clears the WebGL canvas. Resize only when needed and render in
     // the same frame; ResizeObserver must never leave a cleared frame on screen.
     if(width!==nextWidth||heightPx!==nextHeight){width=nextWidth;heightPx=nextHeight;renderer.setSize(width,heightPx,false);}
     setCamera();probabilityLabels.visible=heightPx/(camera.top-camera.bottom)>=22;renderer.render(scene,camera);const placed=[];for(const l of labels){const p=l.position.clone().project(camera);l.node.hidden=Math.abs(p.x)>1.05||Math.abs(p.y)>1.05||Math.abs(p.z)>1;if(l.node.hidden)continue;const w=l.node.offsetWidth,h=l.node.offsetHeight,x=Math.max(w/2+5,Math.min(width-w/2-5,(p.x+1)*width/2));let y=Math.max(h+5,Math.min(heightPx-28,(1-p.y)*heightPx/2));for(const b of placed)if(x+w/2>b.left-4&&x-w/2<b.right+4&&y>b.top-4&&y-h<b.bottom+4)y=b.top-6;if(y<h+4)y=h+4;placed.push({left:x-w/2,right:x+w/2,top:y-h,bottom:y});l.node.style.left=x+'px';l.node.style.top=y+'px';}
    }
    function requestDraw(){if(!frame&&!disposed)frame=requestAnimationFrame(draw);}
    function resize(){requestDraw();}
    function reset(){yaw=Math.PI/4;pitch=Math.PI/6;zoom=1;pan.set(0,0,0);requestDraw();}
    const pointers=new Map();let previous=null,travel=0;
    const gesture=()=>{const p=[...pointers.values()];return p.length?{x:p.reduce((n,p)=>n+p.x,0)/p.length,y:p.reduce((n,p)=>n+p.y,0)/p.length,n:p.length,d:p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0}:null;};
    const listen=(name,fn,options={})=>canvas.addEventListener(name,fn,{...options,signal:events.signal});
    listen('contextmenu',e=>e.preventDefault());
    listen('pointerdown',e=>{if(![0,2].includes(e.button))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);previous=gesture();travel=pointers.size>1?100:0;canvas.classList.add('dragging');});
    listen('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=gesture();if(previous&&next.n===previous.n){const dx=next.x-previous.x,dy=next.y-previous.y;travel+=Math.abs(dx)+Math.abs(dy);if(e.shiftKey||e.buttons===2){const speed=(camera.right-camera.left)/width;pan.x-=dx*Math.cos(yaw)*speed;pan.z+=dx*Math.sin(yaw)*speed;pan.y+=dy*speed;}else {yaw-=dx*.008;pitch=Math.max(.16,Math.min(1.45,pitch+dy*.006));}if(next.n===2&&previous.d)zoom=Math.max(.45,Math.min(4,zoom*next.d/previous.d));requestDraw();}previous=next;});
    function release(e,cancel=false){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);previous=gesture();if(!pointers.size){canvas.classList.remove('dragging');if(!cancel&&e.button===0&&travel<6){const r=canvas.getBoundingClientRect(),p=new T.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);setCamera();ray.setFromCamera(p,camera);const hit=ray.intersectObjects(pickables.filter(o=>o.parent.visible),false)[0];if(hit)choose(hit.object.userData.cell);}if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}}
    listen('pointerup',e=>release(e));listen('pointercancel',e=>release(e,true));
    listen('wheel',e=>{e.preventDefault();zoom=Math.max(.45,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));requestDraw();},{passive:false});
    listen('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){yaw+=(e.key==='ArrowLeft'?-1:1)*Math.PI/12;e.preventDefault();requestDraw();}else if(['ArrowUp','ArrowDown'].includes(e.key)){pitch=Math.max(.16,Math.min(1.45,pitch+(e.key==='ArrowUp'?.1:-.1)));e.preventDefault();requestDraw();}});
    observer=new ResizeObserver(resize);observer.observe(stage);resize();
    return {dispose,update,reset,rotate(delta){yaw+=delta;requestDraw();},toggleCrate(){if(selected.canPlace){after=!after;update();}},select(c){if(lookup.has(key(c))&&key(c)!==key(selected))choose(lookup.get(key(c)),false);}};
   }catch(error){dispose();throw error;}
  }
  return {open:show,select(c){if(dialog.open)view?.select(c);},close(){if(dialog.open)dialog.close();},dispose:close};
 }
 const api={create,height,decorationSurface,viewHalfSize,relationships,riskCategory,description,probabilityCells};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CrateTerrain3D=api;
})(typeof globalThis!=='undefined'?globalThis:this);
