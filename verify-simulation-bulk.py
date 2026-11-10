"""Compare the shared model's new deltas with the Full native application."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
from realmap_simulation import apply, changed_points

root = Path(__file__).resolve().parent
report = root/'output/bulk-tools-qa/model.json'
node = root.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
subprocess.run([str(node), 'verify-simulation-bulk.cjs', str(report)], cwd=root, check=True)
cases = json.loads(report.read_text('utf8'))
for case in cases:
    source, plan = case['source'], case['plan']
    rules, content = deepcopy(source['rules']), deepcopy(source['map'])
    overlays = [v.upper() for k, v in sorted(rules['OVERLAYTYPES'].items(), key=lambda p: int(p[0]))]
    cells = {(c['x'], c['y']): {**c, 'overlayName': overlays[c['overlay']] if c['overlay'] != 255 else None, 'removable': []} for c in source['cells']}
    rubble = apply(plan, content, cells, rules, source['art'])
    for entry, line in rubble:
        content['STRUCTURES'][entry] = line
    for section in ('STRUCTURES', 'UNITS', 'INFANTRY', 'AIRCRAFT', 'TERRAIN'):
        assert content.get(section, {}) == case['map'].get(section, {}), (case['name'], section)
    for point, overlay, frame in case['cells']:
        cell = cells[tuple(map(int, point.split(',')))]
        assert (cell['overlay'], cell['overlayData']) == (overlay, frame), (case['name'], point)
    dirty = changed_points(dict(cells=cells, rules=source['rules'], art=source['art'], m=source['map']), plan, None)
    for identifier in plan['objects']:
        section, entry = identifier.split('/', 1)
        fields = source['map'][section][entry].split(',')
        point = (int(entry) % 1000, int(entry) // 1000) if section == 'TERRAIN' else (int(fields[3]), int(fields[4]))
        assert point in dirty, (case['name'], identifier)
    # Bad magnetic imports must still fail native validation.
    for identifier, mode in [('UNITS/missing', 'magnet'), ('STRUCTURES/missing', 'other')]:
        bad = dict(objects={identifier: mode}, overlays={}, placements=[])
        try:
            apply(bad, deepcopy(source['map']), deepcopy(cells), deepcopy(source['rules']), source['art'])
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid magnetic delta accepted')
print(f'PASS {len(cases)} Full native/Toy bulk and magnetic cases; object/overlay parity and local dirty footprints')
