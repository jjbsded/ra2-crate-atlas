"""Lossless static transport. Expanded reports retain the desktop model schema.

Huge exact integers are stored as their finite-retry arithmetic recipe, not
rounded decimals. Cell columns and repeated search lists are dictionary coded.
This module deliberately does not participate in the analysis fingerprint.
"""
from collections import Counter
from copy import deepcopy
import base64
import gzip
import json
import struct
import sys

if hasattr(sys, 'set_int_max_str_digits'):
    sys.set_int_max_str_digits(20000)


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def zipped(value):
    return gzip.compress(dumps(value), compresslevel=9, mtime=0)


def columns(cells):
    result = {}
    for field in dict.fromkeys(key for cell in cells for key in cell):
        if field in ('probability', 'multiplier'):
            continue
        values, lookup, indices = [], {}, []
        for cell in cells:
            if field not in cell:
                indices.append(0)
                continue
            value = cell[field]
            # Keep bool/int and absent/null distinct, including nested values.
            signature = dumps(value)
            if signature not in lookup:
                values.append(value)
                lookup[signature] = len(values)
            indices.append(lookup[signature])
        if len(values) == 1 and all(indices):
            result[field] = [0, values[0]]
        else:
            width = 1 if len(values) < 256 else 2 if len(values) < 65536 else 4
            packed = struct.pack('<'+{1:'B', 2:'H', 4:'I'}[width]*len(indices), *indices)
            result[field] = [width, values, base64.b64encode(packed).decode('ascii')]
    return result


def expand_columns(table):
    cells = [{} for _ in range(table['count'])]
    for field, col in table['columns'].items():
        if col[0] == 0:
            for cell in cells:
                cell[field] = col[1]
        else:
            indices = struct.iter_unpack('<'+{1:'B', 2:'H', 4:'I'}[col[0]], base64.b64decode(col[2]))
            for cell, (index,) in zip(cells, indices, strict=True):
                if index:
                    cell[field] = col[1][index-1]
    return cells


def probability_recipe(report, selections):
    from realmap_exact import integrate_reduced
    probability = report['probability']
    statuses = {cell['y']*512+cell['x']:cell['status'] for cell in report['cells']}
    terminal, ghosts = {}, Counter()
    for picked in selections:
        n = len(picked)
        if not n:
            continue
        row = terminal.setdefault(n, [0]*n)
        for r, key in enumerate(picked):
            status = statuses.get(key)
            if status in ('crate', 'ghost'):
                row[r] += 1
                if status == 'ghost':
                    ghosts[n, r] += 1
    period, _, overall, conditional, _ = integrate_reduced(terminal, sorted(terminal))
    assert period == probability['period']
    histograms, lookup, ids = [], {}, []
    for coeff in probability['exact']['coefficients']:
        histogram = sorted(conditional[coeff['n'], coeff['r']].items())
        key = dumps(histogram)
        if key not in lookup:
            lookup[key] = len(histograms)
            histograms.append(histogram)
        ids.append(lookup[key])
    recipe = dict(histograms=histograms, ids=ids, overall=sorted(overall.items()),
                  ghosts=[[i, ghosts[c['n'],c['r']]] for i,c in enumerate(probability['exact']['coefficients']) if ghosts[c['n'],c['r']]])
    # Validate the recipe before ever emitting a package.
    reconstructed = deepcopy(probability)
    expand_probability(reconstructed, recipe)
    assert reconstructed == probability, 'Exact probability recipe changed the model'
    return recipe


def expand_probability(probability, recipe):
    n, limit = probability['sampleCount'], probability['attemptLimit']
    base = n**limit
    powers = {t:(n-t)**limit for t,_ in recipe['overall']}
    weights = {t:(base-power)//t if t else 0 for t,power in powers.items()}
    exact = probability['exact']
    numerators = [sum(frames*weights[t] for t,frames in recipe['histograms'][index]) for index in recipe['ids']]
    exact['denominator'] = str(probability['period']*base)
    for coeff, value in zip(exact['coefficients'], numerators, strict=True):
        coeff['numerator'] = str(value)
    exact['failureNumerator'] = str(sum(frames*powers[t] for t,frames in recipe['overall']))
    exact['ghostNumerator'] = str(sum(hits*numerators[index] for index,hits in recipe['ghosts']))


def compact_report(report, recipe, table, base_url):
    result = deepcopy(report)
    cells = result.pop('cells')
    encoded = columns(cells)
    assert len(cells) == table['count']
    overrides = {field:col for field,col in encoded.items() if col != table['columns'].get(field)}
    for field in table['columns'].keys()-encoded.keys():
        overrides[field] = None
    exact = result['probability']['exact']
    for name in ['denominator', 'failureNumerator', 'ghostNumerator']:
        del exact[name]
    for coeff in exact['coefficients']:
        del coeff['numerator']
    result['_static'] = dict(codec=1, base=base_url, columns=overrides, probability=recipe)
    return result


def expand_report(report, table):
    report = deepcopy(report)
    transport = report.pop('_static')
    cols = dict(table['columns'])
    for field,col in transport['columns'].items():
        if col is None:
            cols.pop(field, None)
        else:
            cols[field] = col
    report['cells'] = expand_columns(dict(count=table['count'], columns=cols))
    probability = report['probability']
    expand_probability(probability, transport['probability'])
    numerator_values = [int(c['numerator']) for c in probability['exact']['coefficients']]
    denominator = int(probability['exact']['denominator'])
    derived = {}
    for cell in report['cells']:
        terms = cell['terms']
        key = tuple(tuple(t) for t in terms)
        if key not in derived:
            numerator = sum(numerator_values[index]*hits for index,hits in terms)
            derived[key] = numerator/denominator, numerator*probability['sampleCount']/denominator
        cell['probability'], cell['multiplier'] = derived[key]
    return report


def selections(raw, count):
    offset = 0
    for _ in range(count):
        n, = struct.unpack_from('<I', raw, offset)
        offset += 4
        if n > 24:
            raise ValueError('Invalid search list')
        yield struct.unpack_from('<'+'I'*n, raw, offset)
        offset += n*4
    if offset != len(raw):
        raise ValueError('Invalid search length')


def varint(value):
    output = bytearray()
    while value >= 128:
        output.append((value&127)|128)
        value >>= 7
    output.append(value)
    return output


def compact_search(raw, count):
    maximum = int(count**0.5)
    assert maximum*maximum == count
    lookup, values, indices = {}, [], []
    for i,picked in enumerate(selections(raw,count)):
        origin = (i//maximum+1)*512+i%maximum+1
        if picked == (origin,):
            indices.append(0)
        else:
            if picked not in lookup:
                values.append(picked)
                lookup[picked] = len(values)
            indices.append(lookup[picked])
    output = bytearray(b'CSC1'+struct.pack('<II',count,len(values)))
    for picked in values:
        output.append(len(picked))
        previous = 0
        for target in picked:
            delta = target-previous
            output.extend(varint(delta*2 if delta>=0 else -delta*2-1))
            previous = target
    for index in indices:
        output.extend(varint(index))
    return bytes(output)


def expand_search(raw):
    if raw[:4] != b'CSC1':
        return raw
    count, size = struct.unpack_from('<II',raw,4)
    maximum = int(count**0.5)
    offset, values = 12, []
    def read():
        nonlocal offset
        value, shift = 0, 0
        while True:
            byte = raw[offset]
            offset += 1
            value |= (byte&127)<<shift
            if byte<128:
                return value
            shift += 7
            if shift > 28:
                raise ValueError('Invalid varint')
    for _ in range(size):
        n = raw[offset]
        offset += 1
        picked, previous = [], 0
        for _ in range(n):
            delta = read()
            previous += delta//2 if delta%2 == 0 else -(delta+1)//2
            picked.append(previous)
        values.append(picked)
    output = bytearray()
    for i in range(count):
        index = read()
        picked = values[index-1] if index else [(i//maximum+1)*512+i%maximum+1]
        output.extend(struct.pack('<'+'I'*(len(picked)+1),len(picked),*picked))
    assert offset == len(raw)
    return bytes(output)
