"""Pixel-exact map images and bounded, optional idle recompression."""
from collections import deque
import hashlib
import io
import json
import logging
from pathlib import Path
import threading
import time
from map_storage import PUBLICATION_LOCK, atomic_bytes, read_json


def save_image(image, path):
    path = Path(path)
    # WebP has a dimension limit. Keep PNG for larger valid maps or runtimes
    # without this encoder; neither fallback reduces dimensions or colors.
    if max(image.size) <= 16383:
        try:
            target = path.with_suffix('.webp')
            image.save(target, format='WEBP', lossless=True, exact=True, method=0)
            return target.name
        except (OSError, ValueError):
            target.unlink(missing_ok=True)
    target = path.with_suffix('.png')
    image.save(target, format='PNG')
    return target.name


def save_layers(ground, scene, folder, version):
    from PIL import ImageChops
    filename = save_image(ground, Path(folder)/f'ground-v{version}')
    # Check every channel, including RGB values of transparent pixels.
    identical = (ground.mode == scene.mode and ground.size == scene.size and
                 ImageChops.difference(ground, scene).getbbox(alpha_only=False) is None)
    other = filename if identical else save_image(scene, Path(folder)/f'objects-v{version}')
    return filename, other


def optimize(folder, on_commit=lambda: None, idle=lambda: True):
    from PIL import Image
    folder = Path(folder)
    report = read_json(folder/'result.json')
    rendering = report.get('rendering', {})
    marker = folder/'images-optimized.json'
    try:
        completed = json.loads(marker.read_text('utf8'))
        if not isinstance(completed, dict):
            completed = {}
    except (OSError, ValueError):
        completed = {}
    for name in sorted({rendering.get('image'), rendering.get('objectImage')}-{None}):
        if not idle():
            return False
        path = (folder/name).resolve()
        if path.suffix != '.webp' or not path.is_relative_to(folder.resolve()):
            continue
        raw = path.read_bytes(); before = hashlib.sha256(raw).hexdigest()
        if completed.get(name) == before:
            continue
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            buffer = io.BytesIO()
            image.save(buffer, format='WEBP', lossless=True, exact=True, method=3)
            encoded = buffer.getvalue()
            with Image.open(io.BytesIO(encoded)) as restored:
                if restored.size != image.size or restored.convert(image.mode).tobytes() != image.tobytes():
                    raise ValueError('Lossless image verification failed')
        with PUBLICATION_LOCK:
            # A concurrent render/refresh may have replaced this file meanwhile.
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != before:
                continue
            if len(encoded) < len(raw):
                atomic_bytes(path, encoded)
                before = hashlib.sha256(encoded).hexdigest()
            completed[name] = before
            atomic_bytes(marker, json.dumps(completed).encode('utf8'))
            on_commit()  # Publish matching render-cache checksums in this lock.
    return True


class IdleOptimizer:
    def __init__(self, idle):
        self.idle = idle
        self._queue = deque(maxlen=8)
        self._lock = threading.Lock()
        self._thread = None

    def submit(self, folder, on_commit):
        with self._lock:
            if not any(item[0] == folder for item in self._queue):
                self._queue.append((folder, on_commit))
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, daemon=True, name='map-image-compression')
                self._thread.start()

    def _run(self):
        while True:
            with self._lock:
                if not self._queue:
                    self._thread = None
                    return
                folder, on_commit = self._queue[0]
            if not self.idle():
                time.sleep(.5)
                continue
            try:
                finished = optimize(folder, on_commit, self.idle)
            except Exception as error:
                logging.getLogger(__name__).warning('Map image recompression skipped: %s', error)
                finished = True  # Fast lossless originals remain usable.
            if finished:
                with self._lock:
                    if self._queue and self._queue[0][0] == folder:
                        self._queue.popleft()
