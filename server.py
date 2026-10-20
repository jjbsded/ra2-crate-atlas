"""Loopback-only demo server and bounded MP4 export jobs; Python stdlib only."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import math
import os
import shutil
import subprocess
import threading
import uuid
import webbrowser
from urllib.parse import urlsplit, parse_qs
import original_resources as resource_store

ROOT = Path(__file__).resolve().parent
JOBS = {}
LOCK = threading.Lock()
MAP_JOBS = {}
MAP_LOCK = threading.Lock()


class LocalServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR allows two listeners to share the same port; requests
    # can then keep reaching an older process after restarting the application.
    allow_reuse_address = os.name != 'nt'


def analyze_map_job(job, data, version, filename, mix_paths):
    try:
        from realmap import analyze
        folder = ROOT / 'output' / ('map-' + job)
        def progress(message, percent):
            MAP_JOBS[job].update(message=message, progress=percent)
        result = analyze(data, folder, version, filename, progress, mix_paths)
        MAP_JOBS[job].update(done=True, progress=100, message='外观预览完成' if version == 'directory' else '精确计算完成',
                             url=f'/output/map-{job}/result.json', cells=result['metadata']['cellCount'])
    except Exception as error:
        MAP_JOBS[job].update(error=str(error), message='计算未完成，未输出近似概率')

def clean_timing(value):
    if type(value) is not dict or type(value.get('phases', {})) is not dict:
        raise ValueError('播放参数及阶段参数必须是对象')
    def number(raw, label, maximum):
        if type(raw) not in [int, float] or not math.isfinite(raw) or not .1 <= raw <= maximum:
            raise ValueError(f'{label}必须是 0.1～{maximum} 的数值')
        return raw
    timing = {'speed': number(value.get('speed', 1), '整体速度', 10), 'phases': {}}
    for phase, entry in value.get('phases', {}).items():
        if phase not in ['origin', 'search', 'choose', 'put', 'retry', 'done', 'exhausted', 'heatmap'] or type(entry) is not dict:
            raise ValueError('无效播放阶段参数')
        clean = {'speed': number(entry.get('speed', 1), '阶段速度', 10)}
        if entry.get('seconds') is not None:
            clean['seconds'] = number(entry['seconds'], '停留秒数', 600)
        timing['phases'][phase] = clean
    return timing

def export(job, config):
    try:
        folder = ROOT / 'output' / job
        folder.mkdir(parents=True)
        cfg, progress = folder / 'config.json', folder / 'progress.json'
        cfg.write_text(json.dumps(config), encoding='utf-8')
        JOBS[job]['progress_file'] = progress
        node = str(ROOT/'runtime/node/node.exe') if (ROOT/'runtime/node/node.exe').is_file() else shutil.which('node')
        if not node:
            node = str(Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
        result = subprocess.run([node, str(ROOT / 'export.cjs'), str(cfg), str(folder / 'crate-demo.mp4'), str(progress)], cwd=ROOT, capture_output=True, text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError(result.stderr[-1200:] or '视频编码失败')
        JOBS[job].update(done=True, progress=100, url=f'/output/{job}/crate-demo.mp4')
    except Exception as error:
        JOBS[job]['error'] = str(error)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json(self, value, code=200):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        route = urlsplit(self.path)
        if route.path == '/':
            self.send_response(302)
            self.send_header('Location', '/maps.html'+('?' + route.query if route.query else ''))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if urlsplit(self.path).path == '/api/resources':
            try:
                from realmap_mod import status as mod_status
                return self.json({**resource_store.status(), 'mod': mod_status()})
            except ValueError as error:
                return self.json({'error': str(error)}, 400)
        local = Path(self.translate_path(self.path)).resolve()
        if local.is_relative_to(ROOT/'assets/original') or any(local.is_relative_to(ROOT/name) for name in ('data','runtime','vendor')):
            return self.send_error(404)
        if self.path == '/api/maps/health':
            return self.json({'feature': 'real-maps-v1', 'versions': ['yr', 'ra2']})
        if self.path.startswith('/api/maps/job/'):
            job = MAP_JOBS.get(self.path.rsplit('/', 1)[-1])
            return self.json(job if job else {'error': '任务不存在'}, 200 if job else 404)
        if self.path.startswith('/api/job/'):
            job = JOBS.get(self.path.rsplit('/', 1)[-1])
            if not job:
                return self.json({'error': '任务不存在'}, 404)
            value = {k: v for k, v in job.items() if k != 'progress_file'}
            try:
                if not job.get('done'):
                    value.update(json.loads(job['progress_file'].read_text()))
            except (KeyError, OSError, ValueError):
                pass
            return self.json(value)
        if self.path == '/research':
            research = ROOT/'docs/random-crate-generation.md'
            if not research.exists():
                research = ROOT.parent.parent/'docs/random-crate-generation.md'
            data = research.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self):
        route = urlsplit(self.path)
        if route.path == '/api/resources/mod':
            expected = f'http://{self.headers.get("Host", "")}'
            if self.headers.get('Origin', expected) != expected:
                return self.json({'error': '不接受其他网页的资源请求'}, 403)
            try:
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size <= 4096:
                    raise ValueError('无效请求长度')
                from realmap_mod import configure
                return self.json(configure(json.loads(self.rfile.read(size))['root']))
            except (ValueError, OSError, KeyError, TypeError) as error:
                return self.json({'error': str(error)}, 400)
        if route.path in ['/api/maps/analyze', '/api/maps/heck']:
            expected = f'http://{self.headers.get("Host", "")}'
            if self.headers.get('Origin', expected) != expected:
                return self.json({'error': '不接受其他网页的分析请求'}, 403)
            try:
                query = parse_qs(route.query)
                version = query.get('version', ['yr'])[0]
                if version not in ['yr', 'ra2', 'directory']:
                    raise ValueError('未知游戏版本')
                mix_paths = None if version == 'directory' else resource_store.resolve(version)
                size = int(self.headers.get('Content-Length', 0))
                if not 0 <= size <= 16*1024*1024:
                    raise ValueError('地图不能超过 16 MB')
                filename = query.get('filename', ['map.yrm'])[0]
                if route.path == '/api/maps/heck':
                    filename = 'mp32s8.map' if version == 'ra2' else 'xmp32s8.map'
                    data = (ROOT / 'examples' / filename).read_bytes()
                else:
                    if not size:
                        raise ValueError('没有收到地图文件')
                    if Path(filename).suffix.lower() not in ['.map', '.yrm', '.mpr']:
                        raise ValueError('请选择 .map／.yrm／.mpr 文本地图')
                    data = self.rfile.read(size)
                    if len(data) != size:
                        raise ValueError('地图上传不完整')
                with MAP_LOCK:
                    if any(not v.get('done') and not v.get('error') for v in MAP_JOBS.values()):
                        return self.json({'error': '已有地图正在计算，请稍候'}, 409)
                    job = uuid.uuid4().hex[:12]
                    MAP_JOBS[job] = dict(done=False, progress=0, message='准备读取地图')
                threading.Thread(target=analyze_map_job, args=(job, data, version, filename, mix_paths), daemon=True).start()
                return self.json({'id': job}, 202)
            except (ValueError, OSError) as error:
                return self.json({'error': str(error)}, 400)
        if self.path != '/api/export':
            return self.json({'error': '接口不存在'}, 404)
        # Export can only be requested by this page or a local CLI, not another site.
        expected = f'http://{self.headers.get("Host", "")}'
        if self.headers.get('Origin', expected) != expected:
            return self.json({'error': '不接受其他网页的导出请求'}, 403)
        try:
            size = int(self.headers.get('Content-Length', 0))
            if size < 1 or size > 4096:
                raise ValueError('无效请求长度')
            config = json.loads(self.rfile.read(size))
            options = config.get('options', {})
            start = options.get('start', [2, 3])
            if len(start) != 2 or any(type(v) is not int or not 1 <= v <= 13 for v in start):
                raise ValueError('坐标必须是 1～13 的整数')
            frame = options.get('frame', 600)
            if type(frame) is not int or not 0 <= frame <= 999999999:
                raise ValueError('逻辑帧必须是 0～999999999 的整数')
            preset = options.get('preset', 'outside')
            if preset not in ['outside', 'margin', 'building', 'terrain', 'unit', 'crate', 'empty', 'ore', 'water_margin', 'outside_water', 'outside_island']:
                raise ValueError('未知场景')
            heatmap = config.get('heatmap', {})
            enabled, opacity, area = heatmap.get('enabled', True), heatmap.get('opacity', .55), heatmap.get('filter', 'all')
            if type(enabled) is not bool or type(opacity) not in [int, float] or not math.isfinite(opacity) or not 0 <= opacity <= 1 or area not in ['all', 'water', 'land']:
                raise ValueError('无效热力图选项')
            palette, minimum = heatmap.get('palette', 'warm'), heatmap.get('minMultiplier', 0)
            if palette not in ['multi', 'warm', 'cool'] or type(minimum) not in [int, float] or not math.isfinite(minimum) or not 0 <= minimum <= 169:
                raise ValueError('配色无效，或最低倍率不在 0～169 之间')
            timing = clean_timing(config.get('timing', {}))
            clean = {'all': config.get('all') is True, 'options': {'start': start, 'frame': frame, 'preset': preset}, 'timing': timing, 'heatmap': {'enabled': enabled, 'opacity': opacity, 'filter': area, 'palette': palette, 'minMultiplier': minimum, 'showBaselineValues': heatmap.get('showBaselineValues') is True, 'showBlocked': heatmap.get('showBlocked') is not False}, 'coords': config.get('coords') is True, 'heatmapValues': config.get('heatmapValues') is not False}
            with LOCK:
                if any(not j.get('done') and not j.get('error') for j in JOBS.values()):
                    return self.json({'error': '已有视频正在导出，请稍后再试'}, 409)
                job = uuid.uuid4().hex[:12]
                JOBS[job] = {'done': False, 'progress': 0}
            threading.Thread(target=export, args=(job, clean), daemon=True).start()
            return self.json({'id': job}, 202)
        except (ValueError, TypeError, AttributeError) as error:
            return self.json({'error': str(error)}, 400)

    def log_message(self, *args):
        pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--page', choices=['demo','maps'], default='maps')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}'
    try:
        server = LocalServer(('127.0.0.1', args.port), Handler)
    except OSError:
        # Reopening the launcher should reuse this application's existing server.
        from urllib.request import urlopen
        try:
            with urlopen(url+'/api/maps/health', timeout=2) as response:
                if json.load(response).get('feature') != 'real-maps-v1':
                    raise RuntimeError('该端口已被其他程序占用，请用 --port 选择其他端口。')
            if args.open:
                webbrowser.open(url+('/maps.html' if args.page == 'maps' else '/index.html'))
            print(f'Existing crate demo: {url}', flush=True)
            return
        except Exception as error:
            raise RuntimeError(f'Cannot open {url}: {error}') from error
    print(f'Crate demo: {url}', flush=True)
    if args.open:
        webbrowser.open(url+('/maps.html' if args.page == 'maps' else '/index.html'))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()

if __name__ == '__main__':
    main()
