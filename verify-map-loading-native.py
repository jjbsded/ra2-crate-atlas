"""Native stock loading decisions in isolated RAM; never starts/patches a game.

Arguments/dependencies match verify-bridge-native.py. That script also checks
the executable hashes. Non-decision services are identified beside each stub.
"""
import json
from pathlib import Path
import runpy
import struct

env = runpy.run_path(str(Path(__file__).with_name('verify-bridge-native.py')))
Machine, SPECS = env['Machine'], env['SPECS']
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EIP
from realmap_bridges import initialize, elevated


def constant(m, address, result=0, pop=0):
    m.vm.mem_write(address, b'\xb8'+struct.pack('<I', result)+
                   (b'\xc2'+struct.pack('<H', pop) if pop else b'\xc3'))


def call(m, address, this=0, args=()):
    try:
        return m.call(address, this, args)
    except Exception as e:
        raise RuntimeError(f'native fixture fault at {m.vm.reg_read(UC_X86_REG_EIP):08X}') from e


results = []
for version, spec in SPECS.items():
    m = Machine(spec)
    boundary_checks = 0
    for index, name, direction in [(24,'BRIDGE1',0), (25,'BRIDGE2',6),
                                    (237,'BRIDGEB1',0), (238,'BRIDGEB2',6)]:
        m.reset()
        outside = (100,97) if direction==0 else (97,100)
        pointer = 0x1800000+4*(outside[0]+512*outside[1])
        m.u32(pointer, 0)  # no actual cell, as at Paris's outer Size boundary
        cells = {p:dict(x=p[0],y=p[1],level=0,slope=0,overlay=255,overlayName=None)
                 for p in m.cells if p != outside}
        cells[100,100].update(overlay=index,overlayName=name)
        initialize(cells)
        call(m, spec['init'][index>=237], m.cells[100,100], (direction,1))
        for p,c in cells.items():
            flags = m.read32(m.cells[p]+320)
            assert elevated(c)==bool(flags&0x100)
            assert c['bridgeProjection']==bool(flags&0x1000)
            boundary_checks += 1
        m.u32(pointer, m.cells[outside])

    # Original Overlay::Mark, ore adjacency/data recalculation and neighbor
    # lookup. Stub generic Object mark, virtual coordinate/deletion services
    # and the later terrain-attribute rebuild (tested separately).
    m = Machine(spec)
    m.vm.mem_map(0x3000000, 0x20000)
    actor, vtable, kind, array, tib, tibarray = (0x3000000, 0x3001000, 0x3002000,
                                               0x3003000, 0x3004000, 0x3005000)
    offsets = (dict(mark=0x5FC570, baseMark=0x5F5850, type=172, index=660, coords=440,
                    delete=248, loading=0xA8E7AC, overlays=0xA83D84,
                    tibs=0xB0F4EC, recalc=0x47D2B0)
               if version=='yr' else
               dict(mark=0x5DA970, baseMark=0x5D4160, type=152, index=612, coords=416,
                    delete=240, loading=0xA40774, overlays=0xA35DEC,
                    tibs=0xAC0B34, recalc=0x472540))
    m.u32(actor, vtable); m.u32(actor+offsets['type'],kind)
    m.u32(vtable+offsets['coords'],0x3006000)
    m.vm.mem_write(0x3006000, bytes.fromhex('8b442404c70064006400c20400'))
    m.u32(vtable+offsets['delete'],0x3006100)
    constant(m,0x3006100)
    constant(m,offsets['baseMark'],1,4)
    constant(m,offsets['recalc'],0,4)
    m.u32(offsets['loading'],1)
    m.u32(offsets['overlays'],array)
    m.u32(offsets['tibs'],tibarray); m.u32(offsets['tibs']+12,1); m.u32(tibarray,tib)
    m.u32(kind+offsets['index'],102)
    m.u32(kind+offsets['index']+4,5)  # Land=Tiberium
    m.vm.mem_write(kind+offsets['index']+21,b'\x01')  # Tiberium=yes
    m.u32(array+102*4,kind)
    m.u32(tib+152,0); m.u32(tib+184,25)
    m.u32(tib+224,kind); m.u32(tib+228,12); m.u32(tib+232,12); m.u32(tib+236,8)
    cell = m.cells[100,100]
    ore_checks = 0
    for neighbors in (0,3,8):
        adjacent = [(100+dx,100+dy) for dx,dy in ((0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1))]
        for i,p in enumerate(adjacent):
            m.u32(m.cells[p]+68,102 if i<neighbors else -1)
        for slope in range(9):
            m.u32(cell+68,-1)
            m.vm.mem_write(cell+284,bytes([slope]))
            m.vm.mem_write(cell+286,b'\x0b')
            result = call(m,offsets['mark'],actor,(1,))&255
            assert (m.read32(cell+68)==102)==(slope<=4), (version,neighbors,slope)
            assert bool(result)==(slope<=4), (version,neighbors,slope,result)
            ore_checks += 1
    results.append(dict(version=version, bridgeBoundaryCells=boundary_checks,
                        slopeOreLoadingCases=ore_checks))

# BuildingType's own constructor establishes null FoundationData. The base
# Techno constructor, allocator and array-registration infrastructure are
# fixtures; no foundation/occupancy function is replaced.
m = Machine(SPECS['yr'])
m.vm.mem_map(0x3000000,0x20000)
kind, actor = 0x3000000, 0x3008000
constant(m,0x710AF0,0,8)  # base fields irrelevant to FoundationData
constant(m,0x7C8E17,0x3010000)  # allocator for an unrelated vector
m.u32(0xA83C6C,0x3011000); m.u32(0xA83C70,4); m.u32(0xA83C78,0)
call(m,0x45DD90,kind,(0x3012000,))
assert m.read32(kind+3580)==0
# Absent section: execute Building -> Techno -> Object -> Abstract ReadINI
# return propagation. Only the INI lookup/reset are fixtures.
constant(m,0x526B00)
constant(m,0x526810,0,4)
assert not (call(m,0x45FE50,kind,(0x3014000,))&255)
assert m.read32(kind+3580)==0
constant(m,0x7C978A)  # atexit registration for static empty-list sentinel
foundation = call(m,0x45EC20,kind,(0,))
assert bytes(m.vm.mem_read(foundation,4))==struct.pack('<hh',32767,32767)
m.u32(actor,0x7E3EBC); m.u32(actor+1312,kind)
m.vm.mem_write(kind+565,b'\x01')  # ObjectType constructor's HasCell=true
m.u32(SPECS['yr']['map']+0x140,512*512)
coords=0x1001000
m.vm.mem_write(coords,struct.pack('<hh',100,100))
adds=[]
def record_add(vm,address,size,user):
    adds.append(address)
hook=m.vm.hook_add(UC_HOOK_CODE,record_add,begin=0x47E8A0,end=0x47E8A0)
constant(m,0x47E8A0,0,8)  # count the native decision to insert content
constant(m,0x47D2B0,0,4)  # attribute recomputation after insertion
for health in (0,256):
    m.u32(actor+108,health)
    before=len(adds)
    call(m,0x5683C0,SPECS['yr']['map'],(coords,actor))
    assert len(adds)==before
# Positive control: a real 1x1 foundation must request one cell insertion.
m.vm.mem_write(0x3013000,struct.pack('<hhhh',0,0,32767,32767))
m.u32(kind+3580,0x3013000)
call(m,0x5683C0,SPECS['yr']['map'],(coords,actor))
assert len(adds)==1
m.vm.hook_del(hook)
results.append(dict(version='yr', absentRulesSection=1, emptyFoundationCases=2,
                    nonemptyFoundationControl=1))
evidence = dict(results=results, executableHashes=env['EXPECTED'],
                scope='original x86 decisions in isolated RAM; not live gameplay')
folder=Path(__file__).parent/'output/remaining-map-verification'
folder.mkdir(exist_ok=True)
(folder/'native-loading.json').write_text(json.dumps(evidence,indent=2)+'\n','utf8')
print(json.dumps(evidence,indent=2))
