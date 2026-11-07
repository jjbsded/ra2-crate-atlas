"""Empty registries, approximate editing and verified tree resource regressions."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import runtime_bootstrap
from map_test_fixtures import fixture
from realmap import analyze
from realmap_parser import map_rules
from realmap_format import ini
from realmap_resources import resources
from realmap_sprites import sprite_spec, shp_frame
from map_results import simulation_source
from map_jobs import MapJobs

ROOT = runtime_bootstrap.ROOT


class SimulationLoading(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'output')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def read(self, raw, name='base', **kwargs):
        return analyze(raw, self.folder/name, 'yr', 'fixture.map', use_precomputed=False, **kwargs)

    def test_empty_registrations_are_informational_only(self):
        raw=fixture(extra='[VehicleTypes]\n80=VISC_LRG\n81=VISC_SML\n[VISC_SML]\n')
        report=self.read(raw)
        self.assertFalse(report['metadata'].get('approximate'))
        self.assertEqual(len([w for w in report['metadata']['warnings'] if '仅为空注册项' in w]),2)
        self.assertFalse(report['metadata']['loadIssues'])
        res=resources('yr')
        for reference in ('[Units]\n0=Neutral,VISC_LRG,256,20,20,0,Guard\n', '[TEST]\nUnloadingClass=VISC_LRG\n'):
            with self.assertRaisesRegex(ValueError,'VISC_LRG'):
                map_rules(ini(raw+reference.encode()),res,[])

    def test_approximate_simulation_and_invalid_plan(self):
        raw=fixture(extra='[VehicleTypes]\n80=MYSTERY\n[Units]\n0=Neutral,MYSTERY,256,20,20,0,Guard\n')
        report=self.read(raw); self.assertTrue(report['metadata']['approximate'])
        source=simulation_source(report,self.folder/'base/result.json')
        point=next(c for c in source['cells'] if c['usable'] and c['rawLand']==0 and (c['x'],c['y'])!=(20,20))
        plan=dict(schema=1,map=dict(sha256=source['sourceSha256'],version='yr'),objects={},overlays={},placements=[dict(id='sim-test',type='MTNK',category='UNITS',x=point['x'],y=point['y'],facing=64,subcell=0,onBridge=False)])
        edited=self.read(raw,'edited',simulation=plan)
        self.assertTrue(edited['metadata']['approximate'])
        self.assertEqual(edited['metadata']['simulationPlan'],plan)
        unknown=next(c for c in edited['cells'] if (c['x'],c['y'])==(20,20))
        self.assertTrue(unknown['assumedRetry'])
        placed=next(c for c in edited['cells'] if (c['x'],c['y'])==(point['x'],point['y']))
        self.assertIn('MTNK',placed['objects']); self.assertTrue(placed['occupied'])
        self.assertEqual((self.folder/'edited/source.map').read_bytes(),raw)
        plan['objects']={'UNITS/no-such-object':'delete'}
        with self.assertRaisesRegex(ValueError,'不存在'):
            self.read(raw,'invalid',simulation=plan)

    def test_directory_submission_retains_selected_resources(self):
        raw=fixture(); report=self.read(raw)
        report['metadata'].update(version='directory',approximate=True,previewOnly=False)
        # Exercise routing with a pinned context, not global settings.
        from types import SimpleNamespace
        res=SimpleNamespace(discovery={'config':{'root':'D:/selected-game'}})
        plan=dict(schema=1,map=dict(sha256=report['metadata']['sourceSha256'],version='directory'),objects={},overlays={},placements=[])
        with patch('map_jobs.result_path',return_value=self.folder/'base/result.json'), patch('map_jobs.load_report',return_value=(report,{})), patch('map_jobs.resource_context',return_value=(res,{})), patch.object(MapJobs,'submit',return_value={'id':'test'}) as submit:
            MapJobs().simulate({'result':'test','plan':plan})
        self.assertEqual(submit.call_args.kwargs['resource_root'],'D:/selected-game')
        self.assertEqual(submit.call_args.kwargs['simulation'],plan)
        self.assertIsNone(submit.call_args.args[3])

    def test_tree_bytes_and_climate_are_preserved(self):
        manifest=json.loads((ROOT/'assets/urban-trees/provenance.json').read_text('utf8'))
        res=resources('yr'); theater=res.theater('URBAN'); theater['effectiveRules']=res.rules
        for n in range(29,36):
            raw,colors,_,meta=sprite_spec(f'TREE{n}',False,0,res,theater)
            self.assertEqual(meta['file'],f'tree{n}.urb')
            self.assertEqual(hashlib.sha256(raw).hexdigest(),manifest['files'][meta['file']]['sha256'])
            self.assertIsNotNone(shp_frame(raw,0,colors).getbbox())
        with self.assertRaises(ValueError):
            res.get(['urban.mix'],'tree29.tem')

    def test_toy_rules_and_approximate_materialization(self):
        stock=ROOT/'output/CrateAtlas-Toy-Simulation-20261104/live/stock-yr.json.gz'
        (self.folder/'stock.json').write_bytes(gzip.decompress(stock.read_bytes()))
        for name,extra in [('empty','[VehicleTypes]\n80=VISC_LRG\n81=VISC_SML\n[VISC_SML]\n'),('unknown','[VehicleTypes]\n80=MYSTERY\n[Units]\n0=Neutral,MYSTERY,256,20,20,0,Guard\n')]:
            (self.folder/(name+'.map')).write_bytes(fixture(extra=extra))
        node=ROOT.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
        subprocess.run([str(node),'verify-simulation-loading.cjs',str(self.folder)],cwd=ROOT,check=True,creationflags=0x08000000)


if __name__=='__main__':unittest.main()
