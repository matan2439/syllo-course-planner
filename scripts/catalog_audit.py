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
        for past in (year - 1, year - 2):
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
        listing = f"{last_year}/{last_year + 1}: {last_name}" if last_year else f"not in {year - 1} or {year - 2} either"
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

    out = ROOT / "docs" / "data-audit" / "catalog-audit.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} · missing {len(missing)} · names {names} · offered {offered} · {counts}")


if __name__ == "__main__":
    main()
