/* Keep one parsed layout per preview worker; tile requests only select a view. */
(function(root){'use strict';
 function create(parse,presentation){
  let source=null,plan=null,sourceKey=null,planKey=null,cached=null;
  function get(data,stock){
   const keyed=data.previewSourceKey!=null&&data.previewPlanKey!=null;
   if(keyed){
    if(data.source){source=data.source;sourceKey=data.previewSourceKey;cached=null;}
    if(data.plan){plan=data.plan;planKey=data.previewPlanKey;cached=null;}
    if(!source||sourceKey!==data.previewSourceKey||planKey!==data.previewPlanKey)throw Error('Preview layout cache miss');
   }else{source=data.source;plan=data.plan;cached=null;}
   const key=JSON.stringify([data.version,data.minerals,data.filename,sourceKey,planKey]);
   if(!cached||cached.key!==key){
    const parsed=parse(new Uint8Array(),stock,data.version,data.minerals,data.filename,()=>{},{source,plan});
    cached={key,parsed,rendering:presentation(parsed)};
   }
   const{parsed,rendering}=cached;
   if(!data.box)return{metadata:parsed.metadata,rendering,cells:parsed.cells};
   const[x,y,w,h]=data.box,[ox,oy]=rendering.origin;
   const cells=parsed.cells.filter(c=>{const px=30*(c.x-c.y)+ox,py=15*(c.x+c.y-c.level)+oy;return px>=x-360&&px<=x+w+360&&py>=y-360&&py<=y+h+360;});
   const points=new Set(cells.map(c=>c.x+','+c.y)),objects=[],visual=[];
   rendering.simplified.objects.forEach((o,i)=>{if(points.has(o[0]+','+o[1])){objects.push(o);visual.push(rendering.visualObjects[i]);}});
   // Never trim the cached arrays: subsequent tiles may lie outside this box.
   return{metadata:parsed.metadata,cells,rendering:{...rendering,simplified:{...rendering.simplified,objects},visualObjects:visual}};
  }
  return{get};
 }
 const api={create};root.CrateLivePreview=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
