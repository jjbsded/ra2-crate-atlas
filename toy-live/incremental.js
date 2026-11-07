/* Incremental ordered search + integer incidence. Disk storage is disposable,
 * bounded IndexedDB blocks; probability coefficients are shared, never stored
 * as thousands of decimal digits per cell. Full search remains the oracle. */
(function(root){
 'use strict';
 const S=root.CrateLiveSolver||(typeof require==='function'?require('./solver.js'):null),BLOCK=512,memory=new Map();
 const add=(map,key,amount)=>{const n=(map.get(key)||0)+amount;if(n)map.set(key,n);else map.delete(key);};
 const checksum=(...arrays)=>{let h=2166136261;for(const array of arrays)for(const b of new Uint8Array(array.buffer,array.byteOffset,array.byteLength))h=Math.imul(h^b,16777619);return h>>>0;};
 function searchOne(grid,x,y,maximum){const picked=[],movement=grid[y*512+x]&8?2:1;let primary=0,r=0;
  const consider=(cx,cy)=>{if(cx<0||cy<0||cx>=512||cy>=512||picked.length===24)return;const id=cy*512+cx;if(grid[id]&movement){picked.push(id);if(grid[id]&4)primary++;}};
  for(;r<Math.min(maximum+1,32);r++){for(let d=-r;d<=r&&picked.length<24;d++){consider(x+d,y-r);consider(x+d,y+r);}for(let d=1-r;d<r&&picked.length<24;d++){consider(x-r,y+d);consider(x+r,y+d);}if(picked.length===24||primary)break;}
  return{picks:primary?picked.filter(k=>grid[k]&4):picked,radius:Math.min(r,Math.min(maximum+1,32)-1)};
 }
 class Store {
  constructor(maximum,grid,statuses,binary=null,snapshot=null){
   if(!Number.isInteger(maximum)||maximum<1||maximum>510||grid.length!==262144||statuses.length!==262144)throw Error('Invalid incremental dimensions');
   this.maximum=maximum;const N=maximum**2;this.grid=grid.slice();this.statuses=statuses.slice();this.counts=new Uint8Array(N);this.radii=new Uint8Array(N);this.picks=new Uint32Array(N*24);
   if(snapshot){this.counts.set(snapshot.counts);this.radii.set(snapshot.radii);this.picks.set(snapshot.picks);}
   else{let at=0;for(let i=0;i<N;i++){const n=binary[at++];if(n>24||n===undefined||at+n>binary.length)throw Error('Invalid incremental records');this.counts[i]=n;const row=binary.subarray(at,at+n);this.picks.set(row,i*24);at+=n;
     this.radii[i]=!n||(n<24&&!row.some(k=>grid[k]&4))?Math.min(maximum+1,32)-1:row.reduce((r,k)=>Math.max(r,Math.abs((k&511)-(i%maximum+1)),Math.abs((k>>>9)-(Math.floor(i/maximum)+1))),0);
    }if(at!==binary.length)throw Error('Invalid incremental record count');}
   this.terms=new Map();this.ghost=new Map();this.terminal=new Map();this.originCounts=new Map();this.kernel={};this.binary=null;this.dirty=null;
   for(let i=0;i<N;i++){if(this.counts[i]>24||this.radii[i]>=Math.min(maximum+1,32)||this.row(i).some(k=>k>=262144))throw Error('Invalid incremental snapshot');this.contribute(this.row(i),statuses,1);}
  }
  row(i){return this.picks.subarray(i*24,i*24+this.counts[i]);}
  contribute(row,statuses,sign,touched){const n=row.length;add(this.originCounts,n,sign);if(!n)return;
   for(let r=0;r<n;r++){const key=row[r],pair=n*32+r,status=statuses[key];if(status===1||status===2)add(this.terminal,pair,sign);if(status===1){if(!this.terms.has(key))this.terms.set(key,new Map());const terms=this.terms.get(key);add(terms,pair,sign);if(!terms.size)this.terms.delete(key);touched?.add(key);}else if(status===2){add(this.ghost,pair,sign);}}

  }
  update(grid,statuses){const started=performance.now(),maximum=this.maximum,N=maximum**2,sums=new Uint32Array(513*513);let changedInputCells=0;
   for(let y=0;y<512;y++){let row=0;for(let x=0;x<512;x++){const k=y*512+x,changed=grid[k]!==this.grid[k]||statuses[k]!==this.statuses[k];row+=+changed;changedInputCells+=+changed;sums[(y+1)*513+x+1]=sums[y*513+x+1]+row;}}
   const changedRows=[],touched=new Set();let searchedOrigins=0;
   if(changedInputCells)for(let i=0;i<N;i++){const x=i%maximum+1,y=Math.floor(i/maximum)+1,r=this.radii[i],l=Math.max(0,x-r),t=Math.max(0,y-r),right=Math.min(512,x+r+1),b=Math.min(512,y+r+1);
    if(!(sums[b*513+right]-sums[t*513+right]-sums[b*513+l]+sums[t*513+l]))continue;
    const old=this.row(i),{picks,radius}=searchOne(grid,x,y,maximum);searchedOrigins++;const same=old.length===picks.length&&old.every((k,j)=>k===picks[j]);
    if(!same||old.some(k=>this.statuses[k]!==statuses[k])){this.contribute(old,this.statuses,-1,touched);this.contribute(picks,statuses,1,touched);}
    if(!same||radius!==this.radii[i]){this.counts[i]=picks.length;this.radii[i]=radius;this.picks.fill(0,i*24,i*24+24);this.picks.set(picks,i*24);changedRows.push(i);}
   }
   this.grid=grid.slice();this.statuses=statuses.slice();if(changedRows.length)this.binary=null;if(this.dirty)for(const key of touched)this.dirty.add(key);
   return{changedRows,stats:{changedInputCells,searchedOrigins,changedSearchRecords:changedRows.length,touchedDestinations:touched.size,totalOrigins:N,dependencySeconds:(performance.now()-started)/1000}};
  }
  calculate(progress){const result=S.evaluate(this.terms,this.ghost,this.originCounts,this.maximum**2,this.originCounts.get(0)||0,progress,this.kernel,this.dirty,this.terminal);this.dirty=new Set();return result;}
  export(){if(!this.binary){const out=new Uint32Array(this.counts.reduce((s,n)=>s+n,0)+this.counts.length);let at=0;for(let i=0;i<this.counts.length;i++){const row=this.row(i);out[at++]=row.length;out.set(row,at);at+=row.length;}this.binary=out;}return this.binary.slice();}
 }
 function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 function complete(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Cache transaction aborted'));tx.onerror=()=>{};});}
 async function open(){if(!root.indexedDB)return null;const r=indexedDB.open('crate-incremental-probability-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('states',{keyPath:'key'});r.result.createObjectStore('blocks',{keyPath:'key'});};const db=await request(r);db.onversionchange=()=>db.close();return db;}
 async function restore(db,key){if(!db)return null;const tx=db.transaction(['states','blocks']),done=complete(tx),headerRequest=request(tx.objectStore('states').get(key)),blocksRequest=request(tx.objectStore('blocks').getAll(IDBKeyRange.bound(key+':',key+':\uffff'))),[header,blocks]=await Promise.all([headerRequest,blocksRequest]);await done;if(!header)return null;
  if(header.checksum!==checksum(header.grid,header.statuses)||!Number.isInteger(header.maximum)||header.maximum<1||header.maximum>510)throw Error('Invalid probability cache header');
  const N=header.maximum**2,snapshot={counts:new Uint8Array(N),radii:new Uint8Array(N),picks:new Uint32Array(N*24)};if(blocks.length!==Math.ceil(N/BLOCK))throw Error('Incomplete probability cache');
  const seen=new Set();for(const block of blocks){const start=block.index*BLOCK,size=Math.min(BLOCK,N-start);if(!Number.isInteger(block.index)||start<0||size<=0||seen.has(block.index)||block.counts.length!==size||block.radii.length!==size||block.picks.length!==size*24||block.checksum!==checksum(block.counts,block.radii,block.picks))throw Error('Invalid probability cache block');seen.add(block.index);snapshot.counts.set(block.counts,start);snapshot.radii.set(block.radii,start);snapshot.picks.set(block.picks,start*24);}
  const value=new Store(header.maximum,header.grid,header.statuses,null,snapshot);value.revision=header.revision;return value;
 }
 async function save(db,key,value,changedRows){if(!db)return false;const tx=db.transaction(['states','blocks'],'readwrite'),done=complete(tx),states=tx.objectStore('states'),blocks=tx.objectStore('blocks');
  // Re-read revision inside this transaction: another tab may have written a
  // different layout. In that case write every block, not an incompatible delta.
  const r=states.get(key);r.onsuccess=()=>{const all=r.result?.revision!==value.revision||!changedRows,indices=all?Array.from({length:Math.ceil(value.counts.length/BLOCK)},(_,i)=>i):[...new Set(changedRows.map(i=>Math.floor(i/BLOCK)))];
   if(all)blocks.delete(IDBKeyRange.bound(key+':',key+':\uffff'));
   for(const index of indices){const start=index*BLOCK,end=Math.min(start+BLOCK,value.counts.length),counts=value.counts.slice(start,end),radii=value.radii.slice(start,end),picks=value.picks.slice(start*24,end*24);blocks.put({key:key+':'+index,index,counts,radii,picks,checksum:checksum(counts,radii,picks)});}
   value.revision=crypto.randomUUID();states.put({key,revision:value.revision,maximum:value.maximum,grid:value.grid,statuses:value.statuses,used:Date.now(),checksum:checksum(value.grid,value.statuses)});
   const list=states.getAll();list.onsuccess=()=>{for(const old of list.result.sort((a,b)=>b.used-a.used).slice(4)){states.delete(old.key);blocks.delete(IDBKeyRange.bound(old.key+':',old.key+':\uffff'));}};
  };await done;return true;
 }
 async function cached(key,grid,cells,maximum,progress,{force=false,kind='current'}={}){
  const started=performance.now();key=JSON.stringify([S.MODEL,root.location?.href||'test',key,kind]);let value=force?null:memory.get(key),source=value?'memory':'built',db=null;
  const statuses=new Uint8Array(262144);for(const c of cells)statuses[c.y*512+c.x]=c.status==='crate'?1:c.status==='ghost'?2:0;
  try{db=await open();if(!value&&!force){value=await restore(db,key);if(value)source='disk';}}catch{source=value?'memory':'built';}
  let stats,changedRows=null;
  try{
   if(value){({stats,changedRows}=value.update(grid,statuses));}
   else{value=new Store(maximum,grid,statuses,S.search(grid,maximum,progress));stats={changedInputCells:0,searchedOrigins:maximum**2,changedSearchRecords:maximum**2,touchedDestinations:value.terms.size,totalOrigins:maximum**2};}
   const calculated=kind==='current'?value.calculate(progress):null;let persisted=false;
   try{persisted=await save(db,key,value,changedRows);}catch{/* Quota/private mode cannot disable editing. */}
   memory.delete(key);memory.set(key,value);while(memory.size>4)memory.delete(memory.keys().next().value);
   Object.assign(stats,{source:force?'forced-full':source,persisted,coefficientsReused:!!value.kernel.coefficientsReused,evaluatedDestinations:value.kernel.evaluatedDestinations||0,seconds:(performance.now()-started)/1000});
   return{binary:value.export(),calculated,stats};
  }catch(error){memory.delete(key);throw error;}finally{db?.close();}
 }
 const api={Store,searchOne,cached,restore,save,open,clearMemory:()=>memory.clear()};root.CrateIncrementalProbability=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
