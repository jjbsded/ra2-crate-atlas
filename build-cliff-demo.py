"""Rebuild the offline teaching fixture from the bundled, verified stock map."""
import json

from realmap import analyze
from realmap_3d import build_patch, relation_data
from realmap_parser import land_after
from realmap_resources import resources
from runtime_bootstrap import ROOT


def single_peak(real):
    flat = next(c for c in real['cells'] if c['file'] == 'clear01.sno' and not c['slope'])
    rough = next(c for c in real['cells'] if (c['x'], c['y']) == (99, 105))
    wall = next(c['wallTexture'] for c in real['cells'] if c['wallTexture'] and c['file'].startswith('cliff'))
    cells = []
    for y in range(101, 110):
        for x in range(95, 104):
            high, exception = (x, y) == (98, 106), (x, y) == (99, 105)
            cells.append(dict(x=x, y=y, level=6 if high else 2, slope=0,
                              rawLand=3 if high else 7 if exception else 0,
                              texture=(rough if exception else flat)['texture'], wallTexture=wall,
                              walls=[None]*4, corners=[0]*4, decorations=[], occupied=False,
                              probability=None, potentialMarked=False))
    lookup = {(c['x'], c['y']): c for c in cells}
    crate = resources('yr').rules['CRATE']
    for c in cells:
        c['higher'], c['affected'] = relation_data(c, lookup, True)
        c['land'] = land_after(c['rawLand'], 0, None, c['higher'], 2)
        c['postLand'] = land_after(c['rawLand'], 0, crate, c['higher'], 2)
        # Teaching placement compares ground attributes, not random crate odds.
        c['canPlace'] = c['land'] in (0, 7)
        c['marked'] = c['canPlace'] and c['postLand'] == 3
    return dict(version=real['version'], center=[99, 105], radius=4, cells=cells,
                bounds=[95, 101, 103, 109], reliefs={},
                metadata=dict(filename='孤立单高格示例', theater='SNOW', predictionEnabled=True,
                              demonstration='single', uniqueTiles=3, missing=[],
                              sourceDescription='示意布局 · 高格 L6 / 低格 L2 · 使用原版雪地贴图；只演示地面属性变化，不计算随机箱子概率或完整可达路线。'))


def main():
    folder = ROOT/'output/cliff-demo-build'
    source = ROOT/'examples/xmp32s8.map'
    report = analyze(source.read_bytes(), folder, 'yr', filename=source.name)
    lookup = {(c['x'], c['y']): c for c in report['cells']}
    real = build_patch(report, lookup, folder/'result.json', 99, 105, 4)
    assert real['metadata']['version'] == 'yr' and not real['metadata']['missing']
    bundle = dict(schema=1, source='examples/xmp32s8.map', sourceSha256=report['metadata']['sourceSha256'],
                  real=real, single=single_peak(real))
    target = ROOT/'examples/cliff-demo.json'
    target.write_text(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')), 'utf8')
    print(f'{target.name}: {target.stat().st_size:,} bytes; stock YR only')


if __name__ == '__main__':
    main()
