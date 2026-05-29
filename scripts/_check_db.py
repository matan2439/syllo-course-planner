import sqlite3
conn = sqlite3.connect("data/database.sqlite")
tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", tables)
for t in tables:
    n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"  {t}: {n} rows")
if "course_grade_stats" in tables:
    rows = conn.execute("SELECT DISTINCT source_name, COUNT(*) FROM course_grade_stats GROUP BY source_name").fetchall()
    print("  grade sources:", rows)
conn.close()
