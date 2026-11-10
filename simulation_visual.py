"""Paint a bounded edit patch without running probability/search or exporting a map."""
from copy import copy, deepcopy
from collections import OrderedDict, defaultdict
from io import BytesIO
import base64
import time
from uuid import uuid4
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
import os


TILE = 256


class ByteLRU(OrderedDict):
    """On-demand cache ownership; count limits alone thrash on large maps."""
    def __init__(self, budget, weight):
        super().__init__()
        self.budget, self.weight, self.bytes, self.sizes = budget, weight, 0, {}

    def __setitem__(self, key, value):
        if key in self:
            self.__delitem__(key)
        size = self.weight(key, value)
        if size > self.budget:
            return
        super().__setitem__(key, value)
        self.sizes[key] = size
        self.bytes += size
        while self.bytes > self.budget:
            self.popitem(last=False)

    def __delitem__(self, key):
        super().__delitem__(key)
        self.bytes -= self.sizes.pop(key)

    def popitem(self, last=True):
        key, value = super().popitem(last=last)
        self.bytes -= self.sizes.pop(key)
        return key, value

    def clear(self):
        super().clear()
        self.sizes.clear()
        self.bytes = 0


def image_token(image):
    if image is None:
        return None
    token = getattr(image, '_crate_atlas_render_token', None)
    if token is None:
        token = image._crate_atlas_render_token = uuid4().hex
    return token


class SharedVoxelFrames:
    """Share native index/shadow frames; serialize the worker's request pipe."""
    def __init__(self, renderer=None, owner=None):
        self.owner = owner or dict(renderer=renderer, users=1, lock=Lock())
        self.closed = False

    def fork(self):
        with self.owner['lock']:
            if self.closed:
                raise ValueError('Voxel frame owner was closed')
            self.owner['users'] += 1
        return SharedVoxelFrames(owner=self.owner)

    def draw(self, *args, **kwargs):
        with self.owner['lock']:
            if self.closed:
                raise ValueError('Voxel frame reader was closed')
            return self.owner['renderer'].draw(*args, **kwargs)

    def close(self):
        with self.owner['lock']:
            if self.closed:
                return
            self.closed = True
            self.owner['users'] -= 1
            if not self.owner['users']:
                self.owner['renderer'].close()


def encode(image):
    stream = BytesIO()
    from PIL import features
    if features.check('webp'):
        image.save(stream, format='WEBP', lossless=True, method=0, exact=True)
        mime = 'webp'
    else:
        image.save(stream, format='PNG', compress_level=1)
        mime = 'png'
    return f'data:image/{mime};base64,' + base64.b64encode(stream.getvalue()).decode('ascii')


class Scene:
    """Retain native draw inputs and replay only affected pixel tiles."""

    def __init__(self, cells, res, theater, tmps, path, metadata, rendering):
        from PIL import Image
        from realmap_objects import ObjectPainter
        from realmap_render import PaintAssets
        self.res, self.tmps, self.path, self.metadata = res, tmps, path, metadata
        self.width, self.height = rendering['width'], rendering['height']
        self.origin = rendering['origin']
        self.assets = PaintAssets(res, theater, tmps)
        self.painter = ObjectPainter(res, theater, path.parent)
        self.terrain = defaultdict(set)
        self.sprites = defaultdict(set)
        self.sprite_tiles = {}
        self.tile_revisions = {}
        self.init_caches()
        self.ground_epoch = uuid4().hex
        self.tank_records = {}
        self.tank_tiles = defaultdict(dict)
        self.tank_active = False
        self.opaque_parts = {}
        self.background = None
        self.cells = cells
        self.events = self.original_events = self.index_events(self.object_events(cells, theater))
        for point, cell in cells.items():
            x, y = self.anchor(cell)
            _, (parts, *_other) = self.assets.ground(cell)
            for image, dx, dy in parts:
                for tile in self.tiles(x-30+dx, y-15+dy, image):
                    self.terrain[tile].add(point)
            self.update_sprites(point, cell, theater)
        # Only use the saved ground as a checkpoint if its pixel model matches.
        from realmap_render import VERSION
        background = (path.parent/rendering['image']).resolve() if rendering.get('image') else None
        if (self.width*self.height <= 32_000_000 and rendering.get('version') == VERSION and background is not None and
                background.parent == path.parent.resolve() and background.is_file()):
            self.background = Image.open(background)
            if self.background.size != (self.width, self.height):
                self.background.close()
                self.background = None
            else:
                self.background.load()
        self.original_sprite_tiles = frozenset(self.sprites)

    def fork(self, res):
        """Share decoded, read-only pixels; isolate each editor's mutable indexes."""
        other = copy(self)
        other.res = res
        other.tmps = dict(self.tmps)
        other.assets = copy(self.assets)
        other.assets.res, other.assets.tmps = res, other.tmps
        for name in ('tiles', 'sprites', 'audit', 'tile_heights'):
            setattr(other.assets, name, dict(getattr(self.assets, name)))
        other.assets.missing = set(self.assets.missing)
        other.assets.variants = copy(self.assets.variants)
        other.assets.variants.res = res
        other.assets.variants.raws = other.tmps
        other.assets.variants.definitions = dict(self.assets.variants.definitions)
        other.painter = copy(self.painter)
        other.painter.res = res
        for name in ('cache', 'files', 'palettes', 'rules'):
            setattr(other.painter, name, dict(getattr(self.painter, name)))
        other.painter.audit, other.painter.missing, other.painter.warnings = [], [], set()
        if self.painter.voxels is not None:
            if not isinstance(self.painter.voxels, SharedVoxelFrames):
                self.painter.voxels = SharedVoxelFrames(self.painter.voxels)
            other.painter.voxels = self.painter.voxels.fork()
        else:
            other.painter.voxels = None
        other.painter.voxel_error = None
        other.sprites = defaultdict(set, ((key, set(value)) for key,value in self.sprites.items()))
        other.sprite_tiles = {key:set(value) for key,value in self.sprite_tiles.items()}
        other.tile_revisions = {}
        other.init_caches()
        other.ground_epoch = uuid4().hex
        other.tank_records, other.tank_tiles, other.tank_active = {}, defaultdict(dict), False
        other.opaque_parts = {}
        # Ground pixels can outlive the cached baseline while an editor uses it.
        owner = getattr(self, '_background_owner', None)
        if owner is None:
            owner = self._background_owner = dict(image=self.background, users=1, lock=Lock())
        with owner['lock']:
            owner['users'] += 1
        other._background_owner, other._closed = owner, False
        return other

    def init_caches(self):
        self.flat_tiles = ByteLRU(128*1024*1024, lambda k,v: v[0].width*v[0].height*4+v[1].nbytes+128)
        self.ground_encodings = ByteLRU(32*1024*1024, lambda k,v: len(v)+128)
        weight = lambda k,v: len(v['patch'].get('ground',''))+len(v['patch']['objects'])+len(repr(k))*2+256
        self.painted_tiles = ByteLRU(32*1024*1024, weight)
        self.tile_history = ByteLRU(64*1024*1024, weight)
        self.encoder = None

    def tile_signature(self, tile, events, bridge_flags):
        if not hasattr(self, 'assets'):
            return None
        sprites = tuple((p,self.cells[p]['overlayName'],self.cells[p]['overlayData'],self.cells[p]['terrain'],bool(self.cells[p].get('simulationOverlay')))
                        for p in sorted(self.sprites.get(tile, ())))
        parts = tuple((*event[:5],image_token(event[5]['image']),image_token(event[5]['shadow']),
                       event[5]['x'],event[5]['y'],event[5].get('shadowX'),event[5].get('shadowY')) for event in events)
        return tile, bridge_flags, sprites, parts

    def anchor(self, cell):
        x, y = cell['x'], cell['y']
        return 30*(x-y)+self.origin[0], 15*(x+y-cell['level'])+self.origin[1]

    def tiles(self, x, y, image):
        left, top = max(0, x), max(0, y)
        right, bottom = min(self.width, x+image.width), min(self.height, y+image.height)
        if left < right and top < bottom:
            for ty in range(top//TILE, (bottom-1)//TILE+1):
                for tx in range(left//TILE, (right-1)//TILE+1):
                    yield tx, ty

    def update_sprites(self, point, cell, theater):
        x, y = self.anchor(cell)
        old = self.sprite_tiles.pop(point, set())
        for key in old:
            self.sprites[key].discard(point)
        new = set()
        for overlay in (True, False):
            sprite = self.assets.sprite(cell, overlay, theater)
            if sprite is None:
                continue
            image, offset, shadow, _ = sprite
            sx, sy = x-image.width//2, y-image.height//2+offset
            new.update(self.tiles(sx, sy, image))
            if shadow is not None:
                new.update(self.tiles(sx, sy, shadow))
        if new:
            self.sprite_tiles[point] = new
            for key in new:
                self.sprites[key].add(point)
        return old | new

    def object_events(self, cells, theater, event_groups=None):
        painter = self.painter
        painter.theater = theater
        painter.rules = dict(theater['effectiveRules'])
        for house, config in theater.get('mapHouses', {}).items():
            painter.rules[house] = {**painter.rules.get(house, {}), **config}
        painter.audit.clear()
        painter.missing.clear()
        return painter.prepare(cells, self.origin, event_groups=event_groups)[0]

    def event_tiles(self, event):
        _, _, x, y, _, part = event
        image, shadow = part['image'], part['shadow']
        yield from self.tiles(round(x+part['x']), round(y+part['y']), image)
        if shadow is not None:
            yield from self.tiles(round(x+part.get('shadowX', part['x'])),
                                  round(y+part.get('shadowY', part['y'])), shadow)

    def index_events(self, events):
        result = defaultdict(list)
        for event in events:
            for tile in set(self.event_tiles(event)):
                result[tile].append(event)
        return result

    def update(self, cells, theater, dirty, revision):
        if '_liveTanks' in theater:
            events, candidates = self.update_tanks(cells, theater)
        else:
            events = self.index_events(self.object_events(cells, theater))
            candidates = self.events.keys() | events.keys()
            self.tank_records.clear()
            self.tank_tiles.clear()
            self.tank_active = False
        def signature(event):
            return (*event[:5], id(event[5]))
        changed = {tile for tile in candidates
                   if self.events.get(tile) is not events.get(tile) and
                   tuple(map(signature, self.events.get(tile, ()))) != tuple(map(signature, events.get(tile, ())))}
        visual_fields = ('overlayName', 'overlayData', 'terrain', 'simulationOverlay')
        for point in dirty:
            previous, current = self.cells[point], cells[point]
            if any(previous.get(field) != current.get(field) for field in visual_fields):
                changed.update(self.update_sprites(point, current, theater))
        for tile in changed:
            self.tile_revisions[tile] = revision
        self.cells, self.events = cells, events

    def update_tanks(self, cells, theater):
        """Reuse unchanged native object groups in the validated clear-land path.

        Only LiveSession's MTNK shortcut supplies _liveTanks. Bridges, edited
        scenery, buildings and other units retain the complete prepare path.
        """
        units = {obj['id']: obj for obj in theater['_liveTanks']}
        candidates = set()

        def remove(identifier):
            previous = self.tank_records.pop(identifier)
            for tile in previous['tiles']:
                self.tank_tiles[tile].pop(identifier)
                if not self.tank_tiles[tile]:
                    del self.tank_tiles[tile]
                candidates.add(tile)

        for identifier in self.tank_records.keys()-units.keys():
            remove(identifier)
        pending, stamps = [], {}
        for identifier, obj in units.items():
            color_name = theater['mapHouses'].get(obj['house'], {}).get('COLOR')
            stamp = (cells[obj['x'], obj['y']]['level'],
                     theater['effectiveRules']['COLORS'].get(color_name))
            previous = self.tank_records.get(identifier)
            if previous and previous['object'] == obj and previous['stamp'] == stamp:
                continue
            if previous:
                remove(identifier)
            pending.append(obj)
            stamps[identifier] = stamp
        groups = {}
        if pending:
            self.object_events(cells, dict(theater, mapObjects=pending), groups)
        for obj in pending:
            identifier = obj['id']
            tiles = self.index_events(groups.get(identifier, ()))
            self.tank_records[identifier] = dict(object=deepcopy(obj), stamp=stamps[identifier], tiles=tuple(tiles))
            for tile, events in tiles.items():
                self.tank_tiles[tile][identifier] = events
                candidates.add(tile)
        if not self.tank_active:
            candidates.update(self.events.keys() | self.original_events.keys() | self.tank_tiles.keys())
        events = dict(self.events)
        for tile in candidates:
            extra = [event for group in self.tank_tiles.get(tile, {}).values() for event in group]
            combined = sorted([*self.original_events.get(tile, ()), *extra], key=lambda e:e[:2])
            if combined:
                events[tile] = combined
            else:
                events.pop(tile, None)
        self.tank_active = True
        return events, candidates

    def flat_replay(self, tile, box, events):
        """Same-level ground and no scenery commute with object draws.

        Flat terrain behind a solid object is preserved by the object stencil
        at that same level. The original ground plus exact sprite/shadow
        operations is therefore a valid checkpoint for this subset of tiles.
        """
        from PIL import Image
        import numpy as np
        from realmap_render import apply_shadow
        if self.background is None or tile in self.original_sprite_tiles or self.sprites.get(tile):
            return None
        x,y,w,h = box
        if tile not in self.flat_tiles:
            points = self.terrain.get(tile, ())
            levels = {self.cells[p]['level'] for p in points}
            if len(levels) != 1:
                return None
            owner = Image.new('L', (w,h))
            for point in points:
                cell = self.cells[point]
                _, (parts, *_other) = self.assets.ground(cell)
                if len(parts) != 1:
                    return None
                image,dx,dy = parts[0]
                cx,cy = self.anchor(cell)
                at = cx-30+dx-x,cy-15+dy-y
                owner.paste(1, (*at,at[0]+image.width,at[1]+image.height), image.getchannel('A'))
            ground = self.background.crop((x,y,x+w,y+h)).convert('RGBA')
            self.flat_tiles[tile] = ground, np.asarray(owner), next(iter(levels))
        ground, owners, level = self.flat_tiles[tile]
        self.flat_tiles.move_to_end(tile)
        # Different elevations can allow a foreground TMP to cover an object.
        if any(event[4] != level for event in events):
            return None
        for *_, part in events:
            image = part['image']
            key = image_token(image)
            if key not in self.opaque_parts:
                self.opaque_parts[key] = not any(image.getchannel('A').histogram()[1:255])
            if not self.opaque_parts[key]:
                return None
        scene, bodies = ground.copy(), Image.new('L', (w,h))
        for _,_,cx,cy,_,part in events:
            image = part['image']
            at = round(cx+part['x'])-x,round(cy+part['y'])-y
            scene.alpha_composite(image, at)
            bodies.paste(255, (*at,at[0]+image.width,at[1]+image.height), image.getchannel('A'))
        levels = np.array([-32768,level],dtype=np.int16)
        for _,_,cx,cy,_,part in events:
            if (shadow := part['shadow']) is not None:
                sx,sy = round(cx+part.get('shadowX',part['x']))-x,round(cy+part.get('shadowY',part['y']))-y
                apply_shadow(scene, shadow, sx, sy, level, owners, levels, bodies)
        return ground, scene

    def paint(self, theater, base_revision, *, limit=None, offset=0, focus=None, known_ground=()):
        from realmap_bridges import HIGH_NAMES
        from realmap_render import render
        started = time.perf_counter()
        dirty = [tile for tile, revision in self.tile_revisions.items() if revision > base_revision]
        if limit is None and len(dirty) > 64:
            raise ValueError('Artwork change exceeds live tile budget')
        if focus is None:
            dirty.sort()
        else:
            x, y = focus
            dirty.sort(key=lambda p: ((TILE*(p[0]+.5)-x)**2+(TILE*(p[1]+.5)-y)**2, p))
        total = len(dirty)
        if not 0 <= offset <= total:
            raise ValueError('Invalid live artwork cursor')
        end = total if limit is None else min(total, offset+limit)
        bridge_names = {name for p in self.sprite_tiles
                        if (name := self.cells[p]['overlayName']) and (name in HIGH_NAMES or name.startswith(('LOBRDG', 'LOBRDB')))}
        patches = []
        pending = []
        if not hasattr(self, 'encoder'):
            self.encoder = None
        if self.encoder is None:
            self.encoder = ThreadPoolExecutor(max_workers=min(4,max(1,(os.cpu_count() or 2)-2)),thread_name_prefix='crate-tile-codec')
        def encoded(image):
            at=time.perf_counter()
            return encode(image),(time.perf_counter()-at)*1000
        fast_count = 0
        encode_ms = raster_ms = 0.0
        ground_reused = tile_reused = 0
        known_ground = frozenset(known_ground)
        for tile in dirty[offset:end]:
            x, y = tile[0]*TILE, tile[1]*TILE
            w, h = min(TILE, self.width-x), min(TILE, self.height-y)
            box = [x,y,w,h]
            tile_events = self.events.get(tile, ())
            cached = self.painted_tiles.get(tile)
            signature = self.tile_signature(tile,tile_events,(bool(bridge_names & HIGH_NAMES),bool(bridge_names)))
            if (not cached or cached['revision'] != self.tile_revisions[tile]) and signature is not None:
                previous = self.tile_history.get(signature)
                if previous is not None:
                    cached = dict(previous,revision=self.tile_revisions[tile])
                    self.tile_history.move_to_end(signature)
                    self.painted_tiles[tile] = cached
            if cached and cached['revision'] == self.tile_revisions[tile]:
                item = dict(cached['patch'])
                self.painted_tiles.move_to_end(tile)
                tile_reused += 1
                if item.get('groundKey') in known_ground:
                    item.pop('ground', None)
                    ground_reused += 1
                patches.append(item)
                fast_count += cached['flat']
                continue
            def receive(ground, objects, _origin, flat=False):
                saved = self.ground_encodings.get(tile) if flat else None
                pending.append((tile,box,signature,flat,self.encoder.submit(encoded,objects),saved or self.encoder.submit(encoded,ground)))
                patches.append(None)
            raster_at=time.perf_counter()
            fast=self.flat_replay(tile,box,tile_events)
            raster_ms+=(time.perf_counter()-raster_at)*1000
            if fast is not None:
                receive(*fast,None,flat=True);fast_count+=1;continue
            points = self.terrain.get(tile, set()) | self.sprites.get(tile, set())
            # Bridge artwork may be emitted one diagonal cell before its owner.
            points.update((px-1, py-1) for px, py in self.sprites.get(tile, ())
                          if (px-1, py-1) in self.cells)
            events = [(d, px, cx-x, cy-y, level, part)
                      for d, px, cx, cy, level, part in tile_events]
            replay = dict(assets=self.assets, points=points, events=events,
                          rect=(x-self.origin[0], y-self.origin[1], w, h),
                          high=bool(bridge_names & HIGH_NAMES), bridges=bool(bridge_names))
            raster_at=time.perf_counter();encoded_before=encode_ms
            render(self.cells, self.res, theater, self.tmps, self.path.parent,
                   self.metadata, lambda *_: None, save_images=False, image_sink=receive, replay=replay)
            raster_ms+=(time.perf_counter()-raster_at)*1000-(encode_ms-encoded_before)
        iterator=iter(pending)
        for i, patch in enumerate(patches):
            if patch is not None:
                continue
            tile,box,signature,flat,objects,ground=next(iterator)
            objects,ms=objects.result();encode_ms+=ms
            if not isinstance(ground,str):
                ground,ms=ground.result();encode_ms+=ms
                if flat:self.ground_encodings[tile]=ground
            elif flat:self.ground_encodings.move_to_end(tile)
            item=dict(box=box,objects=objects,ground=ground)
            if flat:item['groundKey']=f'{self.ground_epoch}:{tile[0]},{tile[1]}'
            cached=dict(revision=self.tile_revisions[tile],patch=item,flat=int(flat))
            self.painted_tiles[tile]=cached
            if signature is not None:self.tile_history[signature]=cached
            output=dict(item)
            if output.get('groundKey') in known_ground:
                output.pop('ground',None);ground_reused+=1
            patches[i]=output
        return dict(patches=patches, flatTiles=fast_count, groundReused=ground_reused,tileReused=tile_reused,rasterMs=round(raster_ms,3),encodeMs=round(encode_ms,3),paintMs=round((time.perf_counter()-started)*1000, 2),
                    offset=offset, done=end, total=total)

    def close(self):
        if getattr(self, '_closed', False):
            return
        self._closed = True
        if getattr(self,'encoder',None) is not None:
            self.encoder.shutdown(wait=True,cancel_futures=True)
            self.encoder=None
        owner = getattr(self, '_background_owner', None)
        if owner is not None:
            with owner['lock']:
                owner['users'] -= 1
                if owner['users'] == 0 and owner['image'] is not None:
                    owner['image'].close()
        elif self.background is not None:
            self.background.close()
        if self.painter.voxels is not None:
            self.painter.voxels.close()
        for name in ('flat_tiles','ground_encodings','painted_tiles','tile_history'):
            getattr(self,name,{}).clear()


def patch(payload):
    from map_results import result_path, load_report, source_bytes, source_ini, resource_context
    from realmap_simulation import validate, apply
    from realmap_parser import object_records
    from realmap_render import render
    from realmap_bridges import initialize as initialize_bridges
    started = time.perf_counter()
    path = result_path(payload['result'])
    report, _ = load_report(path)
    data = source_bytes(report, path)
    plan = validate(payload['plan'], data, report['metadata']['version'])
    box = payload['box']
    if (not isinstance(box, list) or len(box) != 4 or
            any(type(n) is not int for n in box) or not 0 < box[2]*box[3] <= 4000000):
        raise ValueError('Invalid artwork patch bounds')
    x,y,w,h = box
    r = report['rendering']
    if x < 0 or y < 0 or x+w > r['width'] or y+h > r['height']:
        raise ValueError('Artwork patch outside map')
    res, theater = resource_context(report, path)
    content = deepcopy(source_ini(data))
    rules = dict(theater['effectiveRules'])
    rules['COLORS'] = dict(rules.get('COLORS', {}))
    cells = {(c['x'], c['y']):dict(c) for c in report['cells']}
    rubble = apply(plan, content, cells, rules, res.art)
    initialize_bridges(cells, strict=False)
    for c in cells.values(): c['terrain'] = None
    for position, kind in content.get('TERRAIN', {}).items():
        try: c = cells.get((int(position)%1000, int(position)//1000))
        except ValueError: continue
        if c is not None: c['terrain'] = kind.upper()
    theater['effectiveRules'] = rules
    theater['mapObjects'] = object_records(content, on_error=lambda *args: None)
    theater['mapObjects'].extend(object_records({'STRUCTURES':dict(rubble)}))
    theater['emptyFoundationObjectIds'] = [o['id'] for o in report['metadata'].get('emptyFoundationObjects',[])]
    theater['mapHouses'] = {o['house']:content[o['house']] for o in theater['mapObjects'] if o['house'] in content}
    ox,oy = r['origin']
    # Context retains neighbouring foundations, overhanging sprites and shadows.
    margin = 360
    cells = {p:c for p,c in cells.items() if
        x-margin <= 30*(c['x']-c['y'])+ox <= x+w+margin and
        y-margin <= 15*(c['x']+c['y']-c['level'])+oy <= y+h+margin}
    if not cells: raise ValueError('Empty artwork patch')
    tmps = {name:res.get(theater['tilemix'],name) for name in {c['file'] for c in cells.values() if not c.get('terrainError')}}
    result = {'box':box}
    def receive(ground, objects, origin):
        left,top = x-ox+origin[0],y-oy+origin[1]
        for name,image in (('ground',ground),('objects',objects)):
            result[name] = encode(image.crop((left,top,left+w,top+h)))
    render(cells,res,theater,tmps,path.parent,report['metadata'],lambda *args:None,save_images=False,image_sink=receive)
    result['elapsedMs'] = round((time.perf_counter()-started)*1000,1)
    result['paintedCells'] = len(cells)
    return result
