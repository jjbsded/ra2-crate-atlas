/* Coordinate lists own only the visible page. Layout shares the active tab's
 * remaining height and reserves the largest pager before assigning rows. */
(function(root){
 'use strict';
 const t=(...args)=>root.CrateI18n?.t(...args)||args[0];
 function pageNumbers(page,total,all=false){
  if(all)return Array.from({length:total},(_,i)=>i+1);
  return [...new Set([1,...Array.from({length:5},(_,i)=>page+i-2).filter(n=>n>=1&&n<=total),total])].sort((a,b)=>a-b);
 }
 function create({aside,host,lists,document=root.document,onFocus}){
  let frame=null,selected=null,selectedCode=null,disposed=false;
  const controllers=lists.map(spec=>{
   const grid=spec.grid,nav=document.createElement('nav'),numbers=document.createElement('div'),jump=document.createElement('form'),input=document.createElement('input'),totalLabel=document.createElement('span');
   nav.className='risk-pager';nav.hidden=true;nav.setAttribute('aria-label',t(spec.label)+' · '+t('分页'));numbers.className='risk-page-numbers';jump.className='risk-page-jump';input.type='number';input.min='1';input.step='1';input.setAttribute('aria-label',t('跳转页码'));jump.append(input,totalLabel);nav.append(numbers,jump);grid.after(nav);
   const probe=nav.cloneNode(false);probe.classList.add('risk-pager-probe');probe.hidden=false;probe.setAttribute('aria-hidden','true');document.body.append(probe);
   const c={...spec,nav,numbers,jump,input,totalLabel,probe,items:[],positions:new Map(),page:1,size:1,columns:2,pages:1,all:true,pagerHeight:0,stamp:'',measurements:new Map()};
   const button=(text,number,label)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.className=number?'risk-page-number':'risk-page-arrow';if(number){b.dataset.page=number;if(number===c.page)b.setAttribute('aria-current','page');}else b.dataset.direction=text==='◀'?'-1':'1';return b;};
   function controls(target,page,total,all){
    target.replaceChildren();const prev=button('◀',0,t('上一页'));prev.disabled=page===1;target.append(prev);
    for(const n of pageNumbers(page,total,all)){const b=button(String(n),n,t`第 ${n} 页`);if(n===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');target.append(b);}
    const next=button('▶',0,t('下一页'));next.disabled=page===total;target.append(next);
   }
   c.measure=total=>{
    if(total<=1)return {height:0,all:true};
    const compact=host.classList.contains('risk-pagination-compact-pagers');probe.classList.toggle('risk-pager-tight',compact);
    const width=grid.getBoundingClientRect().width,key=total+'|'+width+'|'+compact;if(c.measurements.has(key))return c.measurements.get(key);
    probe.style.width=width+'px';probe.replaceChildren();const sample=button(String(total),total,''),arrow=button('◀',0,'');probe.append(sample,arrow);const numberWidth=sample.getBoundingClientRect().width,arrowWidth=arrow.getBoundingClientRect().width,gap=parseFloat(getComputedStyle(probe).columnGap)||0,style=getComputedStyle(sample);
    const chrome=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth),digit=(numberWidth-chrome)/String(total).length;
    // Tabular digits let us sum natural text widths without creating every
    // page number. Short labels consume only their actual glyphs and padding.
    let digits=0;for(let low=1,length=1;low<=total;low*=10,length++)digits+=(Math.min(total,low*10-1)-low+1)*length;
    const all=total*chrome+digits*digit+2*arrowWidth+(total+1)*gap<=width-.5;
    const row=document.createElement('div');row.className='risk-page-numbers';probe.replaceChildren(row);
    // Reserve the largest neighborhood, so changing pages cannot grow the
    // pager even though the actual labels retain their natural text widths.
    if(all)controls(row,1,total,true);else{const prev=button('◀',0,'');row.append(prev);for(let i=0;i<Math.min(total,7);i++)row.append(button(String(total),total,''));row.append(button('▶',0,''));}
    if(!all){const form=jump.cloneNode(true);form.hidden=false;probe.append(form);}
    const result={height:Math.ceil(probe.getBoundingClientRect().height),numbers:Math.ceil(row.getBoundingClientRect().height),all};c.measurements.set(key,result);if(c.measurements.size>32)c.measurements.delete(c.measurements.keys().next().value);return result;
   };
   c.render=()=>{
    c.pages=Math.max(1,Math.ceil(c.items.length/c.size));c.page=Math.min(c.pages,Math.max(1,c.page));
    const stamp=[c.page,c.size,c.empty,c.revision].join('|');
    if(c.stamp!==stamp){
     c.stamp=stamp;grid.replaceChildren();
     for(const [x,y]of c.items.slice((c.page-1)*c.size,c.page*c.size)){
      const b=document.createElement('button'),key=x+','+y;b.type='button';b.textContent=x+', '+y;b.dataset.key=key;b.classList.toggle('selected',selected===key);
      const cell=c.lookup?.get(key);if(c.title&&cell)b.title=c.title(cell);b.onclick=()=>{const value=c.lookup?.get(key);if(value)onFocus(value,c);};grid.append(b);
     }
     if(!c.items.length)grid.textContent=c.empty||'';
    }
    nav.hidden=c.pages<=1;numbers.style.minHeight=(c.numbersHeight||0)+'px';
    if(c.pages>1){controls(numbers,c.page,c.pages,c.all);jump.hidden=c.all;input.max=String(c.pages);if(document.activeElement!==input)input.value=String(c.page);totalLabel.textContent='/ '+c.pages;nav.style.minHeight=c.pagerHeight+'px';}
   };
   c.go=page=>{if(!Number.isInteger(page)||page<1||page>c.pages||page===c.page)return;c.page=page;c.render();};
   // A pending input blur must not replace the button between pointer-down and
   // click. Explicit page navigation supersedes that input draft.
   numbers.onpointerdown=e=>{if(document.activeElement===input&&e.target.closest('button'))e.preventDefault();};
   numbers.onclick=e=>{const b=e.target.closest('button');if(!b||b.disabled)return;const page=b.dataset.page?Number(b.dataset.page):c.page+Number(b.dataset.direction);if(document.activeElement===input){input.value=String(c.page);input.blur();}c.go(page);};
   const commit=()=>{const value=Number(input.value);if(input.value.trim()&&Number.isInteger(value)&&value>=1&&value<=c.pages)c.go(value);else input.value=String(c.page);};jump.onsubmit=e=>{e.preventDefault();commit();};input.onchange=commit;input.onblur=commit;
   return c;
  });
  function layout(){
   frame=null;if(disposed||host.hidden||!host.getClientRects().length||!aside.clientHeight)return;
   host.classList.remove('risk-pagination-tight','risk-pagination-compact-pagers');
   const style=getComputedStyle(aside),top=host.getBoundingClientRect().top-aside.getBoundingClientRect().top-aside.clientTop,mobile=matchMedia('(max-width:1000px)').matches||!!document.querySelector('.toy')&&matchMedia('(pointer:coarse) and (max-width:1100px), (orientation:landscape) and (max-height:600px) and (max-width:1200px)').matches;
   // Auto-height mobile asides use one viewport of coordinates instead of
   // creating thousands of DOM rows and an extremely long document.
   const budget=(mobile?Math.max(360,innerHeight-32):aside.clientHeight)-top-parseFloat(style.paddingBottom);
   const active=controllers.filter(c=>c.items.length&&c.grid.getClientRects().length);let dynamic=active.reduce((sum,c)=>sum+c.grid.getBoundingClientRect().height+(c.nav.hidden?0:c.nav.getBoundingClientRect().height),0);
   let available=Math.max(0,budget-host.getBoundingClientRect().height+dynamic-2);
   const metrics=active.map(c=>{
    c.columns=Math.max(1,getComputedStyle(c.grid).gridTemplateColumns.split(' ').filter(Boolean).length);const b=c.grid.querySelector('button');
    return {c,unit:(b?.getBoundingClientRect().height||32)+(parseFloat(getComputedStyle(c.grid).rowGap)||0),gap:parseFloat(getComputedStyle(c.grid).rowGap)||0,rows:Math.ceil(c.items.length/c.columns)};
   });
   if(metrics.reduce((sum,m)=>sum+m.rows*m.unit-m.gap,0)<=available){for(const m of metrics){m.c.size=m.c.items.length;m.c.page=1;m.c.pagerHeight=0;m.c.all=true;m.c.render();}return;}
   // Short panels can leave less room than one row plus both pagers. Reclaim
   // heading spacing before reducing the lists to that minimum.
   if(metrics.reduce((sum,m)=>sum+m.unit-m.gap+m.c.measure(Math.ceil(m.c.items.length/m.c.columns)).height,0)>available){
    host.classList.add('risk-pagination-tight');if(active.length>=3)host.classList.add('risk-pagination-compact-pagers');
    dynamic=active.reduce((sum,c)=>sum+c.grid.getBoundingClientRect().height+(c.nav.hidden?0:c.nav.getBoundingClientRect().height),0);available=Math.max(0,budget-host.getBoundingClientRect().height+dynamic-2);
   }
   // Start with worst-case pagers, then reclaim spare rows from short lists.
   let remaining=available,waiting=metrics.slice();
   for(const m of waiting){m.pager=m.c.measure(Math.ceil(m.c.items.length/m.c.columns));remaining-=m.pager.height;}
   const assigned=new Map();
   while(waiting.length){const share=remaining/waiting.length,short=waiting.filter(m=>m.rows*m.unit-m.gap<=share);
    if(!short.length)break;for(const m of short){assigned.set(m,m.rows);remaining-=m.rows*m.unit-m.gap;waiting.splice(waiting.indexOf(m),1);}
   }
   for(const m of waiting)assigned.set(m,Math.max(1,Math.floor((remaining/waiting.length+m.gap)/m.unit)));
   let used=0;
   for(const m of metrics){m.assigned=assigned.get(m);m.pager=m.c.measure(Math.ceil(m.c.items.length/Math.min(m.c.items.length,m.assigned*m.c.columns)));used+=m.assigned*m.unit-m.gap+m.pager.height;}
   // Spend rounding remainders and space reclaimed by smaller page counts.
   let grew=true;while(grew){grew=false;for(const m of metrics)if(m.assigned<m.rows){
    const pager=m.c.measure(Math.ceil(m.c.items.length/Math.min(m.c.items.length,(m.assigned+1)*m.c.columns))),cost=m.unit+pager.height-m.pager.height;
    if(used+cost<=available){m.assigned++;m.pager=pager;used+=cost;grew=true;}
   }}
   for(const m of metrics){const c=m.c,size=Math.min(c.items.length,m.assigned*c.columns),at=c.positions.get(selectedCode),anchor=at!==undefined&&Math.floor(at/c.size)===c.page-1?at:(c.page-1)*c.size;c.size=size;c.page=Math.floor(anchor/size)+1;
    const pages=Math.ceil(c.items.length/size),pager=c.measure(pages);c.pagerHeight=pager.height;c.numbersHeight=pager.numbers;c.all=pager.all;c.render();}
  }
  function schedule(){if(frame===null)frame=requestAnimationFrame(layout);}
  const resize=new ResizeObserver(schedule);resize.observe(aside);resize.observe(host);
  const mutation=new MutationObserver(records=>{if(records.some(r=>r.attributeName==='open'||r.target===host||r.target.id==='riskLists'||r.target.id==='seaLandLists'))schedule();});mutation.observe(host,{attributes:true,subtree:true,attributeFilter:['open','hidden']});window.addEventListener('resize',schedule);
  // Risk arrays may mutate in place. Immutable geographic lists keep their
  // coordinate index when only those risk arrays change.
  function set(specs,changed=false){for(let i=0;i<controllers.length;i++){const c=controllers[i],spec=specs[i];if(changed&&!spec.immutable||c.items!==spec.items){c.items=spec.items;c.positions=new Map();for(let n=0;n<c.items.length;n++){const[x,y]=c.items[n];c.positions.set(y*512+x,n);}c.revision=(c.revision||0)+1;}c.lookup=spec.lookup;c.empty=spec.empty;c.size=Math.max(c.columns,Math.min(c.size,c.items.length||c.columns));c.render();}schedule();}
  function select(key){selected=key;selectedCode=key===null?null:key.split(',').map(Number).reduce((x,y,i)=>i?x+y*512:y,0);for(const c of controllers){const at=c.positions.get(selectedCode);if(at!==undefined&&Math.floor(at/c.size)!==c.page-1){c.page=Math.floor(at/c.size)+1;c.render();}for(const b of c.grid.children)b.classList.toggle('selected',b.dataset.key===key);}schedule();}
  return {set,select,schedule,get status(){return controllers.map(c=>({page:c.page,pages:c.pages,size:c.size,total:c.items.length,allPages:c.all,nodes:c.grid.childElementCount}));},dispose(){disposed=true;if(frame!==null)cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();window.removeEventListener('resize',schedule);for(const c of controllers)c.probe.remove();}};
 }
 const api={create,pageNumbers};root.CrateRiskPagination=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
