"""
Compare our course data with TAU's official catalog and write a reviewable report:
docs/data-audit/catalog-audit.md.

    python3 scripts/catalog_audit.py --cache <dir>

Reads data/prerequisites/tau.json (scripts/ingest_prerequisites.py) and, for course numbers
missing from this year's catalog, the earlier-year listings cached under <dir>/history
(<course>_<year>.html). Nothing is inferred from a name alone: a same-name match is reported
as a CANDIDATE renumbering for a person to confirm, never applied.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.parsing.tau_prerequisites import parse_catalog_listing  # noqa: E402

BOARDS = ["mechanical_engineering_2027", "mechanical_engineering_years_1_2_2027",
          "electrical_engineering_2027", "electrical_engineering_years_1_2_2027"]


def norm(name: str | None) -> str:
    return re.sub(r"[\s\"'׳״.\-–()]+", "", name or "").lower()


def refs(expression) -> list[str]:
    if not expression:
        return []
    if "course" in expression:
        return [expression["course"]]
    return [ref for child in expression.get("all", expression.get("any", [])) for ref in refs(child)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads((ROOT / "data" / "prerequisites" / "tau.json").read_text(encoding="utf-8"))
    courses, external = data["courses"], data["referenced_courses"]
    year = data["catalog_year"]

    board_rows: dict[str, dict] = {}
    for board_id in BOARDS:
        board = json.loads((ROOT / "data" / "boards" / f"{board_id}.json").read_text(encoding="utf-8"))
        placed = {course["course_id"] for semester in board["semesters"] for course in semester["courses"]}
        for record in board["metadata"].get("program_repository_courses", []) + [c for s in board["semesters"] for c in s["courses"]]:
            row = board_rows.setdefault(record["course_id"], {"name_he": record.get("name_he"), "offered": set(), "offered_in_year": record.get("offered_in_year"),
                                                              "placed": False, "mandatory": False})
            row["offered"] |= {str(term)[-1].upper() for term in record.get("offered_semesters") or []}
            row["placed"] |= record["course_id"] in placed
            row["mandatory"] |= record.get("course_type") == "mandatory" or record.get("is_mandatory") is True

    by_name: dict[str, list[str]] = {}
    for course_id, record in {**external, **courses}.items():
        catalog = record.get("catalog") or {}
        if catalog.get("found"):
            by_name.setdefault(norm(catalog["name_he"]), []).append(course_id)

    required_by: dict[str, list[str]] = {}
    for course_id, record in courses.items():
        for ref in set(refs(record.get("expression")) + refs(record.get("corequisites"))):
            required_by.setdefault(ref, []).append(course_id)

    def history(course_id: str) -> tuple[int | None, str | None]:
        for past in range(year - 1, year - 7, -1):
            path = args.cache / "history" / f"{course_id}_{past}.html"
            if path.exists():
                listing = parse_catalog_listing(path.read_text(encoding="utf-8", errors="replace"))
                if listing["found"]:
                    return past, listing["name_he"]
        return None, None

    missing = sorted(course_id for course_id, record in {**external, **courses}.items()
                     if (record.get("catalog") or {}).get("found") is False)
    lines = [f"# Catalog audit — academic year {year}/{year + 1}", "",
             f"Generated {data['generated_at']} from TAU's official registrar pages. Regenerate with `python3 scripts/catalog_audit.py --cache <dir>`.", "",
             "Nothing in this report is applied automatically. A candidate renumbering is a same-official-name match that a person must confirm.", ""]

    lines += ["## 1. Course numbers missing from this year's official catalog", "",
              "| Course | Name (ours / registrar) | Role in our data | Last official listing | Candidate in this year's catalog | Verdict |", "|---|---|---|---|---|---|"]
    counts = {"candidate": 0, "unresolved": 0, "retired": 0}
    for course_id in missing:
        ours = board_rows.get(course_id, {})
        registrar_names = {record.get("course_names", {}).get(course_id) for record in courses.values()} - {None}
        last_year, last_name = history(course_id)
        name = ours.get("name_he") or last_name or next(iter(registrar_names), None)
        role = []
        if ours:
            role.append("mandatory, placed on a board" if ours["mandatory"] and ours["placed"] else "placed on a board" if ours["placed"] else "catalog course on a board")
        if required_by.get(course_id):
            role.append(f"prerequisite of {len(required_by[course_id])} course(s): {', '.join(sorted(required_by[course_id])[:4])}")
        candidates = sorted({candidate for known in ({name, last_name} | registrar_names) - {None}
                             for candidate in by_name.get(norm(known), []) if candidate != course_id})
        if candidates:
            verdict = "Candidate renumbering — confirm"
            counts["candidate"] += 1
        elif required_by.get(course_id):
            verdict = "Unresolved: required by current courses but not in the catalog"
            counts["unresolved"] += 1
        else:
            verdict = "Not offered this year (no action unless planned)"
            counts["retired"] += 1
        listing = f"{last_year}/{last_year + 1}: {last_name}" if last_year else f"not listed {year - 6}–{year - 1}"
        lines.append(f"| {course_id} | {name or '—'} | {'; '.join(role) or '—'} | {listing} | {', '.join(candidates) or '—'} | {verdict} |")
    lines += ["", f"Totals: {len(missing)} missing · {counts['candidate']} candidate renumberings · {counts['unresolved']} unresolved prerequisites · {counts['retired']} simply not offered this year.", ""]

    lines += ["## 2. Name differences (course in the catalog, our name differs)", "", "| Course | Our name | Official name |", "|---|---|---|"]
    names = 0
    for course_id, record in sorted(courses.items()):
        catalog = record.get("catalog") or {}
        ours = board_rows.get(course_id, {}).get("name_he")
        if catalog.get("found") and ours and norm(ours) != norm(catalog["name_he"]):
            lines.append(f"| {course_id} | {ours} | {catalog['name_he']} |")
            names += 1
    lines += ["", f"{names} name difference(s).", ""]

    lines += ["## 3. Offered-semester differences (availability)", "",
              "Our boards against the semesters the official listing shows groups in this year.", "",
              "| Course | Name | Our semesters | Official semesters |", "|---|---|---|---|"]
    offered = 0
    for course_id, record in sorted(courses.items()):
        catalog = record.get("catalog") or {}
        ours = board_rows.get(course_id)
        if not catalog.get("found") or not ours:
            continue
        official = {term for term in catalog["semesters"] if term in ("A", "B")}
        if "ANNUAL" in catalog["semesters"]:
            official |= {"A", "B"}
        mine = set() if ours["offered_in_year"] is False else ours["offered"] & {"A", "B"}
        if mine and official and mine != official:
            lines.append(f"| {course_id} | {ours['name_he']} | {', '.join(sorted(mine))} | {', '.join(sorted(official))} |")
            offered += 1
        elif ours["offered_in_year"] is False and official:
            lines.append(f"| {course_id} | {ours['name_he']} | marked not offered | {', '.join(sorted(official))} |")
            offered += 1
    lines += ["", f"{offered} difference(s).", ""]

    # ── 4. Proposed equivalences ────────────────────────────────────────────────────────────
    def contexts(expression, target, parent=None, found=None):
        found = [] if found is None else found
        if not expression:
            return found
        if "course" in expression:
            if expression["course"] == target:
                found.append(parent)
            return found
        kind = "all" if "all" in expression else "any"
        for child in expression[kind]:
            contexts(child, target, (kind, [item.get("course") for item in expression[kind] if "course" in item]), found)
        return found

    in_catalog = lambda course_id: ({**external, **courses}.get(course_id, {}).get("catalog") or {}).get("found") is True  # noqa: E731
    official_name = lambda course_id: ({**external, **courses}.get(course_id, {}).get("catalog") or {}).get("name_he")  # noqa: E731
    registrar_name = lambda course_id: next((record["course_names"][course_id] for record in courses.values()  # noqa: E731
                                             if course_id in record.get("course_names", {})), None)
    program_of = lambda course_id: ", ".join(b.replace("_2027", "") for b in courses.get(course_id, {}).get("boards", [])) or "outside our programs"  # noqa: E731

    approved = json.loads((ROOT / "data" / "prerequisites" / "equivalences.json").read_text(encoding="utf-8"))
    lines += ["## 4a. Approved equivalences (consumed by the shadow audit)", "",
              "`registrar_listed` = the registrar itself lists the numbers as alternatives. **`inferred` = NOT stated by the university**: the project owner approved it on the evidence below, and every use is reported as inferred in the shadow audit and in the agent's pathway tool.", "",
              "| Retired | Accepted current course(s) | Status | Programs | Evidence |", "|---|---|---|---|---|"]
    for entry in approved.get("equivalences", []):
        accepted = ", ".join(f"{a['course_id']} {a.get('name_he', '')}" for a in entry["accepts"])
        scope = ", ".join(entry.get("scope_programs", [])) or "all"
        status = "**INFERRED (not official)**" if entry["status"] == "inferred" else "registrar-listed"
        evidence = (entry.get("evidence") or "").replace("|", "/").replace("\n", " ")
        lines.append(f"| {entry['retired']} {entry.get('name_he', '')} | {accepted} | {status} | {scope} | {evidence} |")
    lines += ["", "Still unresolved (satisfy nothing):", ""]
    for entry in approved.get("unresolved", []):
        lines.append(f"- {entry['retired']} {entry.get('name_he', '')} — {entry.get('reason', '')}")
    lines.append("")

    proposals = []
    lines += ["## 4. Proposed equivalences for retired prerequisite numbers — FOR APPROVAL, not applied", "",
              "A retired number needs a mapping only where the registrar requires it with no current alternative. Evidence levels:", "",
              "- **Registrar-listed alternative**: in other official requirements the registrar lists the retired number and the current course as alternatives (\"או\"). Official, but stated per requirement, not as a general equivalence.",
              "- **Same official name**: the current catalog has a course with the identical official name. Inferred.",
              "- **Similar name**: names differ; listed only as a lead. Uncertain.", "",
              "| Retired number | Registrar's name | Required without an alternative by | Proposed current course | Evidence | Status |", "|---|---|---|---|---|---|"]
    for course_id in missing:
        if course_id in courses:  # a board course that is simply not offered this year
            continue
        alone_in, siblings = [], {}
        for dependent, record in courses.items():
            for kind in ("expression", "corequisites"):
                for parent in contexts(record.get(kind), course_id):
                    if parent and parent[0] == "any":
                        for sibling in parent[1]:
                            if sibling != course_id and in_catalog(sibling):
                                siblings.setdefault(sibling, set()).add(dependent)
                    else:
                        alone_in.append(dependent)
        name = registrar_name(course_id)
        same = [c for c in by_name.get(norm(name), []) if c != course_id]
        similar = sorted((c for names_ in by_name.items() for c in names_[1]
                          if c not in same and c != course_id and name
                          and difflib.SequenceMatcher(None, norm(name), names_[0]).ratio() >= 0.8), key=str)
        last_year, _ = history(course_id)
        seen = f"last listed {last_year}/{last_year + 1}" if last_year else f"not listed {year - 6}–{year - 1}"
        if not alone_in:
            lines.append(f"| {course_id} | {name} | — (always listed with a current alternative: {', '.join(sorted(siblings)) or '—'}) | none needed | {seen} | No mapping needed |")
            continue
        candidates = []
        for sibling in sorted(siblings, key=lambda c: -len(siblings[c])):
            candidates.append((sibling, f"registrar-listed alternative in {len(siblings[sibling])} requirement(s), e.g. {sorted(siblings[sibling])[0]}"
                               + ("; same official name" if sibling in same else ""), "Registrar-listed alternative"))
        for candidate in same:
            if candidate not in siblings:
                candidates.append((candidate, "same official name", "Inferred (same official name)"))
        for candidate in similar:
            if candidate not in siblings:
                candidates.append((candidate, f"similar name: {official_name(candidate)}", "Uncertain (similar name only)"))
        dependents = ", ".join(sorted(set(alone_in)))
        if not candidates:
            lines.append(f"| {course_id} | {name} | {dependents} | — | {seen}; no current course found | **Unresolved** |")
            proposals.append({"retired": course_id, "name_he": name, "required_by": sorted(set(alone_in)), "candidates": [], "status": "unresolved"})
            continue
        for index, (candidate, evidence, status) in enumerate(candidates):
            lines.append(f"| {course_id if index == 0 else ''} | {name if index == 0 else ''} | {dependents if index == 0 else ''} | {candidate} {official_name(candidate)} ({program_of(candidate)}) | {evidence}; {seen} | {status}{' — one of several candidates' if len(candidates) > 1 else ''} |")
        proposals.append({"retired": course_id, "name_he": name, "required_by": sorted(set(alone_in)),
                          "candidates": [{"course_id": c, "name_he": official_name(c), "evidence": e, "status": st} for c, e, st in candidates],
                          "status": "proposed"})
    lines += ["", "Where several candidates are listed they are faculty variants of the same subject (for example calculus for mechanical vs. electrical engineering); the mapping would accept any of them, as the registrar's own alternative lists do.", ""]

    lines += ["## 5. Real prerequisites outside our programs", "",
              "Courses in this year's catalog that a board course requires with no alternative, but that no supported board carries. Not an equivalence problem: the student must have completed them.", "",
              "| Outside course | Official name | Required by |", "|---|---|---|"]
    outside = 0
    for course_id, record in sorted(external.items()):
        if not in_catalog(course_id):
            continue
        alone = sorted({dependent for dependent, row in courses.items() for kind in ("expression", "corequisites")
                        for parent in contexts(row.get(kind), course_id) if not (parent and parent[0] == "any")})
        if alone:
            lines.append(f"| {course_id} | {official_name(course_id)} | {', '.join(alone)} |")
            outside += 1
    lines += ["", f"{outside} outside prerequisite(s).", ""]
    (ROOT / "data" / "prerequisites" / "equivalences.proposed.json").write_text(
        json.dumps({"status": "PROPOSED — not consumed by any code until approved", "catalog_year": year, "proposals": proposals},
                   ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    out = ROOT / "docs" / "data-audit" / "catalog-audit.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} · missing {len(missing)} · names {names} · offered {offered} · {counts}")


if __name__ == "__main__":
    main()
