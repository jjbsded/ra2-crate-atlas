"""Initial stock bridge flags used by the random-crate search.

See docs/bridge-crates.md. This models loading a map, not bridge destruction,
repair or moving an object between its ground and deck occupation layers.
"""

# Overlay::Mark hard-codes these indices in both original executables.
HIGH = {24: ('BRIDGE1', (0, -1)), 25: ('BRIDGE2', (-1, 0)),
        237: ('BRIDGEB1', (0, -1)), 238: ('BRIDGEB2', (-1, 0))}
HIGH_NAMES = frozenset(name for name, direction in HIGH.values())
# YR 0x81CC30, used by CellClass::DrawOverlay for intact high bridge frames.
FRAME_VARIATION = (0, 1, 2, 3, 3, 2, 1, 0, 2, 3, 0, 1, 1, 0, 3, 2)


def initialize(cells, *, strict=True):
    """Reproduce the 0x100/0x1000 bits of YR 47E040/47E470.

    Flags are applied in OverlayPack load order (y, then x). The source and
    two forward cells have both bits; the rear edge only has 0x100, and the
    third forward cell only receives 0x1000.
    """
    for c in cells.values():
        c['bridge'] = dict(kind='low') if (c['overlayName'] or '').startswith(('LOBRDG', 'LOBRDB')) else None
        c['bridgeProjection'] = False
        if strict and c['bridge'] and c['slope'] > 4:
            raise ValueError(f"({c['x']},{c['y']}) 在复杂坡面预放低桥；加载失败后的状态尚未支持")
    for p, c in sorted(cells.items(), key=lambda item: (item[0][1], item[0][0])):
        index, name = c['overlay'], c['overlayName'] or ''
        if index in HIGH:
            expected, (dx, dy) = HIGH[index]
            if name != expected:
                if not strict:
                    continue
                raise ValueError(f'桥梁 Overlay 索引 {index} 与原版定义不符')
            if c['slope'] > 4:
                if strict:
                    raise ValueError(f'{p} 在复杂坡面预放高桥；加载失败后的状态尚未支持')
                continue
            for step in (0, 1, 2, 3, -1):
                q = p[0]+step*dx, p[1]+step*dy
                other = cells.get(q)
                if other is None:
                    # Step 3 only writes the projection bit to the engine's
                    # outside-map dummy cell; it does not extend the deck.
                    if strict and step != 3:
                        raise ValueError(f'{p} 的高桥跨出地图；边界加载状态尚未支持')
                    continue
                other['bridgeProjection'] = step != -1
                if step != 3:
                    other['bridge'] = dict(kind='high', owner=list(p), deckLevel=other['level']+4)


def elevated(cell):
    return bool(cell.get('bridge') and cell['bridge']['kind'] == 'high')


def above_ground(section, fields):
    """Map INI OnBridge columns: Units[11], Infantry[12]; not facing/subcell."""
    index = {'UNITS': 11, 'INFANTRY': 12}.get(section)
    if index is None or len(fields) <= index:
        return False
    from realmap_format import ini_integer
    return ini_integer(fields[index]) != 0


def sprite_frame(cell):
    frame = cell['overlayData']
    if cell['overlayName'] in HIGH_NAMES and frame in (0, 9):
        frame += FRAME_VARIATION[(cell['x'] & 3) | ((cell['y'] & 3) << 2)]
    return frame
