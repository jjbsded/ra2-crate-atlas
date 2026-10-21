"""YR native occupancy, overlay drawing position and crate-consumption checks.

Uses the same --game / --deps arguments as verify-bridge-native.py.
Executes the stock x86 instructions in isolated RAM, not a running game.
Flat ground height, subcell choice, owner ID and redraw rectangles are fixtures;
layer selection, crate eligibility and Overlay removal remain original code.
"""
import json
from pathlib import Path
import runpy
import struct

env = runpy.run_path(str(Path(__file__).with_name('verify-bridge-native.py')))
Machine, specs = env['Machine'], env['SPECS']
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_ESI

m = Machine(specs['yr'])
m.vm.mem_map(0x3000000, 0x20000)
m.u32(specs['yr']['map']+0x140, 512*512)
cell = m.cells[100, 100]
coords, actor, vtable = 0x1001000, 0x3008000, 0x3009000


def constant(address, result=0, pop=0):
    m.vm.mem_write(address, b'\xb8'+struct.pack('<I', result)+(b'\xc2'+struct.pack('<H', pop) if pop else b'\xc3'))


# Execute the actual static initializer, rather than assume the direction table.
m.call(0x49F2F0)
assert list(struct.iter_unpack('<hh', m.vm.mem_read(0x89F688, 32))) == [
    (0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1)]
m.u32(0xB1D0AC, 416)
m.u32(0xA8F234, 416)
constant(0x578080, 208, 4)  # flat ground, L2
constant(0x4810A0, 0)  # centre infantry subcell; this check concerns its layer
constant(0x300A000, 0)
m.u32(actor, vtable)
m.u32(vtable+56, 0x300A000)
occupation_checks = 0
for bridge in (False, True):
    for z in (0, 208, 623, 624, 832):
        for address, bit in ((0x7441B0, 32), (0x5217C0, 1), (0x453D60, 128)):
            m.u32(cell+320, 0x100 if bridge else 0)
            m.u32(cell+292, 0); m.u32(cell+296, 0)
            m.vm.mem_write(coords, struct.pack('<iii', 25728, 25728, z))
            m.call(address, actor, (coords,))
            deck = bridge and z >= 624 and bit != 128
            assert m.read32(cell+292) == (0 if deck else bit), (hex(address),bridge,z,m.read32(cell+292),m.read32(cell+296))
            assert m.read32(cell+296) == (bit if deck else 0), (hex(address),bridge,z,m.read32(cell+292),m.read32(cell+296))
            occupation_checks += 1

array, overlay, rules = 0x3000000, 0x3001000, 0x3004000
m.u32(0xA83D84, array)
m.u32(array+179*4, overlay)
m.u32(overlay+660, 179)
m.vm.mem_write(overlay+682, b'\x01')  # Crate=yes
m.u32(0x8871E0, rules)
for offset in (248, 252, 256):
    m.u32(rules+offset, overlay)
m.u32(0x886FA4, 0)

# Overlay drawing uses bit 0x80 (the bridge sprite owner), not bit 0x100.
# A crate on a non-owner bridge cell therefore remains at ground height.
draw_checks = 0
for level in (0, 2, 6):
    for flags, frame, expected_offset in ((0,2,-12),(0x100,2,-12),
                                           (0x180,0,-28),(0x180,9,-43)):
        m.u32(cell+68,179); m.u32(cell+320,flags)
        m.vm.mem_write(cell+283,bytes([level]))
        m.vm.mem_write(cell+286,bytes([frame]))
        m.call(0x480110, cell, (coords,))
        assert struct.unpack('<ii',m.vm.mem_read(coords,8)) == (30,15-15*level+expected_offset)
        draw_checks += 1

# Real CollectCrate -> real crate removal; only graphical/bounds services stubbed.
constant(0x568300, 1, 4)  # test cell is within the legal map
for address in (0x47FDE0, 0x47FB90):
    m.vm.mem_write(address, bytes.fromhex('8b44240431d2891089500489500889500cc20400'))
constant(0x6D2790, 0, 20)  # redraw invalidation
house, house_type = 0x3010000, 0x300C000
m.u32(actor+540, house); m.u32(house+52, house_type)
m.u32(house+752, 1)  # house already has a base; no forced MCV reward
constant(0x505310, 0x300B000)  # MCV type lookup, unrelated to pickup layer
consumed = []


def stop_after_removal(vm, address, size, user):
    if address in (0x4A1BEF, 0x56C1DA):
        consumed.append(m.read32(cell+68) == 0xFFFFFFFF)
        vm.emu_stop()


hooks = [m.vm.hook_add(UC_HOOK_CODE, stop_after_removal, begin=a, end=a)
         for a in (0x4A1BEF, 0x56C1DA)]
pickup_checks = 0
for mode in (0, 3):  # campaign removal and managed-slot removal
    m.u32(0xA8B238, mode)
    for flags in (0, 0x100):
        for land in (0, 2, 3, 7):
            for on_bridge in (False, True):
                for z in (208, 624):
                    m.u32(cell+68,179); m.u32(cell+320,flags); m.u32(cell+236,land)
                    m.vm.mem_write(cell+286,b'\x02')
                    m.vm.mem_write(actor+140,bytes([on_bridge]))
                    m.vm.mem_write(actor+156,struct.pack('<iii',25728,25728,z))
                    m.vm.mem_write(specs['yr']['map']+356,struct.pack('<hh',100,100))
                    stack=0x10F0000
                    m.vm.mem_write(stack,struct.pack('<II',0x1000000,actor))
                    m.vm.reg_write(UC_X86_REG_ESP,stack); m.vm.reg_write(UC_X86_REG_ECX,cell)
                    before=len(consumed)
                    try:
                        m.vm.emu_start(0x481A00,0x1000000,count=100000)
                    except Exception as error:
                        raise RuntimeError(f"Native fixture fault at {m.vm.reg_read(UC_X86_REG_EIP):08X}") from error
                    assert len(consumed)==before+1 and consumed[-1], (mode,flags,land,on_bridge,z)
                    pickup_checks += 1
for hook in hooks:
    m.vm.hook_del(hook)

# The actual constructor's GetTerrain(false) gate always checks ground content,
# independent of the high-bridge bit. Stub only the subsequent generic Unlimbo.
constant(0x300A010, 36)  # AbstractType::Terrain
m.vm.mem_write(0xA8E9A0,b'\x01')  # active scenario (not menu/loading UI)
m.u32(vtable+44,0x300A010)
m.u32(actor+48,0)
constant(0x5F4EC0,1,8)
deploy_calls=[]
def record_deploy(vm,address,size,user):
    deploy_calls.append(address)
hook=m.vm.hook_add(UC_HOOK_CODE,record_deploy,begin=0x5FC4B1,end=0x5FC4B1)
constructor_checks=0
for bridge in (False,True):
    for ground_terrain in (False,True):
        m.u32(cell+320,0x100 if bridge else 0)
        m.u32(cell+228,actor if ground_terrain else 0)
        m.u32(cell+232,0)
        m.vm.mem_write(coords,struct.pack('<hh',100,100))
        stack=0x10F0000
        m.u32(stack,coords)
        m.vm.reg_write(UC_X86_REG_ESP,stack)
        m.vm.reg_write(UC_X86_REG_ECX,specs['yr']['map'])
        m.vm.reg_write(UC_X86_REG_ESI,0x300D000)
        before=len(deploy_calls)
        m.vm.emu_start(0x5FC497,0x5FC4B6,count=10000)
        assert len(deploy_calls)-before == int(not ground_terrain)
        constructor_checks+=1
m.vm.hook_del(hook)
print(json.dumps(dict(version='yr',occupationCases=occupation_checks,
    overlayDrawCases=draw_checks,pickupRemovalCases=pickup_checks,constructorTerrainCases=constructor_checks,
    scope='original layer/consumption instructions; synthetic state; effect after removal not executed; no live-game pathfinding'),indent=2))
