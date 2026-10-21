"""Regression for the ten formerly unsupported stock maps, using bundled bytes."""
import json
import math
import zipfile

from realmap import ROOT, analyze, ini, parse_map
from realmap_bridges import initialize

NAMES = ['ra2/mp19t4.map', 'ra2/mp24du.map', 'ra2/mp05t4.map', 'ra2/mp05mw.map',
         'ra2/mp11t2.map', 'ra2/mp33u4.map', 'yr/xmp33u4.map',
         'yr/c1a02md.map', 'yr/c3y03md.map', 'yr/c3y02md.map']
out = ROOT/'output/remaining-map-verification'
out.mkdir(exist_ok=True)
results = []
with zipfile.ZipFile(ROOT/'official-maps/maps.zip') as archive:
    for member in NAMES:
        raw = archive.read(member)
        version, name = member.split('/')
        folder = out/(version+'-'+name.removesuffix('.map'))
        report = analyze(raw, folder, version, name)
        cells = {(c['x'], c['y']): c for c in report['cells']}
        assert all(math.isfinite(c['probability']) and c['probability'] >= 0 for c in cells.values())
        assert not report['rendering']['missingSprites'], (member, report['rendering']['missingSprites'])
        assert not report['rendering']['objects']['missing'], (member, report['rendering']['objects']['missing'])
        if member in NAMES[:5]:
            ore = [c for c in cells.values() if c['slope'] and any(o['category']=='mineral' for o in c['removable'])]
            assert ore and all(1 <= c['slope'] <= 4 and c['status']=='retry' and c['probability']==0 for c in ore)
        if name in ('mp33u4.map', 'xmp33u4.map'):
            assert (18, 68) not in cells
            assert all(cells[18, y]['bridge']['kind']=='high' for y in (69, 70, 71, 72))
        empty = report['metadata']['emptyFoundationObjects']
        if name in ('c1a02md.map', 'c3y03md.map'):
            assert len(empty) == (1 if name == 'c1a02md.map' else 2)
            assert len([o for o in report['rendering']['objects']['hidden']
                        if o['reason']=='registered-empty-foundation']) == len(empty)
            for obj in empty:
                assert obj['type'] not in cells[obj['x'], obj['y']]['objects']
            # Health is not the reason for the empty footprint.
            modified = raw
            for obj in empty:
                modified = modified.replace((obj['type']+',0,').encode(), (obj['type']+',256,').encode())
            comparison, _, _, _, meta = parse_map(modified, folder, version)
            assert len(meta['emptyFoundationObjects']) == len(empty)
            assert all(c['occupied']==comparison[p]['occupied'] for p,c in cells.items())
        if name == 'c3y02md.map':
            notes = report['metadata']['irrelevantDuplicateKeys']
            assert len(notes)==1 and notes[0]['key']=='SIGHT' and notes[0]['values']==['6','7']
        results.append(dict(map=member, cells=len(cells), probabilitySum=sum(c['probability'] for c in cells.values()),
                            emptyFoundations=len(empty), renderingVersion=report['rendering']['version']))
        print('PASS', member, flush=True)

# Do not weaken genuinely ambiguous or unverified input.
for raw in (b'[X]\nSight=1\nSight=2\n', b'[X]\nStrength=1\nStrength=2\n'):
    try:
        ini(raw, strict=True)
    except ValueError:
        pass
    else:
        raise AssertionError('default strict INI parsing must reject conflicting values')
try:
    ini(b'[X]\nStrength=1\nStrength=2\n', strict=True, irrelevant_duplicates=[])
except ValueError:
    pass
else:
    raise AssertionError('crate-relevant conflicts must not be exempted')
cells = {(10,10):dict(x=10,y=10,level=0,slope=0,overlay=24,overlayName='BRIDGE1')}
try:
    initialize(cells)
except ValueError:
    pass
else:
    raise AssertionError('a bridge deck extending outside the map must still fail')
(out/'verification.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n', 'utf8')
print('PASS: full probability/rendering analyses and conservative rejection guards')
