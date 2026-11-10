"""Optional exact V8 arithmetic, isolated from Python's rendering GIL.

One small persistent pipe owns numeric work only. Missing/failed helpers fall
back to the independent Python kernel; no process is started at import time.
"""
import atexit
import json
import logging
import os
from pathlib import Path
from queue import Queue, Empty, Full
import shutil
import subprocess
from threading import Lock, Thread
from runtime_bootstrap import ROOT

LIMIT = 4*1024*1024
PAIRS = tuple((n,r) for n in range(1,25) for r in range(n))


def node_path():
    local=ROOT/'runtime/node/node.exe'
    if local.is_file():return str(local)
    return shutil.which('node')


class Worker:
    def __init__(self, node=None, script=None, timeout=30):
        self.node=node
        self.script=Path(script or ROOT/'exact-kernel-worker.cjs')
        self.timeout=timeout
        self.lock=Lock()
        self.process=self.reader=self.writer=self.replies=self.requests=None
        self.serial=0
        self.disabled=False
        self.completed=0
        self.error=None

    def _start(self):
        if self.process is not None:return
        node=self.node or node_path()
        if not node or not self.script.is_file():raise OSError('Exact kernel helper unavailable')
        self.process=subprocess.Popen([str(node),'--max-old-space-size=512',str(self.script)],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        replies=self.replies=Queue(maxsize=1)
        requests=self.requests=Queue(maxsize=1)
        stream=self.process.stdout
        output=self.process.stdin
        def read():
            try:
                while True:
                    line=stream.readline(LIMIT+1)
                    if not line:raise EOFError('Exact kernel helper exited')
                    if len(line)>LIMIT or not line.endswith(b'\n'):raise ValueError('Oversized exact kernel response')
                    replies.put_nowait(line)
            except (OSError,ValueError,EOFError,Full) as error:
                try:replies.put_nowait(error)
                except Full:pass
        self.reader=Thread(target=read,name='crate-exact-pipe',daemon=True)
        self.reader.start()
        def write():
            try:
                while True:
                    request=requests.get()
                    if request is None:return
                    output.write(request);output.flush()
            except (OSError,ValueError) as error:
                try:replies.put_nowait(error)
                except Full:pass
        self.writer=Thread(target=write,name='crate-exact-input',daemon=True)
        self.writer.start()

    def _close(self):
        process=self.process;self.process=None
        if process is not None:
            try:self.requests.put_nowait(None)
            except Full:pass
            # Termination also interrupts a blocked pipe write. Closing a
            # buffered stdin first can wait for that writer's lock forever.
            try:process.wait(.3)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:process.wait(2)
                except subprocess.TimeoutExpired:process.kill();process.wait(2)
            if self.reader:self.reader.join(.3)
            if self.writer:self.writer.join(.3)
            try:process.stdin.close()
            except (OSError,ValueError):pass
            process.stdout.close()
        self.reader=self.writer=self.replies=self.requests=None

    def close(self):
        with self.lock:self._close()

    def calculate(self,terminal,origin_count,limit):
        with self.lock:
            if self.disabled:return None
            try:
                self._start();self.serial+=1
                request=dict(id=self.serial,N=origin_count,limit=limit,entries=[[n,r,h] for (n,r),h in terminal.items() if h])
                self.requests.put_nowait(json.dumps(request,separators=(',',':')).encode('ascii')+b'\n')
                value=self.replies.get(timeout=self.timeout)
                if isinstance(value,BaseException):raise value
                value=json.loads(value)
                if value.get('id')!=self.serial or value.get('error'):raise ValueError(value.get('error') or 'Exact kernel revision mismatch')
                coefficients=value['coefficients']
                if (len(coefficients)!=300 or [(c['n'],c['r']) for c in coefficients]!=list(PAIRS)
                        or value['period']!=5354228880):raise ValueError('Invalid exact kernel coefficients')
                denominator=int(value['denominator']);exhausted=int(value['exhausted'])
                values={pair:int(c['numerator']) for pair,c in zip(PAIRS,coefficients)}
                if denominator!=5354228880*origin_count**limit or not 0<=exhausted<=denominator or any(n<0 for n in values.values()):raise ValueError('Invalid exact kernel integers')
                self.completed+=1
                return dict(denominator=denominator,values=values,coefficients=coefficients,
                    exhausted=exhausted,period=value['period'],weightPeriod=value['weightPeriod'],
                    method=value['method'],terminalCountRange=value['terminalCountRange'])
            except (OSError,ValueError,KeyError,TypeError,AttributeError,EOFError,Empty,Full) as error:
                self.error=str(error);self.disabled=True;self._close()
                logging.getLogger(__name__).info('Using Python exact kernel: %s',error)
                return None


shared=Worker()
atexit.register(shared.close)


def calculate(terminal,origin_count,limit):
    if os.environ.get('CRATE_ATLAS_KERNEL_BACKEND')=='python':return None
    return shared.calculate(terminal,origin_count,limit)
