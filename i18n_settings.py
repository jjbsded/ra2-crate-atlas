"""Small, installation-local UI preference; never a release input."""
import ctypes
import json
import locale
import os
from pathlib import Path
import threading

SETTINGS = Path(__file__).resolve().parent/'data/ui-language.json'
LOCK = threading.Lock()
LANGUAGES = ('zh-CN', 'en')


def system_language():
    if os.name == 'nt':
        try:
            # Windows display language, independent of Python/browser locale.
            return 'zh-CN' if ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3ff == 4 else 'en'
        except (AttributeError, OSError):
            pass
    return 'zh-CN' if (locale.getlocale()[0] or '').lower().startswith('zh') else 'en'


def settings(*, initialize=False):
    system = system_language()
    with LOCK:
        try:
            saved = json.loads(SETTINGS.read_text('utf8')).get('language')
        except (OSError, ValueError, AttributeError):
            saved = None
        if saved not in LANGUAGES:
            saved = None
            if initialize:
                try:
                    _write(system)
                    saved = system
                except OSError:
                    # A read-only installation can still display the UI. An
                    # explicit preference change reports the save failure.
                    pass
    return {'system': system, 'saved': saved}


def language():
    value = settings()
    return value['saved'] or value['system']


def save(value):
    if value not in LANGUAGES:
        raise ValueError('Unsupported language')
    with LOCK:
        _write(value)
    return {'language': value}


def _write(value):
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    temp = SETTINGS.with_suffix('.tmp')
    temp.write_text(json.dumps({'language': value}), 'utf8')
    os.replace(temp, SETTINGS)
