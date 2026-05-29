import json, sqlite3
from pathlib import Path

# Board JSON shape
board = json.loads(Path("data/parsed_json/mechanical_semester_board_2027.json").read_text("utf-8"))
repo = board["metadata"].get("program_repository_courses", [])
placed = [c for sem in board["semesters"] for c in sem.get("courses", [])]
print(f"board semesters: {[s['semester_id'] for s in board['semesters']]}")
print(f"repo courses: {len(repo)}")
print(f"placed mandatory: {len([c for c in placed if c.get('course_type')=='mandatory'])}")
print(f"repo sample keys: {list(repo[0].keys()) if repo else 'none'}")

# SQLite shape
conn = sqlite3.connect("data/database.sqlite")
curs = conn.cursor()
for t in ["courses","course_groups","prerequisites","course_grade_stats"]:
    n = curs.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"sqlite.{t}: {n} rows")
cols = [r[1] for r in curs.execute("PRAGMA table_info(course_groups)").fetchall()]
print(f"course_groups cols: {cols}")
# check if year col exists
conn.close()

# Enriched JSON structure
enr = json.loads(Path("data/programs/mechanical_engineering_2027_enriched.json").read_text("utf-8"))
print(f"enriched program_id: {enr.get('program_id')}")
print(f"enriched elective_courses: {len(enr.get('elective_courses', []))}")
print(f"enriched other_spec_electives: {len(enr.get('other_specialization_electives', []))}")
reqs = enr.get("requirements", {})
print(f"core_categories: {[c['category_id'] for c in reqs.get('core_categories', [])]}")
adv = reqs.get("advanced_labs", {})
print(f"advanced_labs category_id: {adv.get('category_id')}")
other = reqs.get("other_specialization", {})
print(f"other_spec category_id: {other.get('category_id')}")

# Mandatory JSON
mand = json.loads(Path("data/programs/mechanical_engineering_mandatory_2027.json").read_text("utf-8"))
print(f"mandatory courses: {len(mand.get('courses', []))}")
print(f"mandatory sample: {mand['courses'][0] if mand.get('courses') else 'none'}")
