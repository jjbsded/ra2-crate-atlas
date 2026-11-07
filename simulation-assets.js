(function(root){
 'use strict';
 let loaded,active=0;const images=new Map(),waiting=[];
 async function limited(fn){if(active>=3)await new Promise(resolve=>waiting.push(resolve));active++;try{return await fn();}finally{active--;waiting.shift()?.();}}
 const catalog=()=>loaded||(loaded=(root.CrateMapPlatform?root.CrateMapPlatform.readJSON('simulation-assets/catalog.json'):fetch('simulation-assets/catalog.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Simulation materials unavailable');return r.json();})).catch(e=>{loaded=null;throw e;}));
 async function prepare(source){const data=await catalog(),version=['ra2','yr'].includes(source.version)?source.version:'yr',scope=data.scopes[version+'/'+source.map.MAP.THEATER.toUpperCase()];source.simulationAssets={...scope,labels:data.labels?.[version]||{},allowOre:source.allowOre||scope?.allowOre||{}};return data;}
 async function image(record){if(!record)return null;if(!images.has(record.file))images.set(record.file,limited(async()=>{const im=new Image();im.src=new URL('simulation-assets/'+record.file,document.baseURI).href;await im.decode();return im;}).catch(e=>{images.delete(record.file);throw e;}));return {...record,image:await images.get(record.file)};}
 async function get(source,choice,{icon=false,frame=0}={}){const data=await catalog(),version=source.version==='ra2'?'ra2':'yr';if(icon){const icons=root.CrateI18n?.language==='en'?data.localizedIcons?.en?.[version]:null;const record=choice.tree?data.menuIcons?.tree:choice.ore?data.menuIcons?.ore:icons?.[choice.type]||data.icons[version]?.[choice.type];if(record)return image(record);}return image(source.simulationAssets?.sprites[choice.type]?.[String(frame)]);}
 async function toolIcon(tool){const data=await catalog(),record=data.toolIcons?.[tool];return image(record?{...record,file:record.file+'?v='+(record.sha256||record.source.sha256).slice(0,16)+'-'+record.source.frame}:null);}
 root.CrateSimulationAssets={catalog,prepare,get,toolIcon};
})(globalThis);
