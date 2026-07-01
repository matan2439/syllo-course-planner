# TAU Course Planner — Canonical Project State
_Last updated: 2026-07-01, end of architecture-review session. This file is the handoff for the next conversation — read it first._

## Status Summary

- **V1**: complete. PlannerWorker + ConstraintModel + ORAV loop + pluggable Orchestrators + streaming planner-run endpoint + debug trace panel.
- **P0**: complete (commit `e645004` + cleanup). Six correctness fixes (memoized validation context, priorHours double-count fix, dynamic semester ids, STOP trace on step-limit, null-hours exclusion, DB-less local board snapshot).
- **P1**: complete (commits `cd18929`…`2fdb0d3`, 2026-07-01). Agentic Planner shipped: `SearchStrategy` interface, `BeamSearchStrategy` (width 6 default), `PlannerAgent` with capability dispatch (`SearchCapability`/`KnowledgeCapability`/`ValidationCapability`/`ExplanationCapability`), wired into `generate-plan.ts`, `REPLACE_COURSE` enumeration, g2/g4 scoring fixes, `is_unwanted` exclusion, `rank_candidates` sort fix. Score vector is now **8D**.
- **P2-A**: complete (commit `d86252a`). Dead `generateCandidates` removed (superseded by beam search).
- **P2-C**: **NOT complete** — do not trust the commit message (`2119c6d`, "annual course deduplication via root_course_id"). Verified this session: it introduced the *type* (`root_course_id`, `count_hours_once` on `CourseProfile`) and the *one consumer* (`placedHours()` in `planner_goals.ts`), but **no production code anywhere writes `root_course_id`**. See Finding 1 below — this is a live bug, not a prepared-but-inert feature.
- **This session (2026-07-01)**: full architecture review of the planner against `docs/product-goal.md`'s generic-engine vision, requested via `/superpowers:systematic-debugging` with a 7-section review brief. **No planner code was changed.** Full review text is in that conversation's transcript; this file carries the durable findings forward. `docs/roadmap-v2.md` was updated in the same session with a new Section 8 capturing the same findings in roadmap form.

## Test Suite State (verified 2026-07-01, this session — read-only, no fixes attempted)

- **TS/JS** (`npm test` = `jest tests/api` + `jest --config jest.ui.config.js`): **643/647 passing, 4 failing in 2 suites**. Failures are in `tests/ui/planner_user_intent_focus.test.js` — a `beforeAll` hook exceeding the 5000ms jsdom-init timeout. Not investigated further (no code was touched this session, so this isn't a regression *from* this session, but it's unclear whether it's pre-existing flakiness or a real gap — **verify at the start of next session** before assuming either way).
- **`tsc --noEmit`**: clean.
- **Python (`pytest`)**: **currently cannot run in this sandbox environment.** Two separate breakages found:
  1. System `python` (3.13, not `.venv`): `ModuleNotFoundError: No module named 'sqlalchemy'`.
  2. `.venv/Scripts/python` resolves to a WindowsApps-store Python 3.11 (not obviously the project's intended venv) and fails differently, inside `pydantic_settings` import.
  3. Independent of both: `tests/test_supabase_normalize.py` calls `sys.exit(1)` at **module import time** when Supabase env vars are absent, which triggers a pytest `INTERNALERROR` that aborts the *entire* collection run (not just that file) — `--ignore`-ing it still leaves the sqlalchemy/pydantic_settings problems.
  - **Not a code regression** — this is environment/dependency drift in the sandbox, unrelated to any change this session (none were made). Needs a working Python env fixed/identified before the Python test count (last known: 689 tests as of 2026-05-27) can be re-verified.

## Architecture Map (as of this session)

Core planner (`api/ai/`):
- `planner_types.ts` — `ConstraintModel`, `PlanState`, `PlannerMutation`, `CategoryReq` (generic types, no TAU literals)
- `course_profile.ts` — `CourseProfile` + `buildCourseProfiles` (board_json → normalized per-course record)
- `planner_model.ts` — `buildConstraintModel` (board_json + user context → `ConstraintModel`), `planContextToState`
- `planner_goals.ts` — `GOAL_STACK` (8D), `scorePlan`, `compareScore`, `applyMutation`, `placedHours`/`degreeHours` (annual dedup lives here, currently inert — Finding 1)
- `planner_actions.ts` — `enumerateActions` (candidate mutation generation, incl. `REPLACE_COURSE`)
- `planner_validate.ts` / `plan_validation.ts` — deterministic legality gate
- `planner_search_types.ts` / `planner_search_beam.ts` — `SearchStrategy`/`SearchDeps`/`BeamSearchStrategy` (verified: never imports `ConstraintModel`, closures only)
- `planner_capabilities.ts` — `detectGaps` (pure), `SearchCapability`/`KnowledgeCapability`/`ValidationCapability`/`ExplanationCapability` interfaces, `PassThroughKnowledgeCapability` (P1 no-op)
- `planner_agent.ts` — `PlannerAgent.run()`: **linear** 5-step pipeline (detectGaps → knowledge.resolve once → search.search once → explain once), not yet a resumable/adaptive loop — see Finding 6
- `planner_trace.ts` — `PlannerTracer`, `PLANNER_ACTION_TYPES` (9 values; only 6 have a producer — see Finding 2)
- `board_loader.ts` — `loadLocalBoardJson(programId)`, reads `data/boards/{programId}.json`
- `load_constants.ts` / `completion_analysis.ts` — global constants (`HARD_LOAD_CAP=26`, `DEFAULT_MAX_HOURS_PER_SEMESTER=20`, `DEGREE_REQUIRED_HOURS=185`) — see Finding 5
- `llm_explainer.ts`, `planner_orchestrator.ts`, `planner_worker.ts`, `planner_lookahead.ts` — pre-P1 greedy worker + orchestrators, retained for the streaming `planner-run.ts` endpoint (unchanged in P1 by design)

Client: `app/web/semester_board_viewer.html` — single-file board UI **plus an independent shadow implementation of the entire rule engine** (~20 `*Local` functions: `scorePlanLocal`, `validatePlanProposalLocal`, `computeDegreeProgress`, `getDegreeHoursStatusLocal`, `getCategoryStatusReportLocal`, `repairAddMissingMandatoryLocal`, `repairAddHoursToDegreeLocal`, `fillToDegreeTargetLocal`, `_gradeRiskScoreLocal`, etc.) — see Finding 3, roadmap §7.5.

Data: `data/boards/{program_id}.json` (committed full-universe snapshots), `scripts/course_planner_pipeline.py` (build/audit/sync), `app/analysis/board_audit.py` (data-integrity gate, includes annual-course checks that are **disconnected** from the planner's own annual fields — Finding 1), `scripts/fix_annual_and_offering_data.py` (hand-written per-course-ID patch script — the wrong pattern, see Finding 1).

Docs: `docs/product-goal.md` (generic-engine target architecture — well-written, treat as the standard to hold the code to), `docs/roadmap-v2.md` (living implementation roadmap, updated this session).

## Score Vector (8D — `planner_goals.ts` `GOAL_STACK`)

`[degree_completion, requirements_mandatory, requirements_category, legality, balance, preferences, unwanted_avoidance, difficulty_comfort]` — lexicographic, higher-priority goal always outranks a lower one regardless of magnitude.

## Verified Findings From the 2026-07-01 Architecture Review

Ordered by what the full review found, not by priority (see Prioritized Roadmap below for that):

1. **LIVE BUG — annual course double-counting.** `placedHours()` only dedupes when `p.count_hours_once && p.root_course_id` are both set. `root_course_id` is written **nowhere** in production code (verified by grep). The one real annual course in production data, `0542-3792` (4 hours, placed in both `year_3_semester_a` and `year_3_semester_b`, `count_hours_once=true`), is counted **twice** (8 instead of 4) in every planner run today. Root cause: `root_course_id` should be *derived* at board-extraction time (from syllabus text / course-numbering convention), not hand-listed. `count_hours_once` is currently set by `scripts/fix_annual_and_offering_data.py`, a one-off script hardcoded to 3 literal TAU course IDs — the wrong pattern to repeat for other universities. `board_audit.py` separately checks `is_annual`/`spans_semesters`, but those fields never reach `CourseProfile` — two disconnected annual-course representations exist today.
2. **Trace API dead code.** `VALIDATE`/`SCORE`/`REPAIR` exist in `PLANNER_ACTION_TYPES` but are never emitted by any `tracer.record()` call site (verified by grep across all of `api/`) and never consumed by the frontend. Safe to delete — not a compatibility concern, just an unreachable enum variant left over from the pre-agentic design.
3. **Client JS shadow engine.** `semester_board_viewer.html` reimplements scoring, validation, repair, and degree-completion logic independently of the server engine (~20 functions). This is the single largest "one canonical implementation" violation in the codebase and the thing that makes every other duplication in the review (annual hours, degree completion, semester legality) possible. Already named as debt in roadmap §7.5 but its true scope is larger than that section implies.
4. **No institution/program identity in `ConstraintModel`.** Grepped for `institution_id`/`university_id`/`faculty_id` across `api/` — zero matches. Courses are keyed by bare `course_id` globally, not `(institution_id, course_id)` as `product-goal.md` §4 itself requires. `program_id` exists only as a board-file-loader filename key, never as a field on the model consumed during planning.
5. **Load-cap constants are hardcoded with no data override.** `HARD_LOAD_CAP=26`, `DEFAULT_MAX_HOURS_PER_SEMESTER=20`, `SOFT_LOAD_MAX=22` (`load_constants.ts`) are wired into `ConstraintModel.hardCap`/`maxHoursPerSemester` with **no `??` fallback to board data at all** — unlike `degreeRequiredHours`, which does correctly prefer board metadata. A different university's weekly-load model has no way to express itself through data today.
6. **`PlannerAgent.run()` is a fixed linear pipeline, not a resumable/adaptive loop.** The capability interfaces (`SearchCapability`/`KnowledgeCapability`/`ValidationCapability`/`ExplanationCapability`) are real and correctly scoped (verified: `BeamSearchStrategy` never imports `ConstraintModel`), but `run()` calls each capability at most once, in a fixed order, with no branching. `BeamSearchStrategy.explore()` has no pause/resume point, so knowledge-gap resolution can only happen *before* search starts, never mid-search. Needs a resumable-search seam (e.g. agent calls `explore()` with a step budget, inspects gaps on the intermediate state, resolves, re-invokes with the new state as `initialState`) **before** real `KnowledgeCapability` (P2 syllabus enrichment) is built on top of the current no-op assumption.
7. **`KnowledgeCapability.resolve()` has no feedback contract.** Signature is `resolve(gaps): Promise<void>` — even a real implementation that successfully resolves a gap (e.g. determines `hours=3` for a null-hours course) has no way to get that fact back into `ConstraintModel.profiles` before search runs. Needs to return resolved facts that the agent merges into a new model. Fix the type signature now (cheap); the real LLM implementation can come later.
8. **The "second synthetic test program" doesn't prove cross-program generality.** `data/boards/test_program_2027.json` exists and is used in `generate-plan.test.ts`, but it has identical semester ids, identical 185-hour target, and identical category shape to the TAU fixture — it's a smaller dataset in the same shape, not a structurally different program. `product-goal.md` §14.5's "build the second synthetic test program... proof of generic architecture" gate has not actually been exercised.

## Prioritized Roadmap (from the review, highest architectural value → lowest)

1. Fix the live annual-dedup bug at the extraction stage (Finding 1) — derive `root_course_id`, don't hand-patch it.
2. Add `institution_id`/`program_id`/`catalog_year` to `ConstraintModel` now (Finding 4) — cheapest before a second real program exists.
3. Source load-cap constants from board data instead of bare module constants (Finding 5).
4. Design (don't yet implement) the `KnowledgeCapability.resolve()` return contract + resumable-search seam (Findings 6, 7) — before real P2 syllabus enrichment gets built on the wrong assumption.
5. Retire the client JS shadow engine (Finding 3) — largest single migration, but it's the item that otherwise doubles the cost of everything else on this list.
6. Build a genuinely structurally-different second synthetic program and run the full reliability matrix against it (Finding 8) — the actual proof-of-genericity gate; currently believed done, isn't.
7. Delete `VALIDATE`/`SCORE`/`REPAIR` from the trace enum (Finding 2) — free, zero-risk, do opportunistically.
8. Track/specialization model + typed mandatory-mobility enum (roadmap §4.2, product-goal.md §10) — correctly known as not-yet-built; sequence after 1–5 so it isn't built twice against a still-buggy/duplicated foundation.

## Design Invariants (carry forward unchanged — see `docs/roadmap-v2.md` for full text)

`SearchStrategy` never imports `ConstraintModel` (verified still true). `PlannerAgent` owns `ConstraintModel` and all capabilities. `SearchResult.meta` is the primary debug record; `diffToTrace` is fallback-only. The LLM is never the planner. `KnowledgeCapability` is on-demand, not a mandatory pipeline phase (though today it's *only* pre-search — Finding 6). `detectGaps` is pure. `toProposal` Option B signature. `PlannerWorker`/`GreedyOrchestrator`/`LlmOrchestrator` untouched in P1. All planner changes require TDD.

## Security Invariants (carry forward)

- No Alembic migrations applied to Supabase without explicit user approval.
- No merge/deploy without explicit user approval.
- `.claude/settings.local.json` and `.claude/skills/` never committed.
- No API keys or credentials committed.
- Migration `d4e5f6a7b8c9_add_planner_runs_table.py` is committed only, NOT applied.

## Next Conversation

Start here:

1. **Re-verify the test suite state first**, in a fresh shell, before touching anything: `npm test` (expect the same 4-failure/2-suite jsdom timeout, or confirm it's fixed/worse) and find a working Python interpreter for `pytest` (check whether `.venv` was created with the intended Python, or whether a `requirements.txt`/`pyproject.toml` install is needed — this session's `.venv/Scripts/python` resolved to an unexpected WindowsApps Python 3.11, which is itself worth investigating before assuming the venv is set up correctly).
2. **No decision has been made yet on which roadmap item to act on** — the architecture review (this file's "Prioritized Roadmap" section, and `docs/roadmap-v2.md` §8) is a review, not an approved plan. Before writing any planner code, get explicit confirmation on which item to start with. Item 1 (fix the live annual-hours double-counting bug) is the strongest candidate to lead with: it's a verified production correctness bug, small in scope, and its fix pattern (derive `root_course_id` at extraction time) sets the right precedent before any more one-off per-course patch scripts get written.
3. If the user wants to start with Finding 1: the fix touches `scripts/course_planner_pipeline.py` or wherever board extraction/enrichment happens (derive `root_course_id`), `course_profile.ts` (no change needed — the field already exists), and possibly `board_audit.py` (tighten the check to assert `root_course_id` is present whenever `is_annual`/`count_hours_once` is true, closing the gap between the two disconnected annual representations). Write a failing test first (TDD, per Design Invariant 11) that asserts `placedHours()` counts `0542-3792` once, using the *real* board-loading path (`buildCourseProfiles` from actual board_json), not a hand-constructed fixture that sets `root_course_id` directly — the hard-avoid bug from the panel-pref-wiring session was hidden by exactly this kind of fixture shortcut, don't repeat it.
4. Full architecture-review reasoning and all seven-section detail (Annual Dedup, Trace API, Rule Engine per-assumption table, Search Layer, Knowledge Capability, Single Sources of Truth, Future Generic Platform) is in the 2026-07-01 conversation transcript if deeper rationale is needed beyond the summary above.
