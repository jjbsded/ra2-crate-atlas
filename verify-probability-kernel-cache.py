"""Exact cache parity, mutable-report isolation, concurrency and byte ownership."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from unittest.mock import patch

import probability_kernel_cache as C
import realmap_exact as E

cache=C.KernelCache(5000)
for i in range(100):
    value,hit=cache.get(i,lambda:b'x'*1000)
    assert not hit and value==b'x'*1000
    assert cache.bytes<=cache.budget
assert len(cache.entries)<10
assert cache.get(99,lambda:None)[1]
cache.get('large',lambda:b'x'*6000)
assert 'large' not in cache.entries
try:
    cache.get('error',lambda:(_ for _ in ()).throw(ValueError('failure')))
except ValueError:
    pass
else:
    raise AssertionError('Factory error was lost')
assert not cache.running
assert cache.get('error',lambda:7)==(7,False)

gate,started=Event(),Event();calls=[]
def build():
    calls.append(1);started.set();assert gate.wait(3);return 17
with ThreadPoolExecutor(max_workers=8) as pool:
    first=pool.submit(cache.get,'shared',build);assert started.wait(2)
    others=[pool.submit(cache.get,'shared',build) for _ in range(6)]
    gate.set();assert first.result()==(17,False)
    assert all(work.result()==(17,True) for work in others)
assert len(calls)==1 and not cache.running

# Full terminal rows, not only the summed function, preserve diagnostics too.
terminals=[Counter({(1,0):1}),Counter({(2,0):1,(4,1):1,(4,3):1}),Counter({(2,0):2,(2,1):1})]
assert E.terminal_signature(terminals[0])==E.terminal_signature(terminals[1])
assert E.retry_kernel(terminals[0],7,9)['weightPeriod']!=E.retry_kernel(terminals[1],7,9)['weightPeriod']
with patch.object(C,'shared',C.KernelCache()):
    for origin,limit in [(7,9),(11,1000)]:
        for terminal in terminals:
            key=(origin,limit,tuple(sorted(terminal.items())))
            expected=E.retry_kernel(terminal,origin,limit)
            expected={k:v for k,v in expected.items() if k not in ('overall','conditional')}
            first,hit=C.exact_kernel(key,lambda:E.retry_kernel(terminal,origin,limit));assert not hit
            assert first==expected
            first['coefficients'][0]['numerator']='bad'
            first['values'][1,0]=-1
            assert 'overall' not in first and 'conditional' not in first
            first['terminalCountRange'].clear()
            again,hit=C.exact_kernel(key,lambda:(_ for _ in ()).throw(AssertionError('Rebuilt cached kernel')))
            assert hit and again==expected
    a=E.calculate([[513],[514]],{513:'crate',514:'retry'},2)
    b=E.calculate([[513],[514]],{513:'crate',514:'retry'},2)
    assert a==b
print('PASS exact kernel cache: diagnostics, 1000 retries, report isolation, bounded eviction, coalesced requests and failure retry')
