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
from map_storage import write_report, compress_downloads


class BusyError(ValueError):
    pass


class SupersededRender(Exception):
    pass


class MapJobs:
    def __init__(self, *, history_limit=64, analyzer=None):
        self.history_limit = max(2, history_limit)
        self._analyzer = analyzer
        self._jobs = OrderedDict()
        self._lock = threading.RLock()
        self._analysis_lock = threading.Lock()
        self._probabilities = OrderedDict()
        self._render_pending = None
        self._render_event = threading.Event()
        self._render_thread = None
        self._latest_simulation = {}

    def _idle(self):
        with self._lock:
            return not any(not job.get('done') and not job.get('error') for job in self._jobs.values())

    def status(self, job):
        with self._lock:
            value = self._jobs.get(job)
            return dict(value) if value is not None else None

    def probability(self, job):
        with self._lock:
            return self._probabilities.get(job)

    def _update(self, job, **changes):
        with self._lock:
            self._jobs[job].update(changes)

    def submit(self, data, version, filename, mix_paths, official=None,
               minerals_enabled=True, previous_result=None, resource_root=None, *, background=False, force_recompute=False, simulation=None, analysis_context=None, probability_base=None, base_revision=None, publish_preview=True):
        with self._lock:
            active = [(key, value) for key, value in self._jobs.items()
                      if not value.get('done') and not value.get('error') and not value.get('probabilityReady')]
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
                                  simulation=simulation is not None,
                                  message='等待后台预加载完成' if active else '准备读取地图')
            if simulation is not None:
                self._latest_simulation[(version, simulation['map']['sha256'])] = job
            args = (job, data, version, filename, mix_paths, official,
                    minerals_enabled, previous_result, resource_root, force_recompute, simulation, analysis_context, probability_base, base_revision, publish_preview)
            try:
                threading.Thread(target=self._run, args=args, daemon=True).start()
            except Exception:
                del self._jobs[job]
                raise
            return {'id': job}

    def _run(self, job, data, version, filename, mix_paths, official, enabled, previous, root, force_recompute,
             simulation=None, analysis_context=None, probability_base=None, base_revision=None, publish_preview=True):
        from realmap_mod import lookup_scope
        with lookup_scope():
            return self._run_scoped(job, data, version, filename, mix_paths, official, enabled, previous, root, force_recompute,
                                    simulation, analysis_context, probability_base, base_revision, publish_preview)

    def _run_scoped(self, job, data, version, filename, mix_paths, official, enabled, previous, root, force_recompute,
                    simulation=None, analysis_context=None, probability_base=None, base_revision=None, publish_preview=True):
        try:
            from realmap import analyze, PendingAnalysis
            folder = ROOT/'output'/('map-'+job)
            def progress(message, percent):
                # A newer edit supersedes only obsolete artwork. Its exact
                # probability snapshot has already been committed separately.
                if simulation is not None and self.status(job).get('rendering'):
                    with self._lock:
                        if self._latest_simulation.get((version, simulation['map']['sha256'])) != job:
                            raise SupersededRender()
                self._update(job, message=message, progress=percent)
            options = dict(minerals_enabled=enabled, resource_root=root)
            if simulation is not None: options['simulation'] = simulation
            if analysis_context is not None: options['analysis_context'] = analysis_context
            from official_render_cache import key, reuse
            identity = key(data, version, enabled, mix_paths) if official and not root and self._analyzer is None and simulation is None else None
            with self._analysis_lock:
                result = reuse(identity, folder, filename, progress) if not force_recompute else None
                if force_recompute: options['use_precomputed'] = False
                if result is None:
                    from incremental_probability import session
                    def publish(value):
                        if not publish_preview:
                            self._update(job, probabilityReady=True)
                            return
                        from probability_delta import snapshot, patch
                        value = snapshot(value, job)
                        packet = patch(value, probability_base, base_revision)
                        write_report(folder/'probability.json', packet)
                        with self._lock:
                            self._probabilities[job] = value
                            while len(self._probabilities) > 4: self._probabilities.popitem(last=False)
                        self._update(job, probabilityUrl=f'/output/map-{job}/probability.json',
                                     probabilityReady=True, changedCells=len(packet['cells']),
                                     probabilityPatch=bool(packet.get('probabilityPatch')))
                    with session(force=force_recompute, publish=publish if simulation is not None else None,
                                 defer_render=self._analyzer is None):
                        result = (self._analyzer or analyze)(data, folder, version, filename, progress, mix_paths, **options)
            def finish():
                self._update(job, rendering=True)
                progress('正在更新地图画面', 86)
                value = result.finish() if isinstance(result, PendingAnalysis) else result
                progress('正在发布完整结果', 98)
                self._finish(job, value, folder, official, previous, enabled, identity)
            if isinstance(result, PendingAnalysis):
                self._enqueue_render(job, finish)
            else:
                finish()
        except SupersededRender:
            self._update(job, done=True, superseded=True, message='已由更新的模拟布局替代')
        except Exception as error:
            self._update(job, error=str(error) or type(error).__name__, message='计算未完成，未输出近似概率')

    def _enqueue_render(self, job, finish):
        with self._lock:
            if self._render_pending is not None:
                old, _ = self._render_pending
                self._update(old, done=True, superseded=True, message='已由更新的模拟布局替代')
            self._render_pending = job, finish
            if self._render_thread is None or not self._render_thread.is_alive():
                self._render_thread = threading.Thread(target=self._render_loop, daemon=True)
                self._render_thread.start()
            self._render_event.set()

    def _render_loop(self):
        # One renderer and one latest pending frame bound CPU/memory use while
        # probability calculations continue on the separate analysis queue.
        while True:
            self._render_event.wait()
            with self._lock:
                item = self._render_pending; self._render_pending = None
                self._render_event.clear()
            if item is None: continue
            job, finish = item
            try:
                from realmap_mod import lookup_scope
                with lookup_scope():
                    finish()
            except SupersededRender:
                self._update(job, done=True, superseded=True, message='已由更新的模拟布局替代')
            except Exception as error:
                self._update(job, error=str(error) or type(error).__name__, message='地图画面生成失败')
            finally:
                # Release the large completed render closure before waiting for
                # another edit; otherwise its teardown lands on the next job.
                item = finish = None

    def _finish(self, job, result, folder, official, previous, enabled, identity):
        from official_render_cache import remember
        if official: result['metadata'].update(officialMap=official, displayName=official['label'])
        if previous: result['metadata']['mineralPreviousResult'] = previous
        if self.status(job).get('simulation'): result['probabilityRevision'] = job
        write_report(folder/'result.json', result)
        compress_downloads(folder)
        url = f'/output/map-{job}/result.json'
        from map_results import remember_report
        remember_report(folder/'result.json', result)
        if previous: remember_pair(previous, url, enabled)
        remember(identity, folder, url)
        meta = result['metadata']
        message = ('近似计算完成，概率不保证准确' if meta.get('approximate') else
                   '部分加载完成，请查看告警' if meta.get('partialAnalysis') else
                   '外观预览完成' if meta.get('previewOnly') else '精确计算完成')
        self._update(job, done=True, progress=100, message=message, url=url, cells=meta['cellCount'])
        # The initial images are already pixel-exact lossless files. Re-encoding
        # them immediately competed with first decode and live-editor warmup.

    def simulate(self, payload):
        from realmap_simulation import validate
        if not isinstance(payload, dict):
            raise ValueError('无效的模拟请求')
        path = result_path(payload.get('result'))
        report, _ = load_report(path)
        meta = report['metadata']; version = meta['version']
        if version not in ('ra2', 'yr', 'directory', 'shikong') or meta.get('previewOnly'):
            raise ValueError('当前结果没有可编辑的地图布局，请重新分析地图')
        data = source_bytes(report, path)
        plan = validate(payload.get('plan'), data, version)
        force = payload.get('force', False)
        publish_preview = payload.get('publishPreview', True)
        if type(force) is not bool or type(publish_preview) is not bool:
            raise ValueError('Invalid simulation options')
        res, _ = resource_context(report, path)
        root = res.discovery['config']['root'] if version in ('directory', 'shikong') else None
        paths = None if root else original_resources.resolve(version)
        base_revision = payload.get('baseRevision', payload.get('result'))
        if not isinstance(base_revision, str) or len(base_revision) > 512:
            raise ValueError('Invalid probability revision')
        with self._lock:
            base = report if base_revision == payload.get('result') else self._probabilities.get(base_revision)
        if base is not None and any(base['metadata'].get(k) != meta.get(k) for k in ('sourceSha256','version','rulesSha256','resourceFingerprint')):
            base = None
        return self.submit(data, version, meta['filename'], paths,
                           meta.get('officialMap'), True, resource_root=root, force_recompute=force, simulation=plan,
                           analysis_context=res, probability_base=base, base_revision=base_revision, publish_preview=publish_preview)

    def recompute(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('无效的重新计算请求')
        path = result_path(payload.get('result'))
        report, _ = load_report(path)
        meta = report['metadata']; version = meta['version']
        data = source_bytes(report, path)
        root = None
        if version in ('directory', 'shikong'):
            res, _ = resource_context(report, path)
            root = res.discovery['config']['root']
        paths = None if root is not None else original_resources.resolve(version)
        return self.submit(data, version, meta['filename'], paths, meta.get('officialMap'),
                           meta.get('mineralsEnabled', True), resource_root=root, force_recompute=True,
                           simulation=meta.get('simulationPlan'))

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
                 'resourceRoot', 'resourceFingerprint', 'artSha256', 'calculationModelSha256')))


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
