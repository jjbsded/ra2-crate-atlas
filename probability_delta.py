"""Revision-bound probability patches; missing bases use a complete snapshot."""
from copy import deepcopy

GEOMETRY = frozenset(('px','py','surface','visibleSurface','surfaceVisibility','labelOffset','cameraCoverage','visibleBand'))


def snapshot(value, revision):
    return {**value, 'probabilityRevision': revision,
            'metadata': deepcopy(value['metadata']),
            'cells': list(value['cells'])}


def patch(current, base, base_revision):
    if base is None:
        return current
    previous = {(c['x'], c['y']): c for c in base['cells']}
    if len(previous) != len(current['cells']):
        return current
    changed = []
    for c in current['cells']:
        old = previous.get((c['x'], c['y']))
        if old is None:
            return current
        # Geometry added by rendering stays with the current displayed image.
        if c is not old and (any(old.get(k) != v or k not in old for k, v in c.items()) or old.keys() - c.keys() - GEOMETRY):
            changed.append(c)
    sets, removed = [], []
    def difference(value, old, path):
        if value == old:
            return
        if isinstance(value, dict) and isinstance(old, dict):
            for key in old.keys() - value.keys():
                removed.append([*path, key])
            for key, item in value.items():
                if key in old:
                    difference(item, old[key], [*path, key])
                else:
                    sets.append([[*path, key], item])
        else:
            sets.append([path, value])
    for key in ('metadata', 'probability', 'markers', 'zeroProbabilityRockCandidates', 'potentialMarkers', 'clearance'):
        difference(current[key], base.get(key), [key])
    if 'regionNavigation' in current:
        difference(current['regionNavigation'], base.get('regionNavigation'), ['regionNavigation'])
    elif 'regionNavigation' in base:
        removed.append(['regionNavigation'])
    return dict(probabilityPatch=1, baseRevision=base_revision,
                probabilityRevision=current['probabilityRevision'],
                sourceSha256=current['metadata']['sourceSha256'], version=current['metadata']['version'],
                cellCount=len(current['cells']), cells=changed, sets=sets, removed=removed)
