"""Exact shared-frame finite-retry probabilities, without sampling.

Aggregate origin incidence by (candidate count, residue, destination). Only the
number of terminating origins controls the geometric retry weight. Integrate
that function over its reduced period, or by CRT factor elimination for huge
periods. Keep integer coefficients shared by all cells, rather than repeating
thousands of digits for every destination.
"""
from collections import Counter, defaultdict
from functools import reduce
import math
import struct
import sys

if hasattr(sys, 'set_int_max_str_digits'):
    sys.set_int_max_str_digits(20000)


def read_search(path, origin_count):
    data = path.read_bytes()
    pos = 0
    for _ in range(origin_count):
        n, = struct.unpack_from('<I', data, pos)
        if n > 24:
            raise ValueError('候选文件损坏')
        pos += 4
        yield struct.unpack_from('<' + 'I' * n, data, pos)
        pos += 4 * n
    if pos != len(data):
        raise ValueError('候选文件长度不符')


def fundamental(values):
    n = len(values)
    return next(p for p in range(1, n + 1) if n % p == 0 and all(v == values[i % p] for i, v in enumerate(values)))


def convolve(a, b):
    out = Counter()
    for x, count in a.items():
        for y, other in b.items():
            out[x + y] += count * other
    return out


def crt_residue(core, base, prime, residue, n):
    # base and prime are coprime; returned f is compatible with both.
    return (core + base * ((residue - core) * pow(base, -1, prime) % prime)) % n


def integrate_crt(terminal, counts):
    """Histograms of T(f), unconditional and conditional on each f%n=r.

    n<=24: after conditioning on 2^a * 3^b, every remaining factor involves
    at most one of 5,7,11,13,17,19,23. Independent conditional contributions
    can therefore be convolved. This handles LCM(1..24)=5,354,228,880 without
    visiting 5 billion frames and without changing the probability space.
    """
    period = math.lcm(*counts) if counts else 1
    base = 1
    for p in (2, 3):
        power = 1
        while period % (power * p) == 0:
            power *= p
        base *= power
    primes = [p for p in (5, 7, 11, 13, 17, 19, 23) if period % p == 0]
    factor = {n: next((p for p in primes if n % p == 0), None) for n in counts}
    overall = Counter()
    conditional = {(n, r): Counter() for n in counts for r in range(n)}
    for core in range(base):
        fixed = sum(row[core % n] for n, row in terminal.items() if factor[n] is None)
        values = [[sum(row[crt_residue(core, base, p, r, n)] for n, row in terminal.items() if factor[n] == p)
                   for r in range(p)] for p in primes]
        distributions = [Counter(row) for row in values]
        prefix = [Counter({fixed: 1})]
        for d in distributions:
            prefix.append(convolve(prefix[-1], d))
        suffix = [None] * (len(primes) + 1)
        suffix[-1] = Counter({0: 1})
        for i in range(len(primes) - 1, -1, -1):
            suffix[i] = convolve(distributions[i], suffix[i + 1])
        overall.update(prefix[-1])
        for n in counts:
            if factor[n] is None:
                conditional[n, core % n].update(prefix[-1])
        for i, p in enumerate(primes):
            others = convolve(prefix[i], suffix[i + 1])
            for r in range(p):
                dist = {t + values[i][r]: multiplicity for t, multiplicity in others.items()}
                for n in counts:
                    if factor[n] == p:
                        conditional[n, crt_residue(core, base, p, r, n)].update(dist)
    assert sum(overall.values()) == period
    assert all(sum(h.values()) == period // n for (n, r), h in conditional.items())
    return overall, conditional


def integrate_reduced(terminal, counts):
    period = math.lcm(*counts) if counts else 1
    weight_period = math.lcm(*(fundamental(row) for row in terminal.values())) if terminal else 1
    if weight_period > 200000:
        overall, conditional = integrate_crt(terminal, counts)
        return period, weight_period, overall, conditional, 'crt-factor-convolution'
    distinct_gcds = {math.gcd(weight_period, n) for n in counts}
    buckets = {g: [Counter() for _ in range(g)] for g in distinct_gcds}
    overall = Counter()
    for f in range(weight_period):
        total = sum(row[f % n] for n, row in terminal.items())
        overall[total] += period // weight_period
        for g in distinct_gcds:
            buckets[g][f % g][total] += 1
    conditional = {}
    for n in counts:
        g = math.gcd(n, weight_period)
        factor = period // math.lcm(n, weight_period)
        for r in range(n):
            conditional[n, r] = {t: hits * factor for t, hits in buckets[g][r % g].items()}
    return period, weight_period, overall, conditional, 'reduced-period-residue-aggregation'


def calculate(selections, statuses, origin_count, limit=1000, progress=lambda *args: None):
    """statuses: key -> 'crate' | 'ghost' | 'retry'. Missing key is retry."""
    if not 1 <= limit <= 1000:
        raise ValueError('重抽上限必须在 1～1000 之间')
    terms = defaultdict(Counter)
    ghost_terms = Counter()
    terminal = {}
    no_candidate = 0
    count = 0
    for picked in selections:
        count += 1
        n = len(picked)
        if not n:
            no_candidate += 1
            continue
        totals = terminal.setdefault(n, [0] * n)
        for r, key in enumerate(picked):
            status = statuses.get(key, 'retry')
            if status == 'crate':
                terms[key][n, r] += 1
                totals[r] += 1
            elif status == 'ghost':
                ghost_terms[n, r] += 1
                totals[r] += 1
    assert count == origin_count
    counts = sorted(terminal)
    progress('正在精确合并帧余数和有限重抽', 64)
    period, weight_period, overall, conditional, method = integrate_reduced(terminal, counts)
    base_denominator = origin_count ** limit
    denominator = period * base_denominator
    weights = {t: (base_denominator - (origin_count - t) ** limit) // t if t else 0 for t in overall}
    failure = sum(frames * (origin_count - t) ** limit for t, frames in overall.items())
    coefficients = {}
    for pair, histogram in conditional.items():
        coefficients[pair] = sum(frames * weights[t] for t, frames in histogram.items())
    coefficient_keys = sorted(coefficients)
    ids = {pair: i for i, pair in enumerate(coefficient_keys)}
    ghost = sum(hits * coefficients[pair] for pair, hits in ghost_terms.items())
    cell_results = {}
    distributions = {}
    total = 0
    for key, hits in terms.items():
        signature = tuple(sorted(hits.items()))
        if signature not in distributions:
            numerator = sum(count * coefficients[pair] for pair, count in signature)
            distributions[signature] = (numerator, {
                'probability': numerator / denominator,
                'multiplier': numerator * origin_count / denominator,
                'terms': [[ids[pair], count] for pair, count in signature],
                'oneAttemptProbability': sum(count / pair[0] for pair, count in hits.items()) / origin_count,
            })
        numerator, result = distributions[signature]
        total += numerator
        cell_results[key] = dict(result)
    assert total + ghost + failure == denominator, '精确整数概率不守恒'
    return {
        'sampleCount': origin_count, 'attemptLimit': limit, 'framePolicy': 'uniform-cycle',
        'period': period, 'weightPeriod': weight_period, 'method': method,
        'candidateCounts': counts, 'terminalCountRange': [min(overall), max(overall)],
        'noCandidateOrigins': no_candidate, 'positiveCellCount': len(cell_results),
        'sharedDistributionCount': len(distributions),
        'maxMultiplier': max((c['multiplier'] for c in cell_results.values()), default=0),
        'finalSuccess': total / denominator, 'finalGhost': ghost / denominator, 'finalFailure': failure / denominator,
        'exact': {
            'representation': 'shared-residue-coefficients', 'denominator': str(denominator),
            'coefficients': [{'n': n, 'r': r, 'numerator': str(coefficients[n, r])} for n, r in coefficient_keys],
            'failureNumerator': str(failure), 'ghostNumerator': str(ghost),
            'formula': 'P(cell)=sum(count*coefficients[id].numerator for id,count in cell.terms)/denominator',
            'conservationVerified': True,
        },
        'cells': cell_results,
    }
