"""
CLI to generate the TAU program page output JSON files from cached data.

Usage:
    python -m app.scraping.generate_tau_program_outputs
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from app.parsing.tau_program_parser import parse_program_body, enrich_pdf_program
from app.scraping.tau_program_scraper import fetch_program_data, save_raw_snapshot

_CACHE_PATH = Path("data/raw_html/tau_program_8715_2025.json")
_OUT_2025 = Path("data/programs/mechanical_engineering_2025_from_tau_program_page.json")
_OUT_2027_ENRICHED = Path("data/programs/mechanical_engineering_2027_enriched.json")
_PDF_2027 = Path("data/programs/mechanical_engineering_2027_from_pdf.json")

TCID = "8715"
SHANA = "2025"
SOURCE_URL = f"https://www.tau.ac.il/study-program?safa=1&shana={SHANA}&tab=programStudy&tcid={TCID}"
PARSED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _extract_total_hours(hesbernosaf: str) -> int | None:
    if not hesbernosaf:
        return None
    m = re.search(r"(\d+)\s*שעות", hesbernosaf)
    if m:
        return int(m.group(1))
    return None


def _load_body() -> list[dict]:
    """Load body from cache or fetch live."""
    body = fetch_program_data(TCID, SHANA, cache_path=_CACHE_PATH)
    if not body:
        print("[warn] Could not load program data from cache or network")
    return body


def generate_2025(body: list[dict]) -> dict:
    """Generate mechanical_engineering_2025_from_tau_program_page.json."""
    parsed = parse_program_body(body)

    # Extract total_required_hours from raw body hesbernosaf
    total_hours = 184
    if body:
        total_hours = _extract_total_hours(body[0].get("hesbernosaf", "")) or 184

    out = {
        "program_id": "mechanical_engineering_2025",
        "program_name_he": parsed.get("program_name_he") or "תוכנית חד-חוגית בהנדסה מכנית",
        "program_name": "Mechanical Engineering",
        "academic_year_he": parsed.get("academic_year_he") or "תשפ\"ו",
        "source_type": "tau_program_page_graphql",
        "source_url": SOURCE_URL,
        "graphql_endpoint": "https://tochniot.tau.ac.il/graphql",
        "tcid": TCID,
        "shana": SHANA,
        "parsed_at": PARSED_AT,
        "total_required_hours": total_hours,
        "mandatory_courses": {
            "source": "tau_program_page",
            "needs_verification": False,
            "courses": parsed["mandatory_courses"],
        },
        "elective_core_courses": parsed["elective_core_courses"],
        "specialization_courses": parsed["specialization_courses"],
        "parse_warnings": parsed["parse_warnings"],
    }
    return out


def generate_2027_enriched(body: list[dict]) -> dict:
    """Generate mechanical_engineering_2027_enriched.json."""
    parsed = parse_program_body(body)

    # Build page_data for enrichment
    page_data = {
        "mandatory_courses": parsed["mandatory_courses"],
        "elective_core_courses": parsed["elective_core_courses"],
        "specialization_courses": parsed["specialization_courses"],
        "program_name_he": parsed.get("program_name_he"),
        "total_required_hours": None,
    }

    pdf_prog = json.loads(_PDF_2027.read_text(encoding="utf-8"))
    enriched, warnings = enrich_pdf_program(pdf_prog, page_data)

    # Filter mandatory_courses_from_page to years 3-4 only (board covers Y3-Y4)
    mand_all = enriched.get("mandatory_courses_from_page", [])
    mand_y34 = [c for c in mand_all if c.get("year") in (3, 4)]
    enriched["mandatory_courses_from_page"] = mand_y34

    enriched["source_type"] = "mechanical_engineering_2027_pdf_enriched_with_tau_program_page"
    enriched["source_url"] = SOURCE_URL
    enriched["enrichment_shana"] = SHANA
    enriched["parsed_at"] = PARSED_AT
    enriched["parse_warnings"] = warnings

    return enriched


def main() -> None:
    print("[generate] Loading program body ...")
    body = _load_body()
    if not body:
        raise SystemExit("[error] Cannot load body — aborting")

    print(f"[generate] Body loaded: {len(body)} top-level entries")

    print("[generate] Generating 2025 output ...")
    out_2025 = generate_2025(body)
    _OUT_2025.write_text(json.dumps(out_2025, ensure_ascii=False, indent=2), encoding="utf-8")
    mand = out_2025["mandatory_courses"]["courses"]
    print(f"  mandatory={len(mand)}  elective_core={len(out_2025['elective_core_courses'])}  "
          f"specialization={len(out_2025['specialization_courses'])}")
    print(f"  Saved: {_OUT_2025}")

    print("[generate] Generating 2027 enriched output ...")
    out_2027 = generate_2027_enriched(body)
    _OUT_2027_ENRICHED.write_text(json.dumps(out_2027, ensure_ascii=False, indent=2), encoding="utf-8")
    other = out_2027.get("other_specialization_electives", [])
    named = sum(1 for c in other if c.get("name_he"))
    mand34 = out_2027.get("mandatory_courses_from_page", [])
    print(f"  other_specialization={len(other)} named={named}  mandatory_y34={len(mand34)}")
    print(f"  Saved: {_OUT_2027_ENRICHED}")


if __name__ == "__main__":
    main()
