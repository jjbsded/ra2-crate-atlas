"""Real stock art, cross-language selection, and VXL shadow regression checks."""
import hashlib,json,struct,subprocess,tempfile,unittest
from pathlib import Path
import numpy as np
from realmap_resources import resources,THEATERS
from realmap_terrain_variants import TerrainVariants,variant_index,geometry,LATTICE8
from realmap_voxel_shadow import footprint
from realmap_objects import ObjectPainter

ROOT=Path(__file__).resolve().parent
KINDS=('YTNK','ZEP','DISK','SHAD','SCHP','ORCA','HTNK')


class Rendering(unittest.TestCase):
    def test_lattice_and_browser(self):
        self.assertEqual([LATTICE8.count(i) for i in range(8)],[8]*8)
        for y in range(8):
            for x in range(8):
                for dx,dy in ((1,0),(0,1),(1,1),(-1,1)):
                    self.assertNotEqual(LATTICE8[x+y*8],LATTICE8[(x+dx)%8+(y+dy)%8*8])
        cases=[]
        for w,h in ((1,1),(2,3),(4,2)):
            for count in (1,2,4,8):
                names=[f'v{i}' for i in range(count)]
                for x in range(-3,17):
                    for y in range(-3,17):
                        # Every subtile of a coherent multicell tile agrees.
                        selected=[]
                        for sub in range(w*h):
                            cx,cy=x*w+sub%w,y*h+sub//w
                            i=variant_index(cx,cy,count,w,h,sub);selected.append(i)
                            cases.append([dict(file='base',x=cx,y=cy,subTile=sub),[w,h,names],names[i]])
                        self.assertEqual(len(set(selected)),1)
        node=ROOT.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
        script="require('./toy/terrain-variants.js');let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>{for(const[c,d,want]of JSON.parse(s))if(CrateTerrainVariants.file(c,{base:d})!==want)throw Error('variant mismatch');console.log('PASS');});"
        result=subprocess.run([str(node),'-e',script],cwd=ROOT,input=json.dumps(cases),text=True,capture_output=True,check=True)
        self.assertIn('PASS',result.stdout)

    def test_stock_variants_and_geometry(self):
        for version in ('ra2','yr'):
            res=resources(version)
            for climate in THEATERS:
                if version=='ra2' and climate not in ('TEMPERATE','SNOW','URBAN'):continue
                t=res.theater(climate);selector=TerrainVariants(res,t)
                _,_,names=selector.choices('clear01.'+t['ext'])
                self.assertEqual(len(names),8,(version,climate))
                self.assertGreater(len({hashlib.sha256(selector.raws[n]).digest() for n in names}),1)
                for _,name,_ in t['definitions']:
                    try:w,h,names=selector.choices(name)
                    except ValueError:continue
                    if len(names)>1:
                        for n in names:self.assertEqual(geometry(selector.raws[n]),geometry(selector.raws[name]))
                for name in selector.bridges:
                    try:self.assertEqual(len(selector.choices(name)[2]),1)
                    except ValueError:pass

    def test_shadow_selection_scale_and_body(self):
        res=resources('yr');theater=res.theater('URBAN');theater['effectiveRules']=res.rules
        with tempfile.TemporaryDirectory() as folder:
            painter=ObjectPainter(res,theater,Path(folder))
            try:
                for kind in KINDS:
                    for face in range(0,256,8):
                        rec=dict(type=kind,category='AIRCRAFT' if kind=='ORCA' else 'UNITS',house='AMERICANS',health=256,facing=face,mission='Guard',upgrades=[])
                        parts=painter.parts(rec)
                        self.assertIsNotNone(parts[0]['shadow'],(kind,face))
                        self.assertTrue(all(p['shadow'] is None for p in parts[1:]),(kind,face))
                        self.assertEqual(parts[0]['shadowSection'],2 if kind in ('SHAD','SCHP') else 0)
                        self.assertEqual(parts[0]['shadowScale'],.5 if kind in ('ZEP','DISK','SHAD','SCHP','ORCA') else 1)
                        self.assertTrue(all(p['image'].getbbox() for p in parts))
                for kind in KINDS:
                    cfg,image,art=painter.art_for(kind);v,h=painter.get(image+'.vxl'),painter.get(image+'.hva')
                    section=int(art.get('SHADOWINDEX',0))
                    for face in range(32):
                        full,_,_=footprint(v,h,face,section=section)
                        half,_,_=footprint(v,h,face,section=section,scale_factor=.5)
                        self.assertLess(np.count_nonzero(half),np.count_nonzero(full)*.5,(kind,face))
                        self.assertEqual(set(np.unique(half)),{0,128})
                    self.assertIsNone(footprint(v,h,0,section=-1)[0])
                    self.assertIsNone(footprint(v,h,0,section=999)[0])
                    with self.assertRaises(ValueError):footprint(v,h[:16],0)
                v,h=painter.get('shad.vxl'),painter.get('shad.hva')
                rotor=footprint(v,h,0,section=0);body=footprint(v,h,0,section=2)
                self.assertNotEqual((rotor[0].size,rotor[1:]),(body[0].size,body[1:]))
            finally:
                if painter.voxels:painter.voxels.close()
        # Surface colors intentionally changed in renderer 18. Historical v17
        # RGB hashes are evidence for that release, not a current shadow oracle.
        # verify-voxel-lighting.py separately checks alpha/anchors/shadows with
        # and without surface lighting across actual stock vehicle directions.


if __name__=='__main__':unittest.main()
