"""New terrain/overlay placement parity and native local artwork equivalence."""
import json
from pathlib import Path
import subprocess
import sys
from realmap_parser import parse_map
root=Path(__file__).resolve().parent
node=root.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
subprocess.run([str(node),'verify-simulation-tools.cjs'],check=True,cwd=root,creationflags=0x08000000)
raw=(root/'output/simulation-20261104/source.map').read_bytes()
fields=('x','y','overlay','overlayData','terrain','occupiedGround','occupiedDeck','land')
for case in json.loads((root/'output/simulation-tools-20261104/cases.json').read_text('utf8')):
 cells,*_=parse_map(raw,root/'output/simulation-20261104','yr',simulation=case['plan'])
 assert [[c.get(k) for k in fields] for c in cells.values()]==case['cells'],case['name']
 print('PASS native/Toy new tools:',case['name'])
