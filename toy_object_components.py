"""Build composable Toy parts from the same native painter as full maps.

Recipes retain palette indices, anchors and shadow masks. Geometry-changing
parameters are represented by exact baked keys, never approximated at runtime.
"""
import json
from realmap_format import yes, ini_integer


def key(value):
    return json.dumps(value, separators=(',', ':'))


def body_key(obj, cfg, image):
    from realmap_objects import deployment_mission
    category = obj['category']
    mission = deployment_mission(category, cfg, image, obj['mission'])
    health = (0 if obj['health'] == 0 else 1 if obj['health'] < 128 else 2) if category == 'STRUCTURES' else 2
    face = 0 if category == 'STRUCTURES' else obj['facing']//(32 if category == 'INFANTRY' else 8)
    return key([category, image.upper(), int(category == 'INFANTRY' and yes(cfg.get('ALTERNATEARCTICART', 'no'))),
                int(category in ('UNITS', 'AIRCRAFT') and yes(cfg.get('CONSIDEREDAIRCRAFT', 'no'))), health, face, mission,
                cfg.get('UNLOADINGCLASS', '').strip().upper() if category == 'UNITS' and mission else ''])


class Components:
    def __init__(self, data=None):
        self.data = data or {}
        self.current = None
        self.counts = {}

    def scope(self, name, painter):
        # Distinguish a genuinely absent optional barrel from an existing model
        # whose angle/offset was not baked. Only the former may be omitted.
        names = {n for mix in painter.mixes for n in painter.res.mix(mix)}
        self.name = name
        self.current = self.data.setdefault(name, dict(bodies={}, voxels={}, turrets={}, vehicles={},
            voxelFiles=sorted(n[:-4].upper() for n in names if n.endswith('.vxl') and n[:-4]+'.hva' in names)))

    def voxels(self, obj, cfg, image, art, turret, parts, part_ref):
        if self.current is None:
            return
        offset = [ini_integer(v) for v in art.get('TURRETOFFSET', '0,0,0').split(',')]
        angle = ini_integer(cfg.get('FIREANGLE', '10'))
        for part in parts:
            name = part['file'][:-4].upper()
            if turret:
                fire = (0 if 'tur' in turret.lower() else angle) if name == turret.upper() else angle
                dx, dy = ini_integer(cfg.get('TURRETANIMX', '0')), ini_integer(cfg.get('TURRETANIMY', '0'))-15
            else:
                if name != image.upper() and any(offset):
                    continue  # A rotated lepton offset cannot be undone as a 2D translation.
                fire = 0 if name in (image.upper(), image.upper()+'TUR') else angle
                dx = dy = 0
            ref = part_ref(part)
            refs = [] if ref is None else [[ref[0], ref[1]-dx, ref[2]-dy, 0, ref[4]]]
            token = key([name, obj['facing']//8, fire])
            prior = self.current['voxels'].setdefault(token, refs)
            assert prior == refs, ('Ambiguous voxel component', token)

    def body(self, painter, obj, cfg, image, art, full_parts, part_ref, shadow_ref):
        token = body_key(obj, cfg, image)
        if token not in self.current['bodies']:
            # Only the build-time copy changes. Map types and gameplay rules do not.
            alias = '__TOY_COMPONENT_BODY__'
            painter.rules[alias] = {**cfg, 'IMAGE': image, 'TURRET': 'no', 'NOSHADOW': 'no'}
            rec = {**obj, 'type': alias, 'facing': 0 if obj['category'] == 'STRUCTURES' else obj['facing']}
            parts = painter.parts(rec)
            refs = [ref for part in parts if (ref := part_ref(part))]
            refs += [ref for part in parts if (ref := shadow_ref(part, all_shapes=True))]
            _, palette = painter.voxel_colors(art, obj)
            vxl = parts[0]['file'][:-4].upper() if parts and parts[0]['file'].endswith('.vxl') else ''
            self.current['bodies'][token] = [refs, palette, yes(art.get('BARRELOVERTURRET', 'no')), vxl]
            self.counts[self.name, token] = len(parts)
        if obj['category'] in ('UNITS', 'AIRCRAFT') and yes(cfg.get('TURRET', 'no')):
            parts = full_parts[self.counts[self.name, token]:]
            refs = [ref for part in parts if (ref := part_ref(part))]
            refs += [ref for part in parts if (ref := shadow_ref(part, all_shapes=True))]
            self.current['vehicles'][token] = [refs, ini_integer(cfg.get('FIREANGLE', '10'))]

    def shp_turret(self, obj, cfg, parts, part_ref, shadow_ref):
        if obj['category'] != 'STRUCTURES' or obj['health'] == 0 or not cfg.get('TURRETANIM') or yes(cfg.get('TURRETANIMISVOXEL', 'no')):
            return
        # Stock SHP turrets, when present, have a final part after the base/anims.
        part = parts[-1]
        dx, dy = ini_integer(cfg.get('TURRETANIMX', '0')), ini_integer(cfg.get('TURRETANIMY', '0'))-15
        refs = [ref for ref in (part_ref(part), shadow_ref(part, all_shapes=True)) if ref]
        refs = [[r[0], r[1]-dx, r[2]-dy, *r[3:]] for r in refs]
        token = key([cfg['TURRETANIM'].upper(), obj['facing']//8, max(1, ini_integer(cfg.get('TURRETANIM.IDLEFRAMES', '1')))])
        prior = self.current['turrets'].setdefault(token, refs)
        assert prior == refs, ('Ambiguous SHP turret', token)

    def references(self):
        for scope in self.data.values():
            for entry in scope['bodies'].values():
                yield entry[0]
            for entry in scope['vehicles'].values():
                yield entry[0]
            for category in ('voxels', 'turrets'):
                yield from scope[category].values()

    def pack(self, intern):
        for scope in self.data.values():
            for entry in scope['bodies'].values():
                entry[0] = intern(entry[0])
            for entry in scope['vehicles'].values():
                entry[0] = intern(entry[0])
            for category in ('voxels', 'turrets'):
                scope[category] = {k: intern(v) for k, v in scope[category].items()}
        return dict(version=1, scopes=self.data)
