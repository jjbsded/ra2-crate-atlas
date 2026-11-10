/* Keep numeric drafts intact. Reject unusable values; never clamp a setting. */
(function(root){
 'use strict';
 function bind(input,{get,set,valid=()=>true}){
  function apply(){
   const raw=input.value.trim(),value=Number(raw);
   if(!raw||input.validity?.badInput){input.setCustomValidity?.('');return false;}
   if(!Number.isFinite(value)||!valid(value)){input.setCustomValidity?.(root.CrateI18n?.t('请输入有效数值')||'请输入有效数值');return false;}
   input.setCustomValidity?.('');if(value!==get())set(value);return true;
  }
  function commit(){if(!apply())input.value=String(get());input.setCustomValidity?.('');}
  input.oninput=apply;input.onchange=input.onblur=commit;
  return {apply,commit,sync(){input.value=String(get());input.setCustomValidity?.('');}};
 }
 const api={bind};root.CrateNumericInput=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
