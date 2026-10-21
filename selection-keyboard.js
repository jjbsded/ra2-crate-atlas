/* Timed arrow-key chords. Independent of browser key-repeat settings. */
(function(root){
 'use strict';
 const arrows=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
 function create({move,enabled=()=>true,setTimer=setTimeout,clearTimer=clearTimeout,chordDelay=90,firstRepeatDelay=260,repeatDelay=120}){
  const held=new Set();let timer=null,mode=null,pending=null,moved=false;
  const direction=()=>({horizontal:Number(held.has('ArrowRight'))-Number(held.has('ArrowLeft')),vertical:Number(held.has('ArrowDown'))-Number(held.has('ArrowUp'))});
  function stopTimer(){if(timer!==null)clearTimer(timer);timer=null;}
  function cancel(){stopTimer();held.clear();mode=null;pending=null;moved=false;}
  function emit(d){if(d&&(d.horizontal||d.vertical))move(d);}
  function schedule(nextMode,delay){stopTimer();mode=nextMode;timer=setTimer(tick,delay);}
  function tick(){
   timer=null;if(!enabled()||!held.size){cancel();return;}
   emit(mode==='chord'?pending:direction());
   const delay=moved?repeatDelay:firstRepeatDelay;moved=true;pending=null;schedule('repeat',delay);
  }
  function down(key,repeat=false){
   if(!arrows.has(key))return false;
   if(!enabled()){cancel();return false;}
   if(repeat||held.has(key))return true;
   if(!held.size)moved=false;
   held.add(key);pending=direction();
   // Keep the first deadline: a slightly later second key changes the first
   // step into a diagonal without an intermediate cardinal step.
   if(mode!=='chord')schedule('chord',chordDelay);
   return true;
  }
  function up(key){
   if(!held.delete(key))return false;
   if(!held.size){
    // Preserve a short tap, including a two-key tap released before 90 ms.
    if(mode==='chord'&&enabled())emit(pending);
    cancel();
   }else if(mode!=='chord'){
    // A pair of keys is rarely released in the same millisecond. Do not
    // accidentally append a cardinal step while the second finger lifts.
    pending=null;schedule('release',chordDelay);
   }
   return true;
  }
  return {down,up,cancel};
 }
 const api={create,arrows};root.CrateSelectionKeyboard=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
