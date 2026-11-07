"""Combined initialization retains the separate source API's exact semantics."""
from pathlib import Path
from unittest.mock import patch
import runtime_bootstrap
import simulation_live as L
from map_results import simulation_source
from realmap_mod import lookup_scope

path=Path('output/CrateAtlas-Windows-x64-Simulation-20261104/output/map-22309489b5d3/result.json.gz')
with lookup_scope(),patch.object(L,'result_path',return_value=path):
    value=L.open_session({'result':'fixture','includeSource':True})
    try:
        s=L._sessions[value['session']]
        assert value['source']==simulation_source(s.report,path)
        assert value['timing']['sourceModelMs']>=0
        print('PASS combined bootstrap source equals the existing API; exact session remains live')
    finally:L.release_session({'session':value['session']});L.close_all()
