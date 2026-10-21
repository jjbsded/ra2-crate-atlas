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


def worker_digest(source):
    # Git and ZIP extraction can change timestamps / line endings, not the code.
    return hashlib.sha256(source.read_text(encoding='utf8').encode('utf8')).hexdigest()


def ensure_worker():
    exe = ROOT/'output/realmap-tools/voxel-worker.exe'
    source = ROOT/'voxel-worker.cs'
    stamp = exe.with_suffix('.sha256')
    digest = worker_digest(source)
    if not exe.is_file() or not stamp.is_file() or stamp.read_text('utf8').strip() != digest:
        csc = Path(os.environ.get('WINDIR', 'C:/Windows'))/'Microsoft.NET/Framework/v4.0.30319/csc.exe'
        exe.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run([str(csc), '/nologo', '/platform:x86', '/out:'+str(exe), str(source)],
            capture_output=True, creationflags=0x08000000, timeout=45)
        if result.returncode:
            raise ValueError('体素桥接组件构建失败：'+result.stdout.decode(errors='replace')[-500:])
        stamp.write_text(digest, 'utf8')
    return exe


class VoxelRenderer:
    def __init__(self, folder, vpl):
        dll = renderer_path()
        if not dll:
            raise ValueError('内置体素组件缺失，请重新完整解压工具包；源码运行也可用 CRATE_VOXEL_DLL 指定组件')
        self.folder = folder/'voxel-cache'; self.folder.mkdir(exist_ok=True)
        self.cache = {}
        exe = ensure_worker()
        vp = self.folder/'voxels.vpl'; vp.write_bytes(vpl)
        self.process = subprocess.Popen([str(exe), str(dll.parent), str(vp)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf8', creationflags=0x08000000)
        self.lines = queue.Queue()
        def read():
            try:
                for line in self.process.stdout:
                    self.lines.put(line.strip())
            except (UnicodeError, OSError, ValueError) as error:
                self.lines.put(error)
            finally:
                self.lines.put('ERROR 体素进程已退出')
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            if self.response() != 'READY':
                raise ValueError('体素组件初始化失败')
        except Exception:
            self.close()
            raise

    def response(self):
        try:
            line = self.lines.get(timeout=20)
        except queue.Empty:
            self.close()
            raise ValueError('体素渲染超时')
        if isinstance(line, Exception):
            self.close()
            raise ValueError('体素进程通信失败：'+str(line)) from line
        if line.startswith('ERROR'):
            raise ValueError(line)
        return line

    def close(self):
        process = getattr(self, 'process', None)
        if process is None:
            return
        try:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        finally:
            reader = getattr(self, 'reader', None)
            if reader:
                reader.join(timeout=2)
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    try:
                        stream.close()
                    except OSError:
                        pass

    def draw(self, vxl, hva, facing, offsets, angle, colors):
        if self.process.poll() is not None or self.process.stdin.closed:
            raise ValueError('体素进程已停止，无法继续绘制对象')
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
