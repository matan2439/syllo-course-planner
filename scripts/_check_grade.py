import sqlite3
conn = sqlite3.connect("data/database.sqlite")
cols = [r[1] for r in conn.execute("PRAGMA table_info(course_grade_stats)").fetchall()]
print("columns:", cols)
rows = conn.execute("SELECT * FROM course_grade_stats WHERE course_id = '0542-4420'").fetchall()
print("rows for 0542-4420:", rows)
rows2 = conn.execute("SELECT * FROM course_grade_stats WHERE course_id LIKE '%4420%' LIMIT 5").fetchall()
print("like 4420:", rows2)
# sample any 3 rows to see format
sample = conn.execute("SELECT * FROM course_grade_stats LIMIT 3").fetchall()
print("sample rows:", sample)
conn.close()
