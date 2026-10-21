"""Closing the renderer owns both its helper process and its pipe reader."""
import subprocess
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import realmap_voxel as voxel
from realmap_voxel import VoxelRenderer


class LifecycleChecks(unittest.TestCase):
    def test_prebuilt_worker_uses_source_hash_not_extraction_time(self):
        with tempfile.TemporaryDirectory(dir=voxel.ROOT/'output') as folder:
            root = Path(folder); source = root/'voxel-worker.cs'
            source.write_bytes(b'// test\r\n')
            exe = root/'output/realmap-tools/voxel-worker.exe'
            exe.parent.mkdir(parents=True); exe.write_bytes(b'prebuilt')
            exe.with_suffix('.sha256').write_text(voxel.worker_digest(source), 'utf8')
            os.utime(exe, (1, 1))
            source.write_bytes(b'// test\n')
            with patch.object(voxel, 'ROOT', root), patch.object(voxel.subprocess, 'run') as compile:
                self.assertEqual(voxel.ensure_worker(), exe)
                compile.assert_not_called()
                source.write_bytes(b'// changed\n')
                compile.return_value.returncode = 0
                self.assertEqual(voxel.ensure_worker(), exe)
                compile.assert_called_once()
                self.assertEqual(exe.with_suffix('.sha256').read_text('utf8'), voxel.worker_digest(source))

    def test_running_and_exited_process_pipes_are_closed(self):
        for script in ("import time; print('READY', flush=True); time.sleep(30)", "print('READY', flush=True)"):
            with self.subTest(script=script):
                renderer = VoxelRenderer.__new__(VoxelRenderer)
                renderer.process = subprocess.Popen([sys.executable, '-u', '-c', script],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    self.assertEqual(renderer.process.stdout.readline().strip(), 'READY')
                    renderer.reader = threading.Thread(target=lambda: list(renderer.process.stdout))
                    renderer.reader.start()
                    if 'sleep' not in script:
                        renderer.process.wait(timeout=5)
                    renderer.close()
                    renderer.close()  # Idempotent on cleanup after a failure.
                    self.assertIsNotNone(renderer.process.poll())
                    self.assertFalse(renderer.reader.is_alive())
                    self.assertTrue(renderer.process.stdin.closed)
                    self.assertTrue(renderer.process.stdout.closed)
                finally:
                    renderer.close()


if __name__ == '__main__':
    unittest.main()
