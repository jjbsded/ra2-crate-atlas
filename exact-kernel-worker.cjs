/* Private numeric pipe. No maps, assets, files or network requests enter it. */
'use strict';
const F=require('./finite-retry.js'),readline=require('node:readline');
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
 let id;
 try{
  const data=JSON.parse(line);id=data.id;
  if(!Number.isSafeInteger(id)||!Number.isInteger(data.N)||data.N<1||!Number.isInteger(data.limit)||data.limit<1||data.limit>1000||!Array.isArray(data.entries)||data.entries.length>300)throw Error('Invalid kernel input');
  const terminal=new Map();
  for(const[n,r,h]of data.entries){if(!Number.isInteger(n)||n<1||n>24||!Number.isInteger(r)||r<0||r>=n||!Number.isSafeInteger(h)||h<0||h>data.N)throw Error('Invalid residue');terminal.set(n*32+r,h);}
  const k=F.kernel(terminal,data.N,data.limit);
  process.stdout.write(JSON.stringify({id,denominator:String(k.denominator),coefficients:k.coefficients,
   exhausted:String(k.exhausted),period:k.period,weightPeriod:k.reduced,method:k.method,terminalCountRange:k.terminalCountRange})+'\n');
 }catch(error){process.stdout.write(JSON.stringify({id,error:error.message})+'\n');}
});
