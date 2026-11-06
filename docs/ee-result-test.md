# EE result test

EE remains **draft**. This is an offline, data-only result test of the committed hardening and EE data. Coverage is complete; release readiness still fails. No core code, boards, registry, account data or other degree data were changed by this task. No network calls or commits were made.

## Evidence and mapping

- Set `degree_years: 4`; the existing EE window board contains years 1-2 and its main board years 3-4, exactly eight semesters.
- Reused all 364 committed ME `pdf:b6a7c762f8db:*` items from `data/degrees/tau/mechanical_engineering/2027/evidence.json`. Their source is the exact `Terms_BA.pdf` URL in EE evidence item `tau:7622:2026:body:terms:8026588cd798`.
- Appended those items verbatim, preserving IDs, raw text, source URL, paths, page metadata and original fetch/cache provenance. No fresh fetch is claimed. The PDF items span pages 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13; none has `data.unread`.
- Copied the seven PDF-backed ME course rules with identical source IDs, parameters and enforcement flags. Only the duration note changes its board paths to EE. Its `enforced_by: board` is supported by the eight observed EE semester IDs. The other six shared rules remain `enforced_by: none`.
- Executed the actual `scripts/degree.py` CLI entry point with `todo --program electrical_engineering_2027 --reuse-from mechanical_engineering_2027`: **364 reused, 0 needing review, 0 differing text**. A narrowly scoped `Path.write_text` patch suppressed only the automatic EE `todo.md` write to respect the three-file scope; the CLI wrote the real allowed spec. Reuse on the final data is idempotent (0 additions/reviews/differences).
- Of the PDF mappings, 18 map to planning fields/rules and 346 retain specific non-planning explanations (headings, exams, grading, administration, individual exemptions/accommodations). Reviewed the donor-specific explanations; adapted only `pdf:b6a7c762f8db:054faa375f0f` from the ME program pointer to the EE `tau:7622:2026:*` evidence. Other PDF mappings are identical to ME.
- Replaced the EE regulations-link mapping with its catalog policy and seven rule targets. Removed `unread-regulations-pdf` only after every PDF item had a resolving mapping or explicit non-planning reason. Final evidence/coverage: **996/996; 0 coverage gaps, 0 stale keys, 0 duplicate IDs, 0 known gaps**.
- Preserved the original 632 EE evidence items, 14 EE course rules, five source conflicts, and original coverage entries except the regulations link. Assertions compare these with `git show HEAD:<path>` and compare the donor with committed ME data.

## Remaining blockers

`board_carries_requirements` fails exactly on:

> group_minimums.track (12 courses) cannot reach the board: it only carries the core group minimum (core_courses_total_min)

Keep `group_minimums.track = 12` honest. Relabelling it as the core group would misstate the source and would not implement four core courses from four distinct tracks.

`rules_enforced` fails on exactly 20 rules (14 EE rules plus six shared regulations rules). The exact rule IDs and limitations are recorded in the complete check output below. They cover:

- EE core/track counting and distinct tracks; distinct-track labs and the conditional third lab; two English-taught courses.
- Six course exclusions, including the unresolved self-referential `0512-4506` overlap. Do not infer that its other course is `0512-4507`.
- Spring-intake timing for `0512-4162`; year/average/interview restrictions for `0509-4010`; semester-3 entry for `0512-3000`; the semester-2/3 window and eligibility restrictions for `0512-4013`.
- Shared regulations: under-75% load approval; duration extensions; before-or-concurrent prerequisite semantics; year progression; graduate-course cap and approvals; conditional prerequisites for reserve duty/eligible students.

Freshness is **SKIPPED** because this task uses committed evidence offline. This independently prevents publication even if every other gate passed. `courses_known` passes with a real warning: 88 general-requirement courses have no credits in the committed facts.

The five existing source conflicts remain unresolved and unchanged (their recording does not itself enforce a rule):

- The program text (hesbernosaf) names 11 specialization areas (מערכות מחשב, תקשורת, בקרה ומערכות אוטונומיות, עיבוד אותות, התקנים אלקטרוניים, אלקטרואופטיקה ופוטוניקה, אלקטרומגנטיות וקרינה, אנרגיה ומקורות מתחדשים, תקשורות ואינפורמציה קוונטית, ביו-אלקטרוניקה, חומרים); the program tree has 14 track sections (adds VLSI, machine learning/AI and multidisciplinary, and names some differently). The spec follows the tree's track sections.
- Advanced-labs hours: the Year-4 section says 6-8 ש"ס, the years 3-4 section says 5-8 ש"ס (both 3-6.5 weighted). The spec states no lab hours (category advanced_labs: min_courses 2).
- The overlap note on 0512-4506 names "מבוא לאלקטרניקת הספק 05124506" - its own number; the course called מבוא לאלקטרוניקת הספק on the same page is 0512-4507. Not resolved; see course_rules[excl-0512-4506-as-printed].
- IMS 2026 lists 0510-6404 as offered (semester A) but the program timetable has no group for it. The spec keeps it (IMS).
- The program page lists these courses without the cancelled flag, but IMS 2026 says not offered and the program timetable has no group: 0510-7400, 0510-7438, 0510-7650, 0512-4262, 0512-4364, 0512-4493, 0512-4507, 0555-4000, 0581-4321, 0581-5312. The spec follows IMS + timetable and leaves them out of the elective pools (not plannable in תשפ"ז); 0512-4262 is also marked core (see course_rules[core-four-distinct-tracks]).

## Focused verification

Ran the following focused suite, with bytecode and pytest cache disabled and `--basetemp` outside the repository:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -m pytest -q -p no:cacheprovider --basetemp <external-scratch>/ee-result-pytest tests/test_coverage_suggest.py tests/test_degree_todo.py tests/test_degree_checks_coverage.py tests/test_degree_checks_consistency.py
```

**87 passed**. Additional assertions verify provenance against HEAD, preservation of existing EE data, shared-rule source identity, unique evidence IDs, zero coverage gaps/stale keys, idempotent reuse, draft status, and the EE board semester windows.

Ran `degree.run_checks(entry, live=False, offline=True)` against the committed EE evidence through `degree._load_evidence(entry)`. The harness replaces only `degree.collect` (to avoid re-collection of external sources) and suppresses only the automatic import-report write. All production check functions run unchanged against committed facts and the existing committed EE board; no build or publish was run. Thus this is a committed-evidence result, not a live freshness or freshly rebuilt-board claim.

| Check | Result |
| --- | --- |
| `coverage` | PASS |
| `courses_known` | PASS |
| `double_counting` | PASS |
| `mandatory_offered` | PASS |
| `degree_length` | PASS |
| `totals` | PASS |
| `board_carries_requirements` | FAIL |
| `plannable` | PASS |
| `rules_enforced` | FAIL |
| `known_gaps` | PASS |
| `freshness` | SKIPPED |

Overall: **FAIL**, deliberately retained as evidence of remaining blockers.

## Complete offline check output

```text
# Degree check — electrical_engineering_2027

Mode: offline (cached sources); evidence items: 996

## coverage: PASS

## courses_known: PASS
- warn: general requirement: 88 course(s) have no credits

## double_counting: PASS

## mandatory_offered: PASS

## degree_length: PASS

## totals: PASS

## board_carries_requirements: FAIL
- group_minimums.track (12 courses) cannot reach the board: it only carries the core group minimum (core_courses_total_min)

## plannable: PASS

## rules_enforced: FAIL
- unenforced rule cohort-0512-4013: TAU: 0512-4013 is for year-1 (semester B) and year-2 (semester A) EE students who met every recommended-plan requirement and hold an average of 85+ (registration by bidding). The board models neither averages nor plan completion.
- unenforced rule cohort-spring-0512-4162: TAU: spring-intake students (מחזור אביב) who want 0512-4162 must take it in semester 5. Neither the spec nor the board models intake cohorts.
- unenforced rule core-four-distinct-tracks: TAU: 12 track courses over the degree (labs excluded), of which at least 4 are marked "קורס ליבה" and come from 4 different tracks. The core marking exists only in each listing's course note ("קורס ליבה במסלול X"; the listing data has no core field) and is attributed to the track the note names, not the section it is listed under (e.g. 0512-4264 is listed in 5 tracks, core of ml_ai only; 0512-4601 is core of optics_photonics and bioelectronics). Core courses not taught in תשפ"ז (IMS not_offered): 0512-4262, 0555-4551. Nothing enforces this: the board has no core marking, and the 12-course minimum lives only in group_minimums.track (spec_to_program emits only the 'core' group to the board as core_courses_total_min), so the planner checks neither.
- unenforced rule duration-extension: TAU engineering regulations (Terms_BA.pdf p1, p13): a student may extend the degree by one more year with the teaching committee's approval (further extension in exceptional cases); a pregnancy/parenthood-eligible student may extend by up to 2 semesters without extension fees. The boards have no semester beyond year 4.
- unenforced rule english-two-courses: TAU (hesbernosaf, per the Council for Higher Education): every student who began higher education in Israel from תשפ"ב studies at least two courses in English during the bachelor's degree. The coverage item itself maps to total_required_credits (same text); the board has no language-of-instruction field.
- unenforced rule excl-0512-1820-0368-2161: TAU: 0512-1820 partly overlaps 0368-2161 (פרויקט תוכנה); both cannot be taken. The board has no exclusion data.
- unenforced rule excl-0512-4264-0368-3235: TAU: 0512-4264 overlaps 0368-3235 (מבוא ללמידה חישובית); both cannot be taken during the degree. The board has no exclusion data.
- unenforced rule excl-0512-4400-0512-4495: TAU: 0512-4400 overlaps 0512-4495 (מבנה המחשב ומערכות הפעלה); both cannot be taken. The note items are mapped to core-four-distinct-tracks (the same note marks 0512-4400 core). The board has no exclusion data.
- unenforced rule excl-0512-4402-0368-2162: TAU: 0512-4402 overlaps 0368-2162 (מערכות הפעלה); both cannot be taken (the same note says it is not meant for computer-engineering students, which does not restrict this program). The board has no exclusion data.
- unenforced rule excl-0512-4506-as-printed: TAU: 0512-4506 (אלקטרוניקת הספק) "overlaps מבוא לאלקטרניקת הספק 05124506" and both cannot be taken. The note names the course's own number; on the same page מבוא לאלקטרוניקת הספק is 0512-4507. Not resolved: recorded in source_conflicts, the second course is left out of course_ids. The board has no exclusion data.
- unenforced rule excl-0512-4861-0512-4860: TAU: 0512-4861 overlaps 0512-4860 (מעגלי RF); both cannot be taken. The board has no exclusion data.
- unenforced rule graduate-courses-max-2-per-semester: TAU engineering regulations (Terms_BA.pdf p2): an undergraduate may take graduate courses only with a high average and the track head's approval, and never more than two graduate courses per semester. The boards do not model graduate courses or this cap.
- unenforced rule labs-two-distinct-tracks: TAU: 2 advanced labs from 2 different tracks; a student who takes both in the same track must take a third lab in another track, whose credits do not count toward the theoretical-course credits. category_members keys are the track categories; the labs themselves sit in the advanced_labs category (min_courses 2). The board enforces only the count of 2 (category advanced_labs), not the distinct-track condition nor the third-lab rule.
- unenforced rule load-min-75pct-approval: TAU engineering regulations (Terms_BA.pdf p1): the normal format is a full program and the student may set their own pace, but studying less than 75% of a full load needs a request to the track head. The boards carry no load bounds (semester total_weekly_hours is informational only).
- unenforced rule prereq-before-or-concurrent: TAU engineering regulations (Terms_BA.pdf p1): a prerequisite (קורס קדם) is taken before or in parallel with the course; meeting it means attending the prerequisite and being eligible for its exam (not passing it). The board records carry prerequisite data but no planner check applies this before-or-parallel semantics.
- unenforced rule prereq-conditional-reserve-or-eligible-student: TAU engineering regulations (Terms_BA.pdf p11, p13): a student kept by reserve duty, or a pregnancy/parenthood-eligible student, from completing a prerequisite course may take the advanced course conditionally until the prerequisite is completed. Neither the spec nor the board models these statuses.
- unenforced rule window-0512-4013: TAU: in semester 2 or 3 one may take one elective, 0512-4013 (מעבדת חשיפה לחומרה). Optional ("ניתן לקחת"): category hardware_exposure_elective has min_courses 0. The built boards do not encode the window: data/boards/electrical_engineering_years_1_2_2027.json offers it in all of year_1_semester_a..year_2_semester_b (semesters 1-4) and data/boards/electrical_engineering_2027.json in year_3_semester_a..year_4_semester_b.
- unenforced rule year-0509-4010: TAU: 0509-4010 can be taken only in year 4, with an average of 85+, after an admission interview. The board's track placement does not restrict it to year 4.
- unenforced rule year-0512-3000: TAU: 0512-3000 (פרויקט מיוחד) can be registered from semester 3 on, manually, on the project supervisor's recommendation. The board offers track courses in years 3-4 only, which is narrower than the rule; nothing encodes semester 3.
- unenforced rule year-progression: TAU engineering regulations (Terms_BA.pdf p2, registration item 6): a student cannot register for courses of an advanced year without finishing all the courses of the current year and meeting the prerequisites. The boards place courses by year but do not block a later-year course while current-year courses are open.

## known_gaps: PASS

## freshness: SKIPPED
- offline run: evidence is cached, so freshness is not verified

Result: FAIL
```

## Changed paths for this task

- `data/degrees/tau/electrical_engineering/2027/spec.json`
- `data/degrees/tau/electrical_engineering/2027/evidence.json`
- `docs/ee-result-test.md`

Unrelated worktree changes observed under `.claude/skills/add-degree/SKILL.md` and `web/app/degrees/` were left untouched.

## Subsequent generic-group implementation

The twelve-track-course minimum is now emitted in board metadata and enforced by Python validation, TypeScript requirements recomputation, and the planner candidate gate. Overlapping track membership counts once; labs are outside the track pool. Identified completed and in-progress courses contribute once. Anonymous category totals cannot manufacture group credit. The shared frontend adapter shows the group progress.

The rebuilt EE main board contains `group_minimums.track = 12`. `board_carries_requirements` now passes. All 20 course-rule blockers remain recorded; this change does not implement distinct core tracks, English-course requirements, eligibility approvals or the unresolved source conflict. EE stays draft. The historical check output above describes the earlier result before this implementation.

## Editable preview verification

Vercel preview `dpl_DrDNtPwJhPSqi6amw1ZySodSi4QW` serves EE through the normal
`/planner?program=electrical_engineering_2027` page with both year windows. The preview
workspace uses its isolated Supabase accounts database. Its planner board and proposal
storage can use the separate planner override.

The deployed smoke test verified two saved alternatives with separate course placements
and weekly groups, restoring A → B → A, reloading saved plans, and adding, moving and
removing a real EE elective. A lookup for the baseline ME program in the same test
session found no EE copies. This validates the deployed API workflow. Browser interaction,
source freshness, and complete academic validation remain release checks.
