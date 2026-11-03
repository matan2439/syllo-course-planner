# קורסי שער רוח — do they count toward degree credits?

**Rule (TAU, 2026):** students in the Faculties of Engineering, Exact Sciences and Life Sciences must complete
humanities courses worth **6 ש"ס** through the "שער רוח" program. Every שער רוח course is worth **2 ש"ס**, so the
requirement is 3 courses. These credits are part of the degree's total credit requirement; they are not extra credits on top of it.

Sources:
- TAU Faculty of Humanities, שער רוח program: https://humanities.tau.ac.il/shar_ruach/courses (course list; "each
  course counts as 2 נק"ז" — recorded as `credits_rule` in `data/general_courses_shaar_ruach.json`) and
  https://humanities.tau.ac.il/shar_ruach/forms (6 ש"ס requirement; exemptions only for humanities-related courses
  with a final grade of 80+; "מפרויקט לסטארטאפ" exempts two שער רוח courses for engineering students).
- Faculty of Engineering yedion: https://engineering.tau.ac.il/frontpage?page=677&tab=1.
- Verify against the current year's (תשפ"ז) yedion for each program before relying on exact totals.

## Per-student application
The board a student plans on is chosen by program, track and year (`programId`, e.g. `mechanical_engineering_2027`,
plus the window board for degree years 1–2). Its `program_requirements_categories` carries the program's
`total_required_hours` and the `shaar_ruach` category (`min_courses: 3`). So the rule applies from the student's
own program, track and year data. No code assumes a single program.

## What was wrong, what changed
`api/ai/requirements_recompute.ts` already added the 2 ש"ס of every שער רוח course **placed on the board** to
`planned_hours`. But courses the student reported as completed only through the profile counter
("קורסי שער רוח שהשלמתי", `completed_category_counts`) counted toward the category and **not** toward the degree
total, so `remaining_hours` was overstated by 2 per reported course.

Fix: unnamed completed courses in a category now add `count × per-course hours` to the total. The per-course weight
is the category pool's uniform hours (2 for every שער רוח course). A pool with mixed hours is not guessed: it is
reported in `unknown_hours_courses` (and the existing "partial calculation" warning).

Tests: `tests/api/requirements_recompute.test.ts` → "unnamed completed category courses count toward total credits".

Known limit: a student who also enters the same courses under "ש״ש שהושלמו מחוץ לרשימה" counts them twice.
The panel does not deduplicate these two inputs.
