"""Curation overlay: the explicit, reviewed hand corrections a degree's boards carry on top of
what the builder derives from spec + official facts.

``data/degrees/<institution>/<base>/<year>/curation.json`` is a JSON list of entries::

    {"board": "<board key>", "course_id": "0542-3620" | null, "field": "dotted.path",
     "value": <any>  |  "omit": true,  "reason": "why this differs from the built value"}

* ``board`` is a key of ``degree.board_paths`` (``semester_board``, ``board``, ``early_years``),
  or a list of them when the same correction applies to several boards.
* With a ``course_id``, ``field`` is relative to every record of that course in the board
  (placed records and the repository pool). The special field ``placement`` takes a
  ``{semester_id: position}`` map and moves the course's placed record(s) there.
* With ``course_id: null``, ``field`` is a path from the board root. A ``name[key]`` segment
  selects the list item whose ``course_id`` / ``semester_id`` / ``category_id`` is ``key``.

Every entry must change the built board: an entry whose course or field no longer exists, or
whose value the builder already produces, is stale and fails the build loudly.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

PLACEMENT = "placement"
_SEGMENT = re.compile(r"^([^\[\]]+)(?:\[([^\[\]]+)\])?$")
_ID_KEYS = ("course_id", "semester_id", "category_id")


class StaleCurationError(ValueError):
    """An overlay entry targets something the build no longer produces (or already produces)."""


def curation_path(spec_file: Path) -> Path:
    return Path(spec_file).with_name("curation.json")


def load_curation(path: Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    entries = json.loads(path.read_text(encoding="utf-8"))
    validate_entries(entries)
    return entries


def validate_entries(entries: list[dict]) -> None:
    if not isinstance(entries, list):
        raise ValueError("curation overlay must be a JSON list of entries")
    seen: set[tuple] = set()
    for i, e in enumerate(entries):
        where = f"curation entry {i} ({e.get('board')}, {e.get('course_id')}, {e.get('field')})"
        unknown = set(e) - {"board", "course_id", "field", "value", "omit", "reason"}
        if unknown:
            raise ValueError(f"{where}: unknown keys {sorted(unknown)}")
        boards = entry_boards(e)
        if not boards or not all(isinstance(b, str) and b for b in boards):
            raise ValueError(f"{where}: board is required")
        if not isinstance(e.get("field"), str) or not e["field"]:
            raise ValueError(f"{where}: field is required")
        if not isinstance(e.get("reason"), str) or not e["reason"].strip():
            raise ValueError(f"{where}: reason is required")
        if ("value" in e) == bool(e.get("omit")):
            raise ValueError(f"{where}: exactly one of value / omit: true")
        if e["field"] == PLACEMENT and (e.get("omit") or not isinstance(e.get("value"), dict)):
            raise ValueError(f"{where}: placement takes a {{semester_id: position}} value")
        for board in boards:
            key = (board, e.get("course_id"), e["field"])
            if key in seen:
                raise ValueError(f"{where}: duplicate (board, course_id, field) for {board}")
            seen.add(key)


def entry_boards(entry: dict) -> list:
    board = entry.get("board")
    return list(board) if isinstance(board, list) else [board]


# ---------------------------------------------------------------- paths


def _segments(path: str) -> list[tuple[str, str | None]]:
    out = []
    for raw in path.split("."):
        m = _SEGMENT.match(raw)
        if not m:
            raise ValueError(f"bad path segment {raw!r} in {path!r}")
        out.append((m.group(1), m.group(2)))
    return out


def _select(items: Any, key: str, path: str) -> Any:
    if not isinstance(items, list):
        raise StaleCurationError(f"{path}: [{key}] applied to a non-list")
    for item in items:
        if isinstance(item, dict) and any(item.get(k) == key for k in _ID_KEYS):
            return item
    raise StaleCurationError(f"{path}: no list item [{key}]")


def _parent(root: dict, path: str) -> tuple[dict, str]:
    """The dict holding the path's last key, and that key (the last segment has no selector)."""
    segs = _segments(path)
    node: Any = root
    for name, key in segs[:-1]:
        if not isinstance(node, dict) or name not in node:
            raise StaleCurationError(f"{path}: {name!r} does not exist")
        node = node[name]
        if key is not None:
            node = _select(node, key, path)
    last, key = segs[-1]
    if key is not None:
        raise ValueError(f"{path}: the last segment cannot select a list item")
    if not isinstance(node, dict):
        raise StaleCurationError(f"{path}: parent is not an object")
    return node, last


_MISSING = object()


def _apply_at(target: dict, path: str, entry: dict) -> bool:
    """Set or omit ``path`` in ``target``. Returns True when it changed something."""
    parent, last = _parent(target, path)
    if entry.get("omit"):
        if last not in parent:
            return False
        del parent[last]
        return True
    if parent.get(last, _MISSING) == entry["value"]:
        return False
    parent[last] = copy.deepcopy(entry["value"])
    return True


# ---------------------------------------------------------------- apply


def _course_records(board: dict, course_id: str) -> list[dict]:
    out = [c for s in board.get("semesters", []) for c in s.get("courses", []) if c.get("course_id") == course_id]
    out += [c for c in board.get("metadata", {}).get("program_repository_courses", [])
            if c.get("course_id") == course_id]
    return out


def _place(board: dict, course_id: str, positions: dict[str, int], label: str) -> bool:
    sems = {s["semester_id"]: s for s in board.get("semesters", [])}
    unknown = set(positions) - set(sems)
    if unknown:
        raise StaleCurationError(f"{label}: unknown semesters {sorted(unknown)}")
    current = {sid: i for sid, s in sems.items() for i, c in enumerate(s["courses"]) if c.get("course_id") == course_id}
    if not current:
        raise StaleCurationError(f"{label}: course is not placed in the built board")
    if current == positions:
        return False
    record = next(c for s in sems.values() for c in s["courses"] if c.get("course_id") == course_id)
    for s in sems.values():
        s["courses"] = [c for c in s["courses"] if c.get("course_id") != course_id]
    for sid, pos in sorted(positions.items(), key=lambda kv: kv[1]):
        sems[sid]["courses"].insert(pos, copy.deepcopy(record))
    return True


def apply_curation(board: dict, entries: list[dict], board_key: str) -> int:
    """Apply this board's entries in place; raise StaleCurationError for any no-op entry."""
    mine = [e for e in entries if board_key in entry_boards(e)]
    ordered = [e for e in mine if e["field"] == PLACEMENT] + [e for e in mine if e["field"] != PLACEMENT]
    for e in ordered:
        label = f"curation[{board_key}] {e.get('course_id') or '-'} {e['field']}"
        if e["field"] == PLACEMENT:
            changed = _place(board, e["course_id"], e["value"], label)
        elif e.get("course_id"):
            records = _course_records(board, e["course_id"])
            if not records:
                raise StaleCurationError(f"{label}: course not in the built board")
            changed = False
            for rec in records:
                changed |= _apply_at(rec, e["field"], e)
        else:
            changed = _apply_at(board, e["field"], e)
        if not changed:
            raise StaleCurationError(f"{label}: stale entry (the build already produces this)")
    return len(mine)
