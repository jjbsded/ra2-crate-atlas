"""Stock MIX/rules/theater access, shared by analysis and rendering."""
from functools import lru_cache
import contextlib
import io
import re
from runtime_bootstrap import ROOT
import ra2mix
from realmap_format import ini, ini_integer, sha

THEATERS = {
    'SNOW': ('snow', 'sno', ['isosnomd.mix', 'isosnow.mix']),
    'TEMPERATE': ('temperat', 'tem', ['isotemmd.mix', 'isotemp.mix']),
    'URBAN': ('urban', 'urb', ['isourbmd.mix', 'isourb.mix']),
    'NEWURBAN': ('urbann', 'ubn', ['isoubnmd.mix', 'isoubn.mix']),
    'DESERT': ('desert', 'des', ['isodesmd.mix', 'isodes.mix']),
    'LUNAR': ('lunar', 'lun', ['isolunmd.mix', 'isolun.mix']),
}


def readmix(**kwargs):
    with contextlib.redirect_stdout(io.StringIO()):
        return ra2mix.read(**kwargs)


class Resources:
    def __init__(self, version, mix_paths):
        self.version = version
        self.mix_paths = mix_paths
        self.archives = [readmix(mix_filepath=mix_paths[0])]
        if version == 'yr':
            self.archives.insert(0, readmix(mix_filepath=mix_paths[1]))
        self.mix_cache = {}
        suffix = 'md' if version == 'yr' else ''
        local = self.mix('local' + suffix + '.mix')
        self.rules_bytes = local['rules' + suffix + '.ini']
        self.rules = ini(self.rules_bytes)
        self.art = ini(local['art' + suffix + '.ini'])

    def mix(self, name):
        if name not in self.mix_cache:
            data = next((m[name] for m in self.archives if name in m), None)
            self.mix_cache[name] = readmix(mix_data=data) if data else {}
        return self.mix_cache[name]

    def get(self, names, filename):
        for name in names:
            mix = self.mix(name)
            if filename in mix:
                return mix[filename]
        raise ValueError(f'原版资源中找不到 {filename}')

    def theater(self, name):
        if name not in THEATERS or self.version == 'ra2' and name in ('NEWURBAN', 'DESERT', 'LUNAR'):
            raise ValueError(f'所选游戏版本不支持气候 {name}')
        stem, ext, tilemix = THEATERS[name]
        # Original theaters also store TMPs (wood bridge ends, urban rubble)
        # in the regular theater archive, and some Overlay SHPs in ISO MIX.
        tilemix = tilemix + [stem+'md.mix', stem+'.mix', ext+'.mix']
        suffix = 'md' if self.version == 'yr' else ''
        cfgbytes = self.get(['local'+suffix+'.mix'], stem+suffix+'.ini')
        cfg = ini(cfgbytes)
        definitions = []
        for key in sorted((k for k in cfg if re.fullmatch(r'TILESET\d+', k)), key=lambda k: int(k[7:])):
            section = cfg[key]
            for n in range(1, ini_integer(section.get('TILESINSET', 0)) + 1):
                definitions.append((key, section['FILENAME'].lower()+f'{n:02d}.'+ext, section.get('SETNAME', key)))
        return dict(name=name, stem=stem, ext=ext, tilemix=tilemix, config=cfg, definitions=definitions,
                    configSha256=sha(cfgbytes), palette=self.get(['cachemd.mix', 'cache.mix'], 'iso'+ext+'.pal'))


@lru_cache(maxsize=2)
def _resources(version, mix_paths):
    return Resources(version, mix_paths)


def resources(version, mix_paths=None):
    from original_resources import resolve
    return _resources(version, tuple(mix_paths) if mix_paths else resolve(version))
