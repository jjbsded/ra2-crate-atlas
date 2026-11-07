"""Native transparent margins and sprite alpha, including the live fast path."""
from pathlib import Path
from tempfile import TemporaryDirectory
from collections import OrderedDict
import numpy as np
from PIL import Image, ImageDraw
import runtime_bootstrap
from realmap_render import render
from simulation_visual import Scene

tile = Image.new('RGBA', (60,30))
ImageDraw.Draw(tile).polygon([(30,0),(59,15),(30,29),(0,15)], fill=(120,140,160,255))
mask = np.asarray(tile.getchannel('A')) != 0
class Assets:
    tile_heights = {}
    def ground(self, *args):
        return 'tile', ([(tile,0,0)],mask,-30,-15,[[[0,-15],[30,0],[0,15],[-30,0]]])
    def sprite(self, *args):
        return None
assets = Assets()
cell = dict(x=2,y=2,level=0,slope=0,overlayName=None)
sprite = Image.new('RGBA',(6,6),(220,90,30,128))
part = dict(image=sprite,x=-45,y=-25,shadow=None)
with TemporaryDirectory() as folder:
    captured=[]
    render({(2,2):cell},None,{},None,Path(folder),dict(size=[0,0,2,2],visibleRect=[0,0,2,2]),lambda *a:None,
           image_sink=lambda ground,scene,origin:captured.append((ground,scene)),
           replay=dict(assets=assets,points=[(2,2)],rect=(-60,0,120,120),events=[(5,0,60,60,0,part)],high=False,bridges=False))
    ground,scene=captured[0]
    assert ground.mode == scene.mode == 'RGBA'
    assert ground.getpixel((0,0))[3] == scene.getpixel((0,0))[3] == 0
    assert ground.getpixel((60,60)) == (120,140,160,255)
    assert scene.getpixel((15,35)) == (220,90,30,128), 'Do not square sprite alpha on a transparent margin'
    fast=Scene.__new__(Scene)
    fast.background=ground;fast.original_sprite_tiles=set();fast.sprites={};fast.flat_tiles=OrderedDict();fast.opaque_parts={}
    fast.terrain={(0,0):[(2,2)]};fast.cells={(2,2):cell};fast.assets=assets;fast.anchor=lambda c:(60,60)
    assert fast.flat_replay((0,0),[0,0,120,120],[(5,0,60,60,0,part)]) is None
    opaque={**part,'image':Image.new('RGBA',(6,6),(220,90,30,255))}
    painted=fast.flat_replay((0,0),[0,0,120,120],[(5,0,60,60,0,opaque)])
    assert painted[0].getpixel((0,0))[3] == painted[1].getpixel((0,0))[3] == 0
    assert painted[1].getpixel((15,35)) == (220,90,30,255)
print('PASS native raster and live flat-tile path preserve empty margins, sprite overhang and partial alpha')
