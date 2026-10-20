"""Lossless RA2/YR text-map inspection and copy-only, guarded INI patches.

Python 3.10+, standard library only. No game/editor processes are launched.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from collections import Counter, defaultdict
from dataclasses import dataclass
import difflib
import hashlib
import json
from pathlib import Path
import re
import sys

VERSION = "0.9.0"
PACKS = {"isomappack5", "overlaypack", "overlaydatapack", "previewpack"}
OBJECT_FIELDS = {
    "Infantry": "owner type health x y subcell mission facing tag veterancy group high recruit_no recruit_yes".split(),
    "Units": "owner type health x y facing mission tag veterancy group high follows recruit_no recruit_yes".split(),
    "Aircraft": "owner type health x y facing mission tag veterancy group recruit_no recruit_yes".split(),
    "Structures": "owner type health x y facing tag sellable rebuildable powered upgrades spotlight upgrade1 upgrade2 upgrade3 repairable nominal".split(),
}
NULL_REFS = {"", "none", "<none>", "-1"}
SECTION = re.compile(r"^\s*\[([^\]\r\n]+)\]\s*(?:;.*)?$")
PAIR = re.compile(r"^([ \t]*([^=;\s][^=]*?)[ \t]*=[ \t]*)(.*)$")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fold(s: str) -> str:
    return s.casefold()


def packed(section: str) -> bool:
    return fold(section) in PACKS or "pack" in fold(section)


@dataclass
class Entry:
    section: str
    key: str
    value: str
    index: int
    prefix: str
    suffix: str
    newline: str

    def location(self) -> dict:
        return {"section": self.section, "key": self.key, "line": self.index + 1}


class Document:
    def __init__(self, raw: bytes, encoding: str | None = None):
        if b"\x00" in raw:
            raise ValueError("Binary or UTF-16 input; use an extracted, single-byte/UTF-8 INI map.")
        self.raw = raw
        self.encoding_explicit = encoding is not None
        if encoding:
            self.encoding = encoding
            self.text = raw.decode(encoding, errors="strict")
        else:
            for candidate in ("utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8", "cp936", "latin-1"):
                try:
                    self.text = raw.decode(candidate, errors="strict")
                    self.encoding = candidate
                    break
                except UnicodeDecodeError:
                    continue
        if self.text.encode(self.encoding) != raw:
            raise ValueError("Encoding does not round-trip; specify the actual --encoding.")
        # INI line endings are CR/LF; do not split CP1252 NEL or Unicode separators.
        self.lines = [line for line in re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", self.text) if line]
        self.newline = next(("\r\n" if x.endswith("\r\n") else "\n" for x in self.lines if x.endswith("\n")), "\r\n")
        self.entries: list[Entry] = []
        self.sections: list[tuple[str, int]] = []
        self.unparsed: list[int] = []
        current = ""
        for i, line in enumerate(self.lines):
            body = line.rstrip("\r\n")
            ending = line[len(body):]
            if not body.strip() or body.lstrip().startswith((";", "#")):
                continue
            match = SECTION.fullmatch(body)
            if match:
                current = match[1].strip()
                self.sections.append((current, i))
                continue
            match = PAIR.fullmatch(body)
            if match and current:
                before_comment, sep, comment = match[3].partition(";")
                value = before_comment.rstrip(" \t")
                suffix = before_comment[len(value):] + sep + comment
                self.entries.append(Entry(current, match[2].strip(), value, i, match[1], suffix, ending))
            else:
                self.unparsed.append(i + 1)
        if not self.sections:
            raise ValueError("No INI sections found; this may be a MIX container, not a text map.")
        self._names = {fold(name) for name, _ in self.sections}
        self._rows = defaultdict(list)
        self._pairs = defaultdict(list)
        for entry in self.entries:
            self._rows[fold(entry.section)].append(entry)
            self._pairs[(fold(entry.section), fold(entry.key))].append(entry)

    @classmethod
    def read(cls, path: Path, encoding=None):
        return cls(path.read_bytes(), encoding)

    def rows(self, section: str) -> list[Entry]:
        return self._rows.get(fold(section), [])

    def names(self) -> set[str]:
        return self._names

    def matches(self, section: str, key: str) -> list[Entry]:
        return self._pairs.get((fold(section), fold(key)), [])

    def value(self, section: str, key: str, default=None):
        rows = self.matches(section, key)
        return rows[0].value if len(rows) == 1 else default

    def require_map(self):
        if not {"map", "basic"}.issubset(self.names()):
            raise ValueError("Expected a map with [Basic] and [Map].")

    def block_bytes(self, name: str) -> bytes:
        chunks = []
        for pos, (section, start) in enumerate(self.sections):
            if fold(section) == fold(name):
                end = self.sections[pos + 1][1] if pos + 1 < len(self.sections) else len(self.lines)
                chunks.extend(self.lines[start:end])
        # BOM belongs to the file, not each block.
        codec = "utf-8" if self.encoding == "utf-8-sig" else self.encoding
        return "".join(chunks).encode(codec)


def fields(value: str) -> list[str]:
    return [x.strip() for x in value.split(",")]


def integer(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def coord(value: str) -> dict:
    n = int(value)
    if n < 0:
        raise ValueError("Negative packed coordinate")
    return {"x": n % 1000, "y": n // 1000}


def pack_info(doc: Document, name: str) -> dict:
    rows = doc.rows(name)
    result = {"section": name, "lines": len(rows), "raw_sha256": sha(doc.block_bytes(name)), "decoded": False}
    try:
        indexes = [int(e.key) for e in rows]
        if len(set(indexes)) != len(indexes):
            raise ValueError("Duplicate chunk keys")
        if indexes and sorted(indexes) != list(range(min(indexes), max(indexes) + 1)):
            raise ValueError("Non-contiguous chunk keys")
        stream = "".join(e.value for e in sorted(rows, key=lambda e: int(e.key)))
        result["encoded_bytes"] = len(base64.b64decode(stream, validate=True))
        result["base64_valid"] = True
    except (ValueError, binascii.Error) as exc:
        result.update(base64_valid=False, error=str(exc))
    return result


def reference_edges(doc: Document) -> list[dict]:
    edges = []

    def add(entry, target_section, target_key, kind):
        if fold(target_key) in NULL_REFS:
            return
        edges.append({"from": entry.location(), "to": {"section": target_section, "key": target_key},
                      "kind": kind, "found_in_map": bool(doc.matches(target_section, target_key))})

    for e in doc.rows("Tags"):
        f = fields(e.value)
        if len(f) == 3:
            add(e, "Triggers", f[2], "tag-trigger")
    for e in doc.rows("Triggers"):
        f = fields(e.value)
        if len(f) >= 2:
            add(e, "Triggers", f[1], "linked-trigger")
    for section, schema in OBJECT_FIELDS.items():
        for e in doc.rows(section):
            f = fields(e.value)
            if len(f) > schema.index("tag"):
                add(e, "Tags", f[schema.index("tag")], "object-tag")
    for e in doc.rows("CellTags"):
        add(e, "Tags", e.value, "cell-tag")
    for e in doc.rows("TeamTypes"):
        for key, target in (("Script", "ScriptTypes"), ("TaskForce", "TaskForces"), ("Tag", "Tags")):
            for member in doc.matches(e.value, key):
                value = member.value
                if target in ("ScriptTypes", "TaskForces"):
                    if fold(value) not in NULL_REFS:
                        edges.append({"from": member.location(), "to": {"section": value, "key": None},
                                      "kind": "team-" + key.lower(), "found_in_map": fold(value) in doc.names()})
                else:
                    add(member, target, value, "team-tag")
    return edges


def lint(doc: Document) -> list[dict]:
    issues = []

    def issue(code, message, e=None, severity="warning", **kw):
        row = {"severity": severity, "code": code, "message": message, **kw}
        if e:
            row.update(e.location())
        issues.append(row)

    if doc.encoding == "latin-1" and not doc.encoding_explicit:
        issue("encoding-uncertain", "Fallback Latin-1 decoding; confirm --encoding before editing.")
    seen = set()
    for section, index in doc.sections:
        if fold(section) in seen:
            issue("duplicate-section", "Section occurs more than once; no precedence assumed.", section=section, line=index + 1)
        seen.add(fold(section))
    seen = set()
    for e in doc.entries:
        pair = (fold(e.section), fold(e.key))
        if pair in seen:
            issue("duplicate-key", "Key occurs more than once; no precedence assumed.", e)
        seen.add(pair)
    for number in doc.unparsed:
        issue("unparsed-line", "Non-comment line could not be parsed.", line=number)
    for required in ("Map", "Basic"):
        if fold(required) not in doc.names():
            issue("missing-section", f"Missing [{required}].", severity="error")
    size = fields(doc.value("Map", "Size", ""))
    if len(size) != 4 or any(integer(x) is None for x in size) or any(int(x) <= 0 for x in size[2:]):
        issue("map-size", "Size must contain x,y,positive width,positive height.", severity="error")
    else:
        if int(size[2]) + int(size[3]) > 512:
            issue("map-size-engine-limit", "Width + height exceeds 512; verify target engine support.")
    for section, schema in OBJECT_FIELDS.items():
        for e in doc.rows(section):
            f = fields(e.value)
            if len(f) != len(schema):
                issue("object-fields", f"Expected {len(schema)} base fields, got {len(f)}; investigate extension or malformed row.", e)
            for key in ("health", "x", "y", "facing"):
                index = schema.index(key)
                if index >= len(f) or integer(f[index]) is None:
                    issue("object-number", f"Invalid or missing {key}.", e, severity="error")
            if len(f) > 2 and integer(f[2]) is not None and not 0 <= int(f[2]) <= 256:
                issue("unusual-health", "Health outside usual 0..256 range; may be intentional.", e)
    for section in ("Waypoints", "CellTags", "Terrain"):
        for e in doc.rows(section):
            encoded = e.value if section == "Waypoints" else e.key
            if integer(encoded) is not None and int(encoded) < 0:
                issue("coordinate-negative", "Negative coordinate exists in some shipped maps; preserve and verify its use in the target engine.", e)
                continue
            try:
                xy = coord(encoded)
                if not all(0 < n < 512 for n in xy.values()):
                    issue("coordinate-range", "Coordinate outside usual nonzero 512x512 storage range.", e)
            except ValueError:
                issue("coordinate-syntax", "Invalid decimal Y*1000+X coordinate.", e, severity="error")
    for section in ("TaskForces", "ScriptTypes", "TeamTypes"):
        for e in doc.rows(section):
            if fold(e.value) not in doc.names():
                issue("unresolved-definition", "Registry definition not present in map; check effective rules/AI.", e)
    for edge in reference_edges(doc):
        if not edge["found_in_map"]:
            issue("unresolved-reference", "Target not found in map; check effective environment before declaring it broken.",
                  **edge["from"], target=edge["to"])
    for e in doc.rows("Actions"):
        f = fields(e.value)
        n = integer(f[0])
        if n is None or n < 0 or len(f) != 1 + 8 * n:
            issue("action-arity", "Base YR action record needs count followed by 8 fields per action.", e)
    for e in doc.rows("Events"):
        f = fields(e.value)
        n = integer(f[0])
        if n is None or n < 0:
            issue("event-count", "Invalid event count.", e)
        # Events have variable arity. Do not apply an all-events 3-field rule.
    for name, _ in doc.sections:
        if packed(name):
            p = pack_info(doc, name)
            if not p["base64_valid"]:
                issue("pack-envelope", p["error"], section=name)
    return issues


def analyze(doc: Document, path: Path, detail=False) -> dict:
    objects = {}
    for section, schema in OBJECT_FIELDS.items():
        rows = []
        for e in doc.rows(section):
            f = fields(e.value)
            rows.append({**e.location(), "fields": dict(zip(schema, f)), "extra_fields": f[len(schema):]})
        item = {"count": len(rows), "by_type": dict(Counter(x["fields"].get("type", "") for x in rows)),
                "by_owner": dict(Counter(x["fields"].get("owner", "") for x in rows))}
        if detail:
            item["entries"] = rows
        objects[section] = item
    waypoints = []
    for e in doc.rows("Waypoints"):
        try:
            waypoints.append({**e.location(), **coord(e.value)})
        except ValueError:
            waypoints.append({**e.location(), "invalid_value": e.value})
    return {
        "tool_version": VERSION, "path": str(path.resolve()), "sha256": sha(doc.raw), "bytes": len(doc.raw),
        "encoding": doc.encoding, "roundtrip_identical": doc.text.encode(doc.encoding) == doc.raw,
        "basic": [{**e.location(), "value": e.value} for e in doc.rows("Basic")],
        "map": [{**e.location(), "value": e.value} for e in doc.rows("Map")],
        "sections": [{"name": s, "line": i + 1, "entries": len(doc.rows(s))} for s, i in doc.sections],
        "objects": objects, "waypoints": waypoints,
        "registries": {s: [{**e.location(), "id": e.value} for e in doc.rows(s)] for s in ("TeamTypes", "TaskForces", "ScriptTypes")},
        "references": reference_edges(doc),
        "packs": [pack_info(doc, s) for s, _ in doc.sections if packed(s)],
        "issues": lint(doc),
        "limitations": ["Packed terrain/overlay/preview contents not decompressed.",
                        "No passability, ore totals, playability or balance proof.",
                        "References cover tags, linked triggers and team definitions; action/event operands are not resolved.",
                        "Rules/AI/Mod inheritance and actual engine loading are not inferred."],
    }


def safe_token(value, kind):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError(f"Invalid {kind}")
    forbidden = "\r\n\x00;[]=" if kind != "value" else "\r\n\x00;"
    if any(c in value for c in forbidden) or any(ord(c) < 32 and c != "\t" for c in value) or (kind != "value" and value.startswith("#")):
        raise ValueError(f"Unsafe characters in {kind}")


def patch(doc: Document, plan: dict) -> tuple[Document, dict]:
    doc.require_map()
    if doc.encoding == "latin-1" and not doc.encoding_explicit:
        raise ValueError("Uncertain encoding; explicitly choose --encoding before editing.")
    if plan.get("schema_version") != 1 or plan.get("source_sha256") != sha(doc.raw):
        raise ValueError("Patch schema or source_sha256 mismatch; re-analyze the actual source.")
    ops = plan.get("operations")
    if not isinstance(ops, list) or not ops:
        raise ValueError("operations must be a nonempty list")
    changed = []
    current = doc
    touched = set()
    for op in ops:
        if not isinstance(op, dict) or op.get("op") not in {"set", "delete"}:
            raise ValueError("Only set and delete operations are supported")
        section, key = op.get("section"), op.get("key")
        safe_token(section, "section")
        safe_token(key, "key")
        if packed(section) or fold(section) == "digest" or (fold(section) == "map" and fold(key) in {"size", "localsize", "theater"}):
            raise ValueError("Geometry, packed blocks and Digest require a specialized editor workflow.")
        pair = (fold(section), fold(key))
        if pair in touched:
            raise ValueError("Each section/key may occur only once in a patch")
        touched.add(pair)
        if sum(fold(s) == fold(section) for s, _ in current.sections) > 1:
            raise ValueError("Ambiguous duplicate section")
        matches = current.matches(section, key)
        if len(matches) > 1:
            raise ValueError("Ambiguous duplicate key")
        old = matches[0].value if matches else None
        if "expect" not in op or op["expect"] != old:
            raise ValueError(f"Precondition failed for [{section}] {key}")
        if op["op"] == "delete" and not matches:
            raise ValueError("Cannot delete a missing key")
        new = op.get("value") if op["op"] == "set" else None
        if new is not None:
            if new != "":
                safe_token(new, "value")
        elif op["op"] == "set":
            raise ValueError("set needs a string value")
        lines = current.lines[:]
        if matches:
            e = matches[0]
            lines[e.index] = e.prefix + new + e.suffix + e.newline if op["op"] == "set" else ""
        else:
            positions = [(i, start) for i, (s, start) in enumerate(current.sections) if fold(s) == fold(section)]
            if positions:
                pos, _ = positions[0]
                at = current.sections[pos + 1][1] if pos + 1 < len(current.sections) else len(lines)
                if at and not lines[at - 1].endswith(("\n", "\r")):
                    lines[at - 1] += current.newline
                lines.insert(at, f"{key}={new}{current.newline}")
            else:
                if lines and not lines[-1].endswith(("\n", "\r")):
                    lines[-1] += current.newline
                lines.extend([f"[{section}]{current.newline}", f"{key}={new}{current.newline}"])
        current = Document("".join(lines).encode(doc.encoding), doc.encoding)
        changed.append({"section": section, "key": key, "before": old, "after": new})
    for name, _ in doc.sections:
        if packed(name) and doc.block_bytes(name) != current.block_bytes(name):
            raise ValueError(f"Protected block changed: {name}")
    after_issues = lint(current)
    before_errors = Counter((i["code"], i.get("section"), i.get("key"), i["message"]) for i in lint(doc) if i["severity"] == "error")
    after_errors = Counter((i["code"], i.get("section"), i.get("key"), i["message"]) for i in after_issues if i["severity"] == "error")
    if after_errors - before_errors:
        raise ValueError("Patch introduces structural errors; inspect with analyze before editing.")
    diff = "".join(difflib.unified_diff(doc.text.splitlines(True), current.text.splitlines(True), fromfile="source", tofile="edited"))
    return current, {"tool_version": VERSION, "source_sha256": sha(doc.raw), "output_sha256": sha(current.raw),
                     "changes": changed, "diff": diff, "packed_sections_unchanged": True, "issues_after": after_issues,
                     "digest_status": "preserved_but_stale_after_changes" if "digest" in doc.names() and doc.raw != current.raw else "unchanged_or_absent",
                     "validation": "Static checks only. Open in matching editor and smoke-test in target game."}


def file_info(path: Path, root: Path) -> dict:
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": sha(path.read_bytes()) if path.stat().st_size < 32 * 1024 * 1024 else None,
            "hash_scope": "full" if path.stat().st_size < 32 * 1024 * 1024 else "omitted-large-file"}


def profile(root: Path) -> dict:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("Game root must be a directory")
    root_files = [p for p in root.iterdir() if p.is_file()]
    extension_names = {"ares.dll", "phobos.dll", "ra2md.dll", "syringe.exe", "gamemd.exe", "cncnet-spawner.dll"}
    rules_names = {"rules.ini", "rulesmd.ini", "art.ini", "artmd.ini", "ai.ini", "aimd.ini"}
    editor = root / "Map Editor"
    extra = [editor / x for x in ("FA2sp.dll", "FinalAlert2YR.dat", "FinalAlert.ini", "FAData.ini", "FAData_TriggerAndScript.ini") if (editor / x).is_file()]
    maps_root = root / "Maps"
    counts = Counter(p.suffix.lower() for p in maps_root.rglob("*") if p.is_file() and p.suffix.lower() in {".map", ".yrm", ".mpr", ".mmx", ".yro"}) if maps_root.exists() else Counter()
    configs = [p for sub in ("INI/Map Code", "INI/Game Options") for p in (root / sub).glob("*.ini")]
    return {"tool_version": VERSION, "root": str(root), "classification": "unverified-game-or-mod",
            "binaries": [file_info(p, root) for p in root_files if fold(p.name) in extension_names],
            "loose_rules": [file_info(p, root) for p in root_files if fold(p.name) in rules_names],
            "archives": [file_info(p, root) for p in root_files if p.suffix.lower() == ".mix"],
            "editor": [file_info(p, root) for p in extra],
            "knowledge_root": str(editor / "mcp/knowledge") if (editor / "mcp/knowledge").is_dir() else None,
            "client_patches": [file_info(p, root) for p in configs], "maps_by_extension": dict(counts),
            "root_maps": [p.name for p in root_files if p.suffix.lower() in {".map", ".yrm", ".mpr"}],
            "limitations": ["Presence of a DLL does not prove it is loaded or identify its version.",
                            "Archive listing is not an effective rules load order; rules inside MIX are unresolved.",
                            "Editor-only supplemental rules and client game-mode patches must be kept distinct."]}


def resolve_layers(paths: list[Path], section: str, key: str, encoding=None) -> dict:
    history = []
    for path in paths:
        doc = Document.read(path, encoding)
        if sum(fold(s) == fold(section) for s, _ in doc.sections) > 1 or len(doc.matches(section, key)) > 1:
            raise ValueError(f"Ambiguous duplicate section/key in {path}")
        for e in doc.matches(section, key):
            history.append({"path": str(path.resolve()), "sha256": sha(doc.raw), **e.location(), "value": e.value})
    return {"section": section, "key": key, "history": history, "effective": history[-1] if history else None,
            "semantics": "Explicit ordered scalar layers only; later specified layers win. Engine load order, includes, inheritance and list merging not inferred."}


def write_new(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)


def emit(value, output=None):
    raw = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if output:
        write_new(output, raw)
        print(str(output.resolve()))
    else:
        print(raw.decode("utf-8"), end="")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=VERSION)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("analyze", "lint", "find", "patch"):
        sub = commands.add_parser(name)
        sub.add_argument("map", type=Path)
        sub.add_argument("--encoding")
        if name != "patch":
            sub.add_argument("--output", type=Path)
        if name == "analyze":
            sub.add_argument("--detail", action="store_true")
        if name == "find":
            sub.add_argument("token")
        if name == "patch":
            sub.add_argument("plan", type=Path)
            sub.add_argument("--apply", action="store_true")
            sub.add_argument("--output", type=Path)
    sub = commands.add_parser("profile")
    sub.add_argument("root", type=Path)
    sub.add_argument("--output", type=Path)
    sub = commands.add_parser("resolve")
    sub.add_argument("--layer", type=Path, action="append", required=True)
    sub.add_argument("--section", required=True)
    sub.add_argument("--key", required=True)
    sub.add_argument("--encoding")
    sub.add_argument("--output", type=Path)
    import ra2mod
    ra2mod.add_commands(commands)
    import ra2launcher
    ra2launcher.add_commands(commands)
    import ra2triggers
    ra2triggers.add_commands(commands)
    import ra2terrain
    ra2terrain.add_commands(commands)
    import ra2terrain_context
    ra2terrain_context.add_commands(commands)
    import ra2editor
    ra2editor.add_commands(commands)
    import ra2batch
    ra2batch.add_commands(commands)
    args = parser.parse_args(argv)
    try:
        if args.command == "editor-batch":
            result = ra2batch.run(args)
            emit(result)
            return 1 if result.get("success") is False else 0
        if args.command.startswith("editor-"):
            result = ra2editor.run(args)
            emit(result, None if args.command == "editor-run" and args.apply else args.output)
            return 1 if result.get("success") is False else 0
        if args.command in ("terrain-context", "terrain-compare"):
            result = ra2terrain_context.run(args)
            emit(result, args.output)
            return int(result.get('status') == 'differences-found')
        if args.command == "terrain":
            emit(ra2terrain.run(args), args.output)
            return 0
        if args.command == "trigger-graph":
            emit(ra2triggers.run(args), args.output)
            return 0
        if args.command.startswith("launcher-"):
            result = ra2launcher.run(args)
            emit(result)
            return 1 if result.get("healthy") is False else 0
        if args.command.startswith("mod-"):
            emit(ra2mod.run(args), args.output)
            return 0
        if args.command == "profile":
            emit(profile(args.root), args.output)
            return 0
        if args.command == "resolve":
            emit(resolve_layers(args.layer, args.section, args.key, args.encoding), args.output)
            return 0
        doc = Document.read(args.map, args.encoding)
        doc.require_map()
        if args.command == "analyze":
            emit(analyze(doc, args.map, args.detail), args.output)
        elif args.command == "lint":
            issues = lint(doc)
            emit({"path": str(args.map.resolve()), "sha256": sha(doc.raw), "issues": issues, "static_only": True}, args.output)
            return int(any(i["severity"] == "error" for i in issues))
        elif args.command == "find":
            if not args.token:
                raise ValueError("Search token must not be empty")
            matcher = re.compile(r"(?<![\w])" + re.escape(args.token) + r"(?![\w])", re.IGNORECASE)
            hits = [{**e.location(), "value": e.value} for e in doc.entries if not packed(e.section) and any(matcher.search(x) for x in (e.section, e.key, e.value))]
            emit({"path": str(args.map.resolve()), "token": args.token, "hits": hits, "interpretation": "Text references, not proof of engine use."}, args.output)
        elif args.command == "patch":
            plan = json.loads(args.plan.read_text(encoding="utf-8-sig"))
            if not isinstance(plan, dict):
                raise ValueError("Patch plan must be a JSON object")
            edited, report = patch(doc, plan)
            report["applied"] = False
            if args.apply:
                if not args.output or args.output.resolve() == args.map.resolve():
                    raise ValueError("--apply requires --output pointing to a new file, different from source")
                audit = Path(str(args.output) + ".audit.json")
                if args.output.exists() or audit.exists():
                    raise ValueError("Output or audit already exists; choose a fresh output path")
                if args.map.read_bytes() != doc.raw:
                    raise ValueError("Source changed during analysis; retry with a new plan")
                report.update(applied=True, source=str(args.map.resolve()), output=str(args.output.resolve()))
                write_new(args.output, edited.raw)
                emit(report, audit)
            else:
                emit(report)
        return 0
    except (OSError, ValueError, LookupError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
