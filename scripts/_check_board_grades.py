import json
from collections import Counter
from pathlib import Path

board = json.loads(Path("data/parsed_json/mechanical_semester_board_2027.json").read_text("utf-8"))
repo  = board["metadata"]["program_repository_courses"]

tf = Counter(r.get("tau_factor_status") for r in repo)
print("tau_factor_status breakdown:", dict(tf))

matched = [r for r in repo if r.get("tau_factor_status") == "matched"]
print(f"\nMatched courses ({len(matched)}):")
for r in matched[:10]:
    print(f"  {r['course_id']} ({r.get('program_category_name_he', '?')[:20]})  "
          f"status={r.get('tau_factor_status')}")

other = [r for r in repo if r.get("tau_factor_status") != "matched"]
print(f"\nNot matched ({len(other)}):")
for r in other:
    print(f"  {r['course_id']}  status={r.get('tau_factor_status')}")
