"""Baked artwork parity and cache invalidation across the full/Toy boundary."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import runtime_bootstrap
from PIL import Image, ImageChops
from map_test_fixtures import fixture
from realmap import analyze
from toy_original import capture, capture_stamp
from toy_live_objects import frame_stamp

ROOT=Path(__file__).resolve().parent


class BakedLightingChecks(unittest.TestCase):
    def test_component_rules_invalidate_supplemental_library_only(self):
        before = (capture_stamp(), frame_stamp())
        read_text = Path.read_text
        def changed(path, *args, **kwargs):
            value = read_text(path, *args, **kwargs)
            return value+'\n# changed component keys\n' if path.name == 'toy_object_components.py' else value
        with patch.object(Path, 'read_text', changed):
            self.assertEqual(before[0], capture_stamp())
            self.assertNotEqual(before[1], frame_stamp())

    def test_lighting_and_worker_changes_invalidate_both_caches(self):
        before=(capture_stamp(),frame_stamp())
        read_text=Path.read_text
        for name in ('realmap_voxel_lighting.py','realmap_voxel_normals.py','realmap_voxel_light_tables.py','realmap_palette_lighting.py',
                     'realmap_voxel_shadow.py','realmap_terrain_variants.py'):
            def changed(path,*args,**kwargs):
                value=read_text(path,*args,**kwargs)
                return value+'\n# changed lighting input\n' if path.name==name else value
            with patch.object(Path,'read_text',changed):
                after=(capture_stamp(),frame_stamp())
                self.assertTrue(all(a!=b for a,b in zip(before,after)),name)
        read_bytes=Path.read_bytes
        def changed_worker(path):
            value=read_bytes(path)
            return value+b'changed worker' if path.name=='voxel-worker.exe' else value
        with patch.object(Path,'read_bytes',changed_worker):
            self.assertTrue(all(a!=b for a,b in zip(before,(capture_stamp(),frame_stamp()))))
        self.assertEqual(before,(capture_stamp(),frame_stamp()))

    def test_recorded_layers_match_full_renderer_without_raster_writes(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'output') as temp:
            work=Path(temp);source=work/'source';cache=work/'capture'
            report=analyze(fixture(objects=True,extra='[Lighting]\nAmbient=.65\nLevel=.032\n'),source,'yr','lighting.yrm',use_precomputed=False)
            report_path=source/'result.json'
            report_path.write_text(json.dumps(report),'utf8')
            with patch('map_images.save_layers',side_effect=AssertionError('Recorder tried to save a raster')):
                trace=json.loads(gzip.decompress(Path(capture(report_path,cache)).read_bytes()))
            for layer,field in (('ground','image'),('objectsLayer','objectImage')):
                result=Image.new('RGB',trace['size'],'#18232b')
                for key,x,y in trace[layer]:
                    with Image.open(cache/'pixels'/(key+'.png')) as sprite:result.paste(sprite,(x,y),sprite)
                with Image.open(source/report['rendering'][field]) as expected:
                    self.assertEqual(result.size,expected.size)
                    self.assertIsNone(ImageChops.difference(result,expected.convert('RGB')).getbbox(),layer)
            self.assertTrue(trace['objects'])

    def test_atlas_reuse_requires_identical_pixels(self):
        spec=importlib.util.spec_from_file_location('original_builder',ROOT/'build-toy-original.py')
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory(dir=ROOT/'output') as temp:
            root=Path(temp);cache=root/'cache';(cache/'pixels').mkdir(parents=True)
            out=root/'out';(out/'art').mkdir(parents=True)
            previous=root/'previous';previous.mkdir()
            image=Image.new('RGBA',(4,4),(12,34,56,255));image.save(cache/'pixels/frame.png')
            image.save(previous/'old.webp',lossless=True,exact=True)
            pages=builder.reusable_atlases(previous)
            task=(0,[('frame',0,0,4,4)],(4,4),cache,out)
            _,info=builder.atlas_job(task,pages)
            self.assertEqual(info['file'],'old.webp')
            self.assertEqual((out/'art/old.webp').read_bytes(),(previous/'old.webp').read_bytes())
            image.putpixel((0,0),(200,100,50,255));image.save(cache/'pixels/frame.png')
            _,info=builder.atlas_job(task,pages)
            self.assertNotEqual(info['file'],'old.webp')
            with Image.open(out/'art'/info['file']) as actual:self.assertEqual(actual.convert('RGBA').tobytes(),image.tobytes())


if __name__=='__main__':unittest.main()
