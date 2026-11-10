"""Exact shared-frame finite retries using a geometric sum and CRT histograms.

Candidate searches/incidence stay incremental. No map search is replayed for
retries; unchanged terminal counts reuse the entire shared coefficient kernel.
"""
from collections import Counter, defaultdict
import math
import struct
import sys

if hasattr(sys, 'set_int_max_str_digits'):
    sys.set_int_max_str_digits(20000)
MODEL = 'finite-retry-v2'
ATTEMPT_LIMIT = 1000
COEFFICIENT_PERIOD = math.lcm(*range(1, 25))
PAIRS = tuple((n, r) for n in range(1, 25) for r in range(n))
IDS = {pair: i for i, pair in enumerate(PAIRS)}

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
    if weight_period > 144:
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


def terminal_signature(terminal):
    # Canonical exact-period projections: redistributing candidates among
    # counts must not invalidate weights if their sum T(frame) is unchanged.
    combined={d:[0]*d for d in range(1,25)}
    for n in range(1,25):
        row=[terminal.get((n,r),0) for r in range(n)]
        components={}
        for d in range(1,n+1):
            if n%d:continue
            value=[sum(row[r::d])*(COEFFICIENT_PERIOD//(n//d)) for r in range(d)]
            for e,part in components.items():
                if d%e==0:value=[v-part[r%e] for r,v in enumerate(value)]
            components[d]=value
            combined[d]=[a+b for a,b in zip(combined[d],value)]
    return tuple((d,tuple(row)) for d,row in combined.items() if any(row))


def retry_kernel(terminal, origin_count, limit=ATTEMPT_LIMIT):
    if not 1 <= limit <= ATTEMPT_LIMIT:
        raise ValueError('Invalid retry limit')
    rows = {n: [terminal.get((n,r),0) for r in range(n)] for n in range(1,25)}
    period, reduced, overall, conditional, method = integrate_reduced(rows, list(rows))
    base = origin_count ** limit
    powers = {t: (origin_count-t)**limit for t in overall}
    weights = {t: (base-powers[t])//t if t else limit*origin_count**(limit-1) for t in overall}
    values = {pair: sum(frames*weights[t] for t,frames in hist.items()) for pair,hist in conditional.items()}
    return dict(denominator=period*base, values=values,
                coefficients=[dict(n=n,r=r,numerator=str(values[n,r])) for n,r in PAIRS],
                exhausted=sum(frames*powers[t] for t,frames in overall.items()),
                period=period, weightPeriod=reduced, method=method,
                terminalCountRange=[min(overall),max(overall)], overall=overall, conditional=conditional)


def calculate(selections, statuses, origin_count, progress=lambda *args: None, limit=ATTEMPT_LIMIT):
    terms = defaultdict(Counter); ghost_terms = Counter(); counts = Counter(); terminal = Counter()
    for picked in selections:
        n=len(picked)
        if n>24: raise ValueError('Invalid candidate records')
        counts[n]+=1
        for r,key in enumerate(picked):
            status=statuses.get(key)
            if status=='crate': terms[key][n,r]+=1
            elif status=='ghost': ghost_terms[n,r]+=1
            if status in ('crate','ghost'): terminal[n,r]+=1
    assert sum(counts.values())==origin_count
    return evaluate_aggregates(terms,ghost_terms,counts,origin_count,counts[0],progress,terminal=terminal,limit=limit)


def evaluate_aggregates(terms, ghost_terms, candidate_counts, origin_count, no_candidate,
                        progress=lambda *args: None, cache=None, dirty=None, terminal=None, limit=ATTEMPT_LIMIT):
    if origin_count<=0: raise ValueError('Invalid origin count')
    progress('正在计算生成概率',64)
    if terminal is None:
        terminal=Counter(ghost_terms)
        for hits in terms.values(): terminal.update(hits)
    weight_key=(origin_count,limit,terminal_signature(terminal))
    reused=cache is not None and cache.get('weightKey')==weight_key
    if not reused:
        from probability_kernel_cache import exact_kernel
        history_key=(origin_count,limit,tuple((p,h) for p,h in sorted(terminal.items()) if h))
        def build_kernel():
            from probability_kernel_worker import calculate as accelerated
            reduced=math.lcm(*(fundamental([terminal.get((n,r),0) for r in range(n)]) for n in range(1,25)))
            value=accelerated(terminal,origin_count,limit) if reduced>144 else None
            return value if value is not None else retry_kernel(terminal,origin_count,limit)
        kernel,kernel_hit=exact_kernel(history_key,build_kernel)
        if cache is not None:
            cache.clear();cache.update(weightKey=weight_key,kernel=kernel,distributions={},kernelCacheHit=kernel_hit)
    else: kernel=cache['kernel']
    denominator=kernel['denominator']; values=kernel['values']
    distributions=cache.setdefault('distributions',{}) if cache is not None else {}
    local=reused and dirty is not None and 'cellResults' in cache
    if len(distributions)>4096: distributions.clear();local=False
    cell_results=cache['cellResults'] if local else {}
    used=cache['usedDistributions'] if local else Counter()
    signatures=cache['signatures'] if local else {}
    for key in dirty if local else terms:
        if key in signatures:
            previous=signatures.pop(key);used[previous]-=1
            if not used[previous]: del used[previous]
        hits=terms.get(key)
        if not hits: cell_results.pop(key,None);continue
        signature=tuple(sorted(hits.items()))
        if signature not in distributions:
            numerator=sum(count*values[pair] for pair,count in signature)
            distributions[signature]=(numerator,dict(probability=numerator/denominator,
                multiplier=numerator*origin_count/denominator,
                terms=[[IDS[pair],count] for pair,count in signature],
                oneAttemptProbability=sum(count/pair[0] for pair,count in signature)/origin_count))
        _,result=distributions[signature];used[signature]+=1;signatures[key]=signature;cell_results[key]=dict(result)
    total=sum(distributions[s][0]*count for s,count in used.items())
    ghost=sum(hits*values[pair] for pair,hits in ghost_terms.items())
    exhausted=kernel['exhausted'];failure=ghost+exhausted
    assert total+failure==denominator,'Exact retry probability conservation failed'
    if cache is not None:
        cache.update(cellResults=cell_results,usedDistributions=used,signatures=signatures,
                     coefficientsReused=reused,evaluatedDestinations=len(dirty if local else terms))
    counts=sorted(n for n,count in candidate_counts.items() if n and count)
    return dict(model=MODEL,sampleCount=origin_count,attemptLimit=limit,framePolicy='uniform-cycle',
        period=math.lcm(*counts),coefficientPeriod=COEFFICIENT_PERIOD,
        weightPeriod=kernel['weightPeriod'],method=kernel['method'],candidateCounts=counts,
        terminalCountRange=kernel['terminalCountRange'],noCandidateOrigins=no_candidate,
        positiveCellCount=len(cell_results),sharedDistributionCount=len(used),
        maxMultiplier=max((distributions[s][1]['multiplier'] for s in used),default=0),
        finalSuccess=total/denominator,finalFailure=failure/denominator,
        exact=dict(representation='shared-residue-coefficients',denominator=str(denominator),
            coefficients=kernel['coefficients'],failureNumerator=str(failure),ghostNumerator=str(ghost),
            exhaustedNumerator=str(exhausted),
            formula='P(cell)=sum(count*coefficients[id].numerator for id,count in cell.terms)/denominator',
            conservationVerified=True),cells=dict(cell_results))
