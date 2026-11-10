/* Detail/quality transitions and download contracts without a running server. */
'use strict';
const assert=require('node:assert/strict');
const D=require('./probability-display.js'),Details=require('./map-details.js'),Export=require('./map-exports.js');
const nodes=new Map();
function element(tag='div'){
 const classes=new Set();let text='';
 return {tag,children:[],dataset:{},hidden:false,disabled:false,title:'',
  classList:{add(name){classes.add(name);},toggle(name,enabled){enabled?classes.add(name):classes.delete(name);},remove(name){classes.delete(name);},contains:name=>classes.has(name)},
  style:{setProperty(){}},setAttribute(){},removeAttribute(){},after(){},cloneNode(){return element(tag);},
  append(...items){this.children.push(...items);},replaceChildren(){text='';this.children=[];},
  get textContent(){return text+this.children.map(c=>c.textContent).join('');},
  set textContent(value){text=String(value);this.children=[];}};
}
const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
// This presentation fixture exercises the real list renderer. Height-dependent
// pagination and observers run in verify-risk-pagination-ui.cjs in Chromium.
global.ResizeObserver=global.MutationObserver=class {observe(){}disconnect(){}};
global.requestAnimationFrame=()=>1;global.window={addEventListener(){},removeEventListener(){}};
const view=Details.create({document:{getElementById:$,createElement:element,body:element('body')}});
const cells=[4,0,1].map((hits,i)=>({x:10+i,y:10,level:2,slope:0,rawLand:7,land:7,postLand:3,overlay:255,
 objects:[],occupied:false,usable:true,primary:true,terms:hits?[[0,hits]]:[],probability:hits/10,multiplier:hits,
 marked:i===0,potentialMarked:i===1,higher:[[9,10,6]],removable:[],status:'crate',file:'fixture.sno',subTile:0,
 clearance:{land:7,postLand:3,rockTransition:true},px:100+i,py:80,exactN:BigInt(hits)*10n}));
cells[1].removable=[{category:'unit',type:'unit,"quoted"\nname'}];
const data={metadata:{filename:'fixture.map',sourceSha256:'fixture-hash',version:'yr',cellCount:3,
 size:[0,0,20,20],localSize:[2,2,16,12],visibleRect:[2,2,16,12],warnings:[],elapsedSeconds:1},
 rendering:{objects:{total:1,requested:2,hidden:[],missing:[{type:'MISSING',reason:'无贴图'}],warnings:[]}},cells,
 probability:{model:'finite-retry-v2',attemptLimit:1000,sampleCount:10,finalSuccess:.5,finalFailure:0,period:1,
 exact:{denominator:'100',failureNumerator:'1',coefficients:[{n:1,numerator:'10'}]}},
 markers:[[10,10]],potentialMarkers:[[11,10]],zeroProbabilityRockCandidates:[],clearance:{description:'移除对象，保留地形'}};
const lookup=new Map(cells.map(c=>[`${c.x},${c.y}`,c])),display=D.map(data);
// The user's details disclosure survives replacement, immediate re-selection
// (before the browser toggle task), and an interval with no selected cell.
view.cell(cells[0],data,display);let technical=$('cellInfo').children.find(n=>n.tag==='details');technical.open=true;
view.cell(cells[1],data,display);assert.equal($('cellInfo').children.find(n=>n.tag==='details').open,true);
view.clear();view.cell(cells[2],data,display);technical=$('cellInfo').children.find(n=>n.tag==='details');assert.equal(technical.open,true);
technical.open=false;technical.ontoggle();view.clear();view.cell(cells[0],data,display);assert.equal($('cellInfo').children.find(n=>n.tag==='details').open,false);
let focused;
const show=report=>view.report({data:report,base:'/output/test/',url:'/output/test/result.json'},D.map(report),{lookup,onFocus:c=>focused=c});
show(data);view.cell(cells[0],data,display);
assert.match($('cellInfo').textContent,/4\.0×/);
assert.match($('cellInfo').textContent,/40%/);
assert.match($('cellInfo').textContent,/放箱后无法通行/);
assert.equal($('markerList').children[0].classList.contains('selected'),true);
$('potentialList').children[0].onclick();assert.equal(focused,cells[1]);
assert.equal($('heatmap').disabled,false);assert.equal($('riskLists').hidden,false);
assert.match($('objectWarnings').textContent,/MISSING：无贴图/);
assert.match($('stats').textContent,/1(?:\.0)?%/);
const tiny={finalFailure:0,exact:{failureNumerator:'23',denominator:'1'+'0'.repeat(402)}};
assert.equal(Details.failurePercent(tiny),'2.3×10⁻³⁹⁹%','Show a positive exact probability beyond floating-point range');
assert.equal(Details.failurePercent(tiny),'2.3×10⁻³⁹⁹%','Reuse the revision label');
tiny.exact.failureNumerator='41';assert.equal(Details.failurePercent(tiny),'4.1×10⁻³⁹⁹%','Mutable inputs also invalidate the label cache');
assert.equal(Details.failurePercent({finalFailure:1e-10,exact:{failureNumerator:'1',denominator:'10000000000'}}),'1×10⁻⁸%');
assert.equal(Details.failurePercent({finalFailure:0,exact:{failureNumerator:'0',denominator:'1'}}),'0%');
assert.equal(Details.failurePercent({finalFailure:.25,exact:{failureNumerator:'1',denominator:'4'}}),'25%');
view.transfer({sources:[{reason:'投影优先规则',cell:null},{reason:'障碍',cell:cells[1]}]});
assert.equal($('transferInfo').textContent,'青蓝：2 个来源格 · 再次点击取消');
view.transfer(null,'读取失败');assert.equal($('transferInfo').textContent,'读取失败');
view.clear();assert.equal($('transferInfo').hidden,true);assert.equal($('markerList').children[0].classList.contains('selected'),false);

const approx={...data,metadata:{...data.metadata,version:'directory',resourceRoot:'fixture-root',approximate:true,partialAnalysis:true,
 approximation:{retryCellCount:1,assumptions:['未验证扩展行为']},loadIssues:[{message:'缺少规则',count:1,cells:[[11,10]]}]}};
const unknown={...cells[1],assumedRetry:true,retryAssumptions:['未知单位'],bridge:{kind:'high',deckLevel:6},objectsGround:['TREE'],objectsDeck:[]};
show(approx);view.cell(unknown,approx,{get:()=>({multiplier:0})});
assert.match($('cellInfo').textContent,/近似概率/);assert.doesNotMatch($('cellInfo').textContent,/不保证/);
assert.match($('cellInfo').textContent,/桥下对象TREE/);
assert.match($('cellInfo').textContent,/未知单位/);
assert.doesNotMatch($('cellInfo').textContent,/重抽|重新抽取/);
assert.equal($('markers').disabled,false);assert.equal($('heatmap').disabled,false);
assert.equal($('retryMod').hidden,true);assert.match($('analysisIssues').textContent,/未验证扩展行为/);
assert.equal(Details.completion(approx),'地图已加载');
const recovered={...approx,metadata:{...approx.metadata,riskPredictionVersion:1,riskUnknownCellCount:1},clearance:{model:'readable-objects-cleared',unknownCellCount:1}};
show(recovered);view.cell(cells[0],recovered,display);assert.equal($('riskLists').hidden,false);assert.equal($('rockDownload').hidden,false);assert.equal($('potentialDownload').hidden,false);assert.match($('cellInfo').textContent,/放箱后无法通行/);
view.cell({...cells[0],riskKnown:false,postLand:null},recovered,{get:()=>display.get(cells[0])});assert.match($('cellInfo').textContent,/暂无法判断/);

const preview={...data,probability:null,metadata:{...data.metadata,previewOnly:true,partialAnalysis:true,analysisError:'不可计算',warnings:['未计算概率']}};
show(preview);view.cell({...cells[0],terrainError:'未知 TMP'},preview,D.map(preview));
assert.equal($('cellFraction').disabled,true);assert.equal($('heatmap').disabled,true);
assert.match($('cellInfo').textContent,/未计算概率/);assert.match($('cellInfo').textContent,/未知 TMP/);
show(data);assert.equal($('cellFraction').disabled,false);assert.equal($('analysisNotice').hidden,true);
assert.equal($('jsonDownload').textContent,'下载精确概率 JSON');
for(const variant of [0,15]){
 view.cell({...cells[0],overlay:24,overlayName:'GAWALL',overlayData:variant},data,{get:()=>display.get(cells[0])});
 const basic=$('cellInfo').children[0];assert(basic.children.some(row=>row.children[0].textContent==='Overlay'&&row.children[1].textContent==='GAWALL'));
 assert(basic.children.some(row=>row.children[0].textContent==='变体编号'&&row.children[1].textContent===String(variant)),'Overlay variants belong in the main detail table, including variant zero');
}

show(data);const unchangedWarnings=$('objectWarnings').children[0],unchangedMarker=$('markerList').children[0],statNode=$('stats').children[1];
const live={...data,probability:{...data.probability,finalSuccess:.75,finalFailure:.25}};
view.update({data:live,base:'/output/test/',url:'/output/test/result.json'},D.map(live),{lookup,onFocus:c=>focused=c});
assert.equal($('objectWarnings').children[0],unchangedWarnings);assert.equal($('markerList').children[0],unchangedMarker);assert.equal($('stats').children[1],statNode);assert.match(statNode.textContent,/75%/);
const riskChange={...live,markers:[[11,10]]};view.update({data:riskChange,base:'/output/test/',url:'/output/test/result.json'},D.map(riskChange),{lookup,onFocus:c=>focused=c});assert.equal($('markerList').children[0].dataset.key,'11,10');
riskChange.markers[0][0]=12;view.update({data:riskChange},display,{lookup,onFocus:c=>focused=c});assert.equal($('markerList').children[0].dataset.key,'12,10','Numeric risk snapshots detect in-place coordinate edits');
riskChange.potentialMarkers=undefined;view.update({data:riskChange},display,{lookup,onFocus:c=>focused=c});assert.equal($('potentialCount').textContent,'未计算');
riskChange.potentialMarkers=[];view.update({data:riskChange},display,{lookup,onFocus:c=>focused=c});assert.equal($('potentialCount').textContent,'0 格','Uncomputed and an empty computed list remain distinct');

const before=structuredClone(data),download=Export.report(data,display),report=JSON.parse(download.text);
assert.equal(download.name,'crate-map-probability.json');assert.equal(report.cells[0].relativeMultiplier,4);
assert.equal(report.cells[0].isBaseline,false);assert.equal(report.cells[2].isBaseline,true);
assert.ok(!('px' in report.cells[0])&&!('py' in report.cells[0])&&!('exactN' in report.cells[0]));
assert.equal(JSON.parse(Export.report(preview,D.map(preview)).text).probability,null);
assert.equal(Export.report(approx,display).name,'crate-map-probability-approximate.json');
const fraction=JSON.parse(Export.fraction(data,cells[0],display).text);
assert.deepEqual(fraction.probability,{numerator:'2',denominator:'5'});
assert.deepEqual(JSON.parse(Export.fraction(data,cells[1],display).text).probability,{numerator:'0',denominator:'1'});
const approxFraction=JSON.parse(Export.fraction(approx,cells[0],display).text);
assert.equal(approxFraction.approximate,true);assert.deepEqual(approxFraction.approximation,approx.metadata.approximation);

function csvRows(text){
 const rows=[];let row=[],value='',quoted=false;
 for(let i=1;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&c===','){row.push(value);value='';}
  else if(!quoted&&c==='\r'&&text[i+1]==='\n'){row.push(value);rows.push(row);row=[];value='';i++;}
  else value+=c;
 }
 row.push(value);rows.push(row);return rows;
}
const all=Export.csv(data,display),rows=csvRows(all.text),headers=rows[0];
assert.equal(all.text.charCodeAt(0),0xfeff);assert.equal(rows.length,4);
assert.deepEqual(JSON.parse(rows[2][headers.indexOf('removable')]),cells[1].removable);
assert.equal(csvRows(Export.csv(data,display,'current').text)[1][0],'10');
assert.equal(csvRows(Export.csv(data,display,'potential').text)[1][0],'11');
assert.equal(Export.csv(approx,display).name,'cells-approximate.csv');
assert.deepEqual(data,before,'Display and download serializers must not change source data.');
console.log('PASS: exact/approximate/preview details, source labels, warnings, risk selection, JSON/CSV/fractions and immutable source data.');

async function controls(){
 const fs=require('node:fs'),vm=require('node:vm'),links=[],frames=[];
 let blob,shotCallback,rendered,drawn=0;
 const doc={getElementById:$,createElement(tag){
  if(tag==='a')return {click(){links.push({name:this.download,blob});}};
  if(tag==='canvas')return {width:1,height:1,getContext:()=>({}),toBlob:fn=>fn(new Blob(['image'],{type:'image/jpeg'}))};
  throw Error('Unexpected element '+tag);
 }};
 const ctx=vm.createContext({Blob,Map,setTimeout:fn=>fn(),requestAnimationFrame:fn=>frames.push(fn),
  URL:{createObjectURL:value=>{blob=value;return 'blob:fixture';},revokeObjectURL(){}},
  CrateMapDetails:Details,CrateMapImageExport:{layout:()=>({width:600,height:400}),renderAsync:async(target,source)=>{await Promise.resolve();rendered=source;return{labels:3};}}});
 vm.runInContext(fs.readFileSync(__dirname+'/map-exports.js','utf8'),ctx);
 const state={data,cells,lookup:new Map(lookup),selected:cells[0]};
 ctx.CrateMapExports.bind({document:doc,getContext:()=>({state,display}),canvas:{toBlob:fn=>shotCallback=fn},
  draw:()=>drawn++,mapOptions:options=>{assert.equal(options.snapshotRegions,true);return{};},message:(text,error)=>assert(!error,text)});
 $('jsonDownload').onclick({preventDefault(){}});
 assert.equal(JSON.parse(await links.at(-1).blob.text()).metadata.sourceSha256,'fixture-hash');
 $('cellFraction').onclick();assert.equal(links.at(-1).name,'cell-10-10-exact.json');
 $('screenshot').onclick();assert.equal(drawn,1);
 state.data={...data,metadata:{...data.metadata,filename:'next.map'}};
 shotCallback(new Blob(['png']));assert.equal(links.at(-1).name,'fixture.map-crate-probability.png');
 state.data={...data,cells:cells.slice()};state.cells=cells.slice();state.image={snapshot:()=>({id:'frozen-artwork'})};
 const exporting=$('mapImageExport').onclick();assert.equal($('mapImageExport').disabled,true);
 state.data.cells[0]={...cells[0],x:999};state.cells[0]=state.data.cells[0];state.image={id:'next-artwork'};
 state.data={...data,metadata:{...data.metadata,filename:'next.map'}};state.lookup.clear();
 frames.shift()();await exporting;
 assert.equal(rendered.lookup.get('10,10'),cells[0],'Changing maps during export must not clear the captured coordinate lookup.');
 assert.equal(rendered.cells[0],cells[0]);assert.equal(rendered.data.cells[0],cells[0]);assert.equal(rendered.image.id,'frozen-artwork');
 assert.equal(links.at(-1).name,'fixture.map-完整地图.jpg');
 assert.equal($('mapImageExport').disabled,false);
 console.log('PASS: real download handlers, selected fraction, asynchronous screenshot naming and full-map export snapshot.');
}
controls().catch(error=>{console.error(error);process.exitCode=1;});
