"""Full native/Toy parity for placed oil rubble and its removal."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
from realmap_simulation import apply, changed_points

root = Path(__file__).resolve().parent
report = root/'output/oil-rubble-qa/cases.json'
node = root.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
subprocess.run([str(node), 'verify-oil-rubble.cjs', str(report)], cwd=root, check=True)
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
        c = cells[tuple(map(int, point.split(',')))]
        assert (c['overlay'], c['overlayData']) == (overlay, frame), (case['name'], point)
    if plan['placements']:
        item = plan['placements'][0]
        dirty = changed_points(dict(cells=cells, rules=source['rules'], art=source['art'], m=source['map']), plan, None)
        assert {(item['x']+dx,item['y']+dy) for dx in range(2) for dy in range(2)} <= dirty
print(f'PASS {len(cases)} Full native/Toy rubble cases, exact object/overlay parity and complete local footprint')
