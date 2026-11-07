"""Fixed yellow/black remap stripes, unchanged non-remap pixels and rubble."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import runtime_bootstrap
import numpy as np
from PIL import Image, ImageDraw
from realmap_objects import ObjectPainter
from realmap_resources import resources
from toy_live_materials import object_key

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'output/simulation-20261104'
OUT.mkdir(exist_ok=True)


class IndexedPainter(ObjectPainter):
    def colors(self, *args, **kwargs):
        return [(i, 0, 0) for i in range(256)], 'indices'

    def voxel_colors(self, *args, **kwargs):
        return self.colors()

    def patterned(self, *args, **kwargs):
        return False


def fingerprint(part, shadow=False):
    im = part.get('shadow') if shadow else part['image']
    if im is None or not (box := im.getbbox()):
        return None
    if shadow:
        alpha = im; im = Image.new('RGBA', alpha.size); im.putalpha(alpha)
    im = im.crop(box); pixels = np.array(im); pixels[pixels[:, :, 3] == 0] = 0
    return dict(x=part.get('shadowX' if shadow else 'x', part['x'])+box[0],
                y=part.get('shadowY' if shadow else 'y', part['y'])+box[1],
                width=im.width, height=im.height, shadow=shadow,
                sha256=hashlib.sha256(pixels.tobytes()).hexdigest())


def main():
    cases = []; previews = []; touched = 0
    for version, ambient in (('ra2', 1), ('yr', 1), ('yr', .2), ('yr', 1.6)):
        res = resources(version); theater = res.theater('TEMPERATE')
        theater['mapLighting'] = {'AMBIENT': str(ambient)}
        rules = deepcopy(res.rules); theater['effectiveRules'] = rules
        rules['COLORS'].update(SIM_RED='0,255,255', SIM_CHECKER='stripe-3-yellow-black-fixed')
        rules['SIM_RED'] = {'COLOR':'SIM_RED'}; rules['SIM_CHECKER'] = {'COLOR':'SIM_CHECKER'}
        painter = ObjectPainter(res, theater, OUT); indexed = IndexedPainter(res, theater, OUT)
        try:
            for kind, category in [('MTNK','UNITS'), ('E2','INFANTRY'), ('GAPOWR','STRUCTURES'),
                                   ('GAREFN','STRUCTURES'), ('GAPILE','STRUCTURES'), ('GADEPT','STRUCTURES'),
                                   ('GAWEAP','STRUCTURES'), ('NALASR','STRUCTURES'), ('GAYARD','STRUCTURES'),
                                   ('YABRCK','STRUCTURES'), ('CAOILD','STRUCTURES')]:
                if kind not in rules: continue
                rec = dict(type=kind, category=category, facing=64, health=0 if kind=='CAOILD' else 256,
                           house='SIM_CHECKER', mission='Guard', upgrades=[])
                patterned = painter.parts(rec); red = painter.parts({**rec, 'house':'SIM_RED'})
                indices = indexed.parts(rec)
                assert len(patterned) == len(red) == len(indices)
                for part, original, index in zip(patterned, red, indices):
                    actual, before, raw = np.asarray(part['image']), np.asarray(original['image']), np.asarray(index['image'])[:, :, 0]
                    if rec['health'] == 0:
                        assert part['palette'] == 'isotem.pal'
                        assert np.array_equal(actual, before)
                        continue
                    mask = (raw >= 16) & (raw < 32)
                    assert np.array_equal(actual[~mask], before[~mask]), (kind, 'non-remap changed')
                    assert np.array_equal(actual[:, :, 3], before[:, :, 3]), (kind, 'alpha changed')
                    y, x = np.indices(raw.shape); black = ((x+part['x']+y+part['y'])//3) % 2 != 0
                    assert np.array_equal(actual[:, :, 0][mask], np.where(black,0,255)[mask])
                    assert np.array_equal(actual[:, :, 1][mask], np.where(black,0,212)[mask])
                    assert not actual[:, :, 2][mask].any()
                    touched += int(mask.sum())
                expected = [v for part in patterned if (v := fingerprint(part))]
                expected += [v for part in patterned if (v := fingerprint(part, True))]
                cases.append(dict(meta=dict(type=kind, category=category, key=object_key(rec,rules,res.art,lighting=theater['mapLighting'])),
                                  version=version, expected=expected))
                if version=='yr' and ambient==1 and kind in ('MTNK','E2','GAPOWR','NALASR','CAOILD'): previews.append((kind,patterned))
        finally:
            if painter.voxels: painter.voxels.close()
            if indexed.voxels: indexed.voxels.close()
    assert touched > 1000
    sheet = Image.new('RGB',(1000,230),(104,116,101)); draw = ImageDraw.Draw(sheet)
    for i,(name,parts) in enumerate(previews):
        x,y=i*200+100,155; draw.text((i*200+10,12),name,fill='white')
        for part in parts: sheet.paste(part['image'],(x+part['x'],y+part['y']),part['image'])
    sheet.resize((2000,460),Image.Resampling.NEAREST).save(OUT/'yellow-stripes-preview.png')
    (OUT/'art-cases.json').write_text(json.dumps(dict(cases=cases,remapPixels=touched)), 'utf8')
    print('PASS native patterned pixels:',touched,'states:',len(cases),'non-remap unchanged, rubble uses iso palette')


if __name__=='__main__': main()
