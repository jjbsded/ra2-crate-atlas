"""Exact incremental oracle: ordered C search, failures, ghosts, persistence, undo."""
import base64
from contextlib import closing
import json
from pathlib import Path
import random
import tempfile
import sqlite3
import sys
import time
import runtime_bootstrap
from incremental_probability import Store
from realmap import ensure_tools, run, TOOLS
from realmap_exact import calculate, read_search

ROOT = Path(__file__).resolve().parent
QA = ROOT/'output/incremental-probability-qa'


def full(grid, statuses, maximum, folder):
    (folder/'grid.bin').write_bytes(grid)
    run([TOOLS/'map-search.exe', folder/'grid.bin', folder/'search.bin', maximum, min(maximum+1, 32)])
    records = list(read_search(folder/'search.bin', maximum**2))
    result = calculate(records, {i: ('crate' if s == 1 else 'ghost') for i,s in enumerate(statuses) if s}, maximum**2)
    return records, result


def main():
    QA.mkdir(exist_ok=True); ensure_tools(); randomizer = random.Random(34819)
    cases = []; measurements = []
    for name, maximum in [('open', 239), ('mixed', 39), ('empty', 17), ('cap', 39)]:
        grid = bytearray(262144); statuses = bytearray(262144)
        for y in range(1, maximum+1):
            for x in range(1, maximum+1):
                k = y*512+x
                if name == 'empty':
                    continue
                if name == 'open':
                    grid[k] = 5; statuses[k] = 1
                else:
                    grid[k] = randomizer.choice([0, 0, 1, 2, 3, 5, 6, 7, 10, 14]) if name == 'mixed' else 1
                    statuses[k] = randomizer.randrange(3)
        records, original = full(grid, statuses, maximum, QA)
        store = Store(maximum, grid, statuses, records)
        assert store.calculate() == original
        baseline = bytes(grid), bytes(statuses)
        case = dict(name=name, maximum=maximum, grid=base64.b64encode(grid).decode(), statuses=base64.b64encode(statuses).decode(), edits=[])
        batches = [[(120*512+120, 4, 0)], [(120*512+130, 4, 0)], [(120*512+120, 5, 1)]] if name == 'open' else [
            [(randomizer.randint(1, maximum)*512+randomizer.randint(1, maximum), randomizer.randrange(16), randomizer.randrange(3)) for _ in range(1+i%5)] for i in range(12)]
        if name == 'empty':
            batches[0] = [(10*512+10, 5, 1)]
        # Status-only and origin-water-only edits matter without destination movement changes.
        batches += [[(2*512+2, grid[2*512+2], 2)], [(2*512+2, grid[2*512+2]^8, 2)]]
        for index, edits in enumerate(batches + [None]):
            if edits is None:
                edits = [(i, baseline[0][i], baseline[1][i]) for i in range(262144) if grid[i] != baseline[0][i] or statuses[i] != baseline[1][i]]
            for k,g,s in edits:
                grid[k] = g; statuses[k] = s
            started = time.perf_counter(); rows, stats = store.update(grid, statuses, changed_keys=[k for k,_,_ in edits] if index%2==0 else None); result = store.calculate(); elapsed = time.perf_counter()-started
            started = time.perf_counter(); records, expected = full(grid, statuses, maximum, QA); full_seconds = time.perf_counter()-started
            assert store.export() == (QA/'search.bin').read_bytes(), (name, index, 'search')
            assert result == expected, (name, index, 'probability')
            if name == 'open' and index == 0:
                assert stats['searchedOrigins'] == 1 and stats['touchedDestinations'] == 9, stats
                assert result['cells'][10*512+10] == original['cells'][10*512+10], 'Distant probability must remain unchanged'
                assert result['exact']['coefficients'] == original['exact']['coefficients'], 'New candidate counts must retain fixed IDs and coefficients'
            if name == 'open' and index == len(batches)-2:
                assert result['finalSuccess']+result['finalFailure']==1
            if name == 'open' and index == 1:
                assert store.kernel['coefficientsReused'] and store.kernel['evaluatedDestinations'] == 9
            with tempfile.TemporaryDirectory(dir=QA) as temp:
                path = Path(temp)/'cache.sqlite'; store.save(path, name)
                reloaded = Store.load(path, name)
                assert reloaded.export() == store.export() and reloaded.calculate() == result
                # A stale writer must replace its snapshot instead of mixing rows.
                stale = Store.load(path, name); store.save(path, name, [])
                stale.save(path, name, [])
                assert Store.load(path, name).export() == store.export()
                with closing(sqlite3.connect(path)) as db:
                    db.execute('UPDATE origins SET radius = 1 WHERE origin = 0')
                    db.commit()
                if store.radii[0] != 1:
                    try: Store.load(path, name)
                    except ValueError: pass
                    else: raise AssertionError('Corrupt cache was accepted')
            if index in (0, 1, len(batches)):
                measurements.append(dict(case=name, edit=index, incrementalSeconds=elapsed, fullSeconds=full_seconds, coefficientsReused=store.kernel['coefficientsReused'], evaluatedDestinations=store.kernel.get('evaluatedDestinations'), **stats))
            file = f'{name}-{index}.json'
            (QA/file).write_text(json.dumps(expected, separators=(',', ':')), 'utf8')
            case['edits'].append(dict(changes=edits, expected=file, search=base64.b64encode(store.export()).decode(), stats=stats))
        cases.append(case)
        print('PASS', name, len(case['edits']), flush=True)
    (QA/'cases.json').write_text(json.dumps(cases, separators=(',', ':')), 'utf8')
    (QA/'native.json').write_text(json.dumps(dict(status='PASS', cases=sum(len(c['edits']) for c in cases), measurements=measurements), indent=2), 'utf8')
    print(json.dumps(measurements, indent=2))


def verify_maps(folder):
    from incremental_probability import session, _memory
    from realmap_parser import parse_map
    from realmap import compute_analysis
    raw = (folder/'source.map').read_bytes()
    cases = json.loads((folder/'cases.json').read_text('utf8'))
    for i, case in enumerate(cases):
        cells, res, theater, _, meta = parse_map(raw, folder, 'yr', simulation=case['plan'])
        with session():
            result = compute_analysis(cells, folder, meta, theater, lambda *args: None)
        assert result['probability'] == case['probability'], case['name']
        assert [c['terms'] for c in cells.values()] == case['terms'], case['name']
        assert (folder/'search.bin').read_bytes() == (folder/(case['name']+'-search.bin')).read_bytes()
        if i % 3 == 2:
            _memory.clear()
    print('PASS incremental map layouts:', len(cases), flush=True)


if __name__ == '__main__':
    main()
    if len(sys.argv) > 1:
        verify_maps(Path(sys.argv[1]))
