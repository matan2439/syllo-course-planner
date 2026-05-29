import json
from pathlib import Path

board = json.loads(Path("data/parsed_json/mechanical_semester_board_2027.json").read_text("utf-8"))
repo = board["metadata"]["program_repository_courses"]

# Find 0542-4420
for r in repo:
    if r.get("course_id") == "0542-4420":
        print("tau_factor_status:", r.get("tau_factor_status"))
        print("tau_factor_avg_grade:", r.get("tau_factor_avg_grade"))
        print("grade_signal:", r.get("grade_signal"))
        break

# Also check the semesters section
for sem in board.get("semesters", []):
    for entry in sem.get("courses", []):
        if entry.get("course_id") == "0542-4420":
            print("\nIn semester entry:")
            print("  grade_signal:", entry.get("grade_signal"))
            print("  tau_factor_avg_grade:", entry.get("tau_factor_avg_grade"))
            break
