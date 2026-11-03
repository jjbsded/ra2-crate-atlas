"""Lossless original-art indexes: JSON metadata and varint drawing columns.

Asset IDs follow first use so nearby commands need small deltas. Layer command
IDs are run-length encoded; shared atlas pixels are never changed.
"""
import gzip
import itertools
import json
import struct

MAGIC = b'CATLAS1\0'
MAX_VALUES = 2_000_000


def ordered(value):
    value = json.loads(json.dumps(value))
    absolute = list(itertools.accumulate(value['commands'][0]))
    ids = list(dict.fromkeys(absolute + list(range(len(value['assets'])))))
    mapping = {old: new for new, old in enumerate(ids)}
    value['assets'] = [value['assets'][i] for i in ids]
    previous = 0
    for i, old in enumerate(absolute):
        new = mapping[old]
        value['commands'][0][i] = new - previous
        previous = new
    for refs in value['tiles'].values():
        for ref in refs:
            ref[0] = mapping[ref[0]]
    for ref in value['sprites'].values():
        if ref:
            ref[0] = mapping[ref[0]]
    for obj in value['objects']:
        for ref in obj[-1]:
            ref[0] = mapping[ref[0]]
    return value


def encode(value):
    meta = dict(value)
    arrays = [(a, False) for a in meta.pop('commands')]
    arrays += [(a, True) for a in meta.pop('layers')]
    assets = meta.pop('assets')
    arrays.append(([a[i] for i in range(5) for a in assets], False))
    raw = json.dumps(meta, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    data = bytearray(MAGIC + struct.pack('<I', len(raw)) + raw)

    def varint(n):
        while n >= 128:
            data.append((n & 127) | 128)
            n >>= 7
        data.append(n)

    for values, rle in arrays:
        assert len(values) <= MAX_VALUES
        data += struct.pack('<I', len(values))
        pairs = ((x, sum(1 for _ in group)) for x, group in itertools.groupby(values)) if rle else ((x, 1) for x in values)
        for x, count in pairs:
            assert -(2**31) <= x < 2**31
            if rle:
                varint(count)
            varint((x << 1) ^ (x >> 31))
    return gzip.compress(data, compresslevel=9, mtime=0)


def decode(payload):
    data = gzip.decompress(payload)
    if not data.startswith(MAGIC):
        return json.loads(data)
    offset = 8

    def uint():
        nonlocal offset
        value = struct.unpack_from('<I', data, offset)[0]
        offset += 4
        return value

    length = uint()
    value = json.loads(data[offset:offset+length])
    offset += length

    def varint():
        nonlocal offset
        result = 0
        for i in range(5):
            byte = data[offset]
            offset += 1
            result += (byte & 127) << (7*i)
            if byte < 128:
                assert result <= 0xffffffff
                return result
        raise ValueError('Atlas varint overflow')

    arrays = []
    for i in range(8):
        count = uint()
        assert count <= MAX_VALUES
        values = []
        while len(values) < count:
            run = varint() if 3 <= i < 7 else 1
            assert 0 < run <= count - len(values)
            number = varint()
            values.extend([-(number+1)//2 if number & 1 else number//2] * run)
        arrays.append(values)
    assert offset == len(data)
    value['commands'], value['layers'] = arrays[:3], arrays[3:7]
    assert len(arrays[7]) % 5 == 0
    count = len(arrays[7])//5
    value['assets'] = [[arrays[7][i+j*count] for j in range(5)] for i in range(count)]
    return value
