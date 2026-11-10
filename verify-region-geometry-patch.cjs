/* Regress the large-edit lookup bound and compare incremental/full geometry. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),R=require('./region-statistics.js');
class Path{constructor(){this.polygons=0;}addPath(other){this.polygons+=other.polygons;}}
const source=fs.readFileSync('region-statistics-ui.js','utf8'),start=source.indexOf('  function* buildGeometry('),end=source.indexOf('  function paintRegion(',start);
const context={R,Path2D:Path,CrateMapRenderer:{surface:c=>c.surface},path:(p,c)=>p.polygons++,cellSurfaceBox:c=>({l:c.px-30,r:c.px+30,t:c.py-15,b:c.py+15})};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
const cells=Array.from({length:25050},(_,i)=>({x:i%150+1,y:Math.floor(i/150)+1,px:30*((i%150)-Math.floor(i/150))+6000,py:15*((i%150)+Math.floor(i/150)+2),surface:[[[0,-15],[30,0],[0,15],[-30,0]]]}));
const data=new Map(cells.map(c=>[R.key(c),c]));let reads=0;
const lookup={get(k){reads++;return data.get(k);}};
function finish(work){let part,yields=0;do{part=work.next();if(!part.done)yields++;}while(!part.done);return{value:part.value,yields};}
function full(keys,revision=0){return finish(context.buildGeometry({cells:keys},null,lookup,revision)).value;}
let keys=new Set(),previous=full(keys);
for(const next of [new Set(data.keys()),new Set(),new Set([...data.keys()].filter((k,i)=>i%3)),new Set(data.keys())]){
 const changes=new Map([...new Set([...keys,...next])].filter(k=>keys.has(k)!==next.has(k)).map(k=>[k,1]));
 const oldSize=previous.keys.size,oldPolygons=previous.fill.polygons;reads=0;
 const patch=finish(context.patchGeometry({cells:next},previous,changes,lookup,1)),cost=reads,expected=full(next,1);
 assert(cost<changes.size*12+10,'Lookup work must scale with changes, never dirty tiles × changes: '+cost);
 assert(patch.yields>50,'Large removals also yield instead of skipping every checkpoint');
 assert.equal(patch.value.fill.polygons,expected.fill.polygons);assert.equal(patch.value.edge.polygons,expected.edge.polygons);
 assert.deepEqual(JSON.parse(JSON.stringify(patch.value.bounds)),JSON.parse(JSON.stringify(expected.bounds)));
 assert.deepEqual(JSON.parse(JSON.stringify(patch.value.center)),JSON.parse(JSON.stringify(expected.center)));
 for(const [id,tile]of expected.tileMap){const actual=patch.value.tileMap.get(id);assert(actual);assert.deepEqual([...actual.keys].sort(),[...tile.keys].sort());assert.deepEqual([...actual.edgeKeys].sort(),[...tile.edgeKeys].sort());}
 assert.equal(previous.keys.size,oldSize);assert.equal(previous.fill.polygons,oldPolygons);
 keys=next;previous=patch.value;
}
const one=new Set(keys);one.delete(R.key(cells[12000]));reads=0;
const patch=finish(context.patchGeometry({cells:one},previous,new Map([[R.key(cells[12000]),1]]),lookup,2));
assert(reads<1000,'A single edit reads neighboring tiles, not the whole region');assert(patch.value.rebuiltTiles<=5);assert.equal(patch.value.keys.size,keys.size-1);
console.log('PASS 25,050-cell fill/remove/reassignment: linear lookups, cooperative empty-tile removal, exact full-geometry agreement, immutable previous results and local one-cell edits');
