# TAU Course Planner — Architecture Reference
_Long-lived design doc. Read on demand, not by default — see `.remember/current.md` for what's active right now._

## System shape

`app/web/semester_board_viewer.html` (single-file board UI, client) ↔ `api/ai/generate-plan.ts` (handler) → `PlannerAgent` → beam search over `ConstraintModel`. DB-less fallback reads a committed full-universe snapshot from `data/boards/{program_id}.json` (never a client-side subset — that was the pre-V1 bug).

## Planner architecture (Agentic Planner, P1)

```
generate-plan.ts (handler)
    └─ PlannerAgent                          — api/ai/planner_agent.ts
           owns: ConstraintModel, initialState, capability registry
           ├─ Capability Registry
           │     ├─ SearchCapability         — invokes a SearchStrategy
           │     ├─ KnowledgeCapability       — detectGaps + future LLM/syllabus enrichment
           │     ├─ ValidationCapability      — wraps validatePlanState/validateCandidate
           │     └─ ExplanationCapability     — LlmExplainer (post-search only)
           ├─ SearchStrategy interface       — api/ai/planner_search_types.ts
           │     explore(initialState, deps, opts): SearchResult
           │     deps = SearchDeps (closures only — no ConstraintModel import)
           └─ BeamSearchStrategy (P1)        — api/ai/planner_search_beam.ts
                 width = 6 (default, configurable)
                 returns: SearchResult { finalState, trace, meta: BeamSearchMeta }
```

`PlannerAgent.run()` is currently a **fixed linear 5-step pipeline** (detectGaps → knowledge.resolve once → search once → explain once) — not resumable/adaptive. `BeamSearchStrategy.explore()` has no pause/resume point, so knowledge-gap resolution can only happen pre-search.

**Pre-agentic path (still live, untouched by P1 by design):** `PlannerWorker` + `GreedyOrchestrator`/`LlmOrchestrator` — used only by the streaming `planner-run.ts` endpoint. Not the code path `generate-plan.ts` uses.

## Module responsibilities (`api/ai/`)

| Module | Responsibility |
|---|---|
| `planner_types.ts` | `ConstraintModel`, `PlanState`, `PlannerMutation`, `CategoryReq` — generic types, no TAU literals |
| `course_profile.ts` | `CourseProfile` + `buildCourseProfiles` (board_json → normalized per-course record, merges placed+repository data by `course_id`) |
| `planner_model.ts` | `buildConstraintModel` (board_json + user context → `ConstraintModel`), `planContextToState` |
| `planner_goals.ts` | `GOAL_STACK` (8D), `scorePlan`, `compareScore`, `applyMutation`, `placedHours`/`degreeHours` (annual dedup lives here — fixed, see Known Gaps §1) |
| `planner_actions.ts` | `enumerateActions` (candidate mutation generation, incl. `REPLACE_COURSE`) |
| `planner_validate.ts` / `plan_validation.ts` | Deterministic legality gate |
| `planner_search_types.ts` / `planner_search_beam.ts` | `SearchStrategy`/`SearchDeps`/`BeamSearchStrategy` |
| `planner_capabilities.ts` | `detectGaps` (pure), capability interfaces, `PassThroughKnowledgeCapability` (P1 no-op) |
| `planner_agent.ts` | `PlannerAgent.run()` — the linear 5-step orchestration |
| `planner_trace.ts` | `PlannerTracer`, `PLANNER_ACTION_TYPES` (9 values; `VALIDATE`/`SCORE`/`REPAIR` confirmed dead — no producer) |
| `board_loader.ts` | `loadLocalBoardJson(programId)` → reads `data/boards/{programId}.json` via `join(__dirname, '..','..','data','boards')` |
| `load_constants.ts` / `completion_analysis.ts` | Global constants: `HARD_LOAD_CAP=26`, `DEFAULT_MAX_HOURS_PER_SEMESTER=20`, `DEGREE_REQUIRED_HOURS=185` — **no board-data override path**, unlike `degreeRequiredHours` |
| `llm_explainer.ts`, `planner_orchestrator.ts`, `planner_worker.ts`, `planner_lookahead.ts` | Pre-P1 greedy worker + orchestrators, retained for `planner-run.ts` only |

**Client shadow engine:** `app/web/semester_board_viewer.html` independently reimplements ~20 functions (`scorePlanLocal`, `validatePlanProposalLocal`, `computeDegreeProgress`, `getDegreeHoursStatusLocal`, `repairAddMissingMandatoryLocal`, `fillToDegreeTargetLocal`, `_gradeRiskScoreLocal`, etc.) — the single largest "one canonical implementation" violation in the codebase. Confirmed still present.

**Data layer:** `data/boards/{program_id}.json` (committed full-universe snapshots — **manually maintained, no automated regeneration script exists** despite `docs/roadmap-v2.md` describing an `npm run refresh-boards` command; verified absent from `package.json`), `data/parsed_json/mechanical_semester_board_2027.json` (upstream source, kept in sync with `data/boards/` by hand — both files now carry `root_course_id` for `0542-3792` as of commit `45286c5`), `scripts/course_planner_pipeline.py` (`--build` only bumps `metadata.board_data_version`, does not regenerate placements; `--audit`/`--sync`/`--verify-live`), `app/analysis/board_audit.py` (data-integrity gate; its annual check now also requires `root_course_id` whenever `is_annual` is set), `scripts/fix_annual_and_offering_data.py` (hand-written, hardcoded to a handful of literal TAU course IDs — the canonical place annual-course fields get stamped, including `root_course_id` as of `45286c5`, despite being documented as a one-off patch).

## Capability model

- `SearchCapability` — invokes a `SearchStrategy`. Only `BeamSearchStrategy` exists.
- `KnowledgeCapability` — `resolve(gaps: GapRecord[]): Promise<void>`. **No feedback contract** — even a real implementation has no way to return resolved facts into `ConstraintModel.profiles` before search runs. P1 ships only `PassThroughKnowledgeCapability` (no-op).
- `ValidationCapability` — wraps `validatePlanState`/`validateCandidate`.
- `ExplanationCapability` — `LlmExplainer`, invoked only after search completes.

`detectGaps` is pure (scans `ConstraintModel.profiles` for `hours==null`, unresolved `category_id`, dangling prerequisite ids) — no I/O, no LLM calls. Verified via grep.

## Score vector (8D — `planner_goals.ts` `GOAL_STACK`)

`[degree_completion, requirements_mandatory, requirements_category, legality, balance, preferences, unwanted_avoidance, difficulty_comfort]` — lexicographic; a higher-priority goal always outranks a lower one regardless of magnitude.

## Design invariants (must not be violated by future work)

1. `SearchStrategy` never imports `ConstraintModel` — operates only through `SearchDeps` closures. Verified true.
2. `PlannerAgent` owns `ConstraintModel` — the only component that constructs/reads/passes it.
3. `PlannerAgent` owns all capabilities — nothing below the agent layer invokes LLMs or enriches `CourseProfile`s directly.
4. `SearchResult.meta` (`BeamSearchMeta.depthRecords`) is the primary debugging record, not a final-state diff.
5. `diffToTrace` is a fallback only, used when a `SearchStrategy` produces no `meta` (e.g. future CP-SAT).
6. The LLM is never the planner — invoked only after `PlannerAgent` has a final `PlanState`+trace. Used for: explanation, preference disambiguation, ambiguity tiebreaking, (future P2) syllabus intelligence.
7. `KnowledgeCapability` is on-demand, not a mandatory pipeline phase — though today it's *only* ever pre-search (see gap below).
8. `detectGaps` is pure and side-effect-free — verified.
9. `toProposal` uses Option B signature: `toProposal(finalState, trace, model, initialState, pinnedHome?, rationaleOverride?)` — no live `PlannerWorker` instance passed.
10. `PlannerWorker`/`GreedyOrchestrator`/`LlmOrchestrator` are not modified by P1 work — `planner-run.ts` uses them unchanged.
11. All planner behavior changes require TDD — failing test before implementation, full regression run before commit.
12. No Alembic migrations applied to Supabase without explicit user approval. No deploy/merge without explicit approval.

## Known architectural gaps (ranked, from 2026-07-01 review against `docs/product-goal.md`)

1. **~~Live bug — annual course double-counting.~~ FIXED (commit `45286c5`, 2026-07-01).** `placedHours()` (`planner_goals.ts`) dedupes only when `count_hours_once && root_course_id` are both set on a `CourseProfile`. `root_course_id` was read at `course_profile.ts` from `raw.root_course_id`, but no board JSON file, and no script, ever wrote that key — the one real annual course in production, `0542-3792` (placed identically in `year_3_semester_a` and `year_3_semester_b`, same `course_id` both times — confirmed via `buildCourseProfiles`'s `rawById` merge-by-`course_id` and `placedCourseIds`'s flat semester list), was counted twice. Fix: `_make_annual()` in `scripts/fix_annual_and_offering_data.py` now stamps `root_course_id := course_id` (self-referential is correct here — both placements collapse to one `CourseProfile`, no cross-id linking needed for this codebase's actual annual-course representation). Applied to both `data/parsed_json/mechanical_semester_board_2027.json` and `data/boards/mechanical_engineering_2027.json` directly (no automated regen pipeline exists — see Data layer above). Also lifted `is_annual`/`spans_semesters` into `CourseProfile` and tightened `board_audit.py` to require `root_course_id` whenever `is_annual` is set. Regression test: `tests/api/planner_model.test.ts` — real board path, not a hand-built fixture (a hand-fixture doing exactly this already existed in `planner_goals.test.ts` and is why the bug shipped unnoticed the first time). RED confirmed (8h not 4h) before the fix, GREEN after. Full API suite (563/563) + `tsc --noEmit` clean.
2. **No institution/program identity in `ConstraintModel`.** Zero matches for `institution_id`/`university_id`/`catalog_year` in `api/`. Courses keyed by bare `course_id` globally.
3. **Load-cap constants hardcoded, no board-data override.** `HARD_LOAD_CAP`/`DEFAULT_MAX_HOURS_PER_SEMESTER`/`SOFT_LOAD_MAX` — unlike `degreeRequiredHours`, which correctly prefers board metadata.
4. **`KnowledgeCapability.resolve()` returns void** — no feedback contract for a future real implementation.
5. **`PlannerAgent.run()` is linear, not resumable** — no pause/resume point in `BeamSearchStrategy.explore()`.
6. **Client JS shadow engine** — largest single duplication-of-truth issue (see Data layer above).
7. **`data/boards/test_program_2027.json` doesn't prove cross-program generality** — identical semester ids/hour target/category shape to the TAU fixture.
8. **`VALIDATE`/`SCORE`/`REPAIR` trace actions are dead** — free deletion, zero risk.
9. **`data/boards/*.json` has no regeneration pipeline** — manually kept in sync with `data/parsed_json/*.json` by hand; the roadmap's `npm run refresh-boards` does not exist.

## Environment notes

See `.remember/current.md` for the live venv/test status. The durable fact worth keeping here: this project's Python tooling assumes ABI-consistent binary wheels for whichever interpreter `.venv` is built from — mixing an interpreter version with wheels resolved for a different version (as happened here: `cp311` interpreter + `cp313` wheels for `psycopg2`/`pydantic-core`/etc.) fails silently at import time with no indication of the real cause in the error message itself.

**Unresolved: full `pytest` run leaks live Supabase connections.** A complete `pytest` run (2026-07-01) accumulated 39+ ESTABLISHED TCP connections to the Supabase Postgres host (port 6543) that never closed, discovered via `netstat` and stopped before completion. `app/database/db.py`'s `_make_engine(db_path=_DB_PATH)` opens a real Postgres engine whenever `db_path is _DB_PATH` (identity check) and `settings.database_url` is set — `_DB_PATH` is imported by identity into `eligibility_engine.py`/`recommendation_engine.py`/`prerequisite_graph.py` as their own default, so any call site omitting its `db_path` argument anywhere in that call chain would trigger this. Exhaustive grep of every call site in `tests/` for every function with this default found none missing the argument — the exact trigger is **not yet found**. Diagnosing further needs either a `pg_stat_activity` read on Supabase (currently against a standing "do not touch Supabase" instruction) or bisecting by running test subsets (which reproduces the same live-connection exposure). Do not run a full unfiltered `pytest` in an environment with a real `DATABASE_URL` in `.env` until this is root-caused — it will quietly hit production.
