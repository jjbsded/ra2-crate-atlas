"""Explicit upgrades of saved map reports; orchestration above the renderers."""
import json
from pathlib import Path
from realmap_render import render, refresh_sprite_issues


def refresh_result(path):
    """Explicit render-only upgrade of a saved report; never recompute probability.

    For legacy results use matching original source bytes, including map overrides.
    Future results preserve source.map beside the report for repeatable rendering.
    """
    from runtime_bootstrap import ROOT
    from realmap_parser import parse_map
    from realmap_format import sha
    path = Path(path)
    result = json.loads(path.read_text('utf8'))
    meta = result['metadata']
    choices = [path.parent/'source.map', ROOT.parents[1]/'scripts/crate_generation_research/heck-analysis'/meta['filename']]
    source = next((p for p in choices if p.is_file() and sha(p.read_bytes()) == meta['sourceSha256']), None)
    if source is None:
        raise ValueError('旧报告缺少哈希匹配的地图原文件；请重新导入地图以升级绘图。')
    if meta.get('previewOnly'):
        if meta['version'] in ('directory', 'shikong'):
            from realmap_mod import root_for_report
            from realmap import analyze_directory
            return analyze_directory(source.read_bytes(), path.parent, meta['filename'], lambda *a:None,
                           minerals_enabled=meta.get('mineralsEnabled', True), resource_root=root_for_report(meta))['rendering']
        from realmap import partial_preview
        return partial_preview(source.read_bytes(), path.parent, meta['version'], meta['filename'], lambda *a:None,
            minerals_enabled=meta.get('mineralsEnabled', True), reason=meta.get('analysisError'))['rendering']
    if meta.get('approximate'):
        from map_results import resource_context
        res, _ = resource_context(result, path)
        _, res, theater, tmps, _ = parse_map(source.read_bytes(), path.parent,
            res.version, resource_context=res,
            visual_only=True, minerals_enabled=meta.get('mineralsEnabled', True))
    else:
        _, res, theater, tmps, _ = parse_map(source.read_bytes(), path.parent, meta['version'], lambda *a: None,
            minerals_enabled=meta.get('mineralsEnabled', True))
    cells = {(c['x'], c['y']): c for c in result['cells']}
    result['rendering'] = render(cells, res, theater, tmps, path.parent, meta, lambda *a: None)
    refresh_sprite_issues(meta, result['rendering'])
    path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), 'utf8')
    return result['rendering']
