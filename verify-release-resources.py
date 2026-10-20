"""Prevent local Mod files from being copied into a portable release."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import original_resources as stock

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('builder',ROOT/'build-portable.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


class ReleaseResources(unittest.TestCase):
    def test_only_verified_stock_archives_are_packaged(self):
        (ROOT/'output').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'output') as name:
            root=Path(name);data=root/'source';data.mkdir();target=root/'release'
            content=b'original test resource'
            expected={role:(filename,len(content),hashlib.sha256(content).hexdigest())
                      for role,filename in (('ra2','ra2.mix'),('yr','ra2md.mix'))}
            for filename,_,_ in expected.values(): (data/filename).write_bytes(content)
            for filename in ('expandmd99.mix','custom-unit.shp','rulesmd.ini','mod-profile.json'):
                (data/filename).write_bytes(b'must stay local')
            with patch.object(stock,'DATA',data),patch.object(stock,'FILES',expected):
                builder.copy_stock_resources(target)
                self.assertEqual({p.name for p in (target/'assets/original').iterdir()}, {'ra2.mix','ra2md.mix'})
                (data/'ra2md.mix').write_bytes(b'changed resource')
                with self.assertRaises(ValueError):
                    builder.copy_stock_resources(root/'invalid-release')
                self.assertFalse((root/'invalid-release').exists())


if __name__=='__main__':unittest.main()
