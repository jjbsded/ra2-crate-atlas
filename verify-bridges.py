"""Stock-map bridge integration regression; optional native oracle is separate."""
from collections import Counter
import json
from pathlib import Path
import zipfile

from realmap import ROOT, parse_map, analyze, ini
from realmap_bridges import elevated
from realmap_3d import build_patch

out = ROOT/'output/bridge-verification'
out.mkdir(exist_ok=True)
with zipfile.ZipFile(ROOT/'official-maps/maps.zip') as archive:
    for version, prefix in [('ra2',''),('yr','x')]:
        for stem, expected in [('mp31s2',dict(low=102)), ('mp18s3',dict(high=148,low=36))]:
            name = prefix+stem+'.map'
            folder = out/(version+'-'+stem)
            report = analyze(archive.read(version+'/'+name),folder,version,name)
            cells = report['cells']
            assert Counter(c['bridge']['kind'] for c in cells if c['bridge']) == expected
            assert not report['rendering']['missingSprites']
            for c in cells:
                if c['bridge'] and c['overlay'] != 255:
                    assert c['status']=='retry' and c['probability']==0
                if elevated(c):
                    assert c['track'] and c['float'] and c['foot']
            if 'high' in expected:
                free = [c for c in cells if elevated(c) and c['overlay']==255 and c['probability']>0]
                assert len(free)==33, (version,len(free))
                lookup={(c['x'],c['y']):c for c in cells}
                chosen=free[0]
                patch=build_patch(report,lookup,folder/'result.json',chosen['x'],chosen['y'],4)
                assert patch['metadata']['bridgeNote']
                decks=[(c,d) for c in patch['cells'] for d in c['decorations'] if d.get('bridge')=='high']
                assert decks and all(d['flat'] and d['level']==c['bridge']['deckLevel'] for c,d in decks)
            print('PASS',version,name,expected,flush=True)
    for name in ('xkaliforn.map','austintx.map','xmp30s6.map','xeb1.map'):
        folder=out/('yr-'+name.removesuffix('.map'))
        report=analyze(archive.read('yr/'+name),folder,'yr',name)
        cells={(c['x'],c['y']):c for c in report['cells']}
        assert not report['rendering']['missingSprites']
        assert not report['rendering']['objects']['missing']
        high = [c for c in cells.values() if elevated(c)]
        if name == 'xkaliforn.map':
            tree=cells[68,84]
            assert tree['occupiedGround'] and not tree['occupiedDeck'] and not tree['occupied']
            assert 'TREE18' in tree['objectsGround']
            assert tree['status']=='ghost' and tree['ghostReason']=='terrain'
            assert tree['candidate'] and tree['probability']==0
        elif name == 'austintx.map':
            assert any(c['occupiedDeck'] for c in high)
            assert all(c['occupied']==c['occupiedDeck'] for c in high)
            car=cells[79,47]
            assert car['occupiedDeck'] and car['probability']==0
            objects=json.loads((folder/'object-audit.json').read_text('utf8'))
            assert any(o['aboveGround'] for o in objects['records'])
        elif name == 'xmp30s6.map':
            invisible=cells[90,60]
            assert invisible['overlayName']=='LOBRDG13' and invisible['overlayData']==0
            assert invisible['bridge']['emptySprite']
            assert invisible['status']=='retry' and invisible['probability']==0
        else:
            gates=[c for c in cells.values() if any('GATE' in kind for kind in c['objects'])]
            assert gates and all(c['occupiedGround'] and c['probability']==0 for c in gates)
        print('PASS',name,'layered objects / transparent bridge / closed gate',flush=True)
    # Previously misplaced wood bridge TMPs are part of shipped original assets.
    cells, _, _, _, _ = parse_map(archive.read('yr/xcarville.map'),out,'yr')
    assert any(c['file'].startswith('ovrpsb') for c in cells.values())
    assert any(elevated(c) for c in cells.values())
    print('PASS: wooden bridge resources and layered initial object occupation',flush=True)

assert ini(b'[CAMEX01]\nBaseNormal=no\nBaseNormal=no\n',strict=True)['CAMEX01']['BASENORMAL']=='no'
try:
    ini(b'[CAMEX01]\nBaseNormal=no\nBaseNormal=yes\n',strict=True)
except ValueError:
    pass
else:
    raise AssertionError('conflicting duplicate must remain unsupported')
