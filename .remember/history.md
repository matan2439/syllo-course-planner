# History — shipped milestones

_One line per shipped item. Full narrative detail, if ever needed, is in git log / commit diffs, not here._

- **2026-06-30** — V1 complete: PlannerWorker + ConstraintModel + ORAV loop + pluggable Orchestrators + streaming planner-run endpoint + debug trace panel. 475 API tests green.
- **2026-06-30** — P0 complete (`e645004` + cleanup): memoized `buildValidationContext`; fixed `priorHours` double-counting; dynamic semester IDs in validator; STOP trace on step-limit hit; excluded null-hours courses from degree fill; DB-less path now plans over full local board snapshot (503 on unknown program) instead of a client-side subset.
- **2026-07-01** — P1 complete: Agentic Planner architecture shipped in 8 phases. `cd18929` SearchStrategy interface/types → `a1e8dfe` tightened interfaces → `064e87b` BeamSearchStrategy → `48be405` capability interfaces + `detectGaps` → `0c4d11a` PlannerAgent → `9f9e8cb` wired into generate-plan → `19f3045` REPLACE_COURSE enumeration + g2/g4 scoring fixes → `b440b05` is_unwanted exclusion (g5b) → `2fdb0d3` rank_candidates sorted by score. Score vector now 8D. 564/564 tests green.
- **2026-07-01** — P2-A (`d86252a`): retired dead `generateCandidates`, superseded by beam search terminal beams.
- **2026-07-01** — P2-C / annual-dedup fix (`45286c5`, superseding incomplete `2119c6d`): `root_course_id` now populated at extraction (`scripts/fix_annual_and_offering_data.py`) for real annual course `0542-3792`, fixing double-counted degree hours. Regression test against the real board path in `tests/api/planner_model.test.ts`. Also lifted `is_annual`/`spans_semesters` into `CourseProfile` and tightened `board_audit.py`.
- **2026-07-01** — Full architecture review conducted against `docs/product-goal.md`'s generic-engine vision. No code changed; findings became the priority list now in `.remember/roadmap.md`.
- **2026-07-01** — Documentation/handoff migration: replaced `.remember/remember.md` (legacy, empty) and `docs/roadmap-v2.md` / `docs/current-production-state.md` (stale, duplicated) with a minimal auto-loaded `.remember/current.md` plus on-demand `.remember/roadmap.md` and this file.
