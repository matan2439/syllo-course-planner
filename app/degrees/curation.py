"""Curation overlay: the explicit, reviewed hand corrections a degree's boards carry on top of
what the builder derives from spec + official facts.

``data/degrees/<institution>/<base>/<year>/curation.json`` is a JSON list of entries::

    {"board": "<board key>", "course_id": "0542-3620" | null, "field": "dotted.path",
     "value": <any>  |  "omit": true,
     "built": <the value the builder produced when the entry was written>  |  "built_missing": true,
     "retire": "post_migration" | null,
     "reason": "why this differs from the built value"}

* ``board`` is a key of ``degree.board_paths`` (``semester_board``, ``board``, ``early_years``),
  or a list of them when the same correction applies to several boards.
* With a ``course_id``, ``field`` is relative to every record of that course in the board
  (placed records and the repository pool). The special field ``placement`` takes a
  ``{semester_id: position}`` map and moves the course's placed record(s) there.
* With ``course_id: null``, ``field`` is a path from the board root. A ``name[key]`` segment
  selects the list item whose ``course_id`` / ``semester_id`` / ``category_id`` is ``key``.
* ``retire: "post_migration"`` marks an entry that only preserves history (a legacy link, an
  old summary, a migration annotation) and should go with the first real update; ``null`` marks
  a durable hand correction.

An entry applies only while the build still produces exactly the value it was written against
(``built`` / ``built_missing``). Anything else fails the build loudly (StaleCurationError): the
course or path is gone, the build now produces the overlay's own value (convergence), or the
build produces some other value (divergence: fresh official data must never be masked).
Entries apply in order (placements first), so ``built`` is the value at that point.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

PLACEMENT = "placement"
RETIRE_TAGS = ("post_migration", None)
_KEYS = {"board", "course_id", "field", "value", "omit", "built", "built_missing", "retire", "reason"}
_SEGMENT = re.compile(r"^([^\[\]]+)(?:\[([^\[\]]+)\])?$")
_ID_KEYS = ("course_id", "semester_id", "category_id")


class StaleCurationError(ValueError):
    """An overlay entry no longer matches what the build produces (gone, converged or diverged)."""


def curation_path(spec_file: Path) -> Path:
    return Path(spec_file).with_name("curation.json")


def load_curation(path: Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    entries = json.loads(path.read_text(encoding="utf-8"))
    validate_entries(entries)
    return entries


def entry_boards(entry: dict) -> list:
    board = entry.get("board")
    return list(board) if isinstance(board, list) else [board]


def validate_entries(entries: list[dict]) -> None:
    if not isinstance(entries, list):
        raise ValueError("curation overlay must be a JSON list of entries")
    seen: set[tuple] = set()
    for i, e in enumerate(entries):
        where = f"curation entry {i} ({e.get('board')}, {e.get('course_id')}, {e.get('field')})"
        unknown = set(e) - _KEYS
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
        if ("built" in e) == bool(e.get("built_missing")):
            raise ValueError(f"{where}: exactly one of built / built_missing: true")
        if e.get("omit") and e.get("built_missing"):
            raise ValueError(f"{where}: omit needs the built value it removes")
        if "value" in e and "built" in e and e["value"] == e["built"]:
            raise ValueError(f"{where}: value equals built (a no-op entry)")
        if "retire" not in e or e["retire"] not in RETIRE_TAGS:
            raise ValueError(f"{where}: retire must be \"post_migration\" or null")
        if e["field"] == PLACEMENT and (e.get("omit") or not isinstance(e.get("value"), dict)
                                        or not isinstance(e.get("built"), dict)):
            raise ValueError(f"{where}: placement takes {{semester_id: position}} value and built")
        for board in boards:
            key = (board, e.get("course_id"), e["field"])
            if key in seen:
                raise ValueError(f"{where}: duplicate (board, course_id, field) for {board}")
            seen.add(key)


# ---------------------------------------------------------------- paths

MISSING = object()


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


def _get(target: dict, path: str) -> Any:
    parent, last = _parent(target, path)
    return parent.get(last, MISSING)


def _set(target: dict, path: str, entry: dict) -> None:
    parent, last = _parent(target, path)
    if entry.get("omit"):
        del parent[last]
    else:
        parent[last] = copy.deepcopy(entry["value"])


def _same(a: Any, b: Any) -> bool:
    if a is MISSING or b is MISSING:
        return a is b
    return a == b


def _show(value: Any) -> str:
    return "<absent>" if value is MISSING else json.dumps(value, ensure_ascii=False)[:120]


# ---------------------------------------------------------------- apply


def _course_records(board: dict, course_id: str) -> list[dict]:
    out = [c for s in board.get("semesters", []) for c in s.get("courses", []) if c.get("course_id") == course_id]
    out += [c for c in board.get("metadata", {}).get("program_repository_courses", [])
            if c.get("course_id") == course_id]
    return out


def placement_of(board: dict, course_id: str) -> dict[str, int]:
    return {s["semester_id"]: i for s in board.get("semesters", [])
            for i, c in enumerate(s.get("courses", [])) if c.get("course_id") == course_id}


def _place(board: dict, course_id: str, positions: dict[str, int], label: str) -> None:
    sems = {s["semester_id"]: s for s in board.get("semesters", [])}
    unknown = set(positions) - set(sems)
    if unknown:
        raise StaleCurationError(f"{label}: unknown semesters {sorted(unknown)}")
    record = next(c for s in sems.values() for c in s["courses"] if c.get("course_id") == course_id)
    for s in sems.values():
        s["courses"] = [c for c in s["courses"] if c.get("course_id") != course_id]
    for sid, pos in sorted(positions.items(), key=lambda kv: kv[1]):
        sems[sid]["courses"].insert(pos, copy.deepcopy(record))


def current_values(board: dict, entry: dict) -> list[Any]:
    """What the build has at the entry's target right now (one value per course record)."""
    label = f"{entry.get('course_id') or '-'} {entry['field']}"
    if entry["field"] == PLACEMENT:
        current = placement_of(board, entry["course_id"])
        if not current:
            raise StaleCurationError(f"{label}: course is not placed in the built board")
        return [current]
    if entry.get("course_id"):
        records = _course_records(board, entry["course_id"])
        if not records:
            raise StaleCurationError(f"{label}: course not in the built board")
        return [_get(r, entry["field"]) for r in records]
    return [_get(board, entry["field"])]


def apply_entry(board: dict, entry: dict, board_key: str) -> None:
    label = f"curation[{board_key}] {entry.get('course_id') or '-'} {entry['field']}"
    wanted = MISSING if entry.get("omit") else entry["value"]
    expected = MISSING if entry.get("built_missing") else entry["built"]
    for cur in current_values(board, entry):
        if _same(cur, wanted):
            raise StaleCurationError(f"{label}: stale entry (the build already produces this)")
        if not _same(cur, expected):
            raise StaleCurationError(
                f"{label}: diverged: written against {_show(expected)}, the build now produces "
                f"{_show(cur)} (review the new value, then update or retire the entry)")
    if entry["field"] == PLACEMENT:
        _place(board, entry["course_id"], entry["value"], label)
    elif entry.get("course_id"):
        for rec in _course_records(board, entry["course_id"]):
            _set(rec, entry["field"], entry)
    else:
        _set(board, entry["field"], entry)


def board_entries(entries: list[dict], board_key: str) -> list[dict]:
    """This board's entries in application order: placements first, then fields (file order)."""
    mine = [e for e in entries if board_key in entry_boards(e)]
    return [e for e in mine if e["field"] == PLACEMENT] + [e for e in mine if e["field"] != PLACEMENT]


def apply_curation(board: dict, entries: list[dict], board_key: str) -> int:
    """Apply this board's entries in place. Raises StaleCurationError unless every entry still
    finds exactly the built value it was written against."""
    ordered = board_entries(entries, board_key)
    for e in ordered:
        apply_entry(board, e, board_key)
    return len(ordered)
