/* Own one numeric worker source; client records already own their source DTO. */
(function(root){'use strict';
 function create(){let key=null,source=null;
  const token=data=>data.analysisSourceKey==null?null:JSON.stringify([data.analysisSourceKey,data.version]);
  function input(data){
   // Asset preparation happens on the client after the initial raw analysis.
   // Refresh these small fields without cloning packed map/rules/cell data.
   const context=value=>value&&data.sourceContext?{...value,simulationAssets:data.sourceContext.simulationAssets,allowOre:data.sourceContext.allowOre}:value;
   const next=token(data);if(next===null)return context(data.source);
   if(data.source){key=next;source=context(data.source);return source;}
   if(data.bytes?.byteLength)return null;
   if(next!==key||!source)throw Error('Analysis source cache miss');
   source=context(source);return source;
  }
  function output(data,result){
   const next=token(data);if(next!==null){key=next;source=result.source;}
   if(data.omitSource)delete result.source;
  }
  return{input,output};
 }
 const api={create};root.CrateLiveAnalysisSource=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
