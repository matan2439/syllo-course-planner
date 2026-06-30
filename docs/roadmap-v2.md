# Planner V2 Roadmap
_V1 complete (2026-06-30). This file is now the V2 roadmap._
_See `.remember/remember.md` for full canonical project state._

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
- Search: **Beam Search** (not A*, not MCTS, not greedy). See Section 2 for rationale.
- DB-less fallback: **Not acceptable**. Must always plan over the full course universe. See Section 3.

---

## Section 1 — Critical Fixes (P0, fix before any deploy)

### 1.1 Memoize `buildValidationContext`

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

### 1.2 Fix `priorHours` double-counting

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

### 1.3 Fix `KNOWN_SEMESTER_IDS` hardcoding

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

### 1.4 Emit STOP trace on step-limit hit

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

### 1.5 Exclude null-hours courses from degree fill

**Problem:** Courses with `hours: null` contribute 0 to `placedHours`. If only null-hours courses remain as eligible candidates for the degree-hours goal, the planner can loop placing and re-placing them (they satisfy g1's add-action filter but never advance the count).

**Solution:** In `enumerateActions`, when generating ADD actions for degree-hours fill (Group 4 / electives), filter out profiles where `p.hours == null || p.hours === 0`. They can still be added if they satisfy mandatory or category requirements (Groups 1–3).

**Affected modules:** `api/ai/planner_actions.ts`

**Tests to add:** Board with only null-hours electives remaining; assert planner emits STOP (not infinite loop) within maxSteps.

**Migration risk:** None.

**Priority:** P0.

---

## Section 2 — Search Architecture Evolution (P1)

### 2.1 Search Architecture Decision

**Current:** Greedy hill-climber with single-committed-path + myopic rollout.
- One path. Cannot backtrack. Committed decisions cannot be revisited.
- Rollout (`greedyComplete`) is itself myopic — deepens a bad choice instead of pruning it.
- Acceptance condition `fin > curFinal || imm > current` (OR) can commit a locally-better but globally-worse move.
- `generateCandidates` was implemented to branch on A/B placements but is never called; only one plan is returned.

**Why not A\*:** State space is exponential (each course can be placed in any of 4+ semesters). No tractable admissible heuristic. Memory cost is unbounded for the full search tree.

**Why not MCTS:** MCTS derives power from randomized simulation/rollouts for exploration. The determinism requirement eliminates its main advantage. UCB1 requires many random playouts per node — expensive and non-deterministic.

**Why not pure A\* with `estimateFinalScore` as heuristic:** `estimateFinalScore` is inadmissible (greedy rollout can be worse than optimal), so A\* cannot guarantee optimality anyway, with added memory overhead.

**Recommended: Beam Search with width k=4–8**

Beam search maintains k active `PlanState` beams simultaneously:
1. At each step, enumerate actions from ALL k beams → `k × |actions|` candidates.
2. Score each resulting state with `scorePlan`.
3. Keep the global k-best states (pruning the rest).
4. Repeat until all k beams are terminal.

Properties:
- **Eliminates rollouts.** The beam IS the lookahead — no `greedyComplete` needed. ~6× faster.
- **Deterministic** given fixed k and scoring function.
- **Naturally produces k terminal plans** → replaces `generateCandidates`.
- **Compatible** with `projectFeasibility`, `validatePlanState`, `scorePlan` unchanged.
- **Bounded memory:** O(k × |state|).
- **Each beam has its own trace** → explainability preserved.

### 2.2 Beam Search Implementation Plan

**New module:** `api/ai/planner_search.ts`

```ts
interface BeamState {
  state: PlanState;
  trace: PlannerAction[];
  score: number[];
}

function beamSearch(
  model: ConstraintModel,
  initialState: PlanState,
  opts: { width: number; maxSteps: number }
): BeamState[]
```

**Algorithm:**
1. Initialize with k=1 beam = initialState.
2. Each iteration:
   a. For each beam: `enumerateActions(beam.state, model)`
   b. For each action: apply tentatively, `projectFeasibility`, `validatePlanState`, `scorePlan`
   c. Collect all (resultState, score, action) tuples across all beams
   d. Sort by `compareScore` descending, keep top-k distinct states
3. Terminal: all beams have `isGoalReached` or no actions expand.
4. Return all terminal beams sorted by score.

**PlannerWorker changes:**
- `run()` delegates to `beamSearch` when `opts.searchMode === 'beam'`
- Greedy remains as fallback (`opts.searchMode === 'greedy'`)

**Affected modules:** New `api/ai/planner_search.ts`, `api/ai/planner_worker.ts`, `api/ai/generate-plan.ts`

**Tests to add:**
- Beam width k=1 produces same result as greedy (simple cases)
- Beam width k=4 on ME-2027 produces ≥2 distinct terminal plans
- All terminal plans pass `validateCandidate`

**Migration risk:** Medium. Worker interface changes. Greedy stays as fallback. No endpoint contract change.

**Priority:** P1.

---

### 2.3 Fix `REPLACE_COURSE` enumeration

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

### 2.4 Fix goal scoring bugs

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

## Section 3 — DB-less Path Fix (P1)

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

**Not used for:** Step-by-step course selection, scoring/ranking actions, any hard facts.

**Used for:**
1. **Explanation** — Hebrew prose derived from selected plan + trace
2. **Preference disambiguation** — interpreting `extra_request_he` free-text
3. **Syllabus extraction** — `extract_syllabus_facts` tool, cached, provenance-tagged
4. **Ambiguity resolution** — near-equal plans where tiebreaker requires preference interpretation

In V2: `LlmOrchestrator` runs AFTER beam search completes. It receives k terminal plans and generates explanation + ranked recommendation with rationale.

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
| 2.1 | Beam k=4 on ME-2027: ≥2 terminal plans, all valid |
| 2.3 | REPLACE_COURSE in enumerateActions on sub-optimal board |
| 2.4 | Score vector unit tests for g2/g4 fixes |
| 3.1 | DB absent + local file → full universe (profile count check) |
| 4.2 | Equivalent group counted once |
| Full | `npm test` green (all suites); `tsc --noEmit` clean |
