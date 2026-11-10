/* Presentation-only controls: retain existing numeric cells and preview canvases. */
(function(root){
 'use strict';
 const t=root.CrateI18n?.t||((s)=>s),groups=['land','sea','all','tank','scorpion','hover'],fields=['total','average'];
 const titles={preview:'定位',name:'名称 / 面积',land:'陆地',sea:'海洋',all:'海陆',tank:'灰熊buff',scorpion:'海蝎buff',hover:'气垫船buff',total:'总倍率',average:'平均倍率'};
 const columns=['preview','name',...groups.flatMap(g=>fields.map(f=>g+'.'+f))],storageKey='crate-atlas.region-table.v1';
 function normalize(value={}){
  const order=[...new Set((Array.isArray(value.order)?value.order:[]).filter(k=>columns.includes(k)))];
  order.push(...columns.filter(k=>!order.includes(k)));
  const size=n=>Number.isFinite(n)?Math.max(25,Math.min(300,n)):100;
  return {order,hidden:columns.filter(k=>Array.isArray(value.hidden)&&value.hidden.includes(k)),compact:value.compact===true,overviewWidth:size(value.overviewWidth),overviewHeight:size(value.overviewHeight),overviewLocked:value.overviewLocked!==false};
 }
 function create({table,body,host,sort,ascending,onSort,onOverviewChanged}){
  if(!table||!body||!host)return null;
  let saved;try{saved=JSON.parse(root.localStorage?.getItem(storageKey)||'null');}catch{}
  const config=normalize(saved||{}),hidden=new Set(config.hidden),rowVersions=new WeakMap(),rowCells=new WeakMap();
  let revision=0,dragged=null,suppressClickUntil=0,numberFrame=null;
  const checks=[],sortButtons=[];
  const controls=document.createElement('div');controls.className='region-table-controls';host.append(controls);
  function checkbox(text,keys,parent=controls){
   const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';
   const span=document.createElement('span');span.textContent=t(text);label.append(span,input);parent.append(label);
   checks.push({input,keys});input.onchange=()=>{for(const key of keys){if(input.checked)hidden.delete(key);else hidden.add(key);}changed();};return {label,input};
  }
  checkbox('总倍率',groups.map(g=>g+'.total')).input.id='regionTotalsVisible';
  checkbox('平均倍率',groups.map(g=>g+'.average')).input.id='regionAveragesVisible';
  const compact=checkbox('紧凑模式',[]).input;compact.id='regionCompact';compact.checked=config.compact;
  compact.onchange=()=>{config.compact=compact.checked;applyCompact();save();};checks.pop();
  const sizes=document.createElement('div');sizes.className='region-overview-size';controls.append(sizes);
  const sizeTitle=document.createElement('span');sizeTitle.textContent=t('图片缩放');sizes.append(sizeTitle);
  const sizeInputs={};
  for(const [axis,title]of [['Width','宽'],['Height','高']]){
   const label=document.createElement('label'),text=document.createElement('span'),input=document.createElement('input');
   text.textContent=t(title);input.type='number';input.min=25;input.max=300;input.step=5;input.id='regionOverview'+axis;input.setAttribute('aria-label',t(axis==='Width'?'统计图宽度比例':'统计图高度比例'));sizeInputs[axis]=input;
   label.append(text,input,document.createTextNode('%'));sizes.append(label);
   input.oninput=()=>{
    if(input.value==='')return;const number=Number(input.value);if(!Number.isFinite(number)||number<25||number>300)return;
    const value=number,key='overview'+axis,other=axis==='Width'?'overviewHeight':'overviewWidth';
    if(config.overviewLocked){const factor=Math.max(Math.max(25/config[key],25/config[other]),Math.min(Math.min(300/config[key],300/config[other]),value/config[key]));config[key]=Math.round(config[key]*factor*10)/10;config[other]=Math.round(config[other]*factor*10)/10;}
    else config[key]=value;
    syncSizes(input);save();onOverviewChanged?.();
   };
   input.onchange=input.onblur=()=>syncSizes();
  }
  const lock=document.createElement('button');lock.type='button';lock.id='regionOverviewLock';sizes.append(lock);
  lock.onclick=()=>{config.overviewLocked=!config.overviewLocked;syncSizes();save();};
  root.CrateDisplayModes?.reverseToggle(lock);
  function syncSizes(editing=null){
   if(editing!==sizeInputs.Width)sizeInputs.Width.value=config.overviewWidth;if(editing!==sizeInputs.Height)sizeInputs.Height.value=config.overviewHeight;
   lock.textContent=config.overviewLocked?'🔗':'🔓';lock.title=t(config.overviewLocked?'宽高连锁':'宽高独立');lock.setAttribute('aria-label',lock.title);lock.setAttribute('aria-pressed',String(config.overviewLocked));
   table.style.setProperty('--region-overview-width',216*config.overviewWidth/100+'px');table.style.setProperty('--region-overview-height',121.5*config.overviewHeight/100+'px');
  }
  syncSizes();
  const menu=document.createElement('details');menu.className='region-column-picker';
  const summary=document.createElement('summary');summary.textContent=t('显示项目');menu.append(summary);
  const options=document.createElement('div');options.className='region-column-options';options.setAttribute('aria-label',t('显示项目'));menu.append(options);controls.append(menu);
  for(const key of ['preview','name'])checkbox(titles[key],[key],options).input.dataset.columnChoice=key;
  for(const group of groups){
   const section=document.createElement('div');section.className='region-column-group';options.append(section);
   checkbox(titles[group],fields.map(f=>group+'.'+f),section).input.dataset.columnChoice=group;
   for(const field of fields){const choice=checkbox(titles[field],[group+'.'+field],section);choice.label.className='region-column-child';choice.input.dataset.columnChoice=group+'.'+field;}
  }
  function positionOptions(){
   if(!menu.open)return;const anchor=summary.getBoundingClientRect(),width=Math.min(295,root.innerWidth-16),below=root.innerHeight-anchor.bottom-14,above=anchor.top-14;
   const desired=Math.min(options.scrollHeight,root.innerHeight*.65),down=below>=Math.min(180,desired)||below>=above,height=Math.max(60,Math.min(desired,down?below:above));
   Object.assign(options.style,{left:Math.max(8,Math.min(root.innerWidth-width-8,anchor.left))+'px',top:Math.max(8,Math.min(root.innerHeight-height-8,down?anchor.bottom+6:anchor.top-height-6))+'px',width:width+'px',maxHeight:height+'px'});
  }
  menu.addEventListener('toggle',positionOptions);root.addEventListener('resize',positionOptions);
  document.addEventListener('scroll',e=>{if(menu.open&&!options.contains(e.target))positionOptions();},true);
  document.addEventListener('pointerdown',e=>{if(menu.open&&!menu.contains(e.target))menu.open=false;});
  document.addEventListener('keydown',e=>{if(menu.open&&e.key==='Escape'){menu.open=false;summary.focus({preventScroll:true});e.preventDefault();e.stopImmediatePropagation();}},true);
  function save(){try{root.localStorage?.setItem(storageKey,JSON.stringify({...config,hidden:[...hidden]}));}catch{}}
  function applyCompact(){table.classList.toggle('region-table-compact',config.compact);}
  function syncChecks(){for(const {input,keys}of checks){const n=keys.filter(k=>!hidden.has(k)).length;input.checked=n===keys.length;input.indeterminate=n>0&&n<keys.length;}}
  function applyRows(){
   for(const row of body.children){
    if(rowVersions.get(row)===revision)continue;
    let cells=rowCells.get(row);if(!cells){cells=new Map(Array.from(row.children).map(c=>[c.dataset.column,c]));rowCells.set(row,cells);}
    for(const key of config.order){const cell=cells.get(key);if(cell){cell.hidden=hidden.has(key);row.append(cell);}}
    row.hidden=hidden.size===columns.length;rowVersions.set(row,revision);
   }
   numbersChanged();
  }
  function numbersChanged(){
   if(numberFrame!==null)return;
   numberFrame=root.requestAnimationFrame(()=>{
    numberFrame=null;if(!table.isConnected||!table.getClientRects().length)return;
    // Read natural widths in one batch, then write one shared width per column.
    // Every row keeps the same right edge inside a centered number block.
    const widths=new Map();
    for(const row of body.children)if(!row.hidden)for(const cell of row.children){
     if(cell.hidden)continue;const content=cell.querySelector('.region-number-content');if(!content)continue;
     const key=cell.dataset.column,width=content.getBoundingClientRect().width;widths.set(key,Math.max(widths.get(key)||0,width));
    }
    for(const [key,width]of widths)table.style.setProperty('--region-number-'+key.replace('.','-'),Math.ceil(width)+'px');
   });
  }
  function choose(metric){
   if(Date.now()<suppressClickUntil)return;
   ascending.checked=sort.value===metric?!ascending.checked:['order','name'].includes(metric);sort.value=metric;onSort();
  }
  function sortButton(th,title,metric){
   const button=document.createElement('button');button.type='button';button.className='region-column-sort';button.dataset.sortMetric=metric;
   const text=document.createElement('span');text.textContent=t(title);const arrow=document.createElement('span');arrow.className='region-sort-arrow';arrow.setAttribute('aria-hidden','true');
   button.append(text,arrow);button.onclick=()=>choose(metric);th.append(button);sortButtons.push({button,th,metric,arrow});return button;
  }
  function dragHeader(th,key){
   th.draggable=true;th.dataset.dragColumn=key;
   const grip=document.createElement('span');grip.className='region-column-grip';grip.textContent='⠿';grip.title=t('拖动调整列顺序');grip.setAttribute('aria-hidden','true');th.prepend(grip);
   th.ondragstart=e=>{dragged=key;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',key);th.classList.add('region-column-dragging');};
   th.ondragover=e=>{if(!dragged||dragged===key)return;e.preventDefault();e.dataTransfer.dropEffect='move';th.classList.add('region-column-drop');};
   th.ondragleave=()=>th.classList.remove('region-column-drop');
   th.ondrop=e=>{if(!dragged)return;e.preventDefault();const source=dragged;clearDrag();suppressClickUntil=Date.now()+250;move(source,key);};
   th.ondragend=()=>{clearDrag();suppressClickUntil=Date.now()+250;};
   // Keyboard equivalent for column reordering while a header has focus.
   th.onkeydown=e=>{if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const keys=members(key),visible=config.order.filter(k=>!hidden.has(k)),index=visible.indexOf(e.key==='ArrowLeft'?keys[0]:keys.at(-1)),target=visible[index+(e.key==='ArrowLeft'?-1:1)];if(target){move(key,target);table.tHead.querySelector('[data-drag-column="'+key+'"] button')?.focus();}};
  }
  function clearDrag(){dragged=null;for(const th of table.tHead.querySelectorAll('th'))th.classList.remove('region-column-dragging','region-column-drop');}
  function members(key){return key.startsWith('group:')?config.order.filter(k=>k.startsWith(key.slice(6)+'.')):columns.includes(key)?[key]:[];}
  function move(source,target){
   const moving=members(source),targets=members(target);if(!moving.length||!targets.length||moving.some(k=>targets.includes(k)))return;
   const forward=config.order.indexOf(moving[0])<config.order.indexOf(targets[0]),remaining=config.order.filter(k=>!moving.includes(k));
   const index=forward?remaining.indexOf(targets.at(-1))+1:remaining.indexOf(targets[0]);remaining.splice(index,0,...moving);config.order=remaining;changed();
  }
  function buildHeader(){
   sortButtons.length=0;
   const top=document.createElement('tr'),bottom=document.createElement('tr'),visible=config.order.filter(k=>!hidden.has(k));
   for(let i=0;i<visible.length;){
    const key=visible[i],th=document.createElement('th');th.scope='col';
    if(!key.includes('.')){
     th.rowSpan=2;th.dataset.column=key;th.className='region-column-'+key;
     if(key==='name'){sortButton(th,'编号','order');sortButton(th,'名称','name');sortButton(th,'面积','all.count');}else th.append(document.createTextNode(t(titles[key])));
     dragHeader(th,key);top.append(th);i++;continue;
    }
    const group=key.split('.')[0],run=[];while(i<visible.length&&visible[i].split('.')[0]===group)run.push(visible[i++]);
    th.colSpan=run.length;th.scope='colgroup';th.dataset.columnGroup=group;
    th.classList.toggle('region-column-single',run.length===1);
    sortButton(th,titles[group],run.includes(group+'.total')?group+'.total':run[0]);dragHeader(th,'group:'+group);top.append(th);
    for(const column of run){const leaf=document.createElement('th');leaf.scope='col';leaf.dataset.column=column;leaf.classList.toggle('region-column-single',run.length===1);sortButton(leaf,titles[column.split('.')[1]],column);dragHeader(leaf,column);bottom.append(leaf);}
   }
   if(!visible.length){const th=document.createElement('th');th.textContent=t('请选择显示项目');top.append(th);}
   table.tHead.replaceChildren(top,bottom);syncSort();
  }
  function syncSort(){
   for(const th of table.tHead.querySelectorAll('th'))th.removeAttribute('aria-sort');
   for(const {button,th,metric,arrow}of sortButtons){const selected=metric===sort.value;button.classList.toggle('active',selected);arrow.textContent=selected?(ascending.checked?'↑':'↓'):'';if(selected&&th.scope!=='colgroup')th.setAttribute('aria-sort',ascending.checked?'ascending':'descending');}
  }
  function changed(){revision++;applyCompact();syncChecks();buildHeader();applyRows();save();}
  applyCompact();syncChecks();buildHeader();
  return {applyRows,syncSort,numbersChanged,get overview(){return {width:config.overviewWidth/100,height:config.overviewHeight/100};}};
 }
 root.CrateRegionTableControls={create};
 if(typeof module!=='undefined')module.exports={normalize,columns};
})(typeof globalThis!=='undefined'?globalThis:this);
