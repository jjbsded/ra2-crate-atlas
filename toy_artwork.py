"""Semantic object records for Toy's shared procedural materials, display only."""
from pathlib import Path

VERSION = 2

UNIT_SYMBOLS = {'INFANTRY': 'soldier', 'UNITS': 'vehicle', 'AIRCRAFT': 'aircraft'}


def unit_visual_symbols(base_rules, base_art):
    """Classify base artwork, before a map overrides gameplay flags.

    Natural/NotHuman can be set on human infantry for gameplay reasons. They
    must not change its fallback appearance. Image aliases inherit the visual
    family of their base art; ambiguous aliases keep the normal type fallback.
    """
    from realmap_format import yes
    result = {}
    for section, types in (('INFANTRY', 'INFANTRYTYPES'), ('UNITS', 'VEHICLETYPES'), ('AIRCRAFT', 'AIRCRAFTTYPES')):
        identities, images = {}, {}
        for kind in base_rules.get(types, {}).values():
            kind = kind.upper()
            cfg = base_rules.get(kind, {})
            image = cfg.get('IMAGE', kind).upper()
            sequence = base_art.get(image, {}).get('SEQUENCE', '').upper()
            symbol = ('animal' if sequence in {'DOGSEQUENCE', 'ANIMALSEQUENCE', 'TREXSEQUENCE', 'BRONTSEQUENCE'} else
                      'civilian' if yes(cfg.get('CIVILIAN', 'no')) else UNIT_SYMBOLS[section])
            identities[kind] = symbol
            images.setdefault(image, set()).add(symbol)
        result[section] = dict(types=identities, images={image: next(iter(kinds)) for image, kinds in images.items() if len(kinds) == 1})
    return result


def unit_symbol(section, kind, cfg, visual_symbols):
    scope = visual_symbols[section]
    return scope['images'].get(cfg.get('IMAGE', kind).upper(), scope['types'].get(kind, UNIT_SYMBOLS[section]))


def scene(report, folder):
    from map_results import resource_context, source_bytes
    from realmap_format import ini, yes, number
    from realmap_parser import object_records
    from realmap_objects import visual_foundation
    path = Path(folder)/'result.json'
    resource, theater = resource_context(report, path)
    rules = theater['effectiveRules']
    visual_symbols = unit_visual_symbols(resource.rules, resource.art)
    records = object_records(ini(source_bytes(report, path, required=True)))
    cells = {(c['x'], c['y']): c for c in report['cells']}
    objects = []
    for obj in records:
        c = cells.get((obj['x'], obj['y']))
        if not c:
            continue
        kind, section = obj['type'], obj['category']
        cfg = rules.get(kind, {})
        art = resource.art.get(cfg.get('IMAGE', kind).upper(), {})
        w = h = 1
        if section == 'STRUCTURES':
            foundation = visual_foundation(art)
            w = max(x for x, y in foundation)+1
            h = max(y for x, y in foundation)+1
            # Most symbols describe abilities. Stock repair huts have no
            # distinguishing rules ability, and are identified by type ID.
            if kind in ('CABHUT', 'CABHUT2'):
                symbol = 'repair'
            elif number(cfg.get('PRODUCECASHAMOUNT', '0')) > 0:
                symbol = 'oil'
            elif yes(cfg.get('HOSPITAL', 'no')) or number(cfg.get('INFANTRYGAINSELFHEAL', '0')) > 0:
                symbol = 'hospital'
            elif yes(cfg.get('ARMORY', 'no')):
                symbol = 'armory'
            elif yes(cfg.get('SECRETLAB', 'no')):
                symbol = 'lab'
            elif yes(cfg.get('CAPTURABLE', 'no')) and kind.startswith('CA'):
                symbol = 'tech'
            else:
                symbol = 'building'
        else:
            symbol = unit_symbol(section, kind, cfg, visual_symbols)
        level = c['bridge']['deckLevel'] if obj['aboveGround'] and (c.get('bridge') or {}).get('kind') == 'high' else c['level']
        objects.append([obj['x'], obj['y'], level, symbol, w, h, obj['subcell']])
    return dict(version=VERSION, style='cell-materials', objects=objects)
