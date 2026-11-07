/* Structured local recovery and fatal-error context; map text stays plain text. */
(function(root){
 'use strict';
 function collect(){
  const issues=[],groups=new Map();
  function issue(message,cell=null,detail={}){
   const context=Object.entries(detail).filter(([k,v])=>!['action','code'].includes(k)&&v!==undefined).map(([k,v])=>`${k}=${v}`).join(' · '),action=detail.action||'选中该格时放置失败 / Placement fails on landing',text=[message,context,action].filter(Boolean).join(' · '),key=JSON.stringify([message,detail]);
   let group=groups.get(key);if(!group){group={row:{...detail,message:text,count:0,cells:[]},positions:new Set()};groups.set(key,group);issues.push(group.row);}const row=group.row;row.count++;
   if(cell){const p=[cell.x,cell.y],position=p.join(',');if(!group.positions.has(position)){group.positions.add(position);row.cells.push(p);}cell.assumedRetry=true;cell.retryAssumptions||=[];if(!cell.retryAssumptions.includes(text))cell.retryAssumptions.push(text);}
   return text;
  }
  return {issues,issue};
 }
 function context(error,detail){if(!(error instanceof Error))error=Error(String(error));error.context={...detail,...error.context};const text=Object.entries(detail).map(([k,v])=>`${k}=${v}`).join(' · ');error.message=`${error.message} · ${text}`;return error;}
 const api={collect,context};root.CrateLiveDiagnostics=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
