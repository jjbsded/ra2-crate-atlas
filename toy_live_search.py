"""Encode lossless anchored source patterns for bundled map data."""
import gzip,struct
from toy_codec import varint

def signed(n):return varint(n*2 if n>=0 else -n*2-1)
def unpack(raw):
 assert raw[:4]==b'CSC1', 'Expected the stable source codec'
 count,size=struct.unpack_from('<II',raw,4);pos=12
 def read():
  nonlocal pos
  n=shift=0
  while True:
   b=raw[pos];pos+=1;n|=(b&127)<<shift
   if b<128:return n
   shift+=7
 values=[]
 for _ in range(size):
  n=raw[pos];pos+=1;row=[];previous=0
  for _ in range(n):
   v=read();previous+=v//2 if v%2==0 else -(v+1)//2;row.append(previous)
  values.append(tuple(row))
 indices=[read() for _ in range(count)];assert pos==len(raw)
 return count,values,indices

def pack(count,values,indices):
 maximum=int(count**.5);patterns=[];lookup={};ids=bytearray();anchors=bytearray()
 for i,index in enumerate(indices):
  if not index:ids+=varint(0);continue
  row=values[index-1]
  if not row:ids+=varint(1);continue
  origin=(i//maximum+1)*512+i%maximum+1
  anchor=row[0]
  pattern=tuple(v-anchor for v in row)
  if pattern not in lookup:lookup[pattern]=len(patterns)+2;patterns.append(pattern)
  ids+=varint(lookup[pattern])
  anchors+=signed(anchor-origin)
 raw=bytearray(b'CSP2'+struct.pack('<II',count,len(patterns)))
 for row in patterns:
  raw.append(len(row));previous=0
  for n in row:raw+=signed(n-previous);previous=n
 raw+=ids;raw+=anchors;return bytes(raw)


def build(source,out):
 total=0
 for path in (source/'shared').glob('search-*.bin.gz'):
  raw=gzip.decompress(path.read_bytes());count,values,indices=unpack(raw)
  encoded=gzip.compress(pack(count,values,indices),9,mtime=0)
  (out/'shared'/path.name).write_bytes(encoded);total+=len(encoded)
 print('Anchored search bytes:',total,flush=True)
