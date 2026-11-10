"""Revision patches reconstruct exact snapshots and keep baseline data immutable."""
from copy import deepcopy
import unittest
from probability_delta import patch, snapshot


def apply(base, delta):
    result = deepcopy(base)
    for path, value in delta['sets']:
        parent = result
        for part in path[:-1]: parent = parent[part]
        parent[path[-1]] = deepcopy(value)
    for path in delta['removed']:
        parent = result
        for part in path[:-1]: parent = parent[part]
        del parent[path[-1]]
    changed = {(c['x'],c['y']): c for c in delta['cells']}
    result['cells'] = [changed.get((c['x'],c['y']), c) for c in base['cells']]
    result['probabilityRevision'] = delta['probabilityRevision']
    return result


class Checks(unittest.TestCase):
    def test_routing_is_published_with_the_layout(self):
        base=dict(metadata=dict(sourceSha256='a',version='yr'),probability={},markers=[],potentialMarkers=[],
                  zeroProbabilityRockCandidates=[],clearance={},cells=[dict(x=1,y=1)],probabilityRevision='a',
                  regionNavigation=dict(version=4,count=1,flags='CA=='))
        current={**base,'probabilityRevision':'b','regionNavigation':dict(version=4,count=1,flags='Ag==')}
        delta=patch(current,base,'a')
        self.assertEqual(delta['cells'],[])
        self.assertEqual(apply(base,delta),current)
        self.assertEqual(base['regionNavigation']['flags'],'CA==')
        missing={k:v for k,v in current.items() if k!='regionNavigation'}
        self.assertEqual(apply(current,patch(missing,current,'b')),missing)

    def test_local_delta_and_global_coefficients(self):
        value = dict(metadata=dict(sourceSha256='a',version='yr',old='remove'),
            probability=dict(exact=dict(coefficients=['9'*5000],denominator='1'+'0'*5000),count=2),
            cells=[dict(x=i,y=2,terms=[[0,1]],occupied=False) for i in range(20)],
            markers=[],potentialMarkers=[],zeroProbabilityRockCandidates=[],clearance={})
        base = snapshot(value,'first'); untouched = deepcopy(base)
        current = {**base,'metadata':dict(sourceSha256='a',version='yr'),
                   'cells':list(base['cells']), 'probabilityRevision':'second'}
        current['cells'][9] = dict(x=9,y=2,terms=[],occupied=True)
        delta = patch(current,base,'first')
        self.assertEqual(len(delta['cells']),1)
        self.assertFalse(any(path[0]=='probability' for path,_ in delta['sets']))
        self.assertEqual(apply(base,delta),current)
        self.assertEqual(base,untouched)
        global_change = deepcopy(current)
        global_change['probability']['exact']['coefficients'][0]='8'*5000
        delta = patch(global_change,current,'second')
        self.assertEqual(apply(current,delta),global_change)

    def test_missing_base_and_removed_cell_fields(self):
        base=dict(metadata=dict(sourceSha256='a',version='yr'),probability={},
                  markers=[],potentialMarkers=[],zeroProbabilityRockCandidates=[],clearance={},
                  cells=[dict(x=1,y=1,occupancyUnknown=True,px=30)],probabilityRevision='a')
        new={**base,'cells':[dict(x=1,y=1)],'probabilityRevision':'b'}
        self.assertEqual(patch(new,None,None),new)
        self.assertEqual(len(patch(new,base,'a')['cells']),1)


if __name__=='__main__': unittest.main()
