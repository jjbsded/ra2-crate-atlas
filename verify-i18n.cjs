/* Locale selection, catalog contracts, diagnostic boundaries and model parity. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('./i18n.js');
assert.equal(I.initial({system:'zh-TW',browser:'en-US'}),'zh-CN');
assert.equal(I.initial({system:'de-DE',browser:'zh-CN'}),'en');
assert.equal(I.initial({saved:'en',system:'zh-CN'}),'en');
assert.equal(I.initial({stored:'zh-CN',browser:'en-US'}),'zh-CN');
assert.equal(I.initial({stored:'zh-CN',system:'en-US'}),'en');
assert.equal(I.initial({saved:'bogus',system:'en-US'}),'en');
assert.throws(()=>I.setLanguage('fr'));
for(const [source,target] of Object.entries(I.messages)){
 assert.ok(target.trim(),source);
 assert.equal(/[\u3400-\u9fff]/u.test(target),false,source+' contains untranslated text');
 const slots=s=>[...new Set(s.match(/\{\d+\}/g)||[])].sort();
 assert.deepEqual(slots(source),slots(target),source+' has mismatched placeholders');
}
I.setLanguage('en');
assert.equal(I.t`起点 (${[99,105]})`,'Origin (99,105)');
const original={metadata:{filename:'矿石.map',displayName:'我的地图',sourceSha256:'abc',
 warnings:['地图含自定义类型列表、include、隧道或预置飞机；当前原版静态模型不支持，未输出近似概率']},
 cells:[{x:1,y:2,probability:1/3,name:'我的区域'}],name:'选择官方地图',path:'D:\\游戏\\水面.map'};
const copy=JSON.parse(JSON.stringify(original));I.diagnostics(copy);
assert.deepEqual(copy.cells,original.cells);
for(const key of ['name','path'])assert.equal(copy[key],original[key]);
for(const key of ['filename','displayName','sourceSha256'])assert.equal(copy.metadata[key],original.metadata[key]);
assert.equal(I.officialLabel({name:'冰天雪地',modeName:'作战',version:'yr',shared:false}),'Heck Freezes Over[YR][Battle]');
assert.equal(I.mapName({displayName:'我的地图'}),'我的地图');
for(const warning of [
 '外部 INI 未找到或无法读取：testsw.ini；仅使用成功加载的定义。',
 '部分加载：新增 A12DROP 的 Image=TYSJ 缺少原版 art 定义，可能依赖外部模组资产。已保留可读取的地形和对象；缺失规则可能影响全图的附近搜索及重抽，未计算概率或禁行风险。'
])assert.equal(/[\u3400-\u9fff]/u.test(I.message(warning)),false,I.message(warning));
const R=require('./region-statistics.js');
assert.equal(R.displayName({id:'r2',name:'区域 2'}),'Region 2');
assert.equal(R.displayName({id:'r2',name:'区域 2',customName:true}),'区域 2');
const regions=R.defaults();regions.regions[1].customName=true;regions.regions[1].name='区域 2';
assert.equal(R.displayName(R.decode(R.encode(regions),new Map()).regions[1]),'区域 2');
const fixture=JSON.parse(fs.readFileSync('examples/cliff-demo.json','utf8'));
I.diagnostics(fixture.single);
assert.ok(!/[\u3400-\u9fff]/u.test(fixture.single.metadata.sourceDescription));
// Fresh isolated module graphs catch locale-dependent constants, classifications
// and search decisions, rather than only testing string replacement.
function graph(language){
 const scope={console,CrateLanguageSettings:{saved:language}};scope.globalThis=scope;
 vm.createContext(scope);
 for(const file of ['i18n-en.js','i18n.js','model.js','probability-index.js','probability.js'])
  vm.runInContext(fs.readFileSync(file,'utf8'),scope,{filename:file});
 return scope;
}
const zh=graph('zh-CN'),en=graph('en');
const mechanics=result=>JSON.stringify(result,(k,v)=>['reason','text','title','name','subtitle','assumptions','scope'].includes(k)?undefined:typeof v==='bigint'?v.toString():v);
let attempts=0;
for(const id of Object.keys(zh.CrateModel.WORLDS)){
 for(const frame of [0,1,5,600,1001])for(let x=1;x<=13;x++)for(let y=1;y<=13;y++){
  assert.equal(mechanics(en.CrateModel.resolveAttempt([x,y],en.CrateModel.WORLDS[id],frame)),
   mechanics(zh.CrateModel.resolveAttempt([x,y],zh.CrateModel.WORLDS[id],frame)),`${id} (${x},${y}) frame ${frame}`);
  attempts++;
 }
 const a=en.CrateProbability.computeRandom(en.CrateModel.WORLDS[id]);
 const b=zh.CrateProbability.computeRandom(zh.CrateModel.WORLDS[id]);
 assert.equal(mechanics(a),mechanics(b),id+' exact probability changed with language');
}
console.log(`PASS ${Object.keys(I.messages).length} translations; locale resolution, protected user data, ${attempts} search attempts and all demo distributions identical`);
