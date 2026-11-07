"""Exact delta summaries and block envelopes against complete native searches."""
from copy import deepcopy
from pathlib import Path
import random
from tempfile import TemporaryDirectory
import runtime_bootstrap
import numpy as np
from incremental_probability import Store
from realmap import ensure_tools, run, TOOLS
from realmap_exact import calculate, read_search

ensure_tools()
randomizer = random.Random(6841)
fast = fallback = 0
with TemporaryDirectory(prefix='crate-aggregate-test-') as temp:
    folder = Path(temp)
    for initially_empty in (False, True):
        maximum = 25
        grid, statuses = bytearray(262144), bytearray(262144)
        if not initially_empty:
            for y in range(1, maximum+1):
                for x in range(1, maximum+1):
                    grid[y*512+x], statuses[y*512+x] = 5, 1

        def oracle():
            (folder/'grid.bin').write_bytes(grid)
            run([TOOLS/'map-search.exe', folder/'grid.bin', folder/'search.bin', maximum, 26])
            records = list(read_search(folder/'search.bin', maximum**2))
            result = calculate(records, {k:('crate' if v == 1 else 'ghost') for k,v in enumerate(statuses) if v}, maximum**2)
            return records, result

        records, expected = oracle()
        store = Store(maximum, grid, statuses, records)
        assert store.calculate() == expected
        frozen = store.calculate()
        initial = deepcopy(frozen)
        for step in range(70):
            if step == 60:
                edits = [(x, y, 4, 0) for x in range(10, 18) for y in range(10, 18)]
            elif step == 61:
                edits = [(x, y, 5, 1) for x in range(10, 18) for y in range(10, 18)]
            elif step in (62, 63):
                edits = [(16, 16, 5, 2 if step == 62 else 1)]
            elif step == 69:
                edits = [(x,y,5,1) for x in range(1,26) for y in range(1,26)]
            else:
                edits = [(randomizer.choice([1, 15, 16, 17, 25]), randomizer.randint(1, 25),
                          *randomizer.choice([(4,0),(5,1)])) for _ in range(1+step%4)]
            keys = sorted({y*512+x for x,y,_,_ in edits})
            selected, examined = store.affected_envelopes(np.array(keys, dtype=np.int64))
            r = np.frombuffer(store.radii, np.uint8)
            mask = np.zeros(maximum**2, dtype=np.bool_)
            for key in keys:
                mask |= (np.abs(store.origin_x-key%512) <= r) & (np.abs(store.origin_y-key//512) <= r)
            assert selected.tolist() == np.flatnonzero(mask).tolist(), (initially_empty, step, 'envelope')
            for x,y,g,s in edits:
                grid[y*512+x], statuses[y*512+x] = g,s
            store.update(grid, statuses, changed_keys=keys)
            selected = keys+[1*512+1] if step%2 else None
            actual = store.calculate(result_keys=selected)
            records, expected = oracle()
            comparison = expected if selected is None else dict(expected, cells={k:expected['cells'][k] for k in selected if k in expected['cells']})
            assert store.records == records and actual == comparison, (initially_empty, step)
            coeff = [int(c['numerator']) for c in expected['exact']['coefficients']]
            assert store.kernel['maximumNumerator'] == max((sum(coeff[i]*n for i,n in c['terms']) for c in expected['cells'].values()), default=0)
            assert len(store.maximum_heap) <= 2*len(store.kernel['usedDistributions'])+64
            fast += store.kernel['aggregateMode'] == 'delta'
            fallback += store.kernel['aggregateMode'] != 'delta'
            if step == 62:
                assert store.kernel['aggregateMode'] == 'full-summary', 'Ghost changes retain the complete calculation'
        assert frozen == initial, 'Later deltas cannot mutate an earlier result'
        # Empty input still uses the latest exact summary and never scans origins.
        _, stats = store.update(grid, statuses, changed_keys=[])
        assert stats['examinedOrigins'] == 0 and store.calculate() == expected
assert fast > 10 and fallback > 0
print('PASS 140 full native oracles: exact summaries, maximum removal, block boundaries, large radii, ghost fallback and heap bounds;', fast, 'delta,', fallback, 'full')
