'use strict';
const assert=require('node:assert/strict'),P=require('./probability.js'),Ref=require('./buff-reference.js');
const ramps={warm:[[0,[255,247,188]],[.35,[254,196,79]],[.7,[227,74,51]],[1,[128,0,38]]],cool:[[0,[235,249,255]],[.35,[158,202,225]],[.7,[49,130,189]],[1,[8,48,107]]]};
const rgb=color=>color.match(/[a-f\d]{2}/gi).map(c=>parseInt(c,16));
for(const palette of ['warm','cool']){
 const expected=palette==='warm'?'#ff2e1f':'#1499ff';
 for(const maximum of [1,2,50,169]){
  assert.equal(P.color(1,palette,maximum),P.paletteDefaults[palette+'Start'],'Start means exactly 1x, independent of the maximum');
  assert.equal(P.color(maximum,palette,maximum),maximum===1?P.paletteDefaults[palette+'Start']:expected,'Maximum follows the chosen debug endpoint above 1x');
  let prior=Infinity;
  for(let i=0;i<=100;i++){const [r,g]=rgb(P.color(i/100,palette,maximum)),greenness=g-r;assert(greenness<=prior+1,'Lower values are greener');prior=greenness;}
  const below=rgb(P.color(1-1e-8,palette,maximum)),at=rgb(P.color(1,palette,maximum)),above=rgb(P.color(1+1e-8,palette,maximum));assert(below.every((v,k)=>Math.abs(v-at[k])<=1)&&above.every((v,k)=>Math.abs(v-at[k])<=1),'No 1x color discontinuity beyond byte rounding');
  for(const value of [0,.2,1,2,maximum]){assert.equal(Ref.textColor(value,palette,maximum),P.labelColor(value,palette,maximum));assert.equal(P.labelColor(value,palette,maximum,false),'#fef371');assert.equal(Ref.textColor(value,palette,maximum,false),'#fef371');}
 }
}
assert.equal(P.color(0,'multi'),'#18222e');assert.equal(P.color(1,'multi'),'#2c77a7');assert.equal(P.color(169,'multi'),'#d977ed');
const saved=P.paletteSettings();assert(P.configurePalette({coolStart:'#123456',coolMax:'#aabbcc',warmStart:'#abcdef',warmMax:'#010203'}));
assert.equal(P.color(1,'cool',20),'#123456');assert.equal(P.color(20,'cool',20),'#aabbcc');assert.equal(P.color(1,'warm',20),'#abcdef');assert.equal(P.color(20,'warm',20),'#010203');
assert.equal(P.color(1,'warm',20,saved),saved.warmStart,'Frozen exports use their captured colors');assert(!P.configurePalette({coolStart:'invalid'}));assert.equal(P.color(0,'cool',20),'#36d37d');P.configurePalette(saved);
const style={...saved,opacityZero:.1,opacityStart:.2,opacity50:.5,opacity75:.65,opacityMax:.8,labelMinRatio:.4};
for(const [x,y]of [[0,.1],[1,.2],[25.5,.35],[50,.5],[62.5,.575],[75,.65],[87.5,.725],[100,.8],[110,.8]])assert(Math.abs(P.paletteOpacity(x,100,style)-y)<1e-12,'Five-point opacity at '+x);
assert.equal(P.opacityCurve(100,style),P.opacityCurve(100,{...style}),'Identical curves are prepared once');
for(const maximum of [0,.5,1,4/3,2]){const curve=P.opacityCurve(maximum,style);assert.equal(curve(0),.1);assert(Math.abs(curve(1)-.2)<1e-12);for(let i=0;i<=100;i++){const alpha=curve(i/100*Math.max(1,maximum));assert(Number.isFinite(alpha)&&alpha>=0&&alpha<=1);}}
assert.equal(P.paletteOpacity(.25,.5,style),.5,'Percentage nodes below 1x remain independently adjustable');
assert.equal(P.labelSize(1,12,style),12);assert.equal(P.labelSize(4,12,style),48);assert.equal(P.labelSize(4,12,{...style,labelMinRatio:0}),12);assert(!Object.hasOwn(P.heatStyle(style),'labelMinRatio'));
const textStyle={...saved,labelBase:'#204060',labelMix:.5,labelStrokeRatio:.3,warmStart:'#4488cc',warmMax:'#4488cc'};
assert.equal(P.labelColor(1,'warm',10,true,textStyle),'#326496');assert.equal(P.labelColor(1,'warm',10,false,textStyle),'#204060');
assert.equal(P.labelColor(1,'warm',10,true,{...textStyle,labelMix:0}),'#204060');assert.equal(P.labelColor(1,'warm',10,true,{...textStyle,labelMix:1}),'#4488cc');
assert.equal(P.labelStrokeWidth(5,textStyle),3);assert.equal(P.labelStrokeWidth(60,textStyle),18);assert.equal(P.labelStrokeWidth(60,{...textStyle,labelStrokeRatio:0}),3);
for(const key of ['labelBase','labelMix','labelStrokeRatio'])assert(!Object.hasOwn(P.heatStyle(textStyle),key),'Text controls leave the heat-cache key unchanged');
const extra={...saved,labelMinRatio:2,labelStrokeRatio:2.5,opacityMax:1.5,baselineFactor:2,labelMix:1.5};P.configurePalette(extra);
assert.equal(P.paletteSettings().labelMinRatio,2);assert.equal(P.labelSize(1),60);assert.equal(P.labelStrokeWidth(20),50);assert.equal(P.paletteOpacity(100,100),1.5);
assert.equal(P.paletteSettings().baselineFactor,2);assert.equal(P.paletteSettings().labelMix,1.5);assert.match(P.labelColor(100,'warm',100),/^#[0-9a-f]{6}$/);
assert.equal(require('./probability-display.js').alpha(.5,true,2),.75,'Valid baseline coefficients above one remain usable');P.configurePalette(saved);
console.log('PASS fixed 1x/new endpoints, low green, shared labels, five-point opacity interpolation, proportional text height and unchanged multicolor');
