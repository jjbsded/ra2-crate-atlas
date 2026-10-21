"""Read-only, provenance-first resources and explicit Ares rules contexts.

No game files are written. Encrypted MIX indices use optional ra2mix 1.0.4;
ordinary MIX, CSF, INI and queries use the standard library.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

from ra2map import Document, OBJECT_FIELDS, fields, fold, sha, VERSION

MAX_RESOURCE = 32 * 1024 * 1024
MAX_HEADER = 84 + ((6 + 12 * 65535 + 7) // 8) * 8
REGISTRIES = ("InfantryTypes", "VehicleTypes", "AircraftTypes", "BuildingTypes")
DEFAULT_NESTED = ("localmd.mix", "local.mix")
DEFAULT_NAMES = ("rulesmd.ini", "artmd.ini", "aimd.ini", "ra2md.csf")


def relative_name(name):
    if not isinstance(name, str) or not name or any(c in name for c in ':\x00\r\n'):
        raise ValueError("Expected a relative resource name")
    parts = name.replace('\\', '/').split('/')
    if any(x in ('', '.', '..') for x in parts):
        raise ValueError("Resource paths must stay inside the game root")
    return '/'.join(parts)


def local_path(root, name, *, entries=None):
    path = root
    for part in relative_name(name).split('/'):
        if entries is None:
            children = list(path.iterdir()) if path.is_dir() else []
        else:
            # A caller may share a directory listing within ONE validation pass.
            # Never keep this snapshot across separate requests.
            if path not in entries:
                index = defaultdict(list)
                for child in path.iterdir() if path.is_dir() else []:
                    index[fold(child.name)].append(child)
                entries[path] = index
        matches = ([p for p in children if fold(p.name) == fold(part)] if entries is None
                   else entries[path].get(fold(part), []))
        if len(matches) > 1:
            raise ValueError(f"Case-ambiguous path: {name}")
        path = matches[0] if matches else path / part
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Resource resolves outside game root")
    return path


def mix_id(name):
    # TS/RA2 filename hash: uppercase ASCII, length-padded to four bytes, CRC32.
    data = relative_name(name).replace('/', '\\').upper().encode('ascii')
    remainder = len(data) % 4
    if remainder:
        data += bytes([remainder]) + data[len(data) - remainder:len(data) - remainder + 1] * (3 - remainder)
    return zlib.crc32(data)


@dataclass
class Slice:
    path: Path
    offset: int
    size: int
    label: str

    def read(self, offset=0, size=None):
        size = self.size - offset if size is None else size
        if offset < 0 or size < 0 or offset + size > self.size or size > MAX_RESOURCE:
            raise ValueError(f"Out-of-bounds or oversized resource: {self.label}")
        with self.path.open('rb') as stream:
            stream.seek(self.offset + offset)
            data = stream.read(size)
        if len(data) != size:
            raise ValueError(f"Truncated resource: {self.label}")
        return data

    def digest(self):
        h = hashlib.sha256()
        with self.path.open('rb') as stream:
            stream.seek(self.offset)
            remaining = self.size
            while remaining:
                chunk = stream.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError(f"Truncated resource: {self.label}")
                h.update(chunk)
                remaining -= len(chunk)
        return h.hexdigest()


class Mix:
    def __init__(self, source):
        self.source = source
        raw = source.read(0, min(MAX_HEADER, source.size))
        if len(raw) < 6:
            raise ValueError(f"Truncated MIX header: {source.label}")
        self.flags = None if struct.unpack_from('<H', raw)[0] else struct.unpack_from('<I', raw)[0]
        self.backend = 'stdlib'
        if self.flags is not None and self.flags & ~0x30000:
            raise ValueError(f"Unsupported MIX flags: {source.label}")
        if self.flags is not None and self.flags & 0x20000:
            try:
                from ra2mix import read_file_info
            except ImportError as exc:
                raise ValueError("Encrypted MIX needs optional ra2mix==1.0.4 (Python 3.11+), or pre-extracted files") from exc
            try:
                header, entries, _ = read_file_info(mix_data=raw)
            except Exception as exc:
                raise ValueError(f"Cannot decode encrypted MIX index: {source.label}: {exc}") from exc
            count, data_size = header.file_count, header.data_size
            self.body = 84 + ((6 + 12 * count + 7) // 8) * 8
            entries = [(e.id & 0xffffffff, e.offset, e.size) for e in entries]
            self.backend = 'ra2mix-encrypted-index'
        else:
            start = 0 if self.flags is None else 4
            if len(raw) < start + 6:
                raise ValueError("Truncated MIX header")
            count, data_size = struct.unpack_from('<HI', raw, start)
            self.body = start + 6 + count * 12
            if self.body > len(raw):
                raise ValueError("Truncated MIX index")
            entries = [struct.unpack_from('<III', raw, start + 6 + i * 12) for i in range(count)]
        if self.body + data_size > source.size:
            raise ValueError(f"MIX body exceeds file: {source.label}")
        if self.flags is not None and self.flags & 0x10000 and self.body + data_size + 20 > source.size:
            raise ValueError(f"Truncated MIX checksum trailer: {source.label}")
        self.entries = defaultdict(list)
        for entry_id, offset, size in entries:
            if offset + size > data_size:
                raise ValueError(f"MIX entry exceeds body: {source.label}")
            self.entries[entry_id].append((offset, size))
        self.data_size = data_size

    def member(self, name):
        matches = self.entries.get(mix_id(name), [])
        if len(matches) > 1:
            raise ValueError(f"Ambiguous duplicate MIX ID: {self.source.label}::{name}")
        if not matches:
            return None
        offset, size = matches[0]
        return Slice(self.source.path, self.source.offset + self.body + offset, size,
                     self.source.label + '::' + name)


class Resources:
    def __init__(self, root, mounts):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise ValueError("Missing game root")
        self.mounts = []
        self.archive_info = {}
        self.cache = {}
        self.mix_cache = {}
        for mount in mounts:
            self.mounts.append(self.open_mount(mount))

    def open_mount(self, mount):
        parts = mount.split('::')
        if len(parts) > 8:
            raise ValueError("Nested MIX depth exceeds 8")
        p = local_path(self.root, parts[0])
        source = Slice(p, 0, p.stat().st_size, str(p.resolve()))
        for index in range(len(parts)):
            if source.label not in self.mix_cache:
                self.mix_cache[source.label] = Mix(source)
            mix = self.mix_cache[source.label]
            if index < len(parts) - 1:
                source = mix.member(parts[index + 1])
                if source is None:
                    raise ValueError(f"Missing nested MIX: {mount}")
        return mix

    def candidates(self, name):
        name = relative_name(name)
        result = []
        p = local_path(self.root, name)
        if p.is_file():
            result.append((Slice(p, 0, p.stat().st_size, str(p.resolve())), None))
        if '/' not in name:
            for mix in self.mounts:
                member = mix.member(name)
                if member:
                    result.append((member, mix))
        return result

    def describe(self, source, mix=None):
        result = {'source': source.label, 'sha256': source.digest(), 'bytes': source.size,
                  'file_offset': source.offset}
        if mix:
            label = mix.source.label
            if label not in self.archive_info:
                self.archive_info[label] = {'source': label, 'sha256': mix.source.digest(),
                                            'bytes': mix.source.size, 'index_backend': mix.backend}
            result['archive'] = self.archive_info[label]
            result['member_lookup'] = 'RA2 filename CRC32; archive IDs cannot prove the original spelling'
        return result

    def get(self, name, required=True):
        key = fold(relative_name(name))
        if key not in self.cache:
            candidates = self.candidates(name)
            if not candidates:
                if required:
                    raise ValueError(f"Resource not found in selected context: {name}")
                return None
            first, mix = candidates[0]
            raw = first.read()
            info = self.describe(first, mix)
            if info['sha256'] != sha(raw):
                raise ValueError(f"Resource changed during read: {name}")
            info.update(name=name, alternatives=[self.describe(s, m) for s, m in candidates[1:]],
                        selection='first resource found; same-name files are NOT merged')
            self.cache[key] = (raw, info)
        return self.cache[key]


def catalog(root, names, nested=DEFAULT_NESTED):
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("Missing game root")
    found = {n: [] for n in names}
    issues, archives = [], []
    loose = Resources(root, [])
    for name in names:
        for source, mix in loose.candidates(name):
            found[name].append(loose.describe(source, mix))
    for p in sorted(root.glob('*'), key=lambda p: fold(p.name)):
        if p.suffix.lower() != '.mix' or not p.is_file():
            continue
        try:
            resources = Resources(root, [p.name])
            parent = resources.mounts[0]
            mixes = [parent]
            for name in nested:
                if parent.member(name):
                    mixes.append(resources.open_mount(p.name + '::' + name))
            for mix in mixes:
                archives.append({'source': mix.source.label, 'entries': sum(map(len, mix.entries.values())),
                                 'flags': mix.flags, 'index_backend': mix.backend})
                for name in names:
                    source = mix.member(name)
                    if source:
                        found[name].append(resources.describe(source, mix))
        except (ValueError, OSError) as exc:
            issues.append({'source': str(p), 'error': str(exc)})
    return {'tool_version': VERSION, 'root': str(root), 'candidates': found, 'archives': archives,
            'issues': issues, 'scope': {'nested_names': list(nested), 'nested_depth': 1},
            'semantics': 'Candidate discovery only. No priority inferred. Unknown nested names and protected archives may be absent.'}


def parse_csf(raw):
    if len(raw) > MAX_RESOURCE or len(raw) < 24 or raw[:4] != b' FSC':
        raise ValueError("Invalid CSF header")
    version, count, string_count, reserved, language = struct.unpack_from('<5I', raw, 4)
    if version not in (2, 3) or count > 100000 or string_count > 100000:
        raise ValueError("Unsupported CSF version or excessive counts")
    pos = 24
    labels, actual = defaultdict(list), 0

    def take(n):
        nonlocal pos
        if n < 0 or pos + n > len(raw):
            raise ValueError("Truncated CSF record")
        data = raw[pos:pos + n]
        pos += n
        return data

    def number():
        return struct.unpack('<I', take(4))[0]

    for _ in range(count):
        offset = pos
        if take(4) != b' LBL':
            raise ValueError("Invalid CSF label tag")
        values = number()
        if values > 1000:
            raise ValueError("Excessive CSF value count")
        label = take(number()).decode('ascii')
        strings = []
        for _ in range(values):
            tag = take(4)
            if tag not in (b' RTS', b'WRTS'):
                raise ValueError("Invalid CSF string tag")
            text = bytes(b ^ 255 for b in take(number() * 2)).decode('utf-16-le')
            extra = take(number()).hex() if tag == b'WRTS' else None
            strings.append({'text': text, 'extra_hex': extra})
            actual += 1
        labels[fold(label)].append({'label': label, 'offset': offset, 'strings': strings})
    if pos != len(raw) or actual != string_count:
        raise ValueError("CSF trailing data or string count mismatch")
    return {'version': version, 'language': language, 'labels': dict(labels)}


class Context:
    def __init__(self, path, map_path=None):
        # Directory discovery supplies an ephemeral context; no per-Mod profile
        # needs to be saved or shipped with the application.
        generated = isinstance(path, dict)
        raw = json.dumps(path, sort_keys=True).encode() if generated else path.read_bytes()
        self.config = json.loads(raw.decode('utf-8-sig'))
        cfg = self.config
        if not isinstance(cfg, dict) or not isinstance(cfg.get('root'), str):
            raise ValueError("Context must be an object with a game root")
        if cfg.get('schema_version') != 1 or cfg.get('include_mode') not in ('none', 'ares'):
            raise ValueError("Context requires schema_version=1 and include_mode=none/ares")
        if not isinstance(cfg.get('search_order'), list) or not isinstance(cfg.get('order_basis'), dict):
            raise ValueError("Context requires explicit search_order and order_basis")
        if not all(isinstance(x, str) for x in cfg['search_order']):
            raise ValueError("search_order entries must be MIX paths")
        root = Path(cfg['root'])
        if not root.is_absolute():
            if generated:
                raise ValueError("Discovered game root must be absolute")
            root = path.resolve().parent / root
        self.resources = Resources(root, cfg['search_order'])
        pins = cfg.get('expected_sha256', {})
        if not isinstance(pins, dict):
            raise ValueError("expected_sha256 must be a path-to-hash object")
        for name, expected in pins.items():
            p = local_path(root.resolve(), name)
            if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', expected):
                raise ValueError(f"Invalid expected SHA-256: {name}")
            if Slice(p, 0, p.stat().st_size, str(p)).digest() != expected.lower():
                raise ValueError(f"Context fingerprint changed; re-investigate profile: {name}")
        self.identity = {'path': None if generated else str(path.resolve()), 'sha256': sha(raw), 'root': str(root.resolve()),
                         'order_basis': cfg['order_basis'], 'search_order': cfg['search_order'],
                         'verified_fingerprints': pins}
        self.sources, self.issues, self.layers = {}, [], defaultdict(list)
        self.documents = {}
        self.csf = []
        self.map_doc = None
        self.map_source = None
        self.load_count = 0
        self.total_ini_bytes = 0
        self.load('rules', cfg.get('rules', 'rulesmd.ini'))
        if cfg.get('art'):
            self.load('art', cfg['art'])
        if map_path:
            doc = Document.read(map_path)
            doc.require_map()
            info = {'source': str(map_path.resolve()), 'sha256': sha(doc.raw), 'bytes': len(doc.raw),
                    'name': map_path.name, 'kind': 'map', 'selection': 'explicit map; launcher injection is not assumed'}
            self.map_doc, self.map_source = doc, info['source']
            self.add_doc('rules', doc, info, None)
            self.expand('rules', doc, info, [info['source']])
        names = list(cfg.get('csf', []))
        if cfg.get('ares_stringtables', False):
            names += [f'stringtable{i:02}.csf' for i in range(100)]
        base_language = None
        for name in names:
            try:
                item = self.resources.get(name, required=False)
                if not item:
                    continue
                data, info = item
                table = parse_csf(data)
                self.sources[info['source']] = info
                if base_language is None:
                    base_language = table['language']
                if table['language'] not in (base_language, 0xffffffff):
                    self.issues.append({'domain': 'csf', 'code': 'language-mismatch', 'source': info['source']})
                    continue
                self.csf.append((info['source'], table))
            except (ValueError, OSError) as exc:
                self.issues.append({'domain': 'csf', 'code': 'unresolved', 'name': name, 'error': str(exc)})

    def add_doc(self, domain, doc, info, via):
        self.total_ini_bytes += len(doc.raw)
        if self.total_ini_bytes > 128 * 1024 * 1024:
            raise ValueError("Combined INI budget exceeds 128 MiB")
        source = info['source']
        self.sources[source] = {**info, 'encoding': doc.encoding}
        self.layers[domain].append({'source': source, 'via': via})
        self.documents[source] = doc
        if doc.unparsed:
            self.issues.append({'domain': domain, 'code': 'unparsed-lines', 'source': source, 'lines': doc.unparsed[:30],
                                'examples': [{'line': n, 'text': doc.lines[n - 1].strip()[:300]} for n in doc.unparsed[:10]]})
        if doc.encoding == 'latin-1' and not doc.encoding_explicit:
            self.issues.append({'domain': domain, 'code': 'encoding-uncertain', 'source': source})
        special = [e for e in doc.entries if e.key.startswith(('$', '+')) or e.section.startswith('$')]
        if special:
            self.issues.append({'domain': domain, 'code': 'unsupported-inheritance-or-list-syntax', 'source': source,
                                'locations': [e.location() for e in special[:20]]})

    def load(self, domain, name, stack=(), via=None):
        self.load_count += 1
        if len(stack) >= 32 or self.load_count > 256:
            self.issues.append({'domain': domain, 'code': 'include-limit', 'name': name})
            return
        try:
            data, info = self.resources.get(name)
            if fold(info['source']) in {fold(s) for s in stack}:
                self.issues.append({'domain': domain, 'code': 'include-cycle', 'source': info['source'], 'stack': list(stack)})
                return
            encoding = self.config.get('encodings', {}).get(name)
            doc = Document(data, encoding)
            self.add_doc(domain, doc, info, via)
            self.expand(domain, doc, info, [*stack, info['source']])
        except (ValueError, OSError) as exc:
            self.issues.append({'domain': domain, 'code': 'unresolved-include-or-root', 'name': name, 'via': via, 'error': str(exc)})

    def expand(self, domain, doc, info, stack):
        rows = doc.rows('#include')
        if not rows:
            return
        if self.config['include_mode'] != 'ares':
            self.issues.append({'domain': domain, 'code': 'include-not-enabled', 'source': info['source']})
            return
        if sum(fold(s) == '#include' for s, _ in doc.sections) > 1 or len({fold(e.key) for e in rows}) != len(rows):
            self.issues.append({'domain': domain, 'code': 'ambiguous-include-list', 'source': info['source']})
            return
        for e in rows:
            self.load(domain, e.value, stack, {'source': info['source'], **e.location()})

    def section(self, name, domain='rules'):
        grouped = defaultdict(list)
        ambiguous = set()
        for index, layer in enumerate(self.layers[domain]):
            doc = self.documents[layer['source']]
            rows = doc.rows(name)
            duplicate_section = sum(fold(s) == fold(name) for s, _ in doc.sections) > 1
            for e in rows:
                key = fold(e.key)
                grouped[key].append({'source': layer['source'], 'sha256': self.sources[layer['source']]['sha256'],
                                     'layer': index, **e.location(), 'value': e.value})
                if duplicate_section or len(doc.matches(name, e.key)) > 1:
                    ambiguous.add(key)
        incomplete = any(i['domain'] == domain for i in self.issues)
        return {key: {'key': history[-1]['key'], 'history': history,
                      'value': None if key in ambiguous or incomplete else history[-1]['value'],
                      'candidate': history[-1]['value'],
                      'status': 'ambiguous' if key in ambiguous else ('incomplete-context' if incomplete else 'resolved-in-profile')}
                for key, history in grouped.items()}

    def display_name(self, label):
        if not label:
            return {'status': 'missing-uiname', 'value': None}
        if self.config['include_mode'] == 'ares' and fold(label).startswith('nostr:'):
            return {'status': 'literal', 'value': label[6:], 'label': label}
        history, ambiguous = [], False
        for source, table in self.csf:
            rows = table['labels'].get(fold(label), [])
            if len(rows) > 1:
                ambiguous = True
            for row in rows:
                if len(row['strings']) != 1:
                    ambiguous = True
                history.append({'source': source, 'sha256': self.sources[source]['sha256'], **row})
        incomplete = any(i['domain'] == 'csf' and i['code'] != 'language-mismatch' for i in self.issues)
        status = 'ambiguous' if ambiguous else ('incomplete-context' if incomplete else ('resolved-in-profile' if history else 'missing-label'))
        value = history[-1]['strings'][0]['text'] if history and history[-1]['strings'] else None
        return {'label': label, 'status': status, 'value': value if status == 'resolved-in-profile' else None,
                'candidate': value, 'history': history}

    def registrations(self, name):
        result = []
        for layer in self.layers['rules']:
            for section in REGISTRIES:
                for e in self.documents[layer['source']].rows(section):
                    if fold(e.value) == fold(name):
                        result.append({'source': layer['source'], **e.location(), 'value': e.value})
        return result

    def placements(self, name=None):
        result = []
        if self.map_doc:
            for section, schema in OBJECT_FIELDS.items():
                for e in self.map_doc.rows(section):
                    f = fields(e.value)
                    if len(f) >= 2 and (name is None or fold(f[1]) == fold(name)):
                        result.append({'source': self.map_source, **e.location(),
                                       'fields': dict(zip(schema, f))})
        return result

    def inspect(self, name):
        props = self.section(name)
        relations = []
        for key, prop in props.items():
            if key in ('primary', 'secondary', 'eliteprimary', 'elitesecondary', 'deathweapon') or re.fullmatch(r'(elite)?weapon\d+', key):
                target = reference_value(prop)
                if not target or fold(target) in ('none', '<none>'):
                    continue
                weapon = self.section(target)
                children = []
                for link in ('warhead', 'projectile'):
                    child = reference_value(weapon.get(link, {}))
                    if child:
                        children.append({'kind': link, 'id': child, 'reference_status': weapon[link]['status'],
                                         'properties': self.section(child)})
                relations.append({'key': prop['key'], 'id': target, 'reference_status': prop['status'],
                                  'properties': weapon, 'links': children})
                if len(relations) >= 64:
                    break
        image_prop = props.get('image')
        image_name = reference_value(image_prop) if image_prop else name
        art = {'id': image_name, 'basis': 'Image property' if image_prop else 'object ID fallback',
               'reference_status': image_prop['status'] if image_prop else 'fallback-assumption',
               'properties': self.section(image_name, 'art') if image_name else {}}
        ui_prop = props.get('uiname', {})
        return {'id': name, 'definition_status': 'definition-found' if props else 'not-found-in-profile', 'properties': props,
                'display_name': {**self.display_name(reference_value(ui_prop)), 'reference_status': ui_prop.get('status', 'missing')},
                'registration_mentions': self.registrations(name),
                'registration_semantics': 'Declarations by value; no final registry numbering or availability inferred.',
                'placements': self.placements(name), 'weapons': relations, 'art': art}

    def report(self):
        return {'tool_version': VERSION, 'context': self.identity, 'sources': self.sources,
                'layers_low_to_high': dict(self.layers), 'issues': self.issues,
                'confidence': 'explicit-profile-static-analysis; not a runtime trace',
                'limitations': ['Only the configured mounts are searched; same-name resources shadow whole files.',
                                'Ares include traversal is depth-first; section inheritance and engine defaults are not evaluated.',
                                'Unknown DLL hooks, country/veterancy modifiers and weapon effects are not simulated.',
                                'Map object health is a deployment fraction, separate from type Strength.',
                                *self.config.get('limitations', [])]}

    def map_report(self):
        if not self.map_doc:
            raise ValueError("Map required")
        groups = defaultdict(list)
        for item in self.placements():
            groups[item['fields']['type']].append(item)
        objects = []
        selected = ('strength', 'cost', 'armor', 'speed', 'primary', 'secondary', 'image', 'techlevel')
        for name, placements in sorted(groups.items()):
            props = self.section(name)
            objects.append({'id': name, 'definition_status': 'definition-found' if props else 'not-found-in-profile', 'count': len(placements),
                            'display_name': {**self.display_name(reference_value(props.get('uiname', {}))),
                                             'reference_status': props.get('uiname', {}).get('status', 'missing')},
                            'registration_mentions': self.registrations(name),
                            'properties': {k: props[k] for k in selected if k in props}, 'placements': placements})
        result = self.report()
        result['objects'] = objects
        result['map'] = self.sources[self.map_source]
        return result


def reference_value(prop):
    # Still show a provisional relationship when an unrelated include is missing.
    # Preserve its status on the edge; never choose an ambiguous definition.
    return None if prop.get('status') == 'ambiguous' else prop.get('candidate', prop.get('value'))


def add_commands(commands):
    sub = commands.add_parser('mod-catalog', help='Find resource candidates; no priority inferred')
    sub.add_argument('root', type=Path)
    sub.add_argument('--name', action='append')
    sub.add_argument('--nested', action='append', help='Known nested MIX name, one level')
    sub.add_argument('--output', type=Path)
    sub = commands.add_parser('mod-inspect', help='Trace object rules using an explicit context')
    sub.add_argument('context', type=Path)
    sub.add_argument('--id', required=True, action='append')
    sub.add_argument('--map', type=Path)
    sub.add_argument('--output', type=Path)
    sub = commands.add_parser('mod-map', help='Map deployments joined to rules and localization')
    sub.add_argument('context', type=Path)
    sub.add_argument('map', type=Path)
    sub.add_argument('--output', type=Path)


def run(args):
    if args.command == 'mod-catalog':
        return catalog(args.root, args.name or DEFAULT_NAMES, args.nested if args.nested is not None else DEFAULT_NESTED)
    context = Context(args.context, args.map)
    if args.command == 'mod-map':
        return context.map_report()
    objects = [context.inspect(name) for name in args.id]
    return {**context.report(), 'objects': objects}
