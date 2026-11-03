"""Build-time original-art capture for the static edition.

The desktop painter remains the single authority for draw order, bridge depth,
object occlusion and shadow receivers. Its two RGB output surfaces are replaced
by command recorders inside an isolated build process; all ownership/stencil
images remain real Pillow images. No map bitmap or MIX is shipped to browsers.
"""
from pathlib import Path
from contextlib import contextmanager
import base64, gzip, hashlib, json, struct
import runtime_bootstrap
import numpy as np
from PIL import Image
from map_results import resource_context, source_bytes
from realmap_format import ini
from realmap_parser import object_records
from toy_build_inputs import artwork_fingerprint

VERSION = 1


def capture_stamp():
    return artwork_fingerprint(('toy_original.py',))

def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf8')

class Pixels:
    def __init__(self, folder):
        self.folder = Path(folder); self.folder.mkdir(parents=True, exist_ok=True)
        self.records = {}

    def add(self, image):
        if image.mode != 'RGBA':
            alpha = image.convert('L'); image = Image.new('RGBA', image.size); image.putalpha(alpha)
        bounds = image.getbbox()
        if bounds is None: return None
        image = image.crop(bounds)
        a = np.asarray(image).copy(); a[a[:,:,3] == 0] = 0
        payload = a.tobytes()
        key = hashlib.sha256(struct.pack('<II', *image.size)+payload).hexdigest()[:32]
        if key not in self.records:
            path = self.folder/(key+'.png')
            if not path.exists():
                # Workers may publish the same immutable pixel data.
                import os, tempfile
                fd, temp = tempfile.mkstemp(suffix='.png', dir=self.folder); os.close(fd)
                try:
                    Image.frombytes('RGBA', image.size, payload).save(temp)
                    # A second worker may publish the same hash while this
                    # worker encodes it. Never replace an open Windows file.
                    try: os.link(temp,path)
                    except FileExistsError: pass
                    except PermissionError:
                        if not path.is_file(): raise
                finally:
                    if Path(temp).exists(): Path(temp).unlink()
            self.records[key] = [image.width, image.height]
        return [key,bounds[0],bounds[1]]

def capture(report_path, cache):
    import realmap_render as painter
    from realmap_sprites import tile_parts, palette, sprite_spec, shp_frame
    from realmap_bridges import sprite_frame
    from realmap_objects import ObjectPainter
    path, cache = Path(report_path), Path(cache)
    report = json.loads(path.read_text('utf8'))
    res, theater = resource_context(report,path)
    metadata = report['metadata']; cells = {(c['x'],c['y']):c for c in report['cells']}
    content = ini(source_bytes(report,path)); theater['mapObjects'] = object_records(content)
    audit = json.loads((path.parent/'object-audit.json').read_text('utf8'))
    theater['emptyFoundationObjectIds'] = [v['id'] for v in audit.get('hidden',[]) if v.get('reason') == 'registered-empty-foundation']
    theater['mapHouses'] = {o['house']:content[o['house']] for o in theater['mapObjects'] if o['house'] in content}
    pixels = Pixels(cache/'pixels'); layers = []
    class Surface:
        def __init__(self,size):
            self.size=size; self.width,self.height=size; self.commands=[]; layers.append(self)
        def copy(self): return Surface(self.size)
        def paste(self,image,box,mask=None):
            if isinstance(image,tuple):
                sprite=Image.new('RGBA',mask.size,image+(255,) if len(image)==3 else image)
                sprite.putalpha(mask)
            else:
                sprite=image
                if mask is not None and mask is not image:
                    sprite=image.copy(); sprite.putalpha(mask if mask.mode=='L' else mask.getchannel('A'))
            ref=pixels.add(sprite)
            if ref: self.commands.append([ref[0],box[0]+ref[1],box[1]+ref[2]])
        def save(self,*args,**kwargs): pass
    class Imaging:
        def new(self,mode,size,*args,**kwargs):
            return Surface(size) if mode=='RGB' else Image.new(mode,size,*args,**kwargs)
        def __getattr__(self,name): return getattr(Image,name)
    raw_tiles={name:res.get(theater['tilemix'],name) for name in {c['file'] for c in cells.values()}}
    original=painter.Image; original_contours=painter.contours
    folder=cache/'traces'/path.parent.name; folder.mkdir(parents=True,exist_ok=True)
    try:
        painter.Image=Imaging()
        # Display contours are already authoritative in the precomputed report;
        # recapturing them cannot affect pixels, depth stencils or shadows.
        painter.contours=lambda *args: []
        rendering=painter.render(cells,res,theater,raw_tiles,folder,metadata,lambda *args:None,save_images=False)
    finally:
        painter.Image=original
        painter.contours=original_contours
    assert len(layers)==2
    # Source sprites at native size, for 3D unprojection and billboards. Shared
    # with 2D whenever the final painter did not clip their alpha.
    from realmap_terrain_variants import TerrainVariants
    variants=TerrainVariants(res,theater,raw_tiles)
    # Keep all safe variants of each used tile available to custom maps and 3D.
    tile_keys={(name,c['subTile']) for c in cells.values() if not c.get('terrainError')
               for name in variants.choices(c['file'])[2]}
    tiles={}; colors=palette(theater['palette'])
    for name,sub in sorted(tile_keys):
        parts=[]
        for image,x,y in tile_parts(raw_tiles[name],sub,colors):
            ref=pixels.add(image)
            if ref: parts.append([ref[0],x+ref[1],y+ref[2]])
        tiles[name+'/'+str(sub)]=parts
    sprites={}
    for kind,overlay,frame in sorted({(c['terrain'],False,0) for c in cells.values() if c['terrain']}|{(c['overlayName'],True,sprite_frame(c)) for c in cells.values() if c['overlayName']}):
        raw,colors,offset,_=sprite_spec(kind,overlay,frame,res,theater)
        im=shp_frame(raw,frame,colors); ref=pixels.add(im)
        sprites[f'{int(overlay)}/{kind}/{frame}']=None if not ref else [ref[0],ref[1]-im.width//2,ref[2]-im.height//2+offset]
    objects=[]; op=ObjectPainter(res,theater,path.parent)
    try:
        events,info=op.prepare(cells,rendering['origin'])
        for rec in info['records']:
            if not rec.get('parts'): continue
            cell=cells.get((rec['x'],rec['y']))
            if not cell: continue
            parts=[]
            for part in op.parts(rec):
                ref=pixels.add(part['image'])
                if ref: parts.append([ref[0],part['x']+ref[1],part['y']+ref[2]])
            objects.append([rec['x'],rec['y'],cell['level']+(4 if rec['onBridgeDeck'] else 0),
                            rec['renderAnchor'][0]-(30*(rec['x']-rec['y'])+rendering['origin'][0]),
                            rec['renderAnchor'][1]-(15*(rec['x']+rec['y']-cell['level']-(4 if rec['onBridgeDeck'] else 0))+rendering['origin'][1]),parts])
    finally:
        if op.voxels: op.voxels.close()
    # Source/build cache only. The packer replaces hashes with compact atlas IDs.
    value=dict(version=VERSION,assets=pixels.records,ground=layers[0].commands,objectsLayer=layers[1].commands,
               tiles=tiles,terrainVariants=variants.metadata(),sprites=sprites,objects=objects,rasterScale=rendering['rasterScale'],
               size=list(layers[0].size),modelSource=metadata['sourceSha256'])
    target=cache/'maps'/(path.parent.name+'.json.gz'); target.parent.mkdir(exist_ok=True)
    target.write_bytes(gzip.compress(dumps(value),compresslevel=9,mtime=0))
    return str(target)

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('report',type=Path);p.add_argument('--cache',type=Path,default=Path('output/toy-original-cache'))
    a=p.parse_args();print(capture(a.report,a.cache),flush=True)
