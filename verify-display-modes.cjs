'use strict';
const assert=require('node:assert/strict'),M=require('./display-modes.js');
for(let i=0;i<4;i++){const mode=M.order[i];assert.equal(M.next(mode),M.order[(i+1)%4]);assert.equal(M.next(mode,-1),M.order[(i+3)%4]);assert.equal(M.next(M.next(mode),-1),mode);}
assert.equal(M.next('crate',1,['crate','off']),'off');assert.equal(M.next('crate',-1,['crate','off']),'off');
const events={},button={disabled:false,addEventListener(name,fn){events[name]=fn;},click(){this.onclick();}};let direction=0;M.bind(button,d=>direction+=d);button.click();assert.equal(direction,1);
let prevented=0,stopped=0;const event={preventDefault(){prevented++;},stopPropagation(){stopped++;}};button.oncontextmenu(event);assert.equal(direction,0);assert.equal(prevented,1);assert.equal(stopped,1);button.disabled=true;button.click();button.oncontextmenu(event);assert.equal(direction,0);button.disabled=false;M.reverseToggle(button);events.contextmenu(event);assert.equal(direction,1);
console.log('PASS four-state forward/reverse order, reduced states, disabled controls and reversible two-state buttons');
