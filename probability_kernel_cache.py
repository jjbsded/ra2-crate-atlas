"""Byte-bounded exact retry kernels shared across layouts and editor sessions."""
from collections import OrderedDict
from concurrent.futures import Future
from threading import Lock
from sys import getsizeof


def retained_bytes(value):
    seen = set()
    def visit(item):
        key = id(item)
        if key in seen:
            return 0
        seen.add(key)
        size = getsizeof(item)
        if isinstance(item, dict):
            size += sum(visit(k)+visit(v) for k,v in item.items())
        elif isinstance(item, (tuple, list)):
            size += sum(map(visit, item))
        return size
    return visit(value)


class KernelCache:
    def __init__(self, budget=64*1024*1024):
        self.budget, self.bytes = budget, 0
        self.entries, self.running, self.lock = OrderedDict(), {}, Lock()

    def get(self, key, build):
        with self.lock:
            if key in self.entries:
                value,size = self.entries[key]
                self.entries.move_to_end(key)
                return value, True
            work = self.running.get(key)
            owner = work is None
            if owner:
                work = self.running[key] = Future()
        if not owner:
            return work.result(), True
        try:
            value = build()
            size = retained_bytes((key,value))
            with self.lock:
                if size <= self.budget:
                    self.entries[key] = value,size
                    self.bytes += size
                    while self.bytes > self.budget:
                        _,(_,old_size) = self.entries.popitem(last=False)
                        self.bytes -= old_size
                self.running.pop(key, None)
            work.set_result(value)
            return value, False
        except BaseException as error:
            with self.lock:
                self.running.pop(key, None)
            work.set_exception(error)
            raise


shared = KernelCache()


def exact_kernel(key, build):
    # Reports own their writable dictionaries. Histograms are scratch work,
    # not needed by aggregate evaluation; never retain their hundreds of
    # thousands of entries in the layout history.
    def freeze():
        value = build()
        result={k:v for k,v in value.items() if k not in ('overall','conditional')}
        return {**result, 'values':tuple(value['values'].items()),
                'coefficients':tuple((c['n'],c['r'],c['numerator']) for c in value['coefficients']),
                'terminalCountRange':tuple(value['terminalCountRange'])}
    value,hit = shared.get(key,freeze)
    return {**value, 'values':dict(value['values']),
            'coefficients':[dict(n=n,r=r,numerator=num) for n,r,num in value['coefficients']],
            'terminalCountRange':list(value['terminalCountRange'])},hit
