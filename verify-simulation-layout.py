"""Local layout rebuilding against the original complete parsing path."""
from copy import deepcopy
import json
from pathlib import Path
import time
import runtime_bootstrap
from incremental_probability import session
from realmap_parser import parse_map
from realmap_approx import prepare
from realmap_resources import resources


def check(raw, folder, res, plans, approximate=False):
    def parse(plan, force=False):
        with session(force=force):
            value = parse_map(raw, folder, res.version, resource_context=res if hasattr(res, 'discovery') else None,
                              visual_only=approximate, simulation=plan)
            cells, _, theater, _, meta = value
            if approximate:
                if hasattr(res, 'discovery'):
                    meta.update(version='directory', engineVersion=res.version)
                prepare(cells, res, theater, meta)
            return value
    parse(None)
    rows = []
    for name, plan in plans:
        started = time.perf_counter()
        cells, _, theater, _, meta = parse(plan)
        ms = (time.perf_counter()-started)*1000
        before = deepcopy(cells)
        expected, _, other, _, oracle = parse(plan, True)
        assert list(cells) == list(expected), name+' order'
        for p in cells:
            assert cells[p] == expected[p], (name, p, {k:(cells[p].get(k),expected[p].get(k))
                for k in cells[p].keys() | expected[p].keys() if cells[p].get(k)!=expected[p].get(k)})
        assert theater['mapObjects'] == other['mapObjects'], name+' artwork records'
        assert cells == before, name+' mutated previous result'
        if approximate:
            assert meta['approximation'] == oracle['approximation'], name+' approximation'
        rows.append(dict(name=name, ms=ms, **meta['layoutUpdate']))
    return rows


if __name__ == '__main__':
    qa = Path('output/edit-optimization-20261104'); qa.mkdir(exist_ok=True)
    fixture = Path('output/simulation-20261104')
    raw = (fixture/'source.map').read_bytes()
    plans = [(v['name'], v['plan']) for v in json.loads((fixture/'cases.json').read_text('utf8'))]
    rows = {}
    for approximate in (False, True):
        rows[str(approximate)] = check(raw, qa, resources('yr'), plans, approximate)
        print('PASS', len(plans), 'local/full layouts, approximate=', approximate, flush=True)
    source = Path('D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II/SAVE537E-20261104-130952-917129.yrm')
    if source.is_file():
        from realmap_mod import ModResources
        raw = source.read_bytes(); res = ModResources(source.parent, source)
        cells, _, _, _, meta = parse_map(raw, qa, res.version, resource_context=res, visual_only=True)
        points = [p for p,c in cells.items() if c['usable'] and not c['occupied'] and c['overlay']==255 and c['rawLand']==0][:3]
        plan = dict(schema=1, map=dict(sha256=meta['sourceSha256'],version='directory'), objects={},overlays={},placements=[])
        plans = []
        for i,(x,y) in enumerate(points):
            plan['placements'].append(dict(id=f'sim-test-{i}',category='UNITS',type='MTNK',x=x,y=y,facing=64,subcell=0,onBridge=False))
            plans.append((f'user-map-{i}',deepcopy(plan)))
        plans.append(('user-map-undo',deepcopy(plans[0][1])))
        rows['directory'] = check(raw, qa, res, plans, True)
        assert source.read_bytes() == raw
        print('PASS actual directory map, local/full layouts and undo', flush=True)
    (qa/'layout-parity.json').write_text(json.dumps(dict(status='PASS',cases=rows),indent=2),'utf8')
