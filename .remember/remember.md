# Project State — TAU Course Planner (2026-06-30)

## P0 Complete

All 6 P0 correctness fixes landed in commit **e645004** (+ cleanup checkpoint).

### What was fixed
1. **Memoize `buildValidationContext`** — built once in PlannerWorker constructor, not per-validate call.
2. **`priorHours` double-count** — removed `currently_planned_hours` from formula. `priorHoursFromContext` now returns `manual_completed_degree_hours ?? known_completed_hours` only. Board-placed hours are counted separately via `planContextToState` → `placedHours`.
3. **Dynamic semester IDs** — `normalizePlanProposal` / `validatePlanProposal` now accept `opts.knownSemesterIds`; `KNOWN_SEMESTER_IDS` is legacy fallback only.
4. **STOP trace on step-limit** — `PlannerWorker.run()` emits a STOP action after loop if goal not reached; `generate-plan.ts` surfaces a Hebrew warning and sets `blocked=true`.
5. **Null-hours degree-fill guard** — Group 4 of `enumerateActions` skips courses where `p.hours == null || p.hours === 0`.
6. **DB-less full universe** — `loadLocalBoardJson(program_id)` reads `data/boards/{program_id}.json`. DB absent + no local file → 503 NO_UNIVERSE. `planContextToBoard`/`buildModelFromPlanContext` removed from codebase (were dead in prod).

### Board loading behavior (Fix 6)
- DB available → `queryBoardJson` (prod path).
- DB absent → `loadLocalBoardJson` reads `data/boards/{program_id}.json`.
- Neither → 503 NO_UNIVERSE. Never falls back to client-subset planning.
- `mechanical_engineering_2027.json` committed. Add new programs by adding their board snapshot file.

### Remaining known debt (P1 next)
- Beam Search (Section 2 of roadmap-v2.md) — not started.
- `REPLACE_COURSE` enumeration (2.3) — not started.
- Goal scoring bugs g2/g4 (2.4) — not started.
- DB-less `npm run refresh-boards` script — not implemented; boards updated manually.
- Alembic migration `d4e5f6a7b8c9_add_planner_runs_table.py` — committed only, NOT applied to Supabase.
