#!/usr/bin/env python3
"""
Refresh per-course facts (offered semesters, weekly hours, credits, syllabus
links) from TAU's official sources for the current academic year, audit the
committed boards against them, and optionally apply the corrections.

Sources (TAU year code: 2026 == תשפ"ז / 2026-2027):
  * IMS course search  ims.tau.ac.il/tal/kr/search_l.aspx?course_num=..&year=..
      -> which semesters have groups this year, syllabus link, "not offered"
  * tochniot GraphQL ydtochnit (tcid 8715, shana=year)
      -> weekly hours (shaotuni), credits (mishkal), teaching format

Usage:
    python scripts/refresh_course_data.py                 # fetch + audit (read-only for boards)
    python scripts/refresh_course_data.py --apply         # also patch the board JSON files
    python scripts/refresh_course_data.py --offline       # use cached HTML/JSON only

Outputs:
    data/official/tau_course_facts_{year}.json            # normalized official facts
    data/import_reports/course_data_review_{year}.{json,md}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.parsing.course_search_parser import parse_course_search_result  # noqa: E402
from app.scraping.tau_client import build_course_search_url, fetch_url  # noqa: E402
from app.scraping.tau_program_scraper import fetch_program_data  # noqa: E402

ACADEMIC_YEAR = 2026  # TAU year code for תשפ"ז (2026-2027) — verified against IMS page header
PROGRAM_TCID = "8715"  # Mechanical Engineering

BOARDS = [
    ROOT / "data" / "parsed_json" / "mechanical_semester_board_2027.json",
    ROOT / "data" / "boards" / "mechanical_engineering_2027.json",
]
SHAAR_RUACH_SOURCE = ROOT / "data" / "general_courses_shaar_ruach.json"
IMS_CACHE = ROOT / "data" / "raw_html" / "course_details"
OFFICIAL_DIR = ROOT / "data" / "official"
REPORT_DIR = ROOT / "data" / "import_reports"

NOT_OFFERED_MARKER = "אין נתונים מתאימים"
_SEM_LETTER = {"א": "A", "ב": "B"}
_SUFFIX = {"A": "_semester_a", "B": "_semester_b"}


def digits(course_id: str) -> str:
    return re.sub(r"\D", "", course_id)


def dashed(raw: str) -> str:
    d = digits(raw)
    return f"{d[:4]}-{d[4:]}" if len(d) == 8 else raw


# ---------------------------------------------------------------------------
# Official source readers
# ---------------------------------------------------------------------------

def semesters_from_groups(group_semesters: list[str | None]) -> list[str]:
    """Map IMS group semester labels ("א'", "ב'", "שנתי") to sorted A/B letters."""
    out: set[str] = set()
    for label in group_semesters:
        label = (label or "").strip()
        if "שנתי" in label:
            out.update({"A", "B"})
            continue
        letter = _SEM_LETTER.get(label[:1])
        if letter:
            out.add(letter)
    return sorted(out)


def read_ims(course_id: str, year: int, offline: bool) -> dict:
    """Offering facts for one course from the IMS course-search page."""
    d = digits(course_id)
    url = build_course_search_url(d, year)
    cache = IMS_CACHE / f"course_{d}_{year}.html"
    if offline and not cache.exists():
        return {"status": "unknown", "url": url, "reason": "not cached"}
    try:
        was_cached = cache.exists()
        html = fetch_url(url, cache)
        if not was_cached:
            time.sleep(0.5)  # be polite to IMS
    except RuntimeError as exc:
        return {"status": "unknown", "url": url, "reason": f"fetch failed: {exc}"}

    if NOT_OFFERED_MARKER in html:
        return {"status": "not_offered", "url": url, "offered_semesters": []}
    parsed = parse_course_search_result(html, year)
    if parsed is None:
        return {"status": "unknown", "url": url, "reason": "unparseable page"}
    semesters = semesters_from_groups([g.semester for g in parsed.groups])
    syllabus = next((g.syllabus_url for g in parsed.groups if g.syllabus_url), None)
    return {
        "status": "offered" if semesters else "unknown",
        "url": url,
        "offered_semesters": semesters,
        "syllabus_url": syllabus,
        "name_he": parsed.name_hebrew,
    }


def read_program(year: int, offline: bool) -> dict[str, dict]:
    """course_id -> {weekly_hours, credits, teaching_format} from ydtochnit."""
    cache = ROOT / "data" / "raw_html" / f"tau_program_{PROGRAM_TCID}_{year}.json"
    if offline and not cache.exists():
        return {}
    body = fetch_program_data(PROGRAM_TCID, str(year), cache_path=cache)
    if isinstance(body, str):
        body = json.loads(body)

    out: dict[str, dict] = {}

    def walk(node: dict) -> None:
        for k in node.get("kurs") or []:
            if (k.get("mevutal") or "0") == "1":
                continue
            fmt = [
                {"type": k[f"ofenhoraa{i}"].strip(), "hours": _num(k.get(f"shaot{i}"))}
                for i in (1, 2, 3)
                if (k.get(f"ofenhoraa{i}") or "").strip()
            ]
            out.setdefault(dashed(k.get("kursshow") or k.get("kursid") or ""), {
                "weekly_hours": _num(k.get("shaotuni")),
                "credits": _num(k.get("mishkal")),
                "teaching_format": fmt,
            })
        for child in node.get("rama") or []:
            walk(child)

    for prog in body or []:
        walk(prog)
    return out


def _num(v) -> float | int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


# ---------------------------------------------------------------------------
# Board traversal + comparison
# ---------------------------------------------------------------------------

def board_courses(board: dict):
    """Yield (location, course) for every course record in a board."""
    for sem in board.get("semesters", []):
        for c in sem.get("courses", []):
            yield sem["semester_id"], c
    for c in board.get("metadata", {}).get("program_repository_courses", []):
        yield "pool", c


def official_facts(course_ids: list[str], year: int, offline: bool) -> dict[str, dict]:
    program = read_program(year, offline)
    facts: dict[str, dict] = {}
    for i, cid in enumerate(sorted(course_ids), 1):
        print(f"[{i}/{len(course_ids)}] {cid}", flush=True)
        ims = read_ims(cid, year, offline)
        facts[cid] = {"ims": ims, "program": program.get(cid)}
    return facts


def expected_fields(course: dict, fact: dict, year: int) -> dict:
    """The official values a board record should hold. Only keys we can vouch for."""
    ims, prog = fact["ims"], fact["program"]
    exp: dict = {}
    if ims["status"] == "not_offered":
        exp["offered_in_year"] = False
    elif ims["status"] == "offered":
        exp["offered_in_year"] = True
        # Annual courses list groups only in the semester they open; the span is program data.
        if not is_annual(course):
            exp["offered_semesters"] = ims["offered_semesters"]
        if ims.get("syllabus_url"):
            exp["syllabus_url"] = ims["syllabus_url"]
    if not course.get("name_he") and ims.get("name_he"):
        exp["name_he"] = ims["name_he"]
    # ponytail: שער רוח weekly_hours is a program rule (2h each), not a timetable fact — never overwritten here.
    if prog and course.get("source") != "shaar_ruach_general_requirement":
        if prog["weekly_hours"] is not None:
            exp["weekly_hours"] = prog["weekly_hours"]
        if prog["credits"] is not None:
            exp["credits"] = prog["credits"]
    return exp


def is_annual(course: dict) -> bool:
    return bool(course.get("is_annual")) or course.get("placement_policy") == "annual"


def effective_semesters(course: dict, offered: list[str], board_semesters: list[str]) -> list[str]:
    """program_allowed ∩ offered, expressed as board semester ids (no program rule = any board semester)."""
    allowed = (course.get("program_allowed_semesters") or course.get("allowed_semesters")
               or board_semesters)
    suffixes = tuple(_SUFFIX[s] for s in offered)
    return [s for s in allowed if s.endswith(suffixes)] if suffixes else []


def compare(board: dict, facts: dict, year: int) -> list[dict]:
    rows: list[dict] = []
    for loc, c in board_courses(board):
        cid = c["course_id"]
        fact = facts.get(cid)
        if not fact:
            continue
        ims = fact["ims"]
        if ims["status"] == "unknown":
            rows.append(_row(cid, c, loc, "offering", c.get("offered_semesters"), None,
                             ims["url"], f"manual review: {ims.get('reason', 'no groups listed')}"))
        for field, official in expected_fields(c, fact, year).items():
            current = c.get(field)
            if field == "offered_semesters" and current is not None:
                current = sorted(current)
            if current != official:
                rows.append(_row(cid, c, loc, field, current, official, ims["url"]))
        # A course already placed in a semester it isn't offered in this year.
        offered = ims.get("offered_semesters")
        if loc != "pool" and ims["status"] == "offered" and not is_annual(c) and loc[-1].upper() not in offered:
            rows.append(_row(cid, c, loc, "placement", loc, offered, ims["url"],
                             "placed in a semester with no groups this year"))
        if loc != "pool" and ims["status"] == "not_offered":
            rows.append(_row(cid, c, loc, "placement", loc, None, ims["url"], "placed but not offered this year"))
    return rows


def _row(cid, c, loc, field, current, official, url, note=None) -> dict:
    return {"course_id": cid, "name_he": c.get("name_he"), "location": loc, "field": field,
            "current": current, "official": official, "source_url": url, "note": note}


def apply(board: dict, facts: dict, year: int) -> int:
    changed = 0
    board_semesters = [s["semester_id"] for s in board.get("semesters", [])]
    for _, c in board_courses(board):
        fact = facts.get(c["course_id"])
        if not fact:
            continue
        ims = fact["ims"]
        exp = expected_fields(c, fact, year)
        before = json.dumps(c, sort_keys=True, ensure_ascii=False)

        for field, value in exp.items():
            c[field] = value
        if "name_he" in exp:
            c["name_source"] = f"tau_ims_{year}"
        if "weekly_hours" in exp:
            c["weekly_hours_source"] = f"tau_program_{year}"
        if "syllabus_url" in exp:
            if c.get("syllabus_source_url") and c["syllabus_source_url"] != exp["syllabus_url"]:
                c["syllabus_summary_stale"] = True  # summary was built from an older syllabus
            c["syllabus_links"] = [exp["syllabus_url"]]
            if c.get("syllabus_ai_analysis_status") not in ("pending", "done", "failed"):
                c["syllabus_ai_analysis_status"] = "pending"

        if c.get("course_details_url"):
            c["course_details_url"] = ims["url"]
        if ims["status"] == "offered":
            first = "1" if "A" in ims["offered_semesters"] else "2"
            for key in ("exam_url", "prerequisites_url"):
                if c.get(key):
                    c[key] = re.sub(r"sem=\d{5}", f"sem={year}{first}", c[key])
            eff = effective_semesters(c, ims["offered_semesters"], board_semesters)
            if c.get("placement_policy") not in ("fixed", "annual") and not is_annual(c):
                c["effective_allowed_semesters"] = eff or None
            c["offering_source_url"] = ims["url"]
            c["offering_source_confidence"] = "high"
        elif ims["status"] == "not_offered":
            c["offered_semesters"] = []
            if c.get("placement_policy") not in ("fixed", "annual"):
                c["effective_allowed_semesters"] = None
            c["offering_source_url"] = ims["url"]
            c["offering_source_confidence"] = "high"
        else:
            c["offering_source_confidence"] = "unverified"
        c["official_data_year"] = year

        if json.dumps(c, sort_keys=True, ensure_ascii=False) != before:
            changed += 1
    return changed


def apply_shaar_ruach_source(facts: dict) -> None:
    """Keep the upstream שער רוח catalog in step so a board rebuild can't reintroduce stale offerings."""
    data = json.loads(SHAAR_RUACH_SOURCE.read_text(encoding="utf-8"))
    for c in data["courses"]:
        ims = facts.get(c["course_id"], {}).get("ims", {})
        if ims.get("status") == "offered":
            c["offered_semesters"] = ims["offered_semesters"]
            c["offered_in_year"] = True
            if "semester" in c:
                c["semester"] = ",".join(ims["offered_semesters"])
        elif ims.get("status") == "not_offered":
            c["offered_semesters"] = []
            c["offered_in_year"] = False
    SHAAR_RUACH_SOURCE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[apply] {SHAAR_RUACH_SOURCE.relative_to(ROOT)} updated")


def refresh_syllabi(board: dict) -> int:
    """Rebuild summaries whose syllabus URL moved to this year. A course keeps its old
    summary (still flagged stale) when this year's syllabus page has no usable text yet."""
    from app.pipeline.fetch_syllabus_summaries import enrich_course

    done = 0
    for _, c in board_courses(board):
        if not (c.get("syllabus_summary_stale") or c.get("syllabus_ai_analysis_status") == "pending"):
            continue
        trial = dict(c)
        enrich_course(trial)
        if trial.get("syllabus_text_available"):
            c.update(trial)
            c.pop("syllabus_summary_stale", None)
            done += 1
    return done


def write_report(rows: list[dict], year: int, facts: dict) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"course_data_review_{year}.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    status = {}
    for f in facts.values():
        status[f["ims"]["status"]] = status.get(f["ims"]["status"], 0) + 1
    by_field: dict[str, int] = {}
    for r in rows:
        by_field[r["field"]] = by_field.get(r["field"], 0) + 1
    lines = [
        f"# Course data review — TAU year {year} (תשפ\"ז)",
        "",
        f"Courses checked: {len(facts)} — " + ", ".join(f"{k}: {v}" for k, v in sorted(status.items())),
        "",
        "Mismatches by field: " + (", ".join(f"{k}: {v}" for k, v in sorted(by_field.items())) or "none"),
        "",
        "| course | name | where | field | current | official | note |",
        "|---|---|---|---|---|---|---|",
    ]
    seen = set()
    for r in rows:
        key = (r["course_id"], r["field"], json.dumps(r["current"], ensure_ascii=False))
        if key in seen:  # same course appears in both boards / pool + placement
            continue
        seen.add(key)
        lines.append(f"| [{r['course_id']}]({r['source_url']}) | {r['name_he'] or ''} | {r['location']} | "
                     f"{r['field']} | {_fmt(r['current'])} | {_fmt(r['official'])} | {r['note'] or ''} |")
    (REPORT_DIR / f"course_data_review_{year}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, str) and len(v) > 60:
        return "…" + v[-40:]
    return json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, default=ACADEMIC_YEAR)
    ap.add_argument("--apply", action="store_true", help="patch the board JSON files in place")
    ap.add_argument("--syllabi", action="store_true", help="with --apply: rebuild stale syllabus summaries")
    ap.add_argument("--offline", action="store_true", help="use cached sources only")
    args = ap.parse_args()

    boards = {p: json.loads(p.read_text(encoding="utf-8")) for p in BOARDS if p.exists()}
    ids = {c["course_id"] for b in boards.values() for _, c in board_courses(b)}
    facts = official_facts(sorted(ids), args.year, args.offline)

    OFFICIAL_DIR.mkdir(parents=True, exist_ok=True)
    (OFFICIAL_DIR / f"tau_course_facts_{args.year}.json").write_text(
        json.dumps(facts, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")

    rows = [r for b in boards.values() for r in compare(b, facts, args.year)]
    write_report(rows, args.year, facts)
    print(f"[review] {len(rows)} mismatch rows -> data/import_reports/course_data_review_{args.year}.md")

    if args.apply:
        for path, board in boards.items():
            n = apply(board, facts, args.year)
            if args.syllabi:
                print(f"[syllabi] {path.relative_to(ROOT)}: {refresh_syllabi(board)} summaries rebuilt")
            path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[apply] {path.relative_to(ROOT)}: {n} course records updated")
        apply_shaar_ruach_source(facts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
