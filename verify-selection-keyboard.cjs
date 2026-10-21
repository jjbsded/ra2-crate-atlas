'use strict';
const assert=require('node:assert/strict'),K=require('./selection-keyboard.js');
function harness(){
 let time=0,id=0,enabled=true;const timers=new Map(),moves=[];
 const keys=K.create({move:d=>moves.push({time,...d}),enabled:()=>enabled,
  setTimer:(fn,delay)=>{const key=++id;timers.set(key,{fn,time:time+delay});return key;},clearTimer:key=>timers.delete(key)});
 function advance(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,t])=>t.time<=end).sort((a,b)=>a[1].time-b[1].time)[0];if(!next)break;time=next[1].time;timers.delete(next[0]);next[1].fn();}time=end;}
 return{keys,moves,advance,disable:()=>{enabled=false;},pending:()=>timers.size};
}
// Human timing: the second finger arrives late, then the pair releases late.
for(const [a,b,horizontal,vertical]of [['ArrowLeft','ArrowUp',-1,-1],['ArrowRight','ArrowDown',1,1],['ArrowUp','ArrowRight',1,-1],['ArrowDown','ArrowLeft',-1,1]]){
 const h=harness();h.keys.down(a);h.advance(55);h.keys.down(b);h.advance(34);assert.equal(h.moves.length,0);
 h.advance(1);assert.deepEqual(h.moves,[{time:90,horizontal,vertical}]);
 h.advance(240);h.keys.up(a);h.advance(45);h.keys.up(b);h.advance(500);assert.equal(h.moves.length,1,'uneven key release must not append a cardinal step');
 assert.equal(h.pending(),0);
}
{
 const h=harness();h.keys.down('ArrowUp');h.advance(12);h.keys.up('ArrowUp');h.keys.down('ArrowLeft');h.advance(15);h.keys.up('ArrowLeft');
 assert.deepEqual(h.moves.map(({horizontal,vertical})=>[horizontal,vertical]),[[0,-1],[-1,0]],'separate taps are not a diagonal');
}
{
 const h=harness();h.keys.down('ArrowUp');h.advance(10);h.keys.down('ArrowLeft');h.advance(10);h.keys.up('ArrowUp');h.advance(10);h.keys.up('ArrowLeft');
 assert.deepEqual(h.moves,[{time:30,horizontal:-1,vertical:-1}],'short diagonal tap remains one step');
}
{
 const h=harness();h.keys.down('ArrowRight');h.advance(30);h.keys.down('ArrowDown');h.advance(60);
 h.keys.down('ArrowRight',true);h.keys.down('ArrowDown',true);h.advance(260);h.advance(120);
 assert.deepEqual(h.moves,[90,350,470].map(time=>({time,horizontal:1,vertical:1})),'native repeats cannot double-count held chords');
 h.keys.up('ArrowRight');h.advance(89);assert.equal(h.moves.length,3);h.advance(1);
 assert.deepEqual(h.moves.at(-1),{time:560,horizontal:0,vertical:1},'holding the remaining key changes direction after release grace');
 h.keys.up('ArrowDown');h.advance(500);assert.equal(h.moves.length,4);
}
{
 const h=harness();h.keys.down('ArrowLeft');h.keys.down('ArrowRight');h.advance(90);assert.equal(h.moves.length,0,'opposing keys cancel');h.keys.cancel();
 h.keys.down('ArrowUp');h.advance(50);h.disable();h.advance(500);assert.equal(h.moves.length,0,'focus/lifecycle eligibility is checked before a deferred move');
 assert.equal(h.pending(),0);assert.equal(h.keys.down('a'),false);
}
{
 const h=harness();h.keys.down('ArrowDown');h.advance(40);h.keys.cancel();h.advance(600);assert.equal(h.moves.length,0,'blur cancels pending input');
 h.keys.down('ArrowDown',true);h.advance(600);assert.equal(h.moves.length,0,'a stale native repeat cannot restart movement');
 h.keys.up('ArrowDown');h.keys.down('ArrowDown');h.advance(90);assert.equal(h.moves.length,1);
 h.keys.cancel();h.advance(600);assert.equal(h.moves.length,1,'blur cancels repeating movement');
}
console.log('PASS: delayed eight-direction chords, short taps, hold repeats, uneven release, opposite keys, stale repeat and lifecycle cancellation.');
