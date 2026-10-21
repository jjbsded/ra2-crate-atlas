/* Offline teaching scenes use the same 3D viewer as map inspection. */
(function(){
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const $=id=>document.getElementById(id);
 let bundle=null,scene=null,selected={x:98,y:106};
 const viewer=CrateTerrain3D.create({embedded:true,getContext:()=>({cell:selected}),
  loadPatch:()=>scene,onSelect:(x,y)=>{selected={x,y};}});
 function select(x,y){selected={x,y};viewer.select(selected);}
 async function changeScene(){
  if(!bundle)return;
  const single=$('cliffScene').value==='single';
  scene=single?{...bundle.single,textures:bundle.real.textures}:bundle.real;
  selected=single?{x:98,y:106}:{x:99,y:105};
  $('cliffExamples').hidden=!single;
  $('terrain3dDecorations').closest('label').hidden=single;
  $('terrain3dRelief').closest('label').hidden=single;
  document.body.dataset.scene=single?'single':'real';
  $('cliffSceneNote').textContent=single?_t('一个高格比周围高 4 级：点击“孤立高格”查看六个判定位置，再选择“Rough 例外”预览放箱前后的变化。'):_t('冰天雪地的原始雪地贴图与高度，中心为 (99, 105)；选中粉色格，预览放箱后 Rough → Rock 的变化。');
  await viewer.open();
 }
 $('cliffScene').onchange=changeScene;
 $('cliffHigh').onclick=()=>select(98,106);
 $('cliffRough').onclick=()=>select(99,105);
 $('cliffClear').onclick=()=>select(98,107);
 $('cliffOutside').onclick=()=>select(102,102);
 async function load(){
  $('cliffReload').disabled=true;$('cliffLoadError').textContent='';$('cliffScene').disabled=true;
  try{
   const response=await fetch('examples/cliff-demo.json');if(!response.ok)throw Error(_t('内置演示数据缺失，请检查工具文件是否完整。'));
   bundle=await response.json();_i18n?.diagnostics(bundle.real);_i18n?.diagnostics(bundle.single);if(bundle.schema!==1||!bundle.real?.cells||!bundle.single?.cells)throw Error(_t('内置演示数据格式不正确。'));
   $('cliffScene').disabled=false;await changeScene();
  }catch(error){$('cliffLoadError').textContent=error.message;}
  finally{$('cliffReload').disabled=false;}
 }
 $('cliffReload').onclick=()=>bundle?changeScene():load();
 window.addEventListener('pagehide',()=>viewer.dispose());
 window.addEventListener('pageshow',event=>{if(event.persisted&&bundle)changeScene();});
 load();
})();
