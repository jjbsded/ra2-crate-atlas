/* Brief recovery priority, shared by cooperative UI work. No cache eviction. */
(function(root){
 'use strict';
 function create({warm=null,canWarm=()=>true,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,frame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),minimumIdle=1000,quietTime=180,inputTime=350}={}){
  let awayAt=null,until=0,armed=0,firstUntil=0,inputActive=false,timer=null,warmFrame=null,iterator=null,announced=false;
  const waiters=new Set(),listeners=new Set(),stats={resumes:0,warmed:0,warmParts:0,cancelledWarmups:0,protectedInputs:0,maxWarmPartMs:0};
  const blocked=()=>now()<until;
  function signal(){const value=blocked();if(value!==announced){announced=value;for(const fn of listeners)fn(value);}if(!value){for(const resolve of waiters)resolve();waiters.clear();}}
  function armTimer(){clearTimer(timer);timer=null;if(blocked())timer=setTimer(()=>{timer=null;if(blocked())armTimer();else signal();},Math.max(1,until-now()));signal();}
  function cancelWarm(){if(warmFrame!==null)cancelFrame(warmFrame);warmFrame=null;if(iterator){iterator.return?.();iterator=null;stats.cancelledWarmups++;}}
  function warmStep(){
   warmFrame=null;if(!iterator)return;if(inputActive||!canWarm()){cancelWarm();return;}
   if(root.navigator?.scheduling?.isInputPending?.({includeContinuous:true})){warmFrame=frame(warmStep);return;}
   const start=now();let next;
   try{next=iterator.next();}catch(error){cancelWarm();root.console?.warn('Viewport recovery warmup:',error);return;}
   stats.maxWarmPartMs=Math.max(stats.maxWarmPartMs,now()-start);
   if(next.done){iterator=null;stats.warmed++;}else{stats.warmParts++;warmFrame=frame(warmStep);}
  }
  function leave(){if(awayAt===null)awayAt=now();cancelWarm();inputActive=false;armed=firstUntil=until=0;clearTimer(timer);timer=null;signal();}
  function resume(){
   if(awayAt===null)return false;const elapsed=now()-awayAt;awayAt=null;
   if(elapsed<minimumIdle)return false;
   stats.resumes++;until=Math.max(until,now()+quietTime);armed=now()+1200;inputActive=false;armTimer();
   if(warm&&canWarm()){iterator=warm();if(iterator)warmFrame=frame(warmStep);}return true;
  }
  function input(){
   if(now()>armed||!armed)return false;armed=0;cancelWarm();inputActive=true;firstUntil=now()+inputTime;until=Math.max(until,Math.min(firstUntil,now()+180));stats.protectedInputs++;armTimer();return true;
  }
  function move(){if(!inputActive||now()>=firstUntil)return;until=Math.max(until,Math.min(firstUntil,now()+100));armTimer();}
  function end(){if(!inputActive)return;inputActive=false;until=Math.min(until,now()+60);armTimer();}
  return {leave,resume,input,move,end,configure(options){if(options.warm)warm=options.warm;if(options.canWarm)canWarm=options.canWarm;},get blocked(){return blocked();},wait(){return blocked()?new Promise(resolve=>waiters.add(resolve)):Promise.resolve();},subscribe(fn){listeners.add(fn);fn(blocked());return()=>listeners.delete(fn);},get status(){return {...stats,blocked:blocked(),waiting:waiters.size,warming:!!iterator,remainingMs:Math.max(0,until-now())};}};
 }
 const api={create};root.CrateInteractionPriority=api;root.CrateMapPriority=create();if(typeof module!=='undefined')module.exports=api;
})(globalThis);
