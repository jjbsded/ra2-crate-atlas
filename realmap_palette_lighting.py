"""Final static voxel brightness, after VPL shading and owner remapping.

References: CNCMaps Map.LoadPalettes / Palette.QuantizeTsIntensity, revision
56712d7c9c5048afbfe9bddb01c0ec43f6fc008a. This is separate from normal lighting.
Stock ownable objects receive ambient/height intensity, not terrain RGB tint.
Local lamps, weather transitions and engine extensions are not simulated.
"""
import math

MODEL = 'ra2-voxel-palette-light-v1'


def value(section, key, default):
    try:
        result = float(str(section.get(key, default)).split(';', 1)[0])
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def voxel_object(category, cfg, art):
    from realmap_format import yes
    return (category in ('UNITS', 'AIRCRAFT') and yes(art.get('VOXEL', 'no'))
            or category == 'STRUCTURES' and yes(cfg.get('TURRET', 'no'))
            and bool(cfg.get('TURRETANIM')) and yes(cfg.get('TURRETANIMISVOXEL', 'no')))


def light_step(rules, lighting, category, level=0):
    extra_key = {'UNITS': 'EXTRAUNITLIGHT', 'AIRCRAFT': 'EXTRAAIRCRAFTLIGHT'}.get(category)
    extra = value(rules.get('AUDIOVISUAL', {}), extra_key, 0) if extra_key else 0
    intensity = (value(lighting, 'AMBIENT', 1) - value(lighting, 'GROUND', 0)
                 + value(lighting, 'LEVEL', 0) * level + extra)
    # Game LightConvert intensity row: 0..62, neutral row 31. Clamp before
    # integer arithmetic; arbitrary RGB exposure would miss these steps.
    brightness = int(max(0, min(2, intensity)) * 1000)
    shade = min(254, (261 * brightness) >> 11)
    return min(62, 127 * shade * 62 // 32258)


def light_palette(colors, step):
    if step == 31:
        return colors
    # The object's 240..254 special/emissive entries bypass LightConvert.
    # Index zero remains transparent; alpha and shadows are handled elsewhere.
    return [tuple(min(255, c * step // 31) for c in rgb)
            if 0 < i < 240 or i == 255 else rgb for i, rgb in enumerate(colors)]
