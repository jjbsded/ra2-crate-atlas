"""Pinned stock assets shipped with the tool; independent of optional Mod paths."""
from functools import lru_cache
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT/'assets/original'
FILES = {
    'ra2': ('ra2.mix', 281888480, '896a8b64f9f1bb8ad5e0bc64fc0b8ea8c84112494761ea1a43478d10c5ef9914'),
    'yr': ('ra2md.mix', 204527696, '69d886defad9114dd440a013b364c8c004e369b5221d1889957b49d00058559d'),
}


@lru_cache(maxsize=8)
def digest(path, size, modified):
    # Cache only while this file's size and modification time are unchanged.
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def asset(role):
    name, size, checksum = FILES[role]
    path = DATA/name
    try:
        stat = path.stat()
        if stat.st_size == size and digest(str(path.resolve()), stat.st_size, stat.st_mtime_ns) == checksum:
            return path.resolve()
    except OSError:
        pass
    raise ValueError('内置原版资源缺失或损坏，请重新完整解压工具包（'+name+'）')


def resolve(version):
    if version not in FILES:
        raise ValueError('未知资源版本')
    return tuple(str(asset(role)) for role in (('ra2','yr') if version == 'yr' else ('ra2',)))


def status():
    files = {}
    for role, (name, size, checksum) in FILES.items():
        error = None
        try:
            asset(role)
        except ValueError as failure:
            error = str(failure)
        files[role] = dict(name=name, size=size, sha256=checksum, ready=error is None, error=error)
    return dict(bundled=True, files=files,
                ready=dict(ra2=files['ra2']['ready'], yr=files['ra2']['ready'] and files['yr']['ready']))
