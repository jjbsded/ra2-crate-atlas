"""Local instance handover; never terminate an unidentified port owner."""
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

PROTOCOL = 'crate-atlas-control-v1'
CONTROL_HEADER = 'X-Crate-Atlas-Control'
# Published server.py sources, with CRLF normalized to LF. Older releases lack
# a shutdown endpoint, so the feature string alone is NOT enough to stop them.
LEGACY_SOURCES = frozenset({
    'a14fba313f83966e9017f809f59dddc66983bcd883a2b116104095dcaa339afa',  # v0.2
    '521afc7ee73e81e5520f6fad49531eaab64e4ced7cc302a9437cd2dabd2a2247',  # v0.3/3.1
    'e6face23f38942ca3a4bbf534b33dd990905afd862f13c1b8f66f03816ae3e0b',  # v0.4
    '2eead40e98d3acb364b375b100a819d249f95d2a5dd07a52395cb7bf66b39d0c',  # v0.5
})


class StartupError(RuntimeError):
    pass


def message(en, zh, english=False):
    return en if english else zh


class Lifecycle:
    def __init__(self, server, instance, busy):
        self.server, self.instance, self.busy = server, instance, busy
        self.token = secrets.token_hex(32)
        self.lock = threading.Lock()
        self.active = 0
        self.closing = False

    def dispatch(self, handler, action):
        # Freeze admission before checking job state, including requests that
        # are still uploading a map or about to submit an export.
        with self.lock:
            if self.closing:
                return handler.json({'error': 'Service is restarting / 服务正在切换'}, 503)
            self.active += 1
        try:
            return action()
        finally:
            with self.lock:
                self.active -= 1

    def control(self, handler, shutdown=False):
        host = f'127.0.0.1:{self.server.server_address[1]}'
        if (handler.client_address[0] != '127.0.0.1' or
                handler.headers.get('Host') != host or
                handler.headers.get(CONTROL_HEADER) != PROTOCOL or
                handler.headers.get('Origin') not in (None, 'http://'+host)):
            return handler.json({'error': 'Local launcher request required'}, 403)
        if not shutdown:
            return handler.json({'protocol': PROTOCOL, 'instance': self.instance,
                                 'pid': os.getpid(), 'token': self.token})
        token = handler.headers.get('X-Crate-Atlas-Token', '')
        if len(token) != 64 or not secrets.compare_digest(token.encode('utf8'), self.token.encode('ascii')):
            return handler.json({'error': 'Instance token mismatch'}, 403)
        with self.lock:
            if self.closing:
                return handler.json({'closing': True}, 202)
            if self.active or self.busy():
                return handler.json({'busy': True}, 409)
            self.closing = True
        handler.json({'closing': True}, 202)
        # shutdown must run outside serve_forever's thread; main closes socket.
        threading.Thread(target=self.server.shutdown, daemon=True).start()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, path, *, token=None, raw=False):
    headers = {CONTROL_HEADER: PROTOCOL}
    if token is not None:
        headers['X-Crate-Atlas-Token'] = token
    req = Request(url+path, data=b'' if token is not None else None, headers=headers)
    # System proxies and redirects must not redirect local process control.
    with build_opener(ProxyHandler({}), NoRedirect()).open(req, timeout=2) as response:
        data = response.read(256*1024+1)
        if len(data) > 256*1024:
            raise ValueError('Oversized local server response')
        return data if raw else json.loads(data)


def health(url):
    value = request(url, '/api/maps/health')
    if (not isinstance(value, dict) or value.get('feature') != 'real-maps-v1' or
            not isinstance(value.get('instance'), str) or not value['instance']):
        raise ValueError('Not an identified Crate Atlas service')
    return value


def windows_listener(port):
    # Only the integer port is interpolated; no paths or user text are shell code.
    port = int(port)
    script = r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$listeners = @(Get-NetTCPConnection -LocalPort PORT_VALUE -State Listen | Where-Object { $_.LocalAddress -eq '127.0.0.1' })
if ($listeners.Count -ne 1) { throw 'Ambiguous loopback listener' }
$owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listeners[0].OwningProcess)
if (!$owner) { throw 'Listener exited' }
[pscustomobject]@{pid=$owner.ProcessId; executable=$owner.ExecutablePath; command=$owner.CommandLine; created=$owner.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()} | ConvertTo-Json -Compress
'''.replace('PORT_VALUE', str(port))
    shell = Path(os.environ.get('SystemRoot', 'C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'
    result = subprocess.run([str(shell), '-NoProfile', '-NonInteractive', '-Command', script],
                            capture_output=True, text=True, encoding='utf8', timeout=15,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Cannot identify the listening process')
    return json.loads(result.stdout.lstrip('\ufeff'))


def windows_argv(command):
    from ctypes import wintypes as w
    shell = ctypes.WinDLL('shell32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    shell.CommandLineToArgvW.argtypes = [w.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype = ctypes.POINTER(w.LPWSTR)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    count = ctypes.c_int()
    pointer = shell.CommandLineToArgvW(command, ctypes.byref(count))
    if not pointer:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return list(pointer[:count.value])
    finally:
        kernel.LocalFree(pointer)


def is_server_command(args, port):
    """Accept only Python's script invocation, never -c/-m or arbitrary scripts."""
    if not args or not re.fullmatch(r'python(?:w|3(?:\.\d+)?)?\.exe', Path(args[0]).name.lower()):
        return False
    index = 1
    while index < len(args) and args[index] in ('-B', '-u', '-s', '-E', '-I', '-O', '-OO'):
        index += 1
    if index >= len(args) or Path(args[index]).name.lower() != 'server.py':
        return False
    import argparse
    parser = argparse.ArgumentParser(add_help=False, exit_on_error=False)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--page', choices=('demo', 'maps'))
    try:
        parsed, extra = parser.parse_known_args(args[index+1:])
        return not extra and parsed.port == port
    except (argparse.ArgumentError, ValueError):
        return False


def stop_legacy(url, port, existing, root):
    if os.name != 'nt':
        raise ValueError('Legacy process handover is supported on Windows only')
    trusted = LEGACY_SOURCES | {hashlib.sha256((root/'server.py').read_bytes().replace(b'\r\n', b'\n')).hexdigest()}
    def verify_http():
        if health(url) != existing:
            raise ValueError('Port owner changed during handover')
        source = request(url, '/server.py', raw=True).replace(b'\r\n', b'\n')
        if hashlib.sha256(source).hexdigest() not in trusted:
            raise ValueError('Unrecognized legacy server source')
    verify_http()
    owner = windows_listener(port)
    args = windows_argv(owner['command'])
    if (owner['pid'] == os.getpid() or not is_server_command(args, port) or
            Path(owner['executable']).name.lower() != Path(args[0]).name.lower()):
        raise ValueError('Listener is not a known Python server invocation')
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.GetProcessTimes.argtypes = [w.HANDLE] + [ctypes.POINTER(w.FILETIME)]*4
    kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
    kernel.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
    kernel.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    handle = kernel.OpenProcess(0x1000 | 0x100000 | 0x1, False, owner['pid'])
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        times = [w.FILETIME() for _ in range(4)]
        name = ctypes.create_unicode_buffer(32768)
        size = w.DWORD(len(name))
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)) or not kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        created = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        # CIM timestamps have microsecond precision; retain the open handle so
        # a recycled PID can never cause termination of a replacement process.
        if created//10 != int(owner['created'])//10 or Path(name.value) != Path(owner['executable']):
            raise ValueError('Process identity changed')
        if windows_listener(port) != owner:
            raise ValueError('Listening process changed')
        verify_http()
        if not kernel.TerminateProcess(handle, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        if kernel.WaitForSingleObject(handle, 5000) != 0:
            raise ValueError('Old process did not exit')
    finally:
        kernel.CloseHandle(handle)


def bind_or_reuse(factory, port, instance, root, *, english=False, wait_seconds=60):
    url = f'http://127.0.0.1:{port}'
    deadline = time.monotonic()+wait_seconds
    starting_deadline = time.monotonic()+3
    announced = False
    stopping = False
    while True:
        try:
            return factory()
        except OSError as error:
            if error.errno != errno.EADDRINUSE and getattr(error, 'winerror', None) != 10048:
                raise
        try:
            existing = health(url)
            if existing['instance'] == instance:
                return None
            if not announced:
                print(message('Replacing the previous Crate Atlas service…', '正在关闭旧版工具服务并切换到当前版本…', english), flush=True)
                announced = True
            if not stopping:
                try:
                    control = request(url, '/api/server/identity')
                except HTTPError as error:
                    if error.code != 404:
                        raise
                    print(message('Verified legacy releases may interrupt unfinished tasks during restart.',
                                  '旧版没有退出接口，切换时会结束已核验的旧服务；未完成的任务可能中断。', english), flush=True)
                    stop_legacy(url, port, existing, root)
                    stopping = True
                else:
                    if (control.get('protocol') != PROTOCOL or control.get('instance') != existing['instance'] or
                            not isinstance(control.get('token'), str)):
                        raise ValueError('Invalid instance control response')
                    try:
                        request(url, '/api/server/shutdown', token=control['token'])
                        stopping = True
                    except HTTPError as error:
                        if error.code != 409:
                            raise
                        if announced is True:
                            print(message('Waiting for the old service to finish its current work…',
                                          '旧服务正在计算或导出，等待当前任务完成…', english), flush=True)
                            announced = 'waiting'
            if time.monotonic() >= deadline:
                raise StartupError(message('The old service is still busy. Retry when it finishes, or use --port 8777.',
                                           '旧服务尚未完成当前任务，请稍后重新启动，或用 --port 8777。', english))
        except StartupError:
            raise
        except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError) as error:
            # A successfully stopped service can disappear before the next bind.
            transient = isinstance(error, (URLError, ConnectionError, TimeoutError)) and not isinstance(error, HTTPError)
            if ((stopping and isinstance(error, (URLError, ConnectionError))) or
                    (transient and time.monotonic() < starting_deadline)) and time.monotonic() < deadline:
                time.sleep(.1)
                continue
            raise StartupError(message(
                f'Cannot safely replace the service on port {port}: {error}. Close its launcher or use --port 8777.',
                f'无法安全接管端口 {port} 的服务：{error}。请关闭对应启动窗口，或用 --port 8777。', english)) from error
        time.sleep(.2)
