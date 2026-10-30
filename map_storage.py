"""Lossless on-disk storage behind stable report/download URLs."""
from functools import wraps
import gzip
import json
import os
from pathlib import Path
import threading
import uuid
import zlib

PUBLICATION_LOCK = threading.RLock()
COMPRESSED_DOWNLOADS = {'result.json', 'cells.csv', 'rock-cells.csv', 'potential-rock-cells.csv'}


def synchronized(function):
    @wraps(function)
    def call(*args, **kwargs):
        with PUBLICATION_LOCK:
            return function(*args, **kwargs)
    return call


def storage_path(path):
    path = Path(path)
    compressed = path.with_name(path.name+'.gz')
    return compressed if path.suffix != '.gz' and compressed.is_file() else path


def read_bytes(path):
    path = storage_path(path)
    data = path.read_bytes()
    if path.suffix != '.gz':
        return data
    try:
        return gzip.decompress(data)
    except (OSError, EOFError, zlib.error) as error:
        raise ValueError('Compressed map data is damaged') from error


def read_json(path):
    return json.loads(read_bytes(path))


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@synchronized
def write_report(path, report, *, compressed=True):
    path = Path(path)
    plain = path.with_suffix('') if path.suffix == '.gz' else path
    target = plain.with_name(plain.name+'.gz') if compressed else plain
    data = json.dumps(report, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    atomic_bytes(target, gzip.compress(data, 6, mtime=0) if compressed else data)
    alternate = plain if compressed else plain.with_name(plain.name+'.gz')
    alternate.unlink(missing_ok=True)
    return target


@synchronized
def compress_downloads(folder):
    for name in COMPRESSED_DOWNLOADS-{'result.json'}:
        path = Path(folder)/name
        if path.is_file():
            raw = path.read_bytes()
            atomic_bytes(path.with_name(name+'.gz'), gzip.compress(raw, 6, mtime=0))
            path.unlink()


def accepts_gzip(header):
    encodings = {}
    for entry in header.lower().split(','):
        name, *params = entry.strip().split(';')
        quality = 1.0
        for param in params:
            if param.strip().startswith('q='):
                try:
                    quality = float(param.strip()[2:])
                except ValueError:
                    quality = 0
        encodings[name] = quality
    return encodings.get('gzip', encodings.get('*', 0)) > 0
