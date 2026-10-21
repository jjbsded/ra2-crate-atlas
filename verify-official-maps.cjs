'use strict';
const assert=require('node:assert/strict');
const {searchMaps,preferredVersion}=require('./official-maps-ui.js');
const {maps}=require('./official-maps/catalog.json');
const ice=searchMaps(maps,{query:'冰天雪地'});
assert.equal(ice.length,5);
assert.equal(searchMaps(maps,{query:'冰天雪地 巨富'}).length,2);
assert.equal(searchMaps(maps,{query:'冰天雪地',mode:'megawealth',version:'ra2'}).length,1);
assert.equal(searchMaps(maps,{query:'冰天雪地',version:'shared'}).length,3);
assert.equal(searchMaps(maps,{query:' ＸＭＰ３２Ｓ８.MAP '})[0].label,'冰天雪地[作战]');
assert.equal(searchMaps(maps,{query:'冰天雪地 尤复',mode:'standard'}).length,1);
assert.equal(searchMaps(maps,{query:'no such official map'}).length,0);
assert.equal(searchMaps(maps,{onlySupported:true}).length,maps.length);
const unavailable=structuredClone(maps[0]);
unavailable.id='unsupported-fixture';
for(const source of Object.values(unavailable.variants))source.unsupportedReason='unknown terrain';
assert.deepEqual(searchMaps([unavailable],{onlySupported:true}),[]);
assert.equal(searchMaps([unavailable],{onlySupported:false}).length,1);
for(const entry of searchMaps(maps,{onlySupported:true,version:'yr'}))assert(!entry.variants.yr.unsupportedReason);
const shared=ice.find(e=>e.shared),single=ice.find(e=>!e.shared&&e.variants.ra2);
assert.equal(preferredVersion(shared,'ra2'),'ra2');
assert.equal(preferredVersion(shared,'yr'),'yr');
assert.equal(preferredVersion(shared,'shikong'),'yr');
assert.equal(preferredVersion(single,'yr'),'ra2');
console.log(`PASS: ${maps.length} entries; Chinese/filename/multiword search, version/mode/support filters, original version selection.`);
async function failures(){
 const api=require('./local-api.js'),original=global.fetch;
 try{
  global.fetch=async()=>{throw TypeError('Failed to fetch');};
  await assert.rejects(api.json('/api/maps/catalog'),/无法连接本地工具服务.*无需设置游戏目录/);
  global.fetch=async()=>({status:404,ok:false});
  await assert.rejects(api.json('/api/maps/catalog'),/旧版本/);
  global.fetch=async()=>({status:400,ok:false,json:async()=>({error:'官方地图包缺失，请完整解压工具包'})});
  await assert.rejects(api.json('/api/maps/catalog'),/地图包缺失/);
  global.fetch=async()=>({status:200,ok:true,json:async()=>{throw SyntaxError('Unexpected token');}});
  await assert.rejects(api.json('/api/maps/catalog'),/内容不完整或格式不正确/);
  console.log('PASS: offline service, outdated endpoint, missing bundle and invalid response have distinct explanations.');
 }finally{global.fetch=original;}
}
failures().catch(error=>{console.error(error);process.exitCode=1;});
