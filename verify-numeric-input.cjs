'use strict';
const assert=require('node:assert/strict'),N=require('./numeric-input.js');
let value=50,writes=0;const input={value:'50',validity:{badInput:false},setCustomValidity(message){this.error=message;}};
N.bind(input,{get:()=>value,set:number=>{value=number;writes++;},valid:number=>number>0});
for(const draft of ['1','15','150','150.','150.25','0.01','1000','1e3']){input.value=draft;input.oninput();assert.equal(input.value,draft);assert.equal(value,Number(draft));}
const prior=value;input.value='';input.oninput();assert.equal(input.value,'');assert.equal(value,prior);
input.value='-2';input.oninput();assert.equal(input.value,'-2');assert.equal(value,prior);assert(input.error);input.onblur();assert.equal(input.value,String(prior));assert.equal(input.error,'');
input.value='1e';input.validity.badInput=true;input.oninput();assert.equal(value,prior);assert.equal(input.value,'1e');input.validity.badInput=false;input.onchange();assert.equal(input.value,String(prior));
input.value='1000.000';const before=writes;input.oninput();input.onchange();input.onblur();assert.equal(input.value,'1000.000');assert.equal(writes,before,'Equal values do not republish callbacks on commit');
console.log('PASS numeric drafts, decimals/exponents/empty input, invalid-value rejection, no caps and no commit reformatting');
