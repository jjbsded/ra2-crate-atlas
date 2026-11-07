/* Compose existing native frames. No rule inheritance or geometry approximation. */
(function(root){
 'use strict';
 const yes=v=>['YES','TRUE','1'].includes(String(v).toUpperCase());
 function integer(v){const s=String(v).trim();return s.startsWith('$')?parseInt(s.slice(1),16):/h$/i.test(s)?parseInt(s,16):parseInt(s,10)||0;}
 function compose(lib,name,meta){
  if(lib.components?.version!==1)return;
  const scope=lib.components.scopes[name];if(!scope)return;
  const [category,visual,,health,face,mission,upgrades]=JSON.parse(meta.key);
  if(upgrades.length)return;
  const cfg=Object.fromEntries(lib.visualFields.map((k,i)=>[k,visual[i]])),image=cfg.IMAGE;
  const n=(k,d)=>integer(cfg[k]||d),vxl=category==='UNITS'||category==='AIRCRAFT';
  const token=JSON.stringify([category,image,+(category==='INFANTRY'&&yes(cfg.ALTERNATEARCTICART)),+(vxl&&yes(cfg.CONSIDEREDAIRCRAFT)),
   health,category==='STRUCTURES'?0:category==='INFANTRY'?face:Math.floor(face/8),mission,vxl&&mission?String(cfg.UNLOADINGCLASS||'').trim():'']);
  const body=scope.bodies[token];if(!body)return;
  let parts=lib.refs[body[0]].map(r=>r.slice()),turret=[];
  if(health!==0&&yes(cfg.TURRET)&&category==='STRUCTURES'&&cfg.TURRETANIM){
   const facing=Math.floor(face/8),dx=n('TURRETANIMX',0),dy=n('TURRETANIMY',0)-15;
   if(yes(cfg.TURRETANIMISVOXEL)){
    const model=cfg.TURRETANIM,angle=n('FIREANGLE',10),barrel=cfg.VOXELBARRELFILE||(model.endsWith('TUR')?model.slice(0,-3)+'BARL':meta.type.toUpperCase()+'BARL');
    const fetch=(name,fire)=>{const id=scope.voxels[JSON.stringify([name,facing,fire])];return id===undefined?undefined:lib.refs[id].map(r=>[r[0],r[1]+dx,r[2]+dy,body[1],r[4]]);};
    const head=fetch(model,model.includes('TUR')?0:angle);if(head===undefined)return;
    let tube=fetch(barrel,angle);if(tube===undefined){if(scope.voxelFiles.includes(barrel))return;tube=[];}
    // Full painter orders barrel/turret from the original map facing.
    turret=face>=32&&face<160||body[2]?[...head,...tube]:[...tube,...head];
   }else{
    const id=scope.turrets[JSON.stringify([cfg.TURRETANIM,facing,Math.max(1,n('TURRETANIM.IDLEFRAMES',1))])];
    if(id===undefined)return;
    turret=lib.refs[id].map(r=>[r[0],r[1]+dx,r[2]+dy,...r.slice(3)]);
   }
  }else if(yes(cfg.TURRET)&&vxl){
   const entry=scope.vehicles[token];
   if(entry){if(body[3]&&entry[1]!==n('FIREANGLE',10))return;turret=lib.refs[entry[0]].map(r=>r.slice());}
   else if(!body[3]||scope.voxelFiles.includes(body[3]+'TUR')||scope.voxelFiles.includes(body[3]+'BARL'))return;
  }
  parts.push(...turret);
  // Shadows are drawn as a separate final pass; visible parts retain native order.
  if(yes(cfg.NOSHADOW))parts=parts.filter(r=>!r[5]);
  return [...parts.filter(r=>!r[5]),...parts.filter(r=>r[5])];
 }
 root.CrateToyComponents={compose};
 if(typeof module!=='undefined')module.exports=root.CrateToyComponents;
})(globalThis);
