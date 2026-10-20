/* Stock assets are bundled. A game directory is optional and scoped to Mod previews. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),dialog=$('resourceDialog');
 let state=null,busy=false;
 function render(){
  const version=$('version').value,mod=version==='directory';
  const ready=mod?state?.mod?.ready:state?.ready?.[version];
  $('loadHeck').textContent=mod?'预览冰天雪地':'分析冰天雪地';
  $('resourceSummary').textContent=mod?(state?.mod?.reason||'预览所选游戏目录 时请设置游戏目录'):
   ready?'内置原版资源已就绪 · 无需设置游戏目录':state?.files?.[version]?.error||state?.files?.ra2?.error||'正在检查内置资源…';
  $('resourceSummary').classList.toggle('ready',!!ready);
  $('builtinStatus').textContent=state?.ready?.yr?'红色警戒 2 / 尤里的复仇资源已内置，读入地图即可使用。':
   Object.values(state?.files||{}).map(f=>f.error).filter(Boolean).join('；')||'正在检查内置资源…';
  $('modStatus').textContent=[state?.mod?.reason,...Object.entries(state?.mod?.sources||{}).map(([name,source])=>name+'：'+(source||'未找到')),...(state?.mod?.warnings||[])].filter(Boolean).join('\n');
 }
 async function refresh(){
  const response=await fetch('/api/resources',{cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.error||'资源设置无法读取');
  state=data;render();return data;
 }
 async function open(){
  $('resourceError').textContent='';$('resourceActivity').textContent='';
  $('modRoot').value=state?.mod?.root||'';
  if(!dialog.open)dialog.showModal();
  try{await refresh();if(document.activeElement!==$('modRoot'))$('modRoot').value=state?.mod?.root||'';}
  catch(e){$('resourceError').textContent=e.message;}
 }
 function setBusy(value){busy=value;for(const id of ['modRoot','modSave','modClear','resourceClose'])$(id).disabled=value;}
 async function save(root){
  if(busy)return;setBusy(true);$('resourceError').textContent='';$('resourceActivity').textContent='正在检查目录…';
  try{
   const response=await fetch('/api/resources/mod',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({root})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'目录设置失败');
   await refresh();$('modRoot').value=data.root||'';$('version').value=data.root?'directory':'yr';render();
   $('resourceActivity').textContent=root.trim()?'Mod 目录已保存。':'已清除 Mod 目录，原版与尤复仍可直接使用。';
  }catch(e){$('resourceError').textContent=e.message;$('resourceActivity').textContent='此前设置保持不变。';}
  finally{setBusy(false);}
 }
 $('resourcesOpen').onclick=open;$('resourceClose').onclick=()=>dialog.close();
 $('modSave').onclick=()=>save($('modRoot').value);$('modClear').onclick=()=>save('');
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('version').addEventListener('change',render);
 window.CrateResourceUI={async ensure(version){
  await refresh();if(version==='directory'?state.mod?.ready:state.ready?.[version])return true;
  await open();$('resourceError').textContent=version==='directory'?'请选择对应游戏版本，并设置所选游戏目录 的游戏目录。':'内置资源不完整，请重新完整解压工具包。';return false;
 }};
 refresh().catch(e=>{$('resourceSummary').textContent=e.message;});
})();
