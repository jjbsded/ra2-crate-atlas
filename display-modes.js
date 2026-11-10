/* Shared display states and reversible button cycles. */
(function(root){
 'use strict';
 const order=['crate','buff','units','off'],names={crate:'箱子',buff:'Buff期望',units:'模拟单位Buff',off:'关'};
 function next(value,direction=1,available=order){const index=available.indexOf(value);return available[((index<0?0:index)+(direction<0?-1:1)+available.length)%available.length];}
 function bind(button,change){if(!button)return;button.onclick=()=>{if(!button.disabled)change(1);};button.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();if(!button.disabled)change(-1);};}
 function reverseToggle(button){if(!button)return;button.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(!button.disabled)button.click();});}
 const api={order,names,next,bind,reverseToggle};root.CrateDisplayModes=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
