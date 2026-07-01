# Planner V2 Roadmap
_V1 complete (2026-06-30). P0 fixes complete (2026-06-30, commit e645004 + cleanup). This file is now the V2 roadmap._
_**P1 complete (2026-07-01, commits 19f3045 / b440b05 / 2fdb0d3).** 564/564 tests green, tsc clean._
_See `.remember/remember.md` for full canonical project state, score vector, and blocked/deferred items._

---

## P0 Status — COMPLETE (commit e645004 + cleanup checkpoint)

All six P0 correctness fixes are done and regression-tested:

| Fix | Description | Status |
|---|---|---|
| 1.1 | Memoize `buildValidationContext` | ✅ DONE |
| 1.2 | Remove `currently_planned_hours` from `priorHours` | ✅ DONE |
| 1.3 | Dynamic semester IDs in validator | ✅ DONE |
| 1.4 | Emit STOP trace on step-limit hit | ✅ DONE |
| 1.5 | Exclude null-hours courses from degree fill | ✅ DONE |
| DB-less | Full local board snapshot; 503 on unknown program | ✅ DONE (moved from P1/Section 3) |

Cleanup: dead `buildModelFromPlanContext`/`planContextToBoard` removed from codebase; `priorHoursFromContext` exported and unit-tested. `npm test` green, `tsc --noEmit` clean.

---

## Background

V1 delivered: PlannerWorker + ConstraintModel + ORAV loop + pluggable Orchestrators + streaming planner-run endpoint + debug trace panel. 475 API tests green. `tsc --noEmit` clean. Endpoint backward-compatible.

V2 goals (in priority order):
1. Fix correctness bugs before any deploy.
2. Replace greedy hill-climber with Beam Search.
3. Fix DB-less path — no more client-subset planning.
4. Generalize past ME-2027 (dynamic semesters, multiple programs).
5. Invert LLM role (explanation + enrichment only, not step selection).
6. Clean up remaining debt.

**Two architectural decisions locked in for V2:**
- Search: **Agentic Planner with pluggable SearchStrategy** (first impl: BeamSearchStrategy). See Section 2.
- DB-less fallback: **Not acceptable**. Must always plan over the full course universe. See Section 3 (DONE).

---

## Section 1 — Critical Fixes (P0, fix before any deploy)

### 1.1 Memoize `buildValidationContext` ✅ DONE

**Problem:** `buildValidationContext(model, pinnedHome)` is called on every `validatePlanState` invocation — which happens inside `enumerateActions` (filter pass), inside `estimateFinalScore`'s greedy rollout, and inside every `tryApply`. For a typical ME-2027 run: ~500 steps × ~30 candidate actions × `getLegalSemesters` over ~300 profiles × 4 semesters = ~1.4B operations per run. Measured: the bottleneck is here.

**Why:** Pure function of `(model, pinnedHome)`. Model is immutable; pinnedHome is fixed at run start. Result is identical on every call.

**Solution:** Build and cache the `PlanValidationContext` once in `PlannerWorker` constructor. Pass the cached result into every `validatePlanState` call instead of rebuilding.

```ts
// planner_worker.ts constructor
this._validationCtx = buildValidationContext(model, pinnedCourseHome);
// every validatePlanState call: pass this._validationCtx instead of rebuilding
```

**Affected modules:** `api/ai/planner_validate.ts`, `api/ai/planner_worker.ts`

**Tests to add:** Spy on `buildValidationContext` in a multi-step run, assert call count === 1 (not proportional to steps).

**Migration risk:** None. Pure change to call site — no behavior change.

**Priority:** P0. Single highest-impact change in the codebase.

---

### 1.2 Fix `priorHours` double-counting ✅ DONE

**Problem:** In `generate-plan.ts`:
```ts
function priorHoursFromContext(ctx): number {
  return manual_completed_degree_hours ?? (known_completed_hours + currently_planned_hours);
}
```
`currently_planned_hours` = hours of courses currently on the board. Then `planContextToState` seeds those same courses into `initialState.semesters[...]`. `degreeHours` in the plan = `priorHours + placedHours` where `placedHours` counts the seeded board courses again. Result: planned courses are counted twice in the degree completion metric.

**Why:** The degree completion goal (g1) may appear satisfied earlier than it is, causing the planner to stop short. Or, after removal, the gap re-appears and the planner oscillates.

**Solution:** `priorHoursFromContext` should include only completed courses, not board-planned ones:
```ts
// Safe fallback: known_completed_hours only (never currently_planned_hours)
return manual_completed_degree_hours ?? known_completed_hours ?? 0;
```
The board-planned hours are already counted by `placedHours` via `planContextToState`.

**Verification:** Check what `total_hours_progress.currently_planned_hours` means in the client. If it includes board-placed courses (which `planContextToState` also seeds), remove it from the formula.

**Affected modules:** `api/ai/generate-plan.ts`, `api/ai/planner_model.ts` (`buildModelFromPlanContext`)

**Tests to add:** Seed a board state with 20 placed hours + 100 completed hours, verify `model.priorHours === 100` and `degreeHours === 100 + placedTotal`, not `120 + placedTotal`.

**Migration risk:** Low. Potentially changes stop condition timing — test with ME-2027 oracle.

**Priority:** P0.

---

### 1.3 Fix `KNOWN_SEMESTER_IDS` hardcoding ✅ DONE

**Problem:** `api/ai/plan_validation.ts` contains:
```ts
const KNOWN_SEMESTER_IDS = ['year_3_semester_a','year_3_semester_b','year_4_semester_a','year_4_semester_b'];
```
`validatePlanProposal` filters the proposal's semesters to only this list. Any course placed in a semester not in this list is silently dropped from validation — it is never checked for legality, prereqs, or load. Breaks any program using different semester naming.

**Solution:** Pass `model.knownSemesterIds` into `validatePlanProposal` via an options parameter:
```ts
function validatePlanProposal(proposal, ctx, opts?: { knownSemesterIds?: string[] })
```
Inside, replace `KNOWN_SEMESTER_IDS` with `opts?.knownSemesterIds ?? KNOWN_SEMESTER_IDS`. The constant becomes a legacy fallback only.

**Affected modules:** `api/ai/plan_validation.ts`, `api/ai/planner_validate.ts` (call site)

**Tests to add:** Board with a `year_2_semester_a` semester; assert courses placed there are validated (not silently dropped).

**Migration risk:** Low. Additive parameter with fallback. Existing tests still pass via default.

**Priority:** P0. Blocks any non-ME-2027 program.

---

### 1.4 Emit STOP trace on step-limit hit ✅ DONE

**Problem:** When `run(maxSteps)` exits because `step >= maxSteps`, no `STOP` action is emitted to the trace, no warning appears in `warnings_he`, and the response `blocked` flag stays `false`. The client silently receives an incomplete plan with no indication it was cut short.

**Solution:** In `PlannerWorker.run()`, after the loop exits:
```ts
if (this.stepCount >= maxSteps && !this.isGoalReached()) {
  this.tracer.record({ action: 'STOP', reason: `hit maxSteps (${maxSteps})`, ... });
}
```
Surface this in `generate-plan.ts` warnings_he.

**Affected modules:** `api/ai/planner_worker.ts`, `api/ai/generate-plan.ts`

**Tests to add:** Run with maxSteps=1 on a non-trivial board; assert trace contains a STOP entry with reason containing "maxSteps".

**Migration risk:** None.

**Priority:** P0.

---

### 1.5 Exclude null-hours courses from degree fill ✅ DONE

**Problem:** Courses with `hours: null` contribute 0 to `placedHours`. If only null-hours courses remain as eligible candidates for the degree-hours goal, the planner can loop placing and re-placing them (they satisfy g1's add-action filter but never advance the count).

**Solution:** In `enumerateActions`, when generating ADD actions for degree-hours fill (Group 4 / electives), filter out profiles where `p.hours == null || p.hours === 0`. They can still be added if they satisfy mandatory or category requirements (Groups 1–3).

**Affected modules:** `api/ai/planner_actions.ts`

**Tests to add:** Board with only null-hours electives remaining; assert planner emits STOP (not infinite loop) within maxSteps.

**Migration risk:** None.

**Priority:** P0.

---

## Section 2 — Agentic Planner Architecture (P1)

> **NOT YET IMPLEMENTED.** The architecture below is approved and locked. No code for it exists yet.
> Implementation begins with `api/ai/planner_search_types.ts` (Phase 1). See `# Next Conversation` below.

### 2.1 Architecture Overview

The P1 architecture replaces the greedy `PlannerWorker` + `Orchestrator` with an **Agentic Planner** pattern. The agent owns the planning world, decides when to invoke capabilities, and delegates search to a pluggable `SearchStrategy`.

```
generate-plan.ts (handler)
    │
    └─ PlannerAgent                          — api/ai/planner_agent.ts
           owns: ConstraintModel, initialState, capability registry
           │
           ├─ Capability Registry
           │     ├─ SearchCapability         — invokes a SearchStrategy
           │     ├─ KnowledgeCapability      — detectGaps + future LLM/syllabus enrichment
           │     ├─ ValidationCapability     — wraps validatePlanState/validateCandidate
           │     └─ ExplanationCapability    — LlmExplainer (post-search only)
           │
           ├─ SearchStrategy interface       — api/ai/planner_search_types.ts
           │     explore(initialState, deps, opts): SearchResult
           │     deps = SearchDeps (closures only — no ConstraintModel import)
           │
           └─ BeamSearchStrategy (P1)        — api/ai/planner_search_beam.ts
                 width = 6 (default, configurable)
                 returns: SearchResult { finalState, trace, meta: BeamSearchMeta }
```

**Flow:**
1. `PlannerAgent` builds `ConstraintModel` and `SearchDeps` closures.
2. Agent calls `detectGaps` (pure scan) → if gaps and `KnowledgeCapability` is available, may enrich `CourseProfile`s before or during search (on-demand, not a mandatory pre-search phase).
3. Agent invokes `SearchCapability` → `BeamSearchStrategy.explore(initialState, deps, opts)`.
4. Strategy returns `SearchResult` with `meta: BeamSearchMeta` (primary debug record).
5. Agent builds `PlannerAction` trace from `meta.chosenPath` (primary). `diffToTrace` is a fallback only when `meta` is absent (e.g. a future CP-SAT integration).
6. Agent invokes `ExplanationCapability` → `LlmExplainer` generates Hebrew prose from the trace.
7. `toProposal(finalState, trace, model, initialState)` builds HTTP response (no live `PlannerWorker` instance — Option B signature).

### 2.2 SearchStrategy Interface and SearchDeps

`SearchStrategy` must be maximally generic. It **never imports `ConstraintModel`** or any planner-internal types. It operates on `PlanState` through injected closures only.

```ts
// api/ai/planner_search_types.ts

interface SearchDeps<S, A> {
  generateActions: (state: S) => A[];
  applyMutation:   (state: S, action: A) => S;
  validate:        (state: S) => boolean;
  score:           (state: S) => number[];
  compareScore:    (a: number[], b: number[]) => number;
  isGoal:          (state: S) => boolean;
}

interface CandidateRecord {
  action: unknown;
  resultState: unknown;
  score: number[];
  rejected: boolean;
  rejectReason?: string;  // 'validation_failed' | 'pruned_by_beam' | 'duplicate'
}

interface DepthRecord {
  depth: number;
  candidates: CandidateRecord[];
  survivors: unknown[];  // states that entered next depth
}

type TerminationReason = 'goal_reached' | 'max_steps' | 'no_legal_expansion';

interface BeamSearchMeta {
  beamWidth: number;
  depthRecords: DepthRecord[];
  chosenPath: unknown[];         // the action sequence of the best terminal state
  terminationReason: TerminationReason;
  alternativePaths: unknown[][];  // unchosen legal terminal paths (up to k-1)
}

interface SearchResult<S> {
  finalState: S;
  meta?: BeamSearchMeta;  // present for BeamSearchStrategy; absent for future CP-SAT
}

interface SearchStrategy<S, A> {
  explore(
    initialState: S,
    deps: SearchDeps<S, A>,
    opts: { maxSteps: number; width?: number }
  ): SearchResult<S>;
}
```

**`PlannerAgent` builds `SearchDeps` once**, capturing `ConstraintModel` in closure scope:
```ts
const deps: SearchDeps<PlanState, PlanMutation> = {
  generateActions: (s) => enumerateActions(s, model),
  applyMutation:   (s, a) => applyMutation(s, a),
  validate:        (s) => validatePlanState(s, model, pinnedHome, validationCtx).valid,
  score:           (s) => scorePlan(s, model),
  compareScore,
  isGoal:          (s) => isGoalReached(s, model),
};
```

### 2.3 BeamSearchStrategy (P1 — first SearchStrategy implementation)

> **Beam Search is NOT the architecture.** It is the first `SearchStrategy` implementation. Future strategies (`CpSatStrategy`, `AStarStrategy`) drop in via the same interface.

**Algorithm (width k=6 default):**
1. Initialize beam: `[initialState]`.
2. Each step:
   a. For each beam state: `generateActions(state)` → for each action: `applyMutation`, `validate`, `score`.
   b. Record all candidates in `DepthRecord` (including rejected, with reason).
   c. Sort all valid candidates by `compareScore` descending; keep top-k distinct states (dedup by state fingerprint).
   d. Pruned candidates recorded with `rejectReason: 'pruned_by_beam'`.
3. Terminate when: all beams satisfy `isGoal`, or `maxSteps` reached, or no valid expansion exists.
4. Return best terminal beam as `finalState`; populate `BeamSearchMeta` with full per-depth records.

**Eliminates:** `greedyComplete`, `estimateFinalScore`, per-step rollouts. The beam width IS the lookahead.

**New modules:**
- `api/ai/planner_search_types.ts` — types only (Phase 1)
- `api/ai/planner_search_beam.ts` — `BeamSearchStrategy` implementation (Phase 2)
- `api/ai/planner_capabilities.ts` — capability interfaces + `detectGaps` (Phase 3)
- `api/ai/planner_agent.ts` — `PlannerAgent` orchestrator (Phase 4)

**Existing modules (zero changes needed):**
- `enumerateActions`, `applyMutation`, `scorePlan`, `compareScore`, `validatePlanState`, `buildValidationContext`, `validateCandidate` — reused as-is via `SearchDeps` closures.
- `PlannerWorker`, `GreedyOrchestrator`, `LlmOrchestrator` — retained; `LlmOrchestrator` still used by `planner-run.ts` streaming endpoint (untouched in P1).

**Tests to add (TDD — write before each phase):**
- Phase 1: compile-time shape check on `SearchStrategy` interface
- Phase 2: `BeamSearchStrategy` width=1 converges on trivial board; width=6 produces k distinct terminal states; `meta.depthRecords` cover all candidates; `terminationReason` correct for each exit path; deduplication removes identical states
- Phase 3: `detectGaps` returns expected gap list on boards with null/ambiguous profiles; returns empty on clean board
- Phase 4: `PlannerAgent` end-to-end on ME-2027 board; trace built from `meta.chosenPath`; `diffToTrace` fallback used when `meta` absent
- Phase 5: `generate-plan.ts` response contract unchanged; `toProposal` Option B signature; LLM called only after search

**Migration risk:** Medium. `PlannerWorker` still present and unchanged; `generate-plan.ts` wires to `PlannerAgent` only when feature-flagged or after full phase 5 completion. Greedy path remains as fallback.

**Priority:** P1.

---

### 2.4 KnowledgeCapability and detectGaps

**`detectGaps` (ships in P1):** Pure scan of `ConstraintModel.profiles` for ambiguous or incomplete `CourseProfile` fields:
- `hours == null` — unknown credit hours
- `category_id` unresolved / not present in `model.categories`
- `prerequisites` contains course IDs not in `model.profiles`

Returns `GapRecord[]`. No I/O, no LLM calls.

**`KnowledgeCapability` interface (ships in P1 as interface + pass-through only):** `resolve(gaps: GapRecord[]): Promise<void>`. Real implementation (LLM/syllabus enrichment via `extract_syllabus_facts` tool) is explicitly **NOT part of P1** — ships in P2.

**`PlannerAgent` flow:** calls `detectGaps` before search. If gaps are found and `KnowledgeCapability` has a real resolver, the agent may invoke it and then re-run or resume. In P1, `KnowledgeCapability.resolve()` is a no-op pass-through — gaps are logged but not filled.

**Knowledge acquisition is not a mandatory linear pre-search phase.** The Agent decides when to invoke `KnowledgeCapability`. If gaps are discovered mid-reasoning, the agent may invoke it and resume. This is the extension seam for future autonomous enrichment.

---

### 2.5 Fix `REPLACE_COURSE` enumeration

**Problem:** `enumerateActions` never generates `REPLACE_COURSE` mutations. A placed course can only be replaced if the LLM explicitly calls the `replace_course` tool. In greedy mode, a bad placement can never be corrected by substitution.

**Solution:** In `enumerateActions`, for each placed movable course `c`:
- Enumerate profiles that: (a) fit the same semester legally, (b) have higher preference score than `c`, (c) satisfy at least the same category/mandatory requirements as `c`.
- Emit `REPLACE_COURSE` mutations for the top 3 candidates per placed course.
- Cap: only for the top-3 worst-scoring placed courses (by preference fit).

**Affected modules:** `api/ai/planner_actions.ts`

**Tests to add:** Board with a low-preference placed course; assert `enumerateActions` includes REPLACE_COURSE mutations with higher-preference replacement.

**Migration risk:** Low. Additive. Covered by step-count cap.

**Priority:** P1.

---

### 2.6 Fix goal scoring bugs

**g2 — incommensurable units:**

`g2 = mandatoryPlaced + categoriesSatisfied` aggregates counts with different denominators.

Fix: Split into two dimensions:
- g2a = `mandatoryPlaced / requiredMandatoryCount`
- g2b = `categoriesSatisfied / categoryCount`

Or extend score vector from 6 to 7 dimensions (mandatory completion before category satisfaction).

**g4 — empty semester penalty:**

`spread = max(loads) - min(loads)` where min can be 0 for a legitimately empty semester.

Fix: `spread = max(loads) - min(non-empty semester loads)`.

**Affected modules:** `api/ai/planner_goals.ts`

**Tests to add:** Mandatory-completing action beats category-completing at g2; empty-semester board has spread === 0 for g4.

**Migration risk:** Low. Changes planner behavior only, not output contract.

**Priority:** P1.

---

## Section 3 — DB-less Path Fix ✅ DONE (moved to P0, commit e645004)

### 3.1 The Problem

`buildModelFromPlanContext` → `planContextToBoard` synthesizes a board from the client's `plan_context` — a subset of the full universe. This recreates exactly the pre-V1 problem: planning over a pre-filtered subset. The DB-less path fires whenever `DATABASE_URL` is missing.

### 3.2 Solution: Local Board Data Files

Commit `data/boards/{program_id}.json` for each supported program (initially: `mechanical_engineering_2027`). These are snapshots of the full `board_json` from the DB.

**Loading logic in `generate-plan.ts`:**
```ts
if (!board && !dbUrl) {
  board = loadLocalBoardJson(program_id); // reads data/boards/{program_id}.json
}
if (!board) {
  sendError(res, 503, 'Full course universe unavailable.', 'NO_UNIVERSE');
  return;
}
```

`planContextToBoard` is retained only for legacy tests, never called in production.

**Refresh mechanism:** `npm run refresh-boards` queries DB → writes `data/boards/*.json`. Run manually when requirements change.

**Affected modules:** `api/ai/generate-plan.ts`, new `api/ai/board_loader.ts`, new `data/boards/*.json`

**Tests to add:** DB mocked absent + local file → full universe (profile count check). Assert `planContextToBoard` not called in production path.

**Migration risk:** Medium. Requires committing board data files. Clear error when file missing.

**Priority:** P1.

---

## Section 4 — Requirement Engine Generalization (P2)

### 4.1 Dynamic Semester IDs

Addressed by Section 1.3. No additional work beyond passing `model.knownSemesterIds` into the validator.

### 4.2 Multiple Tracks and Equivalent Courses

Extend `CategoryReq`:
```ts
equivalentGroups?: Array<string[]>; // [[A, B]] means A or B counts as 1 requirement
trackId?: string;                   // only applies when model.activeTrack === trackId
```

Extend `ConstraintModel`:
```ts
activeTrack?: string;
coRequisites?: Array<[string, string]>;
```

Update `validatePlanProposal` to handle `equivalentGroups`.

**Priority:** P2. Required for any program beyond ME-2027.

### 4.3 Annual Course Deduplication

Add `count_hours_once: boolean` to `CourseProfile`. In `degreeHours` calculation, deduplicate annual courses by root before summing hours.

**Affected modules:** `api/ai/course_profile.ts`, `api/ai/planner_goals.ts`

**Priority:** P2.

---

## Section 5 — Performance Improvements (P2)

### 5.1 Memoize `buildValidationContext`

See Section 1.1 (P0). Already covered.

### 5.2 Skip Per-Step Validation in Rollouts

In `greedyComplete`, use only `projectFeasibility` per rollout step. Run `validatePlanState` only on the terminal state of each rollout.

**Affected modules:** `api/ai/planner_lookahead.ts`

**Priority:** P2 (may be unnecessary after P0 memoization).

---

## Section 6 — UI and Observability (P3)

### 6.1 Step-Limit Warning in UI

When STOP trace action with "maxSteps" reason is present, show yellow banner in AI tab.

**Affected:** `app/web/semester_board_viewer.html`

### 6.2 Wire Planner-Run Streaming into UI

Replace `requestPlanProposal` sync fetch with streaming fetch to `/api/ai/planner-run`. Show live step events. On `done`, extract plan and apply existing draft flow.

**Prerequisites:** Alembic migration applied to Supabase.

**Affected:** `app/web/semester_board_viewer.html`

**Priority:** P3.

### 6.3 Trace Panel Improvements

Filter bar by action type; REJECT_COURSE highlighted; degree-hours chart.

**Priority:** P3.

---

## Section 7 — Technical Debt (P3)

### 7.1 Dead Preference Fields

`balance_load`, `avoid_multiple_labs`, `avoid_multiple_projects`, `preferred_categories`, `action_type`, `course_context` — parsed, never used.

Recommendation: implement `extra_request_he` as LLM prompt prefix (1 line). Remove others.

### 7.2 Dead PlannerAction Types

`VALIDATE`, `SCORE`, `REPAIR` in schema but never emitted. Remove or implement.

### 7.3 Fix `rank_candidates` Tool

Returns unsorted list despite the name. Fix:
```ts
worker.enumerateActions()
  .map(a => ({ ...a, score: scorePlan(applyMutation(worker.getState(), a, model), model) }))
  .sort((a, b) => compareScore(b.score, a.score))
  .slice(0, 20)
```
Reduces in importance once beam search replaces LLM step-selection.

### 7.4 Wire `generateCandidates` into Production Flow

Superseded by beam search (Section 2.2). Terminal beams replace `generateCandidates`.

### 7.5 Client JS Engine Retirement

`validatePlanProposalLocal`, `rebuildDraftFromProfileLocal`, etc. — manually-synced mirrors of server functions. Retire after streaming endpoint (Section 6.2) is stable.

**Prerequisites:** Streaming endpoint, separate PR.

### 7.6 `is_unwanted` in Scoring

`is_unwanted` flag set correctly in `CourseProfile`, never checked in `enumerateActions` or `scorePlan`. Add deprioritization in `enumerateActions` + `g5b = -unwanted_placed` sub-dimension.

---

## LLM Role in V2 (Summary)

**The LLM is NEVER responsible for planning decisions.** It has no visibility into the search process and is invoked only after `PlannerAgent` has produced a final `PlanState` and `PlannerAction` trace.

**Not used for:** Step-by-step course selection, scoring/ranking actions, search strategy choices, any hard planning facts.

**Used for (post-search only):**
1. **Explanation** — `LlmExplainer` (inside `ExplanationCapability`) generates Hebrew prose from the final plan + trace
2. **Preference disambiguation** — interpreting `extra_request_he` free-text before or after search
3. **Ambiguity resolution** — near-equal candidates where tiebreaker requires preference interpretation
4. **Future (P2+): Syllabus intelligence** — `KnowledgeCapability` real impl: `extract_syllabus_facts` tool, cached, provenance-tagged

**Wiring in P1:** `ExplanationCapability` calls `LlmExplainer` (new class) after `PlannerAgent` completes search and builds the trace. `LlmOrchestrator` (old tool-calling step-driver) is retained unchanged and still used by the `planner-run.ts` streaming endpoint — it is NOT called in the new `generate-plan.ts` path.

---

## Design Invariants

Every architectural rule future work must not violate:

1. **`SearchStrategy` never imports `ConstraintModel`.** It operates exclusively through `SearchDeps` closures. Any `SearchStrategy` that reaches into `ConstraintModel` internals violates this invariant.

2. **`PlannerAgent` owns `ConstraintModel`.** It is the only component that constructs, reads, or passes `ConstraintModel` to other parts. `SearchStrategy`, `BeamSearchStrategy`, and capability implementations receive closures, not the model object.

3. **`PlannerAgent` owns all capabilities.** No component below the agent layer (strategies, validators) may invoke LLMs, read syllabi, or enrich `CourseProfile`s. Only the agent decides when and which capability to invoke.

4. **`SearchResult.meta` is the primary debugging mechanism.** The per-depth `CandidateRecord[]` (considered actions, rejection reasons, scores, survivors) is the authoritative record of why a path was chosen. A final-state diff alone is never sufficient.

5. **`diffToTrace` is a fallback only.** It is used exclusively when a `SearchStrategy` does not produce `meta` (e.g. a future CP-SAT integration). For `BeamSearchStrategy`, `meta.chosenPath` is always the trace source.

6. **The LLM is never the planner.** It is invoked only after `PlannerAgent` has produced a final `PlanState` and trace. No LLM output may influence `SearchStrategy` execution, action selection, or scoring.

7. **`KnowledgeCapability` is on-demand, not a mandatory pipeline phase.** The agent decides when to invoke it. Missing or ambiguous course data discovered during reasoning may trigger enrichment; it is not a required pre-search gate.

8. **`detectGaps` is always pure and side-effect-free.** It scans `ConstraintModel.profiles` only; it never reads files, calls APIs, or mutates any state.

9. **`toProposal` Option B signature.** `toProposal(finalState, trace, model, initialState, pinnedHome?, rationaleOverride?)` — no live `PlannerWorker` instance passed. The `loadBeam` mutation path on `PlannerWorker` is never called from `toProposal`.

10. **`PlannerWorker`, `GreedyOrchestrator`, `LlmOrchestrator` are not modified in P1.** The streaming `planner-run.ts` endpoint uses them unchanged. P1 adds a new code path in `generate-plan.ts` only.

11. **All planner behavior changes require TDD.** Every new module has a failing test before implementation code. Every phase has a regression run before commit.

12. **No Alembic migrations applied without explicit user approval.** No deploys without explicit user approval.

---

## P1 Status — COMPLETE (2026-07-01)

All eight P1 phases shipped. Score vector is now **8D**. 564/564 tests green. `tsc --noEmit` clean.

| Phase | Commit | Description |
|---|---|---|
| Ph 1 | `cd18929` | SearchStrategy interface + types |
| Ph 1.1 | `a1e8dfe` | Tighten SearchStrategy interfaces |
| Ph 2 | `064e87b` | BeamSearchStrategy |
| Ph 3 | `48be405` | Capability interfaces + detectGaps |
| Ph 4 | `0c4d11a` | PlannerAgent |
| Ph 5 | `9f9e8cb` | Wire PlannerAgent into generate-plan |
| Ph 6 | `19f3045` | REPLACE_COURSE enumeration + g2/g4 scoring fixes |
| Ph 7 | `b440b05` | is_unwanted exclusion + unwanted_avoidance (g5b) |
| Ph 8 | `2fdb0d3` | rank_candidates sorted by plan score |

---

## Next Work — Recommended Starting Points

Decision required before implementing:

1. **Annual course deduplication (Section 4.3)** — needs a `root_course_id` / `annual_group_id` field to identify paired courses; `count_hours_once: boolean` alone is insufficient. Decide whether board_json already carries this field or whether the board schema must be extended first.

2. **Retire `generateCandidates`** (Section 7.4) — dead code post-beam-search. Straightforward cleanup PR, no decision needed.

3. **Multiple-track requirement architecture (Section 4.2)** — design session required; extends `CategoryReq` with `equivalentGroups` and `ConstraintModel` with `activeTrack`/`coRequisites`; affects `validatePlanProposal`.

4. **UI + client-engine cleanup (Sections 6.2, 7.5)** — wire streaming endpoint into UI and retire client-side JS mirrors; prerequisite: streaming endpoint proven stable in production.

5. **Real `KnowledgeCapability` (P2+)** — LLM/syllabus enrichment via `extract_syllabus_facts`; not in scope until core planning is proven stable in production.

**Hard boundaries (unchanged):**
- Do not apply Alembic migration without explicit user approval.
- Do not deploy without explicit user approval.
- Do not touch UI (Sections 6.x) without explicit approval.

---

## Security Invariants (Carry Forward)

- Do not apply Alembic migrations to Supabase without explicit user approval.
- Do not merge or deploy without explicit user approval.
- `.claude/settings.local.json` and `.claude/skills/` never committed.
- No API keys or credentials committed.
- Migration `d4e5f6a7b8c9_add_planner_runs_table.py` is committed only, NOT applied.

---

## Verification (Per Section)

| Section | Gate |
|---|---|
| 1.1 | `buildValidationContext` spy count === 1 per run |
| 1.2 | `priorHours` unit test: seeded board doesn't double-count |
| 1.3 | Non-ME semester board validates correctly |
| 1.4 | Short maxSteps run emits STOP with reason |
| 1.5 | Null-hours only board terminates in STOP |
| 2.3 (Phase 2) | `BeamSearchStrategy` width=6 on ME-2027: ≥2 distinct terminal plans, all valid; `meta.depthRecords` populated |
| 2.4 (Phase 3) | `detectGaps` returns expected gaps on board with null-hours/unresolved profiles |
| 2.1 (Phase 4) | `PlannerAgent` end-to-end: trace built from `meta.chosenPath`, not diffToTrace |
| 2.5 | REPLACE_COURSE in enumerateActions on sub-optimal board |
| 2.6 | Score vector unit tests for g2/g4 fixes |
| 3.1 | DB absent + local file → full universe (profile count check) — ✅ DONE |
| 4.2 | Equivalent group counted once |
| Full | `npm test` green (all suites); `tsc --noEmit` clean |
