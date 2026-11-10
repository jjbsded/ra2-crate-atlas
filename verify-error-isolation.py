"""Generate readable/error fixtures and compare the native and Toy models."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from realmap import analyze

ROOT = Path(__file__).resolve().parent


def main(game_root=None):
    spec=importlib.util.spec_from_file_location('partial_qa',ROOT/'verify-partial-loading.py')
    qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
    out=ROOT/'output/error-isolation-qa';out.mkdir(exist_ok=True)
    cases={
        'exact':qa.risk_fixture(),
        'missing-building':qa.risk_fixture('[BuildingTypes]\n9900=MYSTERY\n[MYSTERY]\nImage=NOART\n[Structures]\n0=Neutral,MYSTERY,256,14,14,0,None\n'),
        'missing-unit-art':qa.risk_fixture('[VehicleTypes]\n9900=MYSTERY\n[MYSTERY]\nImage=NOART\n[Units]\n0=Neutral,MYSTERY,256,14,14,0,None\n'),
        'corrupt-overlay':qa.risk_fixture('[OverlayPack]\n1=invalid!\n'),
        'invalid-cost':qa.risk_fixture('[Rough]\nTrack=oops\n'),
        'invalid-crate':qa.risk_fixture('[Crate]\nLand=ALIEN\n'),
        'unresolved-include':qa.risk_fixture('[#include]\n0=missing.ini\n'),
    }
    for name,raw in cases.items():
        folder=out/name;folder.mkdir(exist_ok=True)
        report=analyze(raw,folder,'yr',name+'.yrm',use_precomputed=False)
        assert report['probability'] and report['rendering']['image']
        print(name,len(report['markers']),report['metadata'].get('riskUnknownCellCount',0),flush=True)
        if name=='missing-building':
            target=ROOT/'output/error-isolation-missing-building';target.mkdir(exist_ok=True)
            for file in folder.iterdir():
                if file.is_file():shutil.copy2(file,target/file.name)
    (out/'cases.json').write_text(json.dumps(list(cases)),'utf8')
    subprocess.run(['node',str(ROOT/'verify-error-isolation.cjs')],cwd=ROOT,check=True)
    if game_root:
        report=analyze(b'[Basic]\nName=Directory recovery QA\n'+cases['exact'],ROOT/'output/error-isolation-directory','directory','directory.yrm',resource_root=str(game_root),use_precomputed=False)
        assert report['metadata']['approximate'] and report['markers']
        print('PASS actual game-directory risks:',len(report['markers']),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--game-root',type=Path);args=parser.parse_args();main(args.game_root)
