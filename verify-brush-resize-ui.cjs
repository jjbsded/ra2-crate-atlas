/* Route native wheel/key input by tool capability and focus, without edits. */
'use strict';
const{chromium}=require('playwright'),assert=require('node:assert/strict');
const toy=process.env.SIM_EDITION==='toy',base=process.env.SIM_BASE||'http://127.0.0.1:8767/';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await browser.newPage({viewport:{width:1900,height:1300}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.goto(base+(toy?'index.html':'maps.html?result='+(process.env.SIM_RESULT||'/output/map-9684d7dc1f8b/result.json')));
 await p.waitForFunction(()=>window.CrateMapViewer?.simulation.model&&!CrateMapViewer.state.busy,null,{timeout:120000});
 await p.locator('#simulationPlaceTab').click();await p.locator('#minimap').uncheck();
 const key=async k=>{await p.locator('#map').focus();await p.keyboard.press(k);},scale=()=>p.evaluate(()=>CrateMapViewer.state.scale),size=()=>p.locator('#simulationPlaceSize').inputValue();
 const hover=async()=>{await p.locator('#map').scrollIntoViewIfNeeded();const point=await p.evaluate(()=>{const v=CrateMapViewer,s=v.state,r=s.data.rendering,c=s.cells.filter(c=>c.surfaceVisibility===1&&c.cameraCoverage===1&&v.simulation.model.placement('MTNK',c.x,c.y).allowed).reduce((a,c)=>(c.px-r.width/2)**2+(c.py-r.height/2)**2<(a.px-r.width/2)**2+(a.py-r.height/2)**2?c:a);s.scale=1.6;s.x=v.area.x+v.area.w/2-c.px*s.scale;s.y=v.area.y+v.area.h/2-c.py*s.scale;v.draw();const b=document.getElementById('map').getBoundingClientRect(),k=Math.min(b.width/v.viewport.width,b.height/v.viewport.height);return{x:b.x+(b.width-v.viewport.width*k)/2+(s.x+c.px*s.scale)*k,y:b.y+(b.height-v.viewport.height*k)/2+(s.y+c.py*s.scale)*k};});await p.mouse.move(point.x,point.y);return point;};
 const wheel=async()=>{const before=await scale();await p.mouse.wheel(0,-100);return before;};
 const picker=()=>p.locator('#map').evaluate(e=>e.classList.contains('simulation-eyedropper'));
 const ctrlResize=async(id)=>{
  const before=Number(await p.locator('#'+id).inputValue()),beforeScale=await scale();await p.keyboard.down('Control');assert(await picker(),'A new Ctrl hold starts the picker');await p.mouse.wheel(0,-100);await p.waitForFunction(({id,before})=>Number(document.getElementById(id).value)===before+1,{id,before});
  assert.equal(await scale(),beforeScale);assert(!await picker(),'Sizing restores the original cursor');assert(await p.evaluate(()=>CrateMapViewer.state.ctrlResizing));
  await p.mouse.move(900,700);assert(!await picker(),'Moving with Ctrl still held must not re-enter the picker');await hover();await p.mouse.wheel(0,-100);await p.waitForFunction(({id,before})=>Number(document.getElementById(id).value)===before+2,{id,before});assert(!await picker());await p.keyboard.up('Control');
 };
 await key('q');await hover();if(await p.locator('#regionColorOverlay').getAttribute('aria-pressed')==='true')await p.locator('#regionColorOverlay').click();await hover();await p.locator('#map').focus();
 await ctrlResize('simulationPlaceSize');assert.equal(await p.locator('#regionColorOverlay').getAttribute('aria-pressed'),'false','Sizing restores the pre-picker region layer');
 await p.keyboard.down('Control');assert(await picker(),'Releasing and pressing Ctrl permits picking again');await p.keyboard.up('Control');
 for(const k of ['q','r']){
  await key(k);await hover();const value=await size(),before=await scale();await p.locator('#map').focus();await p.keyboard.press('+');assert((await scale())>before,'Map focus makes + zoom');assert.equal(await size(),value);await p.keyboard.press('-');assert.equal(await size(),value);
  await p.locator('#simulationToolChoice').focus();await p.keyboard.press('+');await p.keyboard.press('+');assert.equal(Number(await size()),Number(value)+2,'Repeated toolbar sizing keeps its focus');await p.keyboard.press('-');await p.keyboard.press('-');assert.equal(await size(),value);
 }
 for(const tool of ['place','normal','chrono','magnet','restore'])for(const k of ['w','e']){
  await p.locator('#simulationTool').selectOption(tool,{force:true});await key(k);assert(await p.locator('#simulationPlaceSizeLabel').isHidden());const value=await size();await hover();await p.keyboard.down('Control');assert(await p.locator('#simulationPlaceSizeLabel').isHidden(),'Ctrl does not reveal invalid dimensions');const before=await wheel();await p.waitForFunction(before=>CrateMapViewer.state.scale>before,before);assert.equal(await size(),value);assert(!await p.evaluate(()=>!!CrateMapViewer.state.ctrlResizing));await p.keyboard.up('Control');
  await p.locator('#simulationToolChoice').focus();const beforeKey=await scale();await p.keyboard.press('+');assert((await scale())>beforeKey,'A nonresizable toolbar tool falls back to zoom');assert.equal(await size(),value);
 }
 await p.locator('#simulationTool').selectOption('place',{force:true});await key('w');const saved=await size();await hover();await p.keyboard.down('Shift');assert(await p.locator('#simulationPlaceSizeLabel').isVisible(),'Temporary erase has a valid size');await p.keyboard.down('Control');await p.mouse.wheel(0,-100);await p.waitForFunction(saved=>Number(document.getElementById('simulationPlaceSize').value)===Number(saved)+1,saved);assert(!await picker());await p.keyboard.up('Control');await p.keyboard.up('Shift');assert(await p.locator('#simulationPlaceSizeLabel').isHidden());await key('q');assert(await p.locator('#simulationPlaceSizeLabel').isVisible());
 await key('3');await key('q');if(await p.locator('#regionColorOverlay').getAttribute('aria-pressed')!=='true')await p.locator('#regionColorOverlay').click();await hover();await p.locator('#map').focus();await ctrlResize('regionWidth');
 assert(await p.evaluate(()=>{const c=document.getElementById('regionBrushPreview'),ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,c.width,c.height).data;for(let i=3;i<pixels.length;i+=4)if(pixels[i])return true;return false;}),'The actual region brush overlay returns while Ctrl sizing');
 for(const value of ['box-screen','box-game','fill','picker']){
  await p.locator('#regionTool').selectOption(value);await hover();const width=await p.locator('#regionWidth').inputValue();await p.keyboard.down('Control');const before=await wheel();await p.waitForFunction(before=>CrateMapViewer.state.scale>before,before);assert.equal(await p.locator('#regionWidth').inputValue(),width);await p.keyboard.up('Control');
 }
 await key('q');await hover();await p.locator('#map').focus();let before=await scale(),width=await p.locator('#regionWidth').inputValue();await p.keyboard.press('+');assert((await scale())>before);assert.equal(await p.locator('#regionWidth').inputValue(),width);await p.locator('#regionToggle').focus();await p.keyboard.press('+');assert.equal(Number(await p.locator('#regionWidth').inputValue()),Number(width)+1);
 await p.locator('#regionWidth').focus();before=await scale();await p.keyboard.press('-');assert.equal(await scale(),before,'Numeric drafts consume their own key input');
 await key('2');await hover();await p.keyboard.down('Control');before=await wheel();await p.waitForFunction(before=>CrateMapViewer.state.scale>before,before);await p.keyboard.up('Control');
 assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>CrateMapViewer.simulation.model.plan.placements.length),0);console.log('PASS',toy?'Toy':'Full','tool-aware wheel/key routing, original tool/layers/region preview, Ctrl holds, hidden sizes, temporary brushes and map focus');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
