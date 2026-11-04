"""Coverage suggestions: auto-map only the evidence items whose spec home is unambiguous.

Everything not returned here (section texts, rule texts, course notes, policies, cancelled
or unknown courses) is left for a human or AI reviewer to map or mark ``not_planning_rule``.
"""
from typing import Any

from app.degrees.evidence import EvidenceItem
from app.degrees.spec import CoverageEntry, DegreeSpec, MappedTo

_COURSE_KINDS = ("course_listing", "course_fact")
_GENERAL = "general_requirement"


def _course_homes(spec: DegreeSpec) -> dict[str, list[str]]:
    """course id -> every spec path that holds it."""
    homes: dict[str, list[str]] = {}
    for m in spec.mandatory_courses:
        homes.setdefault(m.course_id, []).append(f"mandatory_courses[{m.course_id}]")
    for cat in spec.categories:
        for cid in cat.course_ids:
            homes.setdefault(cid, []).append(f"categories[{cat.category_id}].course_ids[{cid}]")
    for cid in (spec.general_requirement or {}).get("course_ids", []):
        homes.setdefault(cid, []).append(_GENERAL)
    return {cid: list(dict.fromkeys(paths)) for cid, paths in homes.items()}


def _legacy_ramaids(node: Any, out: dict[str, set[str]]) -> dict[str, set[str]]:
    """ramaid -> category ids, from every legacy dict naming both a ``ramaid`` and a ``category_id``."""
    if isinstance(node, dict):
        if node.get("ramaid") is not None and node.get("category_id"):
            out.setdefault(str(node["ramaid"]), set()).add(str(node["category_id"]))
        for value in node.values():
            _legacy_ramaids(value, out)
    elif isinstance(node, list):
        for value in node:
            _legacy_ramaids(value, out)
    return out


def _ramaid(item: EvidenceItem) -> str | None:
    parts = item.id.split(":")
    return parts[parts.index("rama") + 1] if "rama" in parts[:-1] else None


def suggest_coverage(items: list[EvidenceItem], spec: DegreeSpec) -> dict[str, CoverageEntry]:
    """Suggested coverage entries for the unambiguous items only.

    * a ``course_listing`` / ``course_fact`` (timetable, IMS) item for a course the spec holds
      in exactly one place -> that place (``mandatory_courses[<id>]``,
      ``categories[<cat>].course_ids[<id>]`` or ``general_requirement``); cancelled listings
      and courses with several homes are left out;
    * a ``section`` item whose ``ramaid`` the spec's legacy names with exactly one category
      -> ``categories[<cat>]``;
    * a course note carrying ``data.core_of_track`` whose course is listed by exactly one
      ``distinct_categories`` course rule -> ``course_rules[<rule>]``.
    """
    homes = _course_homes(spec)
    sections = _legacy_ramaids(spec.legacy, {})
    known_categories = {c.category_id for c in spec.categories}
    out: dict[str, CoverageEntry] = {}
    for item in items:
        if item.kind in _COURSE_KINDS:
            paths = homes.get(item.course_id or "", [])
            if len(paths) == 1 and not item.cancelled:
                out[item.id] = MappedTo(mapped_to=paths[0])
        elif item.kind == "rule_text" and item.data.get("core_of_track") and item.course_id:
            # a core-of-track course note: the one distinct_categories rule that lists the course
            rules = [r.rule_id for r in spec.course_rules
                     if r.kind == "distinct_categories" and item.course_id in r.course_ids]
            if len(rules) == 1:
                out[item.id] = MappedTo(mapped_to=f"course_rules[{rules[0]}]")
        elif item.kind == "section":
            cats = sections.get(_ramaid(item) or "", set()) & known_categories
            if len(cats) == 1:
                out[item.id] = MappedTo(mapped_to=f"categories[{cats.pop()}]")
    return out
