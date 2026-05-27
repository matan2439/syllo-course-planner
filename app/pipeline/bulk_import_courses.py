"""
Safe bulk course importer.

Reads a user-supplied course list (one ID per line), then imports each course
sequentially through the single-course pipeline.  Never crawls TAU automatically —
only imports IDs explicitly listed in the file.
"""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, get_course_by_id
from app.pipeline.import_course import import_course_pipeline

_REPORT_DIR = Path("data/import_reports")


# ---------------------------------------------------------------------------
# Course list loader
# ---------------------------------------------------------------------------

def load_course_ids(file_path: Path) -> list[str]:
    """Return normalised course IDs from a text file.

    Rules:
      - One course ID per line.
      - Lines starting with '#' are comments and are skipped.
      - Blank lines are skipped.
      - IDs are normalised to XXXX-XXXX format.
    """
    lines = file_path.read_text(encoding="utf-8").splitlines()
    ids: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        ids.append(_normalize(stripped))
    return ids


# ---------------------------------------------------------------------------
# Bulk importer
# ---------------------------------------------------------------------------

def bulk_import_courses(
    course_ids: list[str],
    year: int,
    force_refresh: bool = False,
    skip_existing: bool = False,
    delay_seconds: float = 1.0,
    limit: int | None = None,
    continue_on_error: bool = False,
    db_path: Path = _DB_PATH,
    report_dir: Path = _REPORT_DIR,
) -> dict[str, Any]:
    """
    Import each course in `course_ids` sequentially.

    Returns a report dict (also saved to `report_dir`).
    """
    if limit is not None:
        course_ids = course_ids[:limit]

    started_at = datetime.now(timezone.utc)
    course_results: list[dict[str, Any]] = []
    n_imported = n_skipped = n_failed = 0
    total = len(course_ids)

    for i, course_id in enumerate(course_ids, 1):
        print(f"[{i}/{total}] importing {course_id}")

        # skip-existing check
        if skip_existing and get_course_by_id(course_id, db_path) is not None:
            print(f"  skipped (already in DB)")
            course_results.append({"course_id": course_id, "status": "skipped",
                                   "reason": "already in DB"})
            n_skipped += 1
            continue

        try:
            summary = import_course_pipeline(
                course_id     = course_id,
                year          = year,
                force_refresh = force_refresh,
                db_path       = db_path,
            )
            print(f"  imported  groups={summary['groups_count']}  "
                  f"syllabus={'yes' if summary['syllabus_url'] else 'no'}")
            course_results.append({"course_id": course_id, "status": "imported",
                                   "groups": summary["groups_count"],
                                   "syllabus_url": summary["syllabus_url"]})
            n_imported += 1

        except Exception as exc:
            msg = str(exc)
            print(f"  FAILED: {msg}")
            course_results.append({"course_id": course_id, "status": "failed",
                                   "error": msg})
            n_failed += 1
            if not continue_on_error:
                print("[bulk] stopping on first error (use --continue-on-error to skip)")
                break

        # delay between courses (not after the last one)
        if i < total and delay_seconds > 0:
            time.sleep(delay_seconds)

    finished_at = datetime.now(timezone.utc)

    report = {
        "year":            year,
        "total_requested": total,
        "imported":        n_imported,
        "skipped":         n_skipped,
        "failed":          n_failed,
        "started_at":      started_at.isoformat(),
        "finished_at":     finished_at.isoformat(),
        "course_results":  course_results,
    }

    report_dir.mkdir(parents=True, exist_ok=True)
    ts = started_at.strftime("%Y%m%d_%H%M%S")
    report_path = report_dir / f"bulk_import_{ts}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[bulk] report saved to {report_path}")
    print(f"[bulk] done  imported={n_imported}  skipped={n_skipped}  failed={n_failed}")

    return report


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize(course_id: str) -> str:
    digits = re.sub(r"\D", "", course_id)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    return course_id


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="Bulk TAU course importer")
    cli.add_argument("--file",             required=True,        help="Path to course list file")
    cli.add_argument("--year",             required=True, type=int, help="Academic year, e.g. 2025")
    cli.add_argument("--force-refresh",    action="store_true",  help="Re-download even if cached")
    cli.add_argument("--skip-existing",    action="store_true",  help="Skip courses already in DB")
    cli.add_argument("--delay-seconds",    type=float, default=1.0,
                     help="Seconds to wait between imports (default: 1.0)")
    cli.add_argument("--limit",            type=int, default=None,
                     help="Maximum number of courses to import")
    cli.add_argument("--continue-on-error", action="store_true",
                     help="Log failures and continue rather than stopping")
    cli.add_argument("--db",               default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    src = Path(args.file)
    if not src.exists():
        print(f"[error] File not found: {src}")
        raise SystemExit(1)

    ids = load_course_ids(src)
    print(f"[bulk] loaded {len(ids)} course ID(s) from {src}")

    bulk_import_courses(
        course_ids       = ids,
        year             = args.year,
        force_refresh    = args.force_refresh,
        skip_existing    = args.skip_existing,
        delay_seconds    = args.delay_seconds,
        limit            = args.limit,
        continue_on_error= args.continue_on_error,
        db_path          = Path(args.db),
    )
