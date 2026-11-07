"""Identical concurrent work, fresh publication stamps and isolated directory settings."""
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from time import sleep,perf_counter
from unittest.mock import patch
import json
import runtime_bootstrap
from map_storage import singleflight
import map_results as M
import realmap_mod as D

calls=[]
@singleflight
@lru_cache(maxsize=2)
def read(key):
    calls.append(key);sleep(.025)
    if key=='bad':raise ValueError('retryable')
    return object()
with ThreadPoolExecutor(max_workers=8) as pool:
    values=list(pool.map(read,['same']*8))
assert calls==['same'] and all(v is values[0] for v in values)
with ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(read,['different-a','different-b']))
assert len(calls)==3
for i in range(2):
    try:read('bad')
    except ValueError:pass
assert calls.count('bad')==2
print('PASS identical reads coalesce, independent keys proceed, failures retry')

with TemporaryDirectory() as temporary:
    root=Path(temporary);path=root/'result.json';value={'metadata':{},'cells':[{'x':1,'y':2}]};path.write_text(json.dumps(value),'utf8')
    M.remember_report(path,value)
    with patch.object(M,'read_report',side_effect=AssertionError('Completed report was parsed again')):
        assert M.load_report(path)[0] is value
    changed={'metadata':{},'cells':[{'x':3,'y':4}]};path.write_text(json.dumps(changed)+' ','utf8')
    assert M.load_report(path)[0]==changed
    print('PASS completed report handoff skips JSON decode and invalidates on file replacement')
    game='D:/SteamLibrary/steamapps/common/Command & Conquer Red Alert II';rows=[]
    with patch.object(D,'ROOT',root),D.lookup_scope():
        for name,selected in [('first-directory',game),('same-directory',game),('builtin',''),('back-to-directory',game)]:
            started=perf_counter();state=D.configure(selected);rows.append({'name':name,'ms':(perf_counter()-started)*1000,'ready':state['ready']})
        assert state['ready'] and state['root'] and (root/'data/game-directory.json').is_file()
    Path('output/startup-qa/directory-switch.json').write_text(json.dumps(rows,indent=2),'utf8');print('PASS isolated real-directory switch',json.dumps(rows))
