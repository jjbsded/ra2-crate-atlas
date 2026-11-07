/* Bridge damage units, not connected-component deletion. See docs/simulation-mode.md. */
(function(root){
 'use strict';
 const key=(x,y)=>`${x},${y}`,high=new Set([24,25,237,238]);
 function low(index){const base=index>=205&&index<=232?205:index>=74&&index<=101?74:null;if(base===null)return null;const n=index-base;return {base,axis:n<=8||n>=18&&n<=21||n===26?'x':'y'};}
 function segments(source,lookup){const out=[],seen=new Set();
  for(const[p,c]of lookup){if(high.has(c.overlay)){const axis=[24,237].includes(c.overlay)?'x':'y',cells=[];for(const n of [-1,0,1,2]){const q=key(c.x-(axis==='y'?n:0),c.y-(axis==='x'?n:0));if(lookup.has(q))cells.push(q);}out.push({id:p,kind:'high',x:c.x,y:c.y,axis,owners:[p],cells});continue;}
   const info=low(c.overlay);if(!info)continue;const width=info.axis==='x'?[0,1]:[1,0],at=n=>lookup.get(key(c.x+n*width[0],c.y+n*width[1])),same=v=>low(v?.overlay)?.base===info.base;
   // YR 57BAA0/57CCF0 locate the centre of the three-cell-wide strip.
   const shift=!same(at(-1))?1:same(at(-2))?-1:0,x=c.x+shift*width[0],y=c.y+shift*width[1],id=key(x,y);if(seen.has(id))continue;seen.add(id);
   const cells=[-1,0,1].map(n=>key(x+n*width[0],y+n*width[1])).filter(q=>same(lookup.get(q)));out.push({id,kind:'low',x,y,...info,owners:cells,cells});
  }return out;
 }
 function edit(segments,lookup,targets,write,restore=false){const byId=new Map(segments.map(s=>[s.id,s])),at=new Map(),fallen=new Set();for(const s of segments)for(const p of s.cells)at.set(p,s);
  const chosen=new Set([...targets].map(p=>at.get(p)).filter(Boolean));const get=s=>lookup.get(s.id),neighbor=(s,d)=>byId.get(key(s.x+(s.axis==='x'?d:0),s.y+(s.axis==='y'?d:0)));
  function set(p,index,frame){const c=lookup.get(p);if(!c)return;write(p,[index,frame]);c.overlay=index;c.overlayData=frame;}
  function setStrip(s,index){for(const p of s.cells){const c=lookup.get(p);set(p,index,c.overlayData);}if(index===s.base+26||index===s.base+27)for(const p of s.cells)fallen.add(p);}
  function highEdge(s,d){const n=neighbor(s,d);if(!n||n.kind!=='high'||n.axis!==s.axis||!high.has(get(n)?.overlay))return;const c=get(n),vertical=s.axis==='y',edge=vertical?(d>0?17:16):(d>0?7:8),opposite=vertical?(d>0?16:17):(d>0?8:7);
   if(c.overlayData===opposite){set(n.id,255,0);for(const p of n.cells)fallen.add(p);highEdge(n,d);}else if(c.overlayData<=(vertical?15:6))set(n.id,c.overlay,edge);
  }
  function lowEdge(s){const c=get(s);if(!c||low(c.overlay)?.base!==s.base)return;const n=c.overlay-s.base,rot=s.axis==='y',a=get(neighbor(s,rot?-1:1)||{}),b=get(neighbor(s,rot?1:-1)||{}),offset=rot?9:0;
   const av=a?a.overlay-s.base:-1,bv=b?b.overlay-s.base:-1;
   const mask=([4+offset,6+offset,8+offset,rot?23:19].includes(av)?1:[7+offset,rot?27:26].includes(av)?2:0)|([5+offset,6+offset,7+offset,rot?25:21].includes(bv)?4:[8+offset,rot?27:26].includes(bv)?8:0);
   if(!mask)return;let value;if(n<18){const table={1:5,2:8,4:4,5:6,6:8,8:7,9:7,10:rot?18:26};value=table[mask];if(value===undefined)return;value+=offset;}else if([18,20,22,24].includes(n))value=n+1;else return;
   setStrip(s,s.base+value);
  }
  if(restore){
   for(const s of chosen)for(const p of s.cells){const original=restore.get(p);set(p,original.overlay,original.overlayData);}
   // Reset only neighbouring edge artwork; retain other collapsed segments.
   const edges=new Set();for(const s of chosen)for(const d of [-1,0,1]){const n=d?neighbor(s,d):s;if(n)edges.add(n);}
   for(const s of edges){const c=get(s);if(s.kind==='high'?high.has(c?.overlay):c&&![s.base+26,s.base+27].includes(c.overlay))for(const p of s.owners){const o=restore.get(p);set(p,o.overlay,o.overlayData);}}
   for(const s of edges){const c=get(s);if(s.kind==='high'){if(high.has(c?.overlay))for(const d of [-1,1]){const n=neighbor(s,d);if(n&&!high.has(get(n)?.overlay)){const edge=s.axis==='y'?(d<0?17:16):(d<0?7:8);set(s.id,c.overlay,edge);}}}
    else if(c&&![s.base+26,s.base+27].includes(c.overlay))lowEdge(s);
   }
  }else for(const s of chosen){const c=get(s);if(!c)continue;if(s.kind==='high'){if(!high.has(c.overlay))continue;const f=c.overlayData;set(s.id,255,0);for(const p of s.cells)fallen.add(p);if(![8,16].includes(f))highEdge(s,1);if(![7,17].includes(f))highEdge(s,-1);}
   else {const n=c.overlay-s.base;if(n<0||n>27)continue;const value=n<18?(s.axis==='x'?26:27):[18,20,22,24].includes(n)?n+1:n;setStrip(s,s.base+value);for(const d of [-1,1]){const next=neighbor(s,d);if(next?.kind==='low'&&next.base===s.base&&next.axis===s.axis)lowEdge(next);}}
  }
  return {fallen,selected:[...chosen].flatMap(s=>s.cells)};
 }
 root.CrateSimulationBridges={segments,edit};if(typeof module!=='undefined')module.exports=root.CrateSimulationBridges;
})(globalThis);
