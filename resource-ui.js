/* Directory resources are discovered on demand; only the root is persisted. */
(() => {
 'use strict';
 const _i18n=globalThis.CrateI18n||(typeof require==='function'?require('./i18n.js'):null);
 const _t=_i18n?.t||((s,...v)=>Array.isArray(s)?s.reduce((a,p,i)=>a+(i?v[i-1]:'')+p,''):s);
 const $=id=>document.getElementById(id),dialog=$('resourceDialog');
 let state=null,busy=false,analyzing=false,requestRevision=0,dialogRevision=0,draftRevision=0;
 function render(){
  const choice=$('version').value,version=choice==='auto'?(state?.mod?.configured?'directory':'yr'):choice,mod=version==='directory';
  const ready=mod?state?.mod?.ready:state?.ready?.[version];
  $('loadHeck').textContent=_t('选择官方地图');
  $('resourceSummary').textContent=mod?((state?.mod?.reason||_t('请选择游戏目录'))+(state?.mod?.root?' · '+state.mod.root:'')):
   ready?_t('内置原版资源已就绪 · 无需设置游戏目录'):state?.files?.[version]?.error||state?.files?.ra2?.error||_t('正在检查内置资源…');
  $('resourceSummary').classList.toggle('ready',!!ready);
  $('builtinStatus').textContent=state?.ready?.yr?_t('红色警戒 2 / 尤里的复仇资源已内置，读入地图即可使用。'):
   Object.values(state?.files||{}).map(f=>f.error).filter(Boolean).join('；')||_t('正在检查内置资源…');
  $('modStatus').textContent=[state?.mod?.reason,...Object.entries(state?.mod?.sources||{}).map(([name,source])=>name+'：'+(source||_t('未找到'))),...(state?.mod?.warnings||[])].filter(Boolean).join('\n');
 }
 async function refresh(){
  const revision=++requestRevision;
  try{
   const data=await CrateLocalAPI.json('/api/resources',{cache:'no-store'});
   if(revision!==requestRevision){
    // A save may finish before the first stock-resource check. Keep that check
    // without replacing the newer Mod directory returned by the save.
    if(!state?.ready&&data.ready){state={...data,...state};render();}
    return state;
   }
   state=data;render();return data;
  }catch(e){if(revision!==requestRevision)return state;throw e;}
 }
 async function open(){
  const revision=++dialogRevision,draft=draftRevision;
  $('resourceError').textContent='';$('resourceActivity').textContent='';
  $('modRoot').value=state?.mod?.root||'';
  if(!dialog.open)dialog.showModal();
  try{await refresh();if(dialog.open&&revision===dialogRevision&&draft===draftRevision)$('modRoot').value=state?.mod?.root||'';}
  catch(e){if(dialog.open&&revision===dialogRevision)$('resourceError').textContent=e.message;}
 }
 function setBusy(value){busy=value;_i18n?.setBusy('resources',value);for(const id of ['modRoot','modBrowse','modSave','modClear','resourceClose'])$(id).disabled=value||analyzing;$('resourceCancel').disabled=value;}
 async function browse(){
  if(busy||analyzing)return;
  const revision=dialogRevision;++draftRevision;setBusy(true);
  $('resourceError').textContent='';$('resourceActivity').textContent=_t('请在系统文件夹选择框中选择游戏目录，或取消返回。');
  try{
   const data=await CrateLocalAPI.json('/api/resources/directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initial:$('modRoot').value})});
   if(!dialog.open||revision!==dialogRevision)return;
   if(!data.cancelled){++draftRevision;$('modRoot').value=data.path;$('resourceActivity').textContent=_t('目录已填入，点击“保存并关闭”应用。');}
   else $('resourceActivity').textContent=_t('已取消选择，目录输入保持不变。');
  }catch(e){if(dialog.open&&revision===dialogRevision){$('resourceError').textContent=e.message;$('resourceActivity').textContent=_t('未更改目录，仍可手动输入。');}}
  finally{setBusy(false);}
 }
 async function save(root,closeAfter=false){
  if(busy||analyzing)return;++requestRevision;setBusy(true);$('resourceError').textContent='';$('resourceActivity').textContent=_t('正在检查并保存目录…');
  let saved=false;
  try{
   const data=await CrateLocalAPI.json('/api/resources/mod',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({root})});
   saved=true;++requestRevision;state={...state,mod:data};$('version').value=data.root?'directory':'yr';render();$('modRoot').value=data.root||'';
   $('resourceActivity').textContent=root.trim()?_t('目录已保存并启用，已打开的地图会自动重新分析。'):_t('已清除游戏目录，切换为内置尤复资源。');
   if(closeAfter)dialog.close();
  }catch(e){$('resourceError').textContent=e.message;$('resourceActivity').textContent=saved?_t('目录已保存，页面状态未能更新；请重新打开设置查看。'):_t('保存未完成，请检查目录后重试；输入已保留。');}
  finally{setBusy(false);}
  if(saved)window.CrateResourceUI.onApplied?.($('version').value);
 }
 $('resourcesOpen').onclick=open;$('resourceClose').onclick=()=>save($('modRoot').value,true);
 $('resourceCancel').onclick=()=>dialog.close();
 $('modSave').onclick=()=>save($('modRoot').value);$('modClear').onclick=()=>save('');
 $('modBrowse').onclick=browse;
 $('modRoot').addEventListener('input',()=>++draftRevision);
 dialog.addEventListener('close',()=>++dialogRevision);
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('version').addEventListener('change',render);
 window.CrateResourceUI={onApplied:null,setAnalyzing(value){analyzing=value;setBusy(busy);},async resolve(choice){
  if(busy)throw Error(_t('目录正在保存，请稍候再分析。'));
  await refresh();const version=choice==='auto'?(state.mod?.configured?'directory':'yr'):choice==='shikong'?'directory':choice;
  if(version==='directory'?state.mod?.ready:state.ready?.[version])return version;
  await open();$('resourceError').textContent=version==='directory'?_t('请设置地图对应的游戏根目录，然后保存。'):_t('内置资源不完整，请重新完整解压工具包。');return null;
 },async ensure(version){return !!await this.resolve(version);}};
 refresh().catch(e=>{$('resourceSummary').textContent=e.message;});
})();
