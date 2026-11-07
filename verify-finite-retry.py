"""Independent small-state fraction oracle and Python/JS retry fixtures."""
from fractions import Fraction
from collections import Counter
from pathlib import Path
import json, math, random, time
from realmap_exact import calculate, retry_kernel, COEFFICIENT_PERIOD
QA=Path('output/finite-retry-qa');QA.mkdir(exist_ok=True)
fixtures=[]
def check(records,statuses,limit):
    n=len(records);period=math.lcm(*(len(row) for row in records if row))
    expected=Counter();ghost=Fraction(0);exhausted=Fraction(0)
    for frame in range(period):
        hits=Counter(row[frame%len(row)] for row in records if row)
        terminal=sum(count for key,count in hits.items() if statuses.get(key) in ('crate','ghost'))
        retry=Fraction(n-terminal,n);weight=sum((retry**k for k in range(limit)),Fraction(0))
        for key,count in hits.items():
            if statuses.get(key)=='crate':expected[key]+=Fraction(count,n)*weight/period
            elif statuses.get(key)=='ghost':ghost+=Fraction(count,n)*weight/period
        exhausted+=retry**limit/period
    result=calculate(records,statuses,n,limit=limit);e=result['exact'];d=int(e['denominator'])
    for key,value in expected.items():
        cell=result['cells'][key];num=sum(int(e['coefficients'][i]['numerator'])*count for i,count in cell['terms'])
        assert Fraction(num,d)==value,(records,limit,key)
    assert Fraction(int(e['ghostNumerator']),d)==ghost
    assert Fraction(int(e['exhaustedNumerator']),d)==exhausted
    assert Fraction(int(e['failureNumerator']),d)==ghost+exhausted
    assert sum(expected.values())+ghost+exhausted==1
    assert 'finalGhost' not in result
    fixtures.append(dict(records=records,statuses=statuses,limit=limit,result=result))
check([[513],[514],[515]],{513:'crate',514:'ghost',515:'retry'},3)
assert fixtures[-1]['result']['finalFailure']==14/27
check([[513,515],[513]],{513:'crate',515:'retry'},3)
assert fixtures[-1]['result']['finalSuccess']==.9375 # averaging the retry rate first would be wrong
rng=random.Random(3941)
for i in range(35):
    count=rng.randrange(1,8);records=[[rng.randrange(513,518) for _ in range(rng.randrange(0,7))] for j in range(count)]
    check(records,{k:rng.choice(['crate','ghost','retry']) for k in range(513,518)},rng.randrange(1,8))
check([[],[515]],{515:'retry'},1000)
check([[513],[515]],{513:'crate',515:'retry'},1000)
assert int(fixtures[-1]['result']['exact']['exhaustedNumerator'])>0
empty=retry_kernel({},2,3);assert Fraction(empty['values'][1,0],empty['denominator'])==Fraction(3,2)
# Force CRT: all candidate counts, huge joint period, short bounded histograms.
records=[list(range(513,513+n)) for n in range(1,25)]
statuses={k:('crate' if k%3==0 else 'ghost' if k%3==1 else 'retry') for k in range(513,537)}
start=time.perf_counter();result=calculate(records,statuses,len(records),limit=7);elapsed=time.perf_counter()-start
assert result['method']=='crt-factor-convolution'
fixtures.append(dict(records=records,statuses=statuses,limit=7,result=result))
(QA/'fixtures.json').write_text(json.dumps(fixtures,separators=(',',':')),'utf8')
(QA/'summary.json').write_text(json.dumps(dict(status='PASS',cases=len(fixtures),jointPeriod=COEFFICIENT_PERIOD,crtSeconds=elapsed),indent=2),'utf8')
print('PASS',len(fixtures),'fraction oracle cases; CRT',COEFFICIENT_PERIOD,'frame states aggregated in',round(elapsed,4),'seconds')
