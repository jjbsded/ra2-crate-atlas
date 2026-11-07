"""Small placement previews from the same native painter as the final map."""
import base64
import io
import re
from PIL import Image

def green_ore(image):
    import numpy as np
    pixels=np.array(image);v=pixels[:,:,:3].max(axis=2).astype(np.uint16)
    pixels[:,:,0]=v*35//255;pixels[:,:,1]=v;pixels[:,:,2]=v*70//255
    return Image.fromarray(pixels)


def preview(report, path, kind, level, color=''):
    from map_results import resource_context
    from realmap_objects import ObjectPainter
    if not isinstance(kind, str) or not kind.isascii() or not kind.replace('_', '').isalnum():
        raise ValueError('无效对象类型')
    if not 0 <= level <= 30:
        raise ValueError('无效地形高度')
    if color and not re.fullmatch(r'[0-9a-f]{6}', color):
        raise ValueError('Invalid simulation region color')
    res, theater = resource_context(report, path)
    rules = dict(theater['effectiveRules'])
    if kind not in rules:
        raise ValueError('对象定义不存在')
    category = next((section for section, registry in [('UNITS','VEHICLETYPES'), ('INFANTRY','INFANTRYTYPES'), ('STRUCTURES','BUILDINGTYPES')]
                     if kind in (v.upper() for v in rules.get(registry, {}).values())), None)
    if category is None:
        raise ValueError('未支持的放置对象')
    if color and category != 'STRUCTURES' and kind not in ('E2', 'MTNK', 'HYD', 'YHVR'):
        raise ValueError('Invalid simulation region color')
    rules['CRATE_ATLAS_SIMULATION'] = {'COLOR':'CRATE_ATLAS_SIMULATION_COLOR'}
    pattern = 'stripe-3-region-'+color if color else 'stripe-3-yellow-black-fixed'
    rules['COLORS'] = {**rules.get('COLORS', {}), 'CRATE_ATLAS_SIMULATION_COLOR':pattern}
    theater['effectiveRules'] = rules
    painter = ObjectPainter(res, theater, path.parent)
    painter.cells = {(0,0): {'level':level}}
    try:
        parts = painter.parts(dict(type=kind, category=category, x=0, y=0, facing=64,
                                   health=256, house='CRATE_ATLAS_SIMULATION', mission='Guard', upgrades=[]))
        parts = [p for p in parts if p['image'].getbbox()]
        if not parts:
            raise ValueError('该对象没有可显示的素材')
        x, y = min(p['x'] for p in parts), min(p['y'] for p in parts)
        w = max(p['x']+p['image'].width for p in parts)-x
        h = max(p['y']+p['image'].height for p in parts)-y
        image = Image.new('RGBA', (w,h))
        for part in parts:
            image.alpha_composite(part['image'], (part['x']-x,part['y']-y))
        stream = io.BytesIO(); image.save(stream, 'PNG')
        return dict(x=x, y=y, image='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode())
    finally:
        if painter.voxels:
            painter.voxels.close()
