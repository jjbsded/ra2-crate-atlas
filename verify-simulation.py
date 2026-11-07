"""Simulation fixtures and native/browser parser parity; original map stays intact."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import runtime_bootstrap
from map_test_fixtures import fixture, pack
from realmap_format import ini
from realmap import compute_analysis
from realmap_parser import parse_map
from realmap_resources import resources
from realmap_simulation import CELL_FIELDS, recipe

ROOT=Path(__file__).resolve().parent
FIELDS=('land','overlay','overlayName','overlayData','terrain','occupiedGround','occupiedDeck','occupied','candidate','status','primary','track','foot','float','bridge','bridgeProjection')


def prepare(qa):
    res=resources('yr');names=[v.upper() for v in res.rules['OVERLAYTYPES'].values()]
    rubble=next(n for n,cfg in res.rules.items() if cfg.get('LEAVERUBBLE','').lower()=='yes' and res.art.get(cfg.get('IMAGE',n).upper(),{}).get('FOUNDATION')=='2x2')
    extra=f'[Structures]\n0=Americans,{rubble},256,26,26,0,None\n1=Americans,GAPOWR,256,35,25,0,None\n2=Americans,GAPILL,256,21,20,0,None\n[GAPOWR]\nImmune=yes\n[Units]\n0=Americans,MTNK,256,32,32,64,Guard,None,0,-1,0,0\n1=Americans,MTNK,256,31,40,64,Guard,None,0,-1,0,1\n[Infantry]\n0=Russians,E2,256,33,33,0,Guard,64,None,0,-1,0,0\n[Aircraft]\n0=Americans,ORCA,256,34,34,0,Guard,None,0,-1,0,0\n[Terrain]\n20020=TIBTRE01\n28022=TREE01\n28024=TRFF01\n'
    raw=fixture(width=30,height=40,extra=extra)
    content=ini(raw);overlay=bytearray([255]*262144);frames=bytearray(262144)
    for x,y,name,frame in [(40,30,'TIB01',11),(20,21,'TIB01',11),(19,20,'GAFNCB',0),(30,20,'GAWALL',2),(31,20,'GAWALL',10),(32,20,'GAWALL',8),(30,40,'BRIDGE1',0),(31,40,'BRIDGE1',0),(32,40,'BRIDGE1',0)]:
        if name=='GAFNCB':name='CAFNCB'
        overlay[x+y*512]=names.index(name);frames[x+y*512]=frame
    for base,xs,ys in [(74,range(20,25),range(43,46)),(205,range(36,41),range(43,46))]:
        for x in xs:
            for y in ys:overlay[x+y*512]=base;frames[x+y*512]=y-43
    content.pop('OVERLAYPACK');content.pop('OVERLAYDATAPACK')
    raw=('\n'.join('['+k+']\n'+'\n'.join(f'{a}={b}' for a,b in v.items()) for k,v in content.items())+'\n'+pack('OverlayPack',overlay)+pack('OverlayDataPack',frames)).encode()
    (qa/'source.map').write_bytes(raw)
    cells,res,theater,tmps,meta=parse_map(raw,qa,'yr')
    source=dict(schema=1,sourceSha256=meta['sourceSha256'],version='yr',map=recipe(ini(raw),theater['effectiveRules']),rules=theater['effectiveRules'],art=res.art,cells=[{k:c.get(k) for k in CELL_FIELDS} for c in cells.values()])
    (qa/'source.json').write_text(json.dumps(source),'utf8')
    stock=json.loads(gzip.decompress((ROOT/'output/CrateAtlas-Toy-20261104/live/stock-yr.json.gz').read_bytes()))
    (qa/'stock.json').write_text(json.dumps(stock),'utf8')
    return raw


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'output/simulation-20261104');args=parser.parse_args();qa=args.output;qa.mkdir(exist_ok=True)
    raw=prepare(qa)
    node=ROOT.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
    subprocess.run([str(node),'verify-simulation.cjs',str(qa)],cwd=ROOT,check=True,creationflags=0x08000000)
    cases=json.loads((qa/'cases.json').read_text('utf8'))
    for case in cases:
        cells,res,theater,tmps,meta=parse_map(raw,qa,'yr',simulation=case['plan'])
        actual=[[c.get(k) for k in FIELDS] for c in cells.values()]
        assert actual==case['cells'],case['name']
        calculated=compute_analysis(cells,qa,meta,theater,lambda *args:None)
        assert calculated['probability']==case['probability'],case['name']+' probability'
        assert (qa/'search.bin').read_bytes()==(qa/(case['name']+'-search.bin')).read_bytes(),case['name']+' search order'
        assert [c['terms'] for c in cells.values()]==case['terms'],case['name']+' exact terms'
        print('PASS native/Toy cells, exact probability and search:',case['name'],flush=True)
    assert hashlib.sha256((qa/'source.map').read_bytes()).digest()==hashlib.sha256(raw).digest()
    (qa/'parser-verification.json').write_text(json.dumps(dict(status='PASS',cases=len(cases),cells=len(cells),sourceUnchanged=True,exactProbability=True,searchOrder=True)),'utf8')


if __name__=='__main__':main()
