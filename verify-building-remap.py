"""Real stock SHP indices: obsolete flags must not leave the remap ramp red."""
from pathlib import Path
import tempfile
import unittest
import numpy as np
from realmap_resources import resources
from realmap_objects import ObjectPainter
from realmap_sprites import shp_frame

class RemapChecks(unittest.TestCase):
 def test_stock_bases_and_animation_parts(self):
  checks=0
  for version in ('ra2','yr'):
   res=resources(version)
   for climate in ('TEMPERATE','SNOW','URBAN'):
    theater=res.theater(climate);theater['effectiveRules']={**res.rules,'QA_BLUE':{'COLOR':'DarkBlue'}}
    with tempfile.TemporaryDirectory() as folder:
     painter=ObjectPainter(res,theater,Path(folder))
     for kind in ('YAPSYT','GAGAP','ATESLA','CAAIRP','CAOILD'):
      if kind not in res.rules:continue
      for health in (256,64):
       for house in ('NEUTRAL','AMERICANS','QA_BLUE'):
        obj=dict(type=kind,category='STRUCTURES',facing=0,health=health,mission='Guard',house=house,upgrades=[])
        parts=painter.parts(obj);changed=0
        for part in parts:
         raw=painter.get(part['file']);idx=np.asarray(shp_frame(raw,part['frame'],[(i,0,0) for i in range(256)]))[:,:,0]
         colors,_=painter.colors({},house)
         original=np.asarray(shp_frame(raw,part['frame'],colors))
         actual=np.asarray(part['image']);mask=(idx>=16)&(idx<=31)&(actual[:,:,3]>0)
         self.assertTrue(np.array_equal(actual[mask,:3],original[mask,:3]),(version,climate,kind,house,part['file']))
         self.assertTrue(np.array_equal(actual[~mask],original[~mask]),'Non-remap pixels and transparency must stay unchanged')
         changed+=np.count_nonzero(mask)
        self.assertGreater(changed,0,(version,climate,kind));checks+=1
  print('Verified real building states:',checks)

if __name__=='__main__':unittest.main()
