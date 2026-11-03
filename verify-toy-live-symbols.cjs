/* Visual families must survive map gameplay overrides and follow Image aliases. */
'use strict';
const fs=require('node:fs'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {parse}=require('./toy-live/parser.js');
const base=fs.readFileSync('output/toy-live-qa/fixtures/flat-ore/source.map','utf8');
const cases=[
 ['ENGINEER','Natural=yes\nNotHuman=yes','soldier'],
 ['E1','Animal=yes\nNatural=yes\nCivilian=yes','soldier'],
 ['CIV1','Natural=yes\nNotHuman=yes','civilian'],
 ['DOG','Natural=no','animal'],
 ['COW','Natural=no','animal'],
 ['ENGINEER','Image=DOG\nNatural=no','animal'],
 ['DOG','Image=ENGINEER\nNatural=yes','soldier'],
 ['ENGINEER','Image=CIV1','civilian'],
 ['NEWENGINEER','Image=ENGINEER\nNatural=yes\nNotHuman=yes','soldier'],
 ['NEWANIMAL','Image=DOG\nNatural=no','animal'],
 ['UNKNOWNLOOK','Image=MISSINGART\nNatural=yes\nNotHuman=yes','soldier'],
];
for(const version of ['ra2','yr']){
 const stock=JSON.parse(zlib.gunzipSync(fs.readFileSync(`output/toy-live/live/stock-${version}.json.gz`)));
 for(const[type,rules,expected]of cases){
  const added=stock.rules[type]?'':`[InfantryTypes]\n999=${type}\n`;
  const text=base+`\n${added}[${type}]\n${rules}\n[Infantry]\n0=Neutral,${type},256,20,20,0,Guard,0,None,0,-1,0,0,1,0\n`;
  const result=parse(new TextEncoder().encode(text),stock,version);
  assert.equal(result.objects[0][3],expected,`${version} ${type} ${rules}`);
  assert.ok(result.cells.find(c=>c.x===20&&c.y===20).objects.includes(type));
 }
 const text=base+'\n[HTNK]\nNatural=yes\nAnimal=yes\nCivilian=yes\n[Units]\n0=Neutral,HTNK,256,20,20,0,Guard\n';
 assert.equal(parse(new TextEncoder().encode(text),stock,version).objects[0][3],'vehicle');
}
console.log('PASS 24 visual classification cases: stock identities, gameplay overrides, Image aliases and unknown artwork');
