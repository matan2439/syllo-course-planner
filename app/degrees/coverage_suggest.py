"""Coverage suggestions: auto-map only the evidence items whose spec home is unambiguous.

Everything not returned here (section texts, rule texts, course notes, policies, cancelled
or unknown courses) is left for a human or AI reviewer to map or mark ``not_planning_rule``.
"""
from typing import Any, NamedTuple

from app.degrees.evidence import EvidenceItem, strip_html
from app.degrees.spec import CoverageEntry, DegreeSpec, MappedTo, NotPlanningRule, resolve_spec_path

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


def _locations(item: EvidenceItem, by_id: dict[str, EvidenceItem]) -> set[str]:
    """The normalized section titles an item is listed under: the last element of its path, plus
    the last element of every other location of a repeated section (``data.also_at`` on the item
    itself, or on its section item ``<...>:rama:<rid>`` when the item is ``<...>:rama:<rid>:kurs:<x>``)."""
    paths = [list(item.path)]
    section = by_id.get(item.id.rsplit(":kurs:", 1)[0]) if ":kurs:" in item.id else None
    for holder in (item, section):
        for loc in (holder.data.get("also_at") or []) if holder is not None else []:
            if isinstance(loc, str):
                paths.append(loc.split(" > "))
            elif isinstance(loc, dict) and isinstance(loc.get("path"), list):
                paths.append(loc["path"])
    return {strip_html(str(p[-1])) for p in paths if p} - {""}


def _course_suggestion(item: EvidenceItem, spec: DegreeSpec, paths: list[str],
                       by_id: dict[str, EvidenceItem]) -> MappedTo | None:
    if item.cancelled or not paths:
        return None
    if len(paths) == 1:
        return MappedTo(mapped_to=paths[0])
    cid = item.course_id
    mandatory = f"mandatory_courses[{cid}]"
    if item.kind == "course_fact":
        # a timetable / IMS fact describes the course, wherever the spec places it
        if mandatory in paths:
            return MappedTo(mapped_to=mandatory)
        return MappedTo(mapped_to=paths)
    # a listing belongs to the one category (holding the course) its section is named after
    where = _locations(item, by_id)
    cats = [c.category_id for c in spec.categories if cid in c.course_ids and strip_html(c.name_he) in where]
    if len(cats) == 1:
        return MappedTo(mapped_to=f"categories[{cats[0]}].course_ids[{cid}]")
    return None


def suggest_coverage(items: list[EvidenceItem], spec: DegreeSpec) -> dict[str, CoverageEntry]:
    """Suggested coverage entries for the unambiguous items only.

    * a ``course_listing`` / ``course_fact`` (timetable, IMS) item for a course the spec holds
      in exactly one place -> that place (``mandatory_courses[<id>]``,
      ``categories[<cat>].course_ids[<id>]`` or ``general_requirement``); cancelled items are
      left out;
    * a course the spec holds in several places: a ``course_listing`` -> the one category holding
      it whose ``name_he`` is the section it is listed under (the last path element, or a repeated
      section's other locations; HTML-stripped, whitespace-collapsed) - none or several -> left
      out; a ``course_fact`` -> ``mandatory_courses[<id>]`` if mandatory, else every home;
    * a ``section`` item whose ``ramaid`` the spec's legacy names with exactly one category
      -> ``categories[<cat>]``;
    * a course note carrying ``data.core_of_track`` whose course is listed by exactly one
      ``distinct_categories`` course rule -> ``course_rules[<rule>]``.
    """
    homes = _course_homes(spec)
    sections = _legacy_ramaids(spec.legacy, {})
    known_categories = {c.category_id for c in spec.categories}
    by_id = {i.id: i for i in items}
    out: dict[str, CoverageEntry] = {}
    for item in items:
        if item.kind in _COURSE_KINDS:
            suggestion = _course_suggestion(item, spec, homes.get(item.course_id or "", []), by_id)
            if suggestion is not None:
                out[item.id] = suggestion
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


class Reuse(NamedTuple):
    copied: dict[str, CoverageEntry]       # entries to add here
    needs_review: dict[str, CoverageEntry]  # the other degree's entries whose targets do not all resolve here
    differing: list[str]                    # ids the other degree maps whose evidence text differs here


def reuse_coverage(items: list[EvidenceItem], spec: DegreeSpec,
                   other_items: list[EvidenceItem], other_spec: DegreeSpec) -> Reuse:
    """Another degree's coverage entries for the evidence both degrees share verbatim.

    Only ids present in both evidence sets with identical ``raw_text``, mapped by the other spec
    and not yet covered here, are considered. A ``not_planning_rule`` entry copies as-is; a
    ``mapped_to`` entry copies only when every target resolves in THIS spec, else it needs review.
    Nothing here is ever overwritten.
    """
    theirs = {i.id: i for i in other_items}
    copied: dict[str, CoverageEntry] = {}
    needs_review: dict[str, CoverageEntry] = {}
    differing: list[str] = []
    for item in items:
        other, entry = theirs.get(item.id), other_spec.coverage.get(item.id)
        if other is None or entry is None or item.id in spec.coverage:
            continue
        if other.raw_text != item.raw_text:
            differing.append(item.id)
        elif isinstance(entry, NotPlanningRule) or (
                entry.targets and all(resolve_spec_path(spec, t) for t in entry.targets)):
            copied[item.id] = entry
        else:
            needs_review[item.id] = entry
    return Reuse(copied, needs_review, differing)
