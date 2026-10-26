"""Auxiliary region routes, independent of crate probabilities and caches."""
import base64
from functools import lru_cache
from pathlib import Path

GROUND, WATER, SHORE, DECK, CORE = 1, 2, 4, 8, 16


def build(report, rules):
    from realmap_format import number, yes, ini_integer
    from realmap_parser import LANDS, land_after, is_tree
    flags = bytearray()
    for c in report['cells']:
        if c.get('terrainError') or not isinstance(c.get('slope'), int) or not 0 <= c['slope'] <= 20:
            flags.append(0)
            continue
        overlay = rules.get(c.get('overlayName'), {})
        high = c.get('bridge', {}).get('kind') == 'high' if c.get('bridge') else False
        wall = c.get('wall', False)
        def destroyable(cfg):
            try:
                return bool(cfg) and not yes(cfg.get('IMMUNE', 'no')) and number(cfg.get('STRENGTH', '1')) > 0
            except (TypeError, ValueError):
                return False
        # A wall is removed only for this routing scenario. High-bridge art
        # must not turn the water below its owner into a ground-level road.
        cleared = (high and c.get('overlayName') in ('BRIDGE1','BRIDGE2','BRIDGEB1','BRIDGEB2')) or (wall and destroyable(overlay))
        try:
            land = land_after(c['rawLand'], c['slope'], None if cleared else overlay or None,
                              c.get('higher', []), report['metadata'].get('cliffBackImpassability', 2))
            foot = number(rules.get(LANDS[land].upper(), {}).get('FOOT', '0')) > 0
        except (ValueError, TypeError, IndexError):
            flags.append(0)
            continue
        categories = {obj['type']:obj['category'] for obj in c.get('removable', [])}
        def blocked(layer):
            objects = c.get('objects'+layer, [])
            if c.get('assumedRetry') or c.get('occupancyUnknown') or (c.get('occupied'+layer) and not objects):
                return True
            for kind in objects:
                category = categories.get(kind)
                if category == 'terrain':
                    cfg = rules.get(kind, {})
                    if is_tree(kind, cfg):
                        continue
                    # TerrainClass includes rocks, drills, lights and boxes.
                    # Only trees are cleared; non-occupying scenery may remain.
                    field = 'SNOWOCCUPATIONBITS' if report['metadata'].get('theater') == 'SNOW' else 'TEMPERATEOCCUPATIONBITS'
                    try:
                        if cfg and not (ini_integer(cfg.get(field, '7')) & 7):
                            continue
                    except (ValueError, TypeError):
                        pass
                    return True
                if category == 'building' and destroyable(rules.get(kind, {})):
                    continue
                return True
            return False
        ground = not blocked('Ground') and (not wall or cleared)
        value = ((WATER if land == 2 else GROUND if foot else 0) if ground else 0)
        if land == 6:
            value |= SHORE
        if land not in (2, 6) and c.get('rawLand') not in (2, 6):
            value |= CORE
        if high and number(rules.get('ROAD', {}).get('FOOT', '0')) > 0 and not blocked('Deck'):
            value |= DECK
        flags.append(value)
    return dict(version=2, count=len(flags), flags=base64.b64encode(flags).decode('ascii'),
                model='foot-cleared-trees-destructible-buildings-layered',
                approximate=bool(report['metadata'].get('approximate')))


def for_report(report, path):
    from map_results import resource_context, source_bytes
    source_bytes(report, Path(path), required=True)
    _, theater = resource_context(report, path)
    return build(report, theater['effectiveRules'])


@lru_cache(maxsize=4)
def _cached(path, size, modified, rules_hash):
    from map_results import load_report
    report, _ = load_report(Path(path))
    return for_report(report, Path(path))


def get(value):
    from map_results import load_report, resource_context, result_path
    path = result_path(value)
    report, _ = load_report(path)
    # Resource provenance is revalidated before using the bounded route cache.
    resource_context(report, path)
    stat = path.stat()
    return _cached(str(path), stat.st_size, stat.st_mtime_ns, report['metadata'].get('rulesSha256'))
