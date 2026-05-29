"""
Verify Postgres row counts after a seed or migration run.

Usage:
    python scripts/verify_pg_counts.py

Requires DATABASE_URL to be set in .env or in the environment.
Never prints connection strings or credentials.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("DATABASE_URL", "")
if not url:
    print("Error: DATABASE_URL is not set. Add it to .env and retry.", file=sys.stderr)
    sys.exit(1)

# Expected minimum counts after a full mechanical-2027 seed
EXPECTED = {
    "programs":         1,
    "program_versions": 1,
    "courses":          56,   # 31 SQLite + board/mandatory stubs
    "course_offerings": 1,
    "course_groups":    1,
    "prerequisites":    1,
    "course_categories":5,
    "program_courses":  56,
    "grade_stats":      1,
    "syllabus_sources": 1,
    "import_runs":      1,
}

conn = psycopg2.connect(url)
cur  = conn.cursor()
ok   = True

print("Postgres row counts:")
for table, minimum in EXPECTED.items():
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    count = cur.fetchone()[0]
    flag  = "" if count >= minimum else "  ← BELOW MINIMUM"
    if flag:
        ok = False
    print(f"  {table:<22}: {count}{flag}")

cur.execute("SELECT COUNT(*) FROM program_courses WHERE is_mandatory = true")
mand = cur.fetchone()[0]
print(f"  {'mandatory pc':<22}: {mand}")
if mand < 12:
    print("  ← expected at least 12 mandatory program_courses")
    ok = False

# Spot-check a well-known course
cur.execute(
    "SELECT course_id, weekly_hours FROM courses WHERE course_id = %s",
    ("0542-4420",),
)
row = cur.fetchone()
if row:
    print(f"\nSpot-check 0542-4420: present, weekly_hours={row[1]}")
else:
    print("\nSpot-check 0542-4420: NOT FOUND  ← unexpected")
    ok = False

cur.execute(
    "SELECT COUNT(*) FROM grade_stats WHERE course_id = %s",
    ("0542-4420",),
)
gs_count = cur.fetchone()[0]
print(f"  grade_stats rows for 0542-4420: {gs_count}")
if gs_count == 0:
    print("  ← expected grade_stats rows")
    ok = False

# Last import run
cur.execute(
    "SELECT source_name, status, courses_inserted, started_at "
    "FROM import_runs ORDER BY started_at DESC LIMIT 1"
)
run = cur.fetchone()
if run:
    print(f"\nLast import_run: source={run[0]} status={run[1]} "
          f"inserted={run[2]} at={run[3]}")

cur.close()
conn.close()

print()
if ok:
    print("All counts meet minimums. Seed looks good.")
    sys.exit(0)
else:
    print("One or more counts are below the expected minimum.")
    sys.exit(1)
