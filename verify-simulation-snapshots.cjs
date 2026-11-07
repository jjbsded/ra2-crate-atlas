'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas');
const context={clearTimeout,setTimeout,performance,CrateMapArtwork:require('./map-artwork.js')};vm.createContext(context);
vm.runInContext(fs.readFileSync('simulation-visual.js','utf8').replace('return {reset,update,installTiles,','return {publish,reset,update,installTiles,'),context);
const canvas=color=>{const c=createCanvas(8,8),t=c.getContext('2d');t.fillStyle=color;t.fillRect(0,0,8,8);return c;};
let draws=0;const original=canvas('#888'),base={width:8,height:8,draw(ctx,...args){draws++;ctx.drawImage(original,...args);}},state={image:base,objectImage:base};
const visual=context.CrateSimulationVisual.create({getState:()=>state,schedule(){},onPaint(){}}),tile=(color,x=0)=>({box:[x,0,2,2],ground:canvas(color),objects:canvas(color)});
function pixels(image){const c=createCanvas(8,8);context.CrateMapArtwork.draw(c.getContext('2d'),image,0,0,8,8);return [...c.getContext('2d').getImageData(0,0,8,8).data];}
visual.publish([tile('red')],{});const ground=state.image.snapshot(),objects=state.objectImage.snapshot(),red=pixels(objects);
visual.publish([tile('blue')],{});assert.notDeepEqual(pixels(state.objectImage),red);assert.deepEqual(pixels(objects),red,'An export snapshot cannot change when a new tile arrives');
visual.reset();assert.deepEqual(pixels(ground),red,'Switching to the default layout cannot clear frozen pixels');
for(let i=0;i<30;i++){
 state.image=ground;state.objectImage=objects;visual.reset();visual.publish([tile(i%2?'lime':'blue',2)],{});
 assert.deepEqual(pixels(state.objectImage).slice(0,8),red.slice(0,8),'Restored checkpoints retain previous tiles');
 const g=state.image.snapshot(),o=state.objectImage.snapshot();visual.reset();state.image=g;state.objectImage=o;visual.publish([tile('yellow',4)],{});
 draws=0;pixels(state.objectImage);assert.equal(draws,1,'Repeated restore/edit cycles flatten patch wrappers instead of nesting background draws');
}
assert.deepEqual(pixels(objects),red);console.log('PASS immutable paired artwork snapshots, reset safety, restored tiles and 30 bounded restore/edit cycles');
