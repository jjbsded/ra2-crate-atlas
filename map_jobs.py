"""Map-analysis service, independent of HTTP and 3D presentation.

At most one analysis runs, with at most one foreground request waiting behind
a preload. Job snapshots are synchronized and completed history is bounded.
"""
from collections import OrderedDict
import json
import os
import threading
import uuid

import original_resources
from map_results import ROOT, load_report, result_path, resource_context, source_bytes


class BusyError(ValueError):
    pass


class MapJobs:
    def __init__(self, *, history_limit=64, analyzer=None):
        self.history_limit = max(2, history_limit)
        self._analyzer = analyzer
        self._jobs = OrderedDict()
        self._lock = threading.RLock()
        self._analysis_lock = threading.Lock()

    def status(self, job):
        with self._lock:
            value = self._jobs.get(job)
            return dict(value) if value is not None else None

    def _update(self, job, **changes):
        with self._lock:
            self._jobs[job].update(changes)

    def submit(self, data, version, filename, mix_paths, official=None,
               minerals_enabled=True, previous_result=None, resource_root=None, *, background=False):
        with self._lock:
            active = [(key, value) for key, value in self._jobs.items()
                      if not value.get('done') and not value.get('error')]
            for key, value in active:
                if previous_result and value.get('mineralSource') == previous_result and value.get('mineralEnabled') == minerals_enabled:
                    return {'id': key}
            if any(background or not value.get('background') for _, value in active):
                raise BusyError('已有地图正在计算，请稍候')
            # Never evict a queued/running job. Limit only the polling history;
            # generated reports and persistent cache links remain on disk.
            for key in list(self._jobs):
                if len(self._jobs) < self.history_limit:
                    break
                value = self._jobs[key]
                if value.get('done') or value.get('error'):
                    del self._jobs[key]
            job = uuid.uuid4().hex[:12]
            self._jobs[job] = dict(done=False, progress=0, background=background,
                                  mineralSource=previous_result, mineralEnabled=minerals_enabled,
                                  message='等待后台预加载完成' if active else '准备读取地图')
            args = (job, data, version, filename, mix_paths, official,
                    minerals_enabled, previous_result, resource_root)
            try:
                threading.Thread(target=self._run, args=args, daemon=True).start()
            except Exception:
                del self._jobs[job]
                raise
            return {'id': job}

    def _run(self, job, data, version, filename, mix_paths, official, enabled, previous, root):
        with self._analysis_lock:
            try:
                from realmap import analyze
                folder = ROOT/'output'/('map-'+job)
                progress = lambda message, percent: self._update(job, message=message, progress=percent)
                result = (self._analyzer or analyze)(data, folder, version, filename, progress, mix_paths,
                                                   minerals_enabled=enabled, resource_root=root)
                if official:
                    result['metadata'].update(officialMap=official, displayName=official['label'])
                if previous:
                    result['metadata']['mineralPreviousResult'] = previous
                if official or previous:
                    (folder/'result.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), 'utf8')
                url = f'/output/map-{job}/result.json'
                if previous:
                    remember_pair(previous, url, enabled)
                meta = result['metadata']
                message = ('近似计算完成，概率不保证准确' if meta.get('approximate') else
                           '部分加载完成，请查看告警' if meta.get('partialAnalysis') else
                           '外观预览完成' if meta.get('previewOnly') else '精确计算完成')
                self._update(job, done=True, progress=100, message=message, url=url, cells=meta['cellCount'])
            except Exception as error:
                self._update(job, error=str(error) or type(error).__name__, message='计算未完成，未输出近似概率')

    def minerals(self, payload):
        if not isinstance(payload, dict) or type(payload.get('enabled')) is not bool:
            raise ValueError('矿石状态必须是开或关')
        enabled, url = payload['enabled'], payload.get('result')
        background = payload.get('background', False)
        if type(background) is not bool:
            raise ValueError('无效的预加载参数')
        path = result_path(url)
        report, _ = load_report(path)
        meta = report['metadata']
        data = source_bytes(report, path)
        version = meta['version']
        if version not in ('yr', 'ra2', 'directory', 'shikong'):
            raise ValueError('未知游戏版本')
        root = None
        if version in ('directory', 'shikong'):
            res, _ = resource_context(report, path)
            root = res.discovery['config']['root']
        if matches_layout(meta, enabled):
            return {'url': url}
        # Disk links are sufficient; avoid a second unbounded process-local
        # index. The shared report reader caches by path/size/mtime.
        paths = None if root is not None else original_resources.resolve(version)
        with self._lock:
            for candidate in (mineral_links(path).get(str(enabled).lower()), meta.get('mineralPreviousResult')):
                if not candidate:
                    continue
                try:
                    cached, _ = load_report(result_path(candidate))
                    if compatible_variant(report, cached, enabled):
                        return {'url': candidate}
                except (ValueError, OSError, KeyError, TypeError):
                    pass
            return self.submit(data, version, meta['filename'], paths, meta.get('officialMap'),
                               enabled, url, root, background=background)


def compatible_variant(report, cached, enabled):
    meta, other = report['metadata'], cached['metadata']
    return (matches_layout(other, enabled) and
            cached.get('rendering', {}).get('version') == report.get('rendering', {}).get('version') and
            all(other.get(key) == meta.get(key) for key in
                ('sourceSha256', 'version', 'rulesSha256', 'theaterSha256', 'probabilityQuality',
                 'resourceRoot', 'resourceFingerprint', 'artSha256')))


def matches_layout(meta, enabled):
    # Old ore-only OFF reports cannot satisfy a combined OFF request. Original
    # ON reports are still valid: neither kind of object was removed there.
    return (meta.get('mineralsEnabled', True) == enabled and
            meta.get('treesEnabled', True) == enabled and
            (enabled or meta.get('terrainRemovalVersion') == 1))


def mineral_links(path):
    try:
        value = json.loads((path.parent/'mineral-variants.json').read_text('utf8'))
        return value if isinstance(value, dict) else {}
    except (ValueError, OSError):
        return {}


def remember_pair(previous, current, enabled):
    links = {str(enabled).lower(): current}
    try:
        previous_report, _ = load_report(result_path(previous))
        if matches_layout(previous_report['metadata'], not enabled):
            links[str(not enabled).lower()] = previous
    except (OSError, ValueError, KeyError):
        pass  # A previous report may have been removed during analysis.
    for url in (previous, current):
        try:
            target = result_path(url).parent/'mineral-variants.json'
            temp = target.with_suffix('.tmp')
            temp.write_text(json.dumps(links), encoding='utf8')
            os.replace(temp, target)
        except (OSError, ValueError):
            pass  # A cache-link failure must not discard a completed analysis.
