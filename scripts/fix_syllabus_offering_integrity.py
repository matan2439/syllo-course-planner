"""
Syllabus offering-integrity data fix (spec-named entry point).

This is the targeted, idempotent fix-script that reconciles the LOCAL board
JSON (data/parsed_json/mechanical_semester_board_2027.json — the local static
source-of-truth for offerings, NOT Supabase board_json) with syllabus evidence
for three year-3 mechanical-engineering mandatory courses:

  0542-3780 "תהליכי עיבוד (1)"   -> Semester B only (was wrongly A; placement fixed).
  0542-3791 "תהליכי עיבוד - מעבדה" -> Semester B only (same; placement fixed).
  0542-3792 "הנדסת ניסויים ומדידות - מעבדה" -> ANNUAL (year-long) spanning A+B,
              count_hours_once, present in both semesters, placement_policy=annual.

The actual edit logic lives in fix_annual_and_offering_data.py (mirrors the
existing fix-script pattern: load board JSON → edit canonical records by base
course_id ignoring the -NN suffix → write back with json.dump indent=2
ensure_ascii=False). This module is a stable, spec-named alias so the fix can be
re-run by either name. It is idempotent and re-runnable, which matters because a
future `--build` could regenerate metadata; the upstream parser that mis-recorded
offered_semesters should be fixed as a follow-up so this script becomes a no-op.

Usage:
    python3 scripts/fix_syllabus_offering_integrity.py \
        data/parsed_json/mechanical_semester_board_2027.json
"""

from __future__ import annotations

from fix_annual_and_offering_data import main

if __name__ == "__main__":
    raise SystemExit(main())
