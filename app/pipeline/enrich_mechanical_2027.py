"""
Enrich data/parsed_json/mechanical_semester_board_2027.json with official TAU data.

Sources used:
  1. TAU GraphQL cache: data/raw_html/tau_program_8715_2025.json
     → fills missing name_he and weekly_hours for all 56 repo courses
  2. TAU course detail links: already enriched by app.scraping.enrich_board_links
  3. TAU Factor: not available (domains not resolvable); status remains "not_started"

Mandatory courses:
  Extracted from GraphQL ramaid=3/4 (years 3-4) and saved to
  data/programs/mechanical_engineering_mandatory_2027.json

Usage:
    python -m app.pipeline.enrich_mechanical_2027
    python -m app.pipeline.enrich_mechanical_2027 --dry-run
    python -m app.pipeline.enrich_mechanical_2027 --force-refresh
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.scraping.tau_program_scraper import fetch_program_data

_BOARD_PATH    = Path("data/parsed_json/mechanical_semester_board_2027.json")
_PDF_PATH      = Path("data/programs/mechanical_engineering_2027_from_pdf.json")
_GQL_CACHE     = Path("data/raw_html/tau_program_8715_2025.json")
_MAND_PATH     = Path("data/programs/mechanical_engineering_mandatory_2027.json")

_TCID  = "8715"
_SHANA = "2025"


# ---------------------------------------------------------------------------
# GraphQL cache helpers
# ---------------------------------------------------------------------------

def _load_graphql_body() -> list[dict]:
    """Return the program body list from the local GraphQL cache (utf-8-sig safe)."""
    for enc in ("utf-8-sig", "utf-8"):
        try:
            raw = json.loads(_GQL_CACHE.read_text(encoding=enc))
            return raw["data"]["results"]["body"]
        except (KeyError, TypeError, json.JSONDecodeError):
            continue
        except UnicodeDecodeError:
            continue
    return []


def _fetch_or_load_graphql(force_refresh: bool = False) -> list[dict]:
    """Load GraphQL program body from cache, or fetch if missing/force."""
    if _GQL_CACHE.exists() and not force_refresh:
        body = _load_graphql_body()
        if body:
            return body
    print(f"[graphql] Fetching program data for tcid={_TCID} shana={_SHANA}…")
    body = fetch_program_data(
        tcid=_TCID,
        shana=_SHANA,
        safa="1",
        cache_path=_GQL_CACHE,
        force_refresh=force_refresh,
    )
    return body


# ---------------------------------------------------------------------------
# Course data extraction from GraphQL body
# ---------------------------------------------------------------------------

def _extract_course_map(body: list[dict]) -> dict[str, dict]:
    """Return {course_id: {name_he, weekly_hours, offered_semesters, teaching_format}} from all rama sections."""
    course_map: dict[str, dict] = {}

    def _process_kurs_list(kurs_list: list[dict]) -> None:
        for k in kurs_list:
            raw_id  = k.get("kursshow", "")
            name    = k.get("teurkurs", "")
            hours   = k.get("shaotuni")
            fmt     = k.get("ofenhoraa1") or k.get("ofenhoraa2") or ""
            mevutal = k.get("mevutal", "0")
            hidden  = k.get("hidekurs", "")
            if not raw_id or not name:
                continue
            if mevutal == "1" or (hidden and hidden not in ("0", "")):
                continue
            cid = _normalize_course_id(raw_id)
            if cid not in course_map:
                # Convert hours to float safely
                weekly_hours: float | None = None
                try:
                    weekly_hours = float(hours) if hours else None
                except (TypeError, ValueError):
                    pass
                course_map[cid] = {
                    "name_he":        name,
                    "weekly_hours":   weekly_hours,
                    "teaching_format": str(fmt) if fmt else None,
                }

    if not body:
        return course_map

    for rama_item in body[0].get("rama", []):
        # Direct courses in this rama
        _process_kurs_list(rama_item.get("kurs", []))
        # Sub-sections
        for sub in rama_item.get("rama", []):
            _process_kurs_list(sub.get("kurs", []))

    return course_map


def _normalize_course_id(raw: str) -> str:
    """Normalise '05424320' or '0542-4320' → '0542-4320'."""
    import re
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    return raw.strip()


# ---------------------------------------------------------------------------
# Mandatory courses extraction
# ---------------------------------------------------------------------------

_MANDATORY_RAMAIDS = {"3", "4"}


def _extract_mandatory_courses(body: list[dict]) -> list[dict]:
    """Extract Y3/Y4 mandatory courses from GraphQL body."""
    courses: list[dict] = []
    seen: set[str] = set()

    if not body:
        return courses

    for rama_item in body[0].get("rama", []):
        ramaid = str(rama_item.get("ramaid", ""))
        if ramaid not in _MANDATORY_RAMAIDS:
            continue
        year_num = int(ramaid)
        for sub in rama_item.get("rama", []):
            semester_label = sub.get("teurrama", "")
            sem_key = "A" if "א" in semester_label else "B" if "ב" in semester_label else None
            for k in sub.get("kurs", []):
                raw_id  = k.get("kursshow", "")
                name    = k.get("teurkurs", "")
                hours   = k.get("shaotuni")
                mevutal = k.get("mevutal", "0")
                hidden  = k.get("hidekurs", "")
                if not raw_id or not name or mevutal == "1" or (hidden and hidden not in ("0", "")):
                    continue
                cid = _normalize_course_id(raw_id)
                if cid in seen:
                    continue
                seen.add(cid)
                weekly_hours: float | None = None
                try:
                    weekly_hours = float(hours) if hours else None
                except (TypeError, ValueError):
                    pass
                entry: dict = {
                    "course_id":        cid,
                    "name_he":          name,
                    "weekly_hours":     weekly_hours,
                    "year":             year_num,
                    "locked_by_default": True,
                    "source":           "tau_graphql_2025",
                }
                if sem_key:
                    entry["allowed_semesters"] = [sem_key]
                courses.append(entry)
        # Also process direct kurs on the rama (no sub-section)
        for k in rama_item.get("kurs", []):
            raw_id  = k.get("kursshow", "")
            name    = k.get("teurkurs", "")
            hours   = k.get("shaotuni")
            mevutal = k.get("mevutal", "0")
            hidden  = k.get("hidekurs", "")
            if not raw_id or not name or mevutal == "1" or (hidden and hidden not in ("0", "")):
                continue
            cid = _normalize_course_id(raw_id)
            if cid in seen:
                continue
            seen.add(cid)
            weekly_hours = None
            try:
                weekly_hours = float(hours) if hours else None
            except (TypeError, ValueError):
                pass
            courses.append({
                "course_id":         cid,
                "name_he":           name,
                "weekly_hours":      weekly_hours,
                "year":              year_num,
                "locked_by_default": True,
                "source":            "tau_graphql_2025",
            })

    return courses


# ---------------------------------------------------------------------------
# Board enrichment
# ---------------------------------------------------------------------------

def enrich_board(
    board_path: Path   = _BOARD_PATH,
    force_refresh: bool = False,
    dry_run: bool      = False,
) -> dict:
    """
    Enrich board JSON with course names and hours from GraphQL cache.

    Returns a dict with enrichment statistics.
    """
    body = _fetch_or_load_graphql(force_refresh)
    if not body:
        print("[warn] GraphQL body empty — cannot enrich names/hours from TAU official data")
        return {"graphql_ok": False}

    course_map = _extract_course_map(body)
    print(f"[graphql] Extracted {len(course_map)} courses from TAU official data")

    board = json.loads(board_path.read_text(encoding="utf-8"))
    repo  = board["metadata"]["program_repository_courses"]

    stats = {
        "graphql_ok":         True,
        "total_repo":         len(repo),
        "enriched_name":      0,
        "enriched_hours":     0,
        "still_missing_name": [],
        "still_missing_hours":[],
        "with_course_details_url": 0,
        "with_syllabus_url":  0,
        "tau_factor_not_started": 0,
    }

    for rc in repo:
        cid  = rc.get("course_id", "")
        info = course_map.get(cid, {})

        # Fill missing name_he
        if not rc.get("name_he") and info.get("name_he"):
            if not dry_run:
                rc["name_he"] = info["name_he"]
            stats["enriched_name"] += 1

        # Fill missing weekly_hours
        if rc.get("weekly_hours") is None and info.get("weekly_hours") is not None:
            if not dry_run:
                rc["weekly_hours"] = info["weekly_hours"]
            stats["enriched_hours"] += 1

        # Tally final state
        if not rc.get("name_he"):
            stats["still_missing_name"].append(cid)
        if rc.get("weekly_hours") is None:
            stats["still_missing_hours"].append(cid)
        if rc.get("course_details_url"):
            stats["with_course_details_url"] += 1
        if rc.get("syllabus_url"):
            stats["with_syllabus_url"] += 1
        if rc.get("tau_factor_status") == "not_started":
            stats["tau_factor_not_started"] += 1

    if not dry_run:
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[board] Board JSON updated: {board_path}")

    return stats


# ---------------------------------------------------------------------------
# Mandatory courses save
# ---------------------------------------------------------------------------

def save_mandatory_courses(
    body: list[dict],
    mand_path: Path = _MAND_PATH,
    dry_run: bool   = False,
) -> list[dict]:
    courses = _extract_mandatory_courses(body)
    if not courses:
        print("[mand] No mandatory courses found in GraphQL Y3/Y4 sections")
        return []

    # Exclude any course already in the PDF elective repository
    pdf = json.loads(_PDF_PATH.read_text(encoding="utf-8"))
    elective_ids = {c["course_id"] for c in pdf.get("elective_courses", [])}
    # Also gather all IDs from requirements
    for cat_key in ("core_categories",):
        for cat in pdf.get("requirements", {}).get(cat_key, []):
            elective_ids.update(cat.get("course_ids", []))
    for key in ("advanced_labs", "other_specialization"):
        sect = pdf.get("requirements", {}).get(key, {})
        elective_ids.update(sect.get("course_ids", []))

    non_overlapping = [c for c in courses if c["course_id"] not in elective_ids]
    overlap = [c["course_id"] for c in courses if c["course_id"] in elective_ids]
    if overlap:
        print(f"[mand] Excluded {len(overlap)} courses that overlap with elective repo: {overlap}")

    payload = {
        "version":        "2027",
        "program_id":     "mechanical_engineering_2027",
        "description":    "קורסי חובה שנה ג'+ד' — הנדסה מכנית תשפ\"ז. מקור: TAU GraphQL API 2025.",
        "status":         "extracted_from_graphql",
        "needs_verification": True,
        "note":           "קורסי החובה נחלצו מ-API הרשמי של אוניברסיטת תל אביב (tochniot.tau.ac.il). יש לאמת מול הסילבוס הרשמי.",
        "source":         "tau_graphql_2025",
        "courses":        non_overlapping,
    }

    if not dry_run:
        mand_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[mand] Mandatory courses saved: {mand_path} ({len(non_overlapping)} courses)")

    return non_overlapping


# ---------------------------------------------------------------------------
# Main report
# ---------------------------------------------------------------------------

def _print_report(stats: dict, mandatory: list[dict]) -> None:
    print()
    print("=" * 55)
    print("Enrichment Report — mechanical_engineering_2027")
    print("=" * 55)
    print(f"  Total repository courses:       {stats.get('total_repo', 0)}")
    print(f"  Enriched from TAU official:     {stats.get('enriched_name', 0)} names, {stats.get('enriched_hours', 0)} hours")
    print(f"  With course_details_url:        {stats.get('with_course_details_url', 0)}")
    print(f"  With syllabus_url:              {stats.get('with_syllabus_url', 0)}")
    print(f"  TAU Factor matched:             0 (importer not run — status: not_started)")
    print(f"  TAU Factor not started:         {stats.get('tau_factor_not_started', 0)}")
    missing_names = stats.get("still_missing_name", [])
    if missing_names:
        print(f"  Still missing name_he ({len(missing_names)}): {missing_names}")
    missing_hours = stats.get("still_missing_hours", [])
    if missing_hours:
        print(f"  Still missing weekly_hours ({len(missing_hours)}): {missing_hours[:10]}{'…' if len(missing_hours) > 10 else ''}")
    print(f"  Mandatory courses extracted:    {len(mandatory)}")
    print()
    print("TAU Factor status:")
    print("  - Domains taufactor.co.il and taurefactor.com do not resolve")
    print("  - TAU Factor requires browser automation or a different URL")
    print("  - All courses retain tau_factor_status='not_started'")
    print("  - UI shows: 'טרם נטענו נתוני טאו פקטור' (correct)")
    print("  - To load TAU Factor: implement Playwright-based importer when URL is known")


def main() -> None:
    ap = argparse.ArgumentParser(description="Enrich mechanical_engineering_2027 board JSON")
    ap.add_argument("--dry-run",       action="store_true", help="Print changes without writing")
    ap.add_argument("--force-refresh", action="store_true", help="Re-fetch GraphQL data")
    args = ap.parse_args()

    print("[enrich] Loading board JSON…")
    stats = enrich_board(
        force_refresh=args.force_refresh,
        dry_run=args.dry_run,
    )

    mandatory: list[dict] = []
    if stats.get("graphql_ok"):
        body = _fetch_or_load_graphql(force_refresh=False)
        mandatory = save_mandatory_courses(body, dry_run=args.dry_run)

    _print_report(stats, mandatory)

    if args.dry_run:
        print("[dry-run] No files were modified")


if __name__ == "__main__":
    main()
