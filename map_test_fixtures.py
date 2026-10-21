"""Portable synthetic stock-map fixtures; no local research outputs."""
import base64
import struct
import lzokay
from realmap_resources import resources


def pack(name, data):
    blocks = bytearray()
    for pos in range(0, len(data), 8192):
        chunk = bytes(data[pos:pos+8192])
        if name.startswith('Overlay'):
            encoded = b''.join(bytes([0x80+len(chunk[i:i+63])])+chunk[i:i+63] for i in range(0,len(chunk),63))+b'\x80'
        else:
            encoded = lzokay.compress(chunk)
        blocks += struct.pack('<HH',len(encoded),len(chunk))+encoded
    text = base64.b64encode(blocks).decode()
    return '['+name+']\n'+'\n'.join(f'{i//70+1}={text[i:i+70]}' for i in range(0,len(text),70))+'\n'


def fixture(theater='TEMPERATE', water=False, island=False, objects=False, extra='', width=20, height=20):
    res=resources('yr');t=res.theater(theater);w,h=width,height
    water_index=next(i for i,d in enumerate(t['definitions']) if d[1].startswith('water01.')) if water else 0
    raw=bytearray();overlay=bytearray([255]*262144);data=bytes(262144)
    if objects:
        names=list(res.rules['OVERLAYTYPES'].values())
        wall=next(i for i,name in enumerate(names) if res.rules.get(name.upper(),{}).get('WALL','no').lower()=='yes')
        overlay[20+512*21]=wall
        overlay[21+512*20]=names.index('TIB01')
    for y in range(1,w+h):
        for x in range(1,w+h):
            if x+y>w and x+y<=w+2*h and abs(x-y)<w:
                tile=water_index if water and not(island and 18<=x<=21 and 18<=y<=21) else 0
                raw+=struct.pack('<hhIBBB',x,y,tile,0,0,0)
    raw+=b'\0'*4
    text=f'[Map]\nTheater={theater}\nSize=0,0,{w},{h}\nLocalSize=0,0,{w},{h}\n'
    text+=pack('IsoMapPack5',raw)+pack('OverlayPack',overlay)+pack('OverlayDataPack',data)
    if objects:
        text+='[Terrain]\n19019=TIBTRE01\n20018=TRFF01\n[Structures]\n0=Neutral,GAPILL,256,20,20,0,None\n[Units]\n0=Neutral,HTNK,256,22,20,0,None\n[Infantry]\n0=Neutral,E1,256,20,22,0,None\n'
    return (text+extra).encode()
