/* Visible player-facing copy in both locales; diagnostics and data remain intact. */
'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const results=[];
 for(const language of ['zh-CN','en']){
  const context=await browser.newContext({viewport:{width:1700,height:1150},locale:language}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.stack));
  await context.addInitScript(language=>{localStorage.setItem('crate-atlas.language.v1',language);window.copyCanvas=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.id==='map')copyCanvas.push(String(text));return fill.call(this,text,...args);};},language);
  await p.route('**/language-settings.js*',r=>r.fulfill({contentType:'application/javascript',body:'globalThis.CrateLanguageSettings='+JSON.stringify({saved:language,system:language})+';'}));
  await p.goto(base+(toy?'index.html':'maps.html?result=/output/map-22309489b5d3/result.json'));
  await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
  if(toy){await p.locator('#mapFile').setInputFiles('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-155756-719000.map');await p.waitForFunction(()=>CrateMapViewer.state.data.metadata.filename==='SAVE537E-20261104-155756-719000.map'&&!CrateMapViewer.state.busy,null,{timeout:120000});}
  assert.equal(await p.evaluate(()=>CrateI18n.language),language);
  assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.probability.model),'finite-retry-v2');assert.equal(await p.evaluate(()=>CrateMapViewer.state.data.probability.attemptLimit),1000);
  const labels=await p.locator('#stats .stat span').allTextContents();assert(labels.includes(language==='en'?'Created':'生成成功'));assert(labels.includes(language==='en'?'Failed':'生成失败'));assert(!labels.some(t=>/未出箱|No crate/.test(t)));
  const mass=await p.evaluate(()=>{const e=CrateMapViewer.state.data.probability.exact,values=e.coefficients.map(c=>BigInt(c.numerator));return CrateMapViewer.state.data.cells.reduce((s,c)=>s+c.terms.reduce((n,[i,hits])=>n+values[i]*BigInt(hits),0n),0n)+BigInt(e.failureNumerator)===BigInt(e.denominator);});assert(mass,'Exact UI report success/failure mass');
  const title=language==='en'?'Red Alert 2 Map Crate Probability Calculator':'红警2地图箱子概率计算器';
  assert.equal(await p.title(),title);assert.equal(await p.locator('h1').innerText(),title);
  assert(await p.locator('.app-header .eyebrow').isHidden());assert(await p.locator('.app-header p').isHidden());
  if(toy)assert.equal(await p.locator('a[href^="https://"],a[href^="http://"]').count(),0);
  else{assert(await p.locator('#githubRepository').isVisible());assert.equal(await p.locator('#githubRepository').getAttribute('href'),'https://github.com/jjbsded/ra2-crate-atlas');}
  const texts=[];
  async function scan(){const text=await p.evaluate(()=>{const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),values=[];let node;while(node=walk.nextNode()){
   const e=node.parentElement;if(!e||!e.getClientRects().length||e.closest('script,style,[hidden],option,.language-control,dialog:not([open]),#error,#analysisNoticeText,#analysisIssues,#objectWarnings,#terrain3dError,#terrain3dWarningsText,#liveErrorDetails'))continue;
   const folded=e.closest('details:not([open])');if(folded&&!e.closest('summary'))continue;const value=node.nodeValue.trim();if(value)values.push(value);
  }return values.join('\n');});assert.doesNotMatch(text,/不保证(?:精确|准确|与游戏一致)|数值不保证|无需连接或修改游戏进程|原文件保持不变|资源来源用于下一次分析|读入自己的地图|这些假设可能影响|单次放箱调用|重新归一化|simulation.*implementation|not guaranteed|not guarantee accuracy|browser worker|precomputed static/i);if(language==='en')assert.doesNotMatch(text,/[\u3400-\u9fff]/,'English UI contains untranslated copy:\n'+text);texts.push(text);}
  assert.match(await p.locator('#dropzone p').first().innerText(),language==='en'?/Read-only/:/只读/);await scan();
  await p.evaluate(()=>{const v=CrateMapViewer,c=v.state.cells.find(c=>c.usable&&c.terms?.length);v.focus(c);});await scan();
  assert.equal(await p.locator('#cellInfo details').getAttribute('open'),null);assert(await p.locator('#cellInfo details').textContent().then(t=>t.includes('TMP')));
  const wall=await p.evaluate(()=>{const v=CrateMapViewer,c=v.state.cells.find(c=>/WALL|FNC/i.test(c.overlayName||''));if(!c)throw Error('Wall fixture missing');v.focus(c);return {name:c.overlayName,variant:c.overlayData};});
  const rows=await p.locator('#cellInfo > table tr').evaluateAll(rows=>rows.map(r=>[...r.children].map(e=>e.textContent)));
  assert(rows.some(([label,value])=>label==='Overlay'&&value===wall.name));assert(rows.some(([label,value])=>label===(language==='en'?'Variant':'变体编号')&&value===String(wall.variant)));await scan();
  await p.locator('#regionToggle').click();await p.waitForFunction(()=>!CrateMapViewer.state.regionPending);await scan();
  await p.locator('#simulationPlaceTab').click();await scan();await p.locator('#viewMode').click();
  await p.evaluate(()=>{const v=CrateMapViewer;v.focus(v.state.cells.find(c=>c.usable));});await p.locator('#terrain3dOpen').click();await p.waitForFunction(()=>document.getElementById('terrain3dLoading').hidden,null,{timeout:60000});await scan();
  assert(await p.locator('#terrain3dSource').isHidden());assert(await p.locator('#terrain3dProbabilityNote').isHidden());await p.locator('#terrain3dClose').click();
  if(!toy){await p.locator('#resourcesOpen').click();await scan();await p.locator('#resourceCancel').click();}
  await p.locator('#simulationPlaceTab').click();await p.locator('#simulationImportFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schema":999}')});await p.waitForFunction(()=>document.getElementById('error').textContent.length>0);assert((await p.locator('#error').innerText()).length>0,'Validation errors must remain visible');
  assert.deepEqual(errors,[]);fs.mkdirSync('output/ui-copy-qa',{recursive:true});await p.screenshot({path:`output/ui-copy-qa/${toy?'toy':'full'}-${language}.png`,fullPage:true});results.push({language,status:'PASS',screens:texts.length,visibleCharacters:texts.map(t=>t.length)});await context.close();
 }
 fs.writeFileSync(`output/ui-copy-qa/${toy?'toy':'full'}.json`,JSON.stringify({status:'PASS',results},null,2));console.log('PASS',toy?'Toy':'Full','concise visible copy, both languages, cell/region/placement/3D/resources and retained errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
