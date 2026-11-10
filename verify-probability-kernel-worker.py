"""Independent Python/V8 parity, failed pipes, serialization and shutdown."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from probability_kernel_worker import Worker
from realmap_exact import retry_kernel

worker=Worker()
cases=[(Counter({(1,0):1}),7,9),
       (Counter({(2,0):1,(4,1):1,(4,3):1}),11,1000),
       (Counter({(n,r):(n*7+r*13)%9 for n in range(1,25) for r in range(n)}),57121,1000)]
try:
    for terminal,origins,limit in cases:
        expected=retry_kernel(terminal,origins,limit)
        actual=worker.calculate(terminal,origins,limit)
        assert actual is not None,worker.error
        assert actual=={k:v for k,v in expected.items() if k not in ('overall','conditional')}
    terminal,origins,limit=cases[-1]
    with ThreadPoolExecutor(max_workers=4) as pool:
        values=list(pool.map(lambda _:worker.calculate(terminal,origins,limit),range(4)))
    assert all(v==actual for v in values) and worker.completed==7
    process=worker.process;reader=worker.reader;writer=worker.writer
finally:
    worker.close()
assert process.poll() is not None and not reader.is_alive() and not writer.is_alive()

with TemporaryDirectory() as folder:
    for name,source in [('exit','process.exit(0)'),('bad','process.stdin.on("data",()=>process.stdout.write("{}\\n"))'),
                        ('hang','process.stdin.pause();setInterval(()=>{},1000)')]:
        script=Path(folder)/(name+'.cjs');script.write_text(source)
        failed=Worker(script=script,timeout=.2);started=perf_counter()
        # A payload exceeding a pipe buffer must time out too, even if the
        # helper never reads its stdin. No writer thread may outlive close.
        huge=Counter({(n,r):10**100 for n in range(1,25) for r in range(n)})
        assert failed.calculate(huge,57121,1000) is None
        assert failed.disabled and failed.process is None and failed.reader is None and failed.writer is None
        assert perf_counter()-started<4
        assert failed.calculate(*cases[0]) is None
        failed.close()
print('PASS exact V8 kernel: all 300 integer weights/diagnostics match Python, 1000 retries, concurrent RPC, malformed/exited/hung pipe fallback and clean close')
