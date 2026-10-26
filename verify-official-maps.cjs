'use strict';
const assert=require('node:assert/strict');
const {searchMaps,preferredVersion}=require('./official-maps-ui.js');
const {maps}=require('./official-maps/catalog.json');
const I=require('./i18n.js'),N=require('./official-map-names.js');
for(const locale of ['zh-CN','en']){
 I.setLanguage(locale);
 for(const entry of maps){
  assert.ok(N.aliases.has(entry.name),'Missing reviewed pronunciation: '+entry.name);
  assert.equal(N.pronunciations.get(entry.name).split(' ').length,(entry.name.match(/[\p{Script=Han}a-zA-Z0-9]/gu)||[]).length,'One syllable per character: '+entry.name);
  for(const query of [entry.name,I.messages[entry.name],...N.aliases.get(entry.name)])assert.ok(query&&searchMaps(maps,{query}).includes(entry),locale+': '+query);
 }
 for(const query of ['bingtianxuedi','BTXD','bing tian xue di','bīngtiānxuědì','ＢＴＸＤ','Heck Freezes Over'])assert.ok(searchMaps(maps,{query}).some(e=>e.name==='冰天雪地'));
 for(const query of ['qīn lüè xiāo xī','qinluexiaoxi','qlxxhdzs'])assert.ok(searchMaps(maps,{query}).some(e=>e.name==='侵略消息获得证实'));
 assert.ok(searchMaps(maps,{query:'Tanya’s Training Grounds'}).some(e=>e.name==='谭雅的训练场'));
 assert.ok(searchMaps(maps,{query:'snowballs chance'}).some(e=>e.name==='雪地生机'));
 assert.ok(searchMaps(maps,{query:'chongfanbali'}).some(e=>e.name==='重返巴黎'));
 assert.ok(searchMaps(maps,{query:'changzheng'}).some(e=>e.name==='长征'));
 assert.equal(searchMaps(maps,{query:'BTXD 巨富',mode:'megawealth',version:'ra2'}).length,1);
}
I.setLanguage('zh-CN');
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
async function browserChecks(){
 const {chromium}=require('playwright'),browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const url of ['http://127.0.0.1:8767/maps.html?result=/output/map-8b9caa6619a1/result.json','http://127.0.0.1:8787/toy/crate-atlas/index.html']){
  const page=await browser.newPage({locale:'zh-CN'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.CrateMapViewer?.state.data&&!CrateMapViewer.state.busy,null,{timeout:60000});
  await page.locator('#loadHeck').click();await page.waitForSelector('.official-map-row');
  for(const query of ['bingtianxuedi','BTXD','bing tian xue di','Heck Freezes Over']){await page.locator('#officialMapSearch').fill(query);const rows=page.locator('.official-map-row');assert.ok(await rows.count()>0);assert.ok((await rows.allTextContents()).every(t=>/冰天雪地|Heck Freezes Over/.test(t)));}
  await page.locator('#officialMapSearch').fill('Tanya’s Training Grounds');assert.ok(await page.locator('.official-map-row').count()>0);
  assert.deepEqual(errors,[]);console.log('PASS browser search',url);await page.close();
 }}finally{await browser.close();}
}
failures().then(()=>process.argv.includes('--browser')?browserChecks():null).catch(error=>{console.error(error);process.exitCode=1;});
