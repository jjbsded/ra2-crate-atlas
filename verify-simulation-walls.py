"""Apply the shared wall-removal delta through the Full native backend."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from realmap_simulation import apply

root = Path(__file__).resolve().parent
report = root/'output/wall-shortcut-qa/model.json'
node = root.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
subprocess.run([str(node), 'verify-simulation-walls.cjs', str(report)], cwd=root, check=True)
fixture = json.loads(report.read_text('utf8'))
source, plan = fixture['source'], fixture['plan']
rules, content = deepcopy(source['rules']), deepcopy(source['map'])
overlays = [v.upper() for k, v in sorted(rules['OVERLAYTYPES'].items(), key=lambda p: int(p[0]))]
cells = {(c['x'], c['y']): {**c, 'overlayName': overlays[c['overlay']] if c['overlay'] != 255 else None, 'removable': []} for c in source['cells']}
apply(plan, content, cells, rules, source['art'])
for point, overlay, frame in fixture['cells']:
    c = cells[tuple(map(int, point.split(',')))]
    assert (c['overlay'], c['overlayData']) == (overlay, frame), point
for identifier in plan['objects']:
    section, entry = identifier.split('/', 1)
    assert entry not in content[section]
assert 'qa-immune' in content['STRUCTURES'] and 'qa-zero' in content['STRUCTURES']
print('PASS Full native wall-removal delta matches Toy model across all overlays and object removals')
