/* Keep the user's resource choice separate from the last map's displayed version. */
(function(root){
 'use strict';
 const suggest=filename=>/\.yrm$/i.test(filename||'')?'yr':/\.mpr$/i.test(filename||'')?'ra2':null;
 function create(select){
  let choice='auto',showing=false;
  select.addEventListener('change',()=>{if(!showing)choice=select.value;});
  function show(value){showing=true;try{select.value=value;select.dispatchEvent(new Event('change'));}finally{showing=false;}}
  return {get choice(){return choice;},suggest,show,use(value){choice=value;show(value);}};
 }
 const api={suggest,create};root.CrateMapImportVersion=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
