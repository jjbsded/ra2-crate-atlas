"""Execute stock x86 bridge/predicate/projection code in isolated Unicorn RAM.

Optional research dependencies: unicorn, pefile. No game process or disk patch.
Rendering invalidation is stubbed; tested decision functions are original bytes.
Usage: python verify-bridge-native.py --game GAME_DIR --deps OPTIONAL_DIR ...
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import struct
import sys

p = argparse.ArgumentParser()
p.add_argument('--game', type=Path, required=True)
p.add_argument('--deps', type=Path, action='append', default=[])
args = p.parse_args()
for path in args.deps:
    sys.path.insert(0, str(path))
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_ESP
from realmap import project_match
from realmap_bridges import initialize, elevated

SPECS = {
    'yr': dict(file='gamemd.exe', map=0x87F7E8, cellArray=0x13C, directions=0x89F688, costs=0x89EA40,
               init=(0x47E040, 0x47E470), invalidate=0x6551C0, clear=0x4834A0, project=0x6D6410),
    'ra2': dict(file='game.exe', map=0x8324E0, cellArray=0x138, directions=0x851A70, costs=0x850EA0,
                init=(0x4732D0, 0x473700), invalidate=0x631570, clear=0x478760, project=0x6A6A50),
}
EXPECTED = {
    'ra2': '5b61b2fd86bb59a2dfbb898e3bd6113381f4609618a8bbd63ac81b8c2205202e',
    'yr': '3e81a61775d2745d1dabe397325ef663cd994ffc194da4e998e3bf5d2d308600',
}


class Machine:
    def __init__(self, spec):
        self.spec = spec
        raw = (args.game/spec['file']).read_bytes()
        self.sha = hashlib.sha256(raw).hexdigest()
        pe = pefile.PE(data=raw)
        self.vm = Uc(UC_ARCH_X86, UC_MODE_32)
        size = (pe.OPTIONAL_HEADER.SizeOfImage+4095)//4096*4096
        self.vm.mem_map(0x400000, size)
        self.vm.mem_write(0x400000, pe.get_memory_mapped_image())
        self.vm.mem_map(0x1000000, 0x100000)  # stack and return sentinel
        self.vm.mem_map(0x1800000, 0x100000)  # cell pointer array
        self.vm.mem_map(0x2000000, 0x100000)  # test cells
        self.u32(spec['map']+spec['cellArray'], 0x1800000)
        directions = [(0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1)]
        self.vm.mem_write(spec['directions'], b''.join(struct.pack('<hh', *q) for q in directions))
        # Only UI redraw invalidation; not a predicate/terrain/bridge function.
        self.vm.mem_write(spec['invalidate'], b'\xc2\x04\x00')
        self.cells = {}
        for y in range(85, 116):
            for x in range(85, 116):
                at = 0x2000000+len(self.cells)*0x150
                self.cells[x,y] = at
                self.u32(0x1800000+4*(x+y*512), at)
                self.vm.mem_write(at+36, struct.pack('<hh', x,y))
                self.u32(at+68, -1)

    def u32(self, address, value):
        self.vm.mem_write(address, struct.pack('<I', value & 0xFFFFFFFF))

    def read32(self, address):
        return struct.unpack('<I', self.vm.mem_read(address,4))[0]

    def call(self, address, ecx=0, arguments=()):
        stack = 0x10F0000
        self.vm.mem_write(stack, b''.join(struct.pack('<I', n & 0xFFFFFFFF) for n in (0x1000000, *arguments)))
        self.vm.reg_write(UC_X86_REG_ESP, stack)
        self.vm.reg_write(UC_X86_REG_ECX, ecx)
        self.vm.reg_write(UC_X86_REG_EAX, 0)
        self.vm.emu_start(address, 0x1000000, count=100000)
        assert self.vm.reg_read(UC_X86_REG_ESP) == stack+4+4*len(arguments), hex(address)
        return self.vm.reg_read(UC_X86_REG_EAX)

    def reset(self):
        for at in self.cells.values():
            self.u32(at+320, 0)
            self.u32(at+292, 0)
            self.u32(at+296, 0)
            self.vm.mem_write(at+283,b'\x00')


results = []
for version, spec in SPECS.items():
    m = Machine(spec)
    # Expose the fingerprint in evidence; mismatched known executables must stop.
    assert m.sha == EXPECTED[version], (version, m.sha)
    flags_checks = projection_checks = predicate_checks = 0
    rng = random.Random(104017)
    for index, name, direction in [(24,'BRIDGE1',0),(25,'BRIDGE2',6),(237,'BRIDGEB1',0),(238,'BRIDGEB2',6)]:
        m.reset()
        cells = {q: dict(x=q[0],y=q[1],level=0,slope=0,overlay=255,overlayName=None) for q in m.cells}
        cells[100,100].update(overlay=index,overlayName=name)
        initialize(cells)
        m.call(spec['init'][index >= 237], m.cells[100,100], (direction,1))
        for q,c in cells.items():
            flags = m.read32(m.cells[q]+320)
            assert elevated(c) == bool(flags&0x100), (version,index,q,hex(flags))
            assert c['bridgeProjection'] == bool(flags&0x1000), (version,index,q,hex(flags))
            flags_checks += 1
        for trial in range(4):
            for q,c in cells.items():
                # Include tall cliffs, overlapping visual projections and slopes.
                c['level'] = 0 if trial==0 else rng.randrange(15)
                m.vm.mem_write(m.cells[q]+283,bytes([c['level']]))
            for q,c in cells.items():
                if not 94 <= q[0] <= 104 or not 94 <= q[1] <= 104:
                    continue
                m.vm.mem_write(0x1001000, struct.pack('<iii', c['x']*256+128,c['y']*256+128,0))
                m.call(spec['project'], arguments=(0x1001020,0x1001000))
                native = struct.unpack('<hh',m.vm.mem_read(0x1001020,4)) == q
                assert project_match(cells,c) == native, (version,index,q,trial)
                projection_checks += 1
    at = m.cells[100,100]
    for bridge in (False,True):
        for ground in (0,1,7,32,64,128):
            for deck in (0,1,7,32,64,128):
                for cost in (0.,1.):
                    for speed in (0,1,5):
                        m.u32(at+320, 0x100 if bridge else 0)
                        m.u32(at+236, 2)
                        m.u32(at+292, ground)
                        m.u32(at+296, deck)
                        m.vm.mem_write(spec['costs']+4*(9*2+speed),struct.pack('<f',cost))
                        native = bool(m.call(spec['clear'],at,(speed,0,0,-1,0,-1,0))&255)
                        expected = not (deck if bridge else ground) and (bool(cost) or bridge)
                        assert native == expected, (version,bridge,ground,deck,cost,speed)
                        predicate_checks += 1
    results.append(dict(version=version,sha256=m.sha,bridgeFlagCells=flags_checks,
                        projectionCases=projection_checks,movementCases=predicate_checks,
                        scope='isolated original x86; synthetic cell state; rendering invalidation stubbed; no live game'))
print(json.dumps(results, indent=2))
