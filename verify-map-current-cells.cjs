'use strict';
const assert=require('node:assert/strict'),{createCanvas}=require('@napi-rs/canvas'),M=require('./map-renderer.js');
const stale={x:1,y:1,px:50,py:50,terms:[],usable:true},current={...stale,land:0,terms:[[0,1]],surface:[[[0,-15],[30,0],[0,15],[-30,0]]]},state={cells:[current],data:{rendering:{width:100,height:100,origin:[0,0]}},spatialIndex:{query:()=>[stale]},lookup:new Map([['1,1',current]]),x:0,y:0,scale:1,selected:null};
const canvas=createCanvas(100,100),area={x:0,y:0,w:100,h:100},display={get:c=>{assert.equal(c,current,'Render attributes must come from current lookup, including while closing the live session');return{numerator:1n,multiplier:2,isBaseline:false};},cellAlpha:()=>1,meetsThreshold:()=>true,showLabel:()=>false,maxMultiplier:2};
for(const liveEditing of [true,false]){state.liveEditing=liveEditing;assert.equal(M.render(canvas.getContext('2d'),state,area,display,{scene:'off',overlayOnly:true,heatmap:true,baselineLayer:false,opacity:35,filter:'all',palette:'warm',values:false}).colored,1);}
const coordinates=require('./map-coordinates.js');
assert.equal(coordinates.hitTest(state,50,50,c=>{assert.equal(c,current,'Pointer hits must resolve live attributes before querying probability or details');return true;}),current);
state.lookup.clear();assert.equal(coordinates.hitTest(state,50,50,()=>{throw Error('Removed cell cannot be hit');}),null);assert.equal(M.render(canvas.getContext('2d'),state,area,display,{scene:'off',overlayOnly:true,heatmap:true,baselineLayer:false}).colored,0,'Removed records are not painted from stale geometry');
console.log('PASS spatial geometry reuses current probability records before/after native session close and excludes removed cells');
