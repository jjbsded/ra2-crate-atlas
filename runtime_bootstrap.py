"""Prefer dependencies shipped beside the app; development fallbacks are optional."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
for directory in (ROOT.parent.parent/'third_party/ra2mix-venv/Lib/site-packages',
                  ROOT.parent.parent/'.analysis_deps', ROOT/'vendor'):
    if directory.is_dir():
        sys.path.insert(0, str(directory))
