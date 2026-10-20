"""Local CncVxlRenderText bridge, isolated in a 32-bit process with timeouts."""
import hashlib
import os
from pathlib import Path
import queue
import struct
import subprocess
import threading

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent


def renderer_path():
    candidates = [os.environ.get('CRATE_VOXEL_DLL', ''), ROOT/'runtime/voxel/CncVxlRenderText.dll']
    return next((Path(p) for p in candidates if p and Path(p).is_file()), None)


class VoxelRenderer:
    def __init__(self, folder, vpl):
        dll = renderer_path()
        if not dll:
            raise ValueError('内置体素组件缺失，请重新完整解压工具包；源码运行也可用 CRATE_VOXEL_DLL 指定组件')
        self.folder = folder/'voxel-cache'; self.folder.mkdir(exist_ok=True)
        self.cache = {}
        exe = ROOT/'output/realmap-tools/voxel-worker.exe'
        source = ROOT/'voxel-worker.cs'
        if not exe.exists() or exe.stat().st_mtime < source.stat().st_mtime:
            csc = Path(os.environ.get('WINDIR', 'C:/Windows'))/'Microsoft.NET/Framework/v4.0.30319/csc.exe'
            exe.parent.mkdir(parents=True, exist_ok=True)
            result = subprocess.run([str(csc), '/nologo', '/platform:x86', '/out:'+str(exe), str(source)],
                capture_output=True, creationflags=0x08000000, timeout=45)
            if result.returncode:
                raise ValueError('体素桥接组件构建失败：'+result.stdout.decode(errors='replace')[-500:])
        vp = self.folder/'voxels.vpl'; vp.write_bytes(vpl)
        self.process = subprocess.Popen([str(exe), str(dll.parent), str(vp)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf8', creationflags=0x08000000)
        self.lines = queue.Queue()
        def read():
            for line in self.process.stdout:
                self.lines.put(line.strip())
            self.lines.put('ERROR 体素进程已退出')
        threading.Thread(target=read, daemon=True).start()
        if self.response() != 'READY':
            self.close()
            raise ValueError('体素组件初始化失败')

    def response(self):
        try:
            line = self.lines.get(timeout=20)
        except queue.Empty:
            self.close()
            raise ValueError('体素渲染超时')
        if line.startswith('ERROR'):
            raise ValueError(line)
        return line

    def close(self):
        if hasattr(self, 'process') and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=5)

    def draw(self, vxl, hva, facing, offsets, angle, colors):
        checksum = hashlib.sha256(vxl+hva).hexdigest()
        key = checksum, facing, tuple(offsets), angle
        if key not in self.cache:
            vp, hp = self.folder/(checksum+'.vxl'), self.folder/(checksum+'.hva')
            if not vp.exists():
                vp.write_bytes(vxl); hp.write_bytes(hva)
            out = self.folder/'frame.bin'
            request = [vp, hp, facing, *offsets, angle, out]
            self.process.stdin.write('\t'.join(map(str, request))+'\n'); self.process.stdin.flush()
            self.response()
            raw = out.read_bytes()
            w,h,x,y,sw,sh,sx,sy = struct.unpack_from('<8i', raw)
            body = np.frombuffer(raw[32:32+w*h], dtype=np.uint8).reshape(h,w).copy()
            shadow = Image.frombytes('L', (sw,sh), raw[32+w*h:]).point(lambda a: 128 if a else 0) if sw and sh else None
            # The DLL uses a 256 x 256 virtual canvas, coordinates relative to its centre.
            self.cache[key] = body, shadow, x-128, y-128, sx-128, sy-128
        body,shadow,x,y,sx,sy = self.cache[key]
        rgba = np.zeros((*body.shape,4), dtype=np.uint8)
        rgba[:,:,:3] = np.asarray(colors,dtype=np.uint8)[body]
        rgba[:,:,3] = np.where(body,255,0)
        return Image.fromarray(rgba), shadow, x,y,sx,sy
