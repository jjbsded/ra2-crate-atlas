/* One chronological edit timeline; each editor owns its actual snapshots. */
(function(root){
 'use strict';
 function create({limit=100,onTravel=()=>{},onError=()=>{}}={}){
  const channels=new Map(),listeners=new Set();let past=[],future=[],running=false,epoch=0,last='';
  const allowed=entry=>!!entry&&(channels.get(entry.channel)?.ready?.()??true);
  const status=()=>({canUndo:!running&&allowed(past.at(-1)),canRedo:!running&&allowed(future.at(-1)),undoLabel:past.at(-1)?.label||'',redoLabel:future.at(-1)?.label||'',busy:running});
  function refresh(){const value=status(),key=JSON.stringify(value);if(key===last)return;last=key;for(const fn of listeners)fn(value);}
  function clear(channel){past=past.filter(e=>e.channel!==channel);future=future.filter(e=>e.channel!==channel);refresh();}
  function record(channel,label){
   const owner=channels.get(channel);if(!owner)throw Error('Unknown history channel: '+channel);
   future=[];for(const value of channels.values())value.clearRedo?.();
   past.push({channel,label});
   let count=0;for(let i=past.length-1;i>=0;i--)if(past[i].channel===channel&&++count>(owner.limit||limit))past.splice(i,1);
   if(past.length>limit)past.splice(0,past.length-limit);refresh();
  }
  async function travel(redo){
   if(running)return false;
   for(const owner of channels.values())owner.prepare?.();
   const from=redo?future:past,to=redo?past:future,entry=from.at(-1);
   if(!allowed(entry))return false;
   const ticket=epoch;running=true;refresh();
   try{
    const applied=await channels.get(entry.channel)[redo?'redo':'undo']();
    if(ticket!==epoch||applied===false)return false;
    // A new edit invalidates a redo branch while an async editor prepares.
    if(from!==(redo?future:past)||from.at(-1)!==entry)return false;
    from.pop();to.push(entry);onTravel({redo,label:entry.label,channel:entry.channel});return true;
   }catch(error){onError(error);return false;}
   finally{if(ticket===epoch){running=false;refresh();}}
  }
  return {register(channel,owner){channels.set(channel,owner);refresh();},record,clear,refresh,
   subscribe(fn){listeners.add(fn);fn(status());return()=>listeners.delete(fn);},
   reset(){epoch++;running=false;past=[];future=[];for(const value of channels.values())value.clearRedo?.();refresh();},
   undo:()=>travel(false),redo:()=>travel(true),get status(){return status();}};
 }
 function createNotices({host=root.document.body,hold=3000}={}){
  const list=root.document.createElement('div');list.className='edit-history-notices';list.setAttribute('role','log');list.setAttribute('aria-live','polite');list.setAttribute('aria-relevant','additions');host.append(list);
  return text=>{
   const item=root.document.createElement('div');item.className='edit-history-notice';item.textContent=text;list.append(item);
   item.style.height=item.getBoundingClientRect().height+'px';
   root.setTimeout(()=>{item.classList.add('leaving');root.setTimeout(()=>item.remove(),330);},hold);
  };
 }
 const api={create,createNotices};root.CrateEditHistory=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
