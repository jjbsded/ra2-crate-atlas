/* Toy supports local maps as well as the official catalog. */
(()=>{
 const en=CrateI18n.language==='en',text=en?'Toy: analyze local stock maps in the map workspace. Original artwork is reused where available, with simplified fallbacks.':'Toy：在地图页选取原版资源地图并本地计算。优先复用原版素材，缺失时采用简绘。';
 document.getElementById('exportStatus').textContent=text;
 document.querySelector('footer').textContent=text;
 document.querySelector('.page-switch strong').textContent=en?'Map analysis':'地图概率分析';
 document.querySelector('.page-switch').setAttribute('aria-label',en?'Map analysis':'地图概率分析');
})();
