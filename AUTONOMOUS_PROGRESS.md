# Autonomous Progress

Durable handoff for the autonomous Syllo product-engineering routine. Read this
first; `.remember/current.md` is the detailed narrative log this summarizes
(read it for full root-cause writeups and prior-session detail).

_Last updated: 2026-08-14 (cont.), session on branch `ui/frontend-modernization`
(Slice 18A/18B: the wanted/avoided pickers are now HARD `must_include` /
`must_exclude` constraints enforced by a validation GATE, unsatisfiable requests
return a typed deterministic `infeasible` outcome instead of a degraded plan,
`balanced`/`compact` are user policies rather than alternatives, and the candidate
set now holds multiple genuinely different LEGAL course/period combinations found
by a bounded deterministic deviation of the SAME stable planner. Build green, API
139/1790 green, web 12/102 green. **Not merged, not deployed.** The mandatory
KnowledgeCapability sequence is recorded below and is required before the product
can be called complete.)_

_Previous entry: 2026-08-08, session on branch `ui/frontend-modernization`
(protected enrichment LIVE RUN executed after owner unblocked `workflow`
scope + `OPENAI_API_KEY`: workflow merged to `main` via PR #80, run
31251292816 performed a genuine `gpt-4o-mini` invocation, artifact
validated and grounded — but **no cache promotion is committable** (cache
homogeneity invariant + partial/failed/over-classified results), so the
committed cache stays `captured` unchanged. `semantic-only planner decision
acceptance: data-blocked` retained. All gates green. Production unchanged;
Vercel not Git-connected; no preview. See newest session section below.)._

## Session 2026-08-14 (cont.) — HARD wanted/avoided constraints + real multi-combination candidate search (Slice 18A/18B)

**Three binding product decisions were made by the owner this session and are now
authoritative policy:**

1. `balanced` / `compact` are user PREFERENCES/POLICIES that configure scoring and
   search — they are **not** the alternatives shown to the user.
2. Courses selected in the existing **"wanted"** and **"avoided"** pickers are
   **HARD constraints**, not best-effort preferences.
3. The final system must generate **multiple meaningfully different course-plan
   combinations** that all satisfy the same requirements, then rank and explain
   them using intelligent, source-grounded preferences.

### What shipped

**Baseline first.** The production build was missing after the previous final
commits — run at HEAD `2e95748` before any code change: **green**. API suite
green (136 suites / 1730 tests). The one full-UI-suite failure was confirmed to be
the long-documented jsdom **contention flake**, not a regression: the failing
suite passes alone, and a different suite fails at a different worker count.

**Slice 18A — correct constraint vocabulary + hard semantics.**
- `ConstraintModel` gained `mustIncludeCourseIds` (`must_include_course_ids`).
  `disallowedCourseIds` is `must_exclude_course_ids` (already hard). The SOFT
  channel `wantedCourseIds` (`prefer_course_ids`, the old `g5` best-effort
  behavior) is retained for backward compatibility but **the hard pickers no
  longer feed it** — the two sets are mutually exclusive by construction, so a
  hard selection can never also be scored as a tradeable preference.
- "Satisfied" is defined once, in `planner_goals.ts`: completed (academic
  history, never re-scheduled), currently taking, or fully placed.
- **Enforcement is a retention GATE, not a score term.** `validateCandidate` +
  `assessCompleteness` reject any plan with a missing hard inclusion regardless of
  score (`MUST_INCLUDE_ERROR_PREFIX`), `generate-plan`'s new `mustIncludeGate`
  turns it into a blocking error on BOTH the default and flagged paths, and
  `PlannerWorker.isGoalReached` no longer reports "goal reached" for such a plan.
  `g2a` also credits hard inclusions — but only as a **search gradient**; the gate
  is what makes them non-tradeable.
- Hard inclusions are seeded into `requiredButUnplacedCourseIds` /
  `requiredCourseSemesterBoundaries`, which is what makes `enumerateActions`
  group 1b propose them **and their prerequisite chains** unconditionally — the
  exact case the old soft path could never recover from once degree hours were
  already met. `recoverUnplacedWantedCourses` now recovers hard inclusions FIRST
  and **exempts them from the strict-improvement gate**: that gate was, for a
  hard constraint, precisely "a recovery mechanism that treats a missing
  hard-wanted course as acceptable".
- **New: `api/ai/hard_constraints.ts`** — deterministic pre-planning analysis
  returning a typed outcome (`feasible` / `infeasible`, `applyEligible`) with
  stable reason codes, affected course ids, conflicting constraints/facts, a
  concise Hebrew explanation, safe user-resolvable actions, and an
  **authoritative / non-answerable** flag. Codes:
  `wanted_and_avoided_conflict`, `wanted_course_not_in_catalog` (covers both
  catalog membership and catalog-integrity gaps),
  `wanted_course_unavailable_in_horizon`, `wanted_prerequisite_impossible`,
  `avoided_mandatory_conflict`, `wanted_exceeds_workload_cap`,
  `completed_status_contradiction`. The student is **never** asked to adjudicate
  an authoritative catalog fact. Deliberately NOT a conflict: an already-completed
  hard-excluded course (exclusion governs future scheduling; history stays truthful).
- `AcademicDecisionOutcome` gained **`infeasible`**, ranked above `blocked` and
  never apply-eligible; surfaced as `academicDecision.hardConstraints`.
- **Flag-off contract (documented + tested):** `AI_HARD_WANTED_CONSTRAINTS=false`
  routes the wanted picker back to the soft `g5` channel and produces no
  `mustIncludeCourseIds`; every new path is gated on that set being non-empty, so
  behavior is byte-identical to pre-Slice-18.

**Slice 18B — policy ≠ candidate identity, and real multi-combination search.**
- `candidate_set.ts` was rewritten. `generateCandidateSet` now takes **one
  resolved policy** and plans **every** candidate under it, with the same hard
  constraints, catalog and rules. After a confirmed `balanced`, no `compact` plan
  is retained (and vice versa).
- The balanced-vs-compact dual run survives ONLY as `probeBalanceImpact`, an
  internal elicitation probe that retains **no candidates**; `shouldAskBalanceQuestion`
  reads it. Answering still never auto-generates.
- **Search mechanism, chosen on repository evidence:** the single winner is chosen
  in exactly one place — `PlannerWorker.step()` commits the FIRST advancing action
  among already-legal, already-validated, already-ranked candidates. So the
  smallest mechanism that retains more than the greedy winner is a **bounded
  deterministic deviation**: `WorkerOptions.deviation = { atStep, rank }` commits
  the rank-th advancing action at one step, then continues greedily. **No second
  planner**, no randomness, no paid provider, bounded by `maxRuns` (default 8) and
  `maxCandidates` (default 3). (`planner_search_beam.ts` was considered and
  rejected: it drives the separate `PlannerAgent` path, so retaining its beam
  survivors would have meant switching production planning engines.)
- **Retention is the authoritative validator** (`validateCandidate`: completion,
  mandatory, categories, prerequisites, load caps, `must_exclude`, `must_include`)
  — a degraded plan is never an alternative. Zero valid candidates ⇒
  `outcome:'infeasible'`, `applyEligible:false`, never a fabricated plan.
- **Meaningful-distance rule (documented in-file):** two candidates differ iff
  their **normalized academic identity** — the sorted set of (course_id → period)
  pairs — differs. Invariant to object/array order, ids, explanation text and
  equivalent section ordering; and because one policy governs the whole set,
  balanced-vs-compact can no longer appear as a difference at all.
- **Ranking:** hard constraints/legality are the retention gate; retained
  candidates are ordered by the existing lexicographic `scorePlan` vector with the
  normalized identity as a stable final tie-break. Primary = rank 0.
  **No global-optimality claim is made** — this is a bounded deterministic search.
- **UI scope respected:** no candidate-comparison UI. The handler exposes only a
  **lean typed summary** (id, rank, normalized identity, selected flag, policy,
  profile version, provenance, course ids, factual differences, score vector) —
  no duplicate full plans. The UI still shows only the selected primary proposal;
  `infeasible` got a Hebrew label and reuses the existing blocking-errors
  disclosure.

### Verification (all run, all green)

- Production build at HEAD before changes, and again after: **green** both times.
- API suite: **139 suites / 1790 tests pass** (was 136/1730).
- `web/` suite: 12 suites / 102 tests pass. `tsc --noEmit` clean for both roots.
- New suites: `hard_wanted_constraints` (27), `candidate_multi_combination` (20),
  `generate_plan_hard_constraints` (11, through the REAL handler).
- Two pre-existing tests were updated because the NEW POLICY changes their
  expected behavior, and both changes are the policy working as intended:
  excluding a mandatory course now reports the more specific `infeasible` rather
  than the generic `blocked`; and a hard-wanted course with no sound catalog
  record now **blocks instead of being silently dropped**.
- `tests/ui/course_details_panel.test.js` contains a working-tree scope guard
  (`git diff HEAD -- api` must be empty) — it trips on any uncommitted backend
  work and clears once committed. Not a behavioral failure.

### Not done in this session (deliberately, per instruction)

No merge, no deploy, no internet access, no syllabus ingestion.

## KnowledgeCapability continuation contract (MANDATORY next sequence)

**The product is NOT complete until every item below is implemented and proven.**
Slice 18B deliberately ranks candidates on the objectives that exist today
(completion, requirements, legality, the confirmed distribution policy, existing
soft interests, difficulty). Product decision #3 requires ranking and explanation
grounded in **real, sourced course knowledge**, which does not exist yet. The
ranking stack already has a reserved slot for it, so these capabilities plug in
without another refactor. Implement in this order:

1. **Authoritative source registry and evidence model** — which sources are
   authoritative for which facts, with a typed evidence record (claim, source,
   retrieval time, confidence, provenance chain).
2. **Syllabus/document acquisition from official sources** — fetch from official
   TAU endpoints only; respect robots/ToS; no scraping of unofficial mirrors.
3. **Version / year / program matching** — bind each acquired document to the
   exact program version and catalog year it describes; never apply a document to
   a program version it was not published for.
4. **Structured extraction** — topics, assessment structure, project/lab content,
   workload signals, and skills, as typed records with per-field confidence.
5. **Conflict and freshness handling** — detect contradictions between sources,
   detect staleness, and surface both rather than silently choosing a winner
   (reuse the existing authoritative / non-answerable distinction).
6. **Deterministic cached course-knowledge records** — versioned, content-addressed,
   reproducible; the planner must never depend on a live fetch at request time.
7. **Map knowledge into explicit planner objectives** — each objective typed,
   separately toggleable, and slotted into the documented ranking order.
8. **Evidence that each objective changes ranking** — a test per objective proving
   it reorders candidates on a real fixture. An objective that cannot be shown to
   change ranking must not ship.
9. **Top-K candidate comparison using those grounded objectives** — the candidate
   set from Slice 18B, ranked and compared on real knowledge rather than
   structural facts alone.
10. **Explanation with source attribution** — every claim in a candidate's
    explanation traceable to an evidence record from step 1.

Only after step 10 does product decision #3 ("rank and explain them using
intelligent, source-grounded preferences") hold end to end.

## Session 2026-08-14 — completed-course knowledge + native completion workflow (flagged Apply UNBLOCKED)

**Blocker resolved.** The prior session's acceptance blocker (valid flagged Apply unreachable)
is closed: `outcome:'proposal'` / `applyEligible:true` is now reachable through a legitimate
explicit answer, and a real flagged Apply committed the board exactly once in the browser.

### Phase 1 — legacy archaeology (app/web/semester_board_viewer.html)
| Question | Finding (file evidence) |
|---|---|
| Modal | `openMyCoursesModal()` (13460) + `_renderMyCoursesGrid()` (13605); reached from the AI path via `OPEN_COMPLETED_COURSES` → `openCompletedCoursesUi()` (12814) |
| Course list | `YEAR_1_2_MANDATORY_COURSES` (2018–2043) — 24 static TAU-ME courses `{course_id,name_he,semester,credit_hours}`, grouped by `YEAR_1_2_SEMESTERS` |
| Why Years 1–2 | Those courses are **NOT in the board catalog** — the board holds Year 3+ only (comment at 2044–2047: they are not in `courseMap`, so accounting must fall back to the static table) |
| Electives | **Mandatory only** — no completed-elective path existed (the gap the user reported) |
| Status values | 4-way `not_taken | completed | currently_taking | planned` (`STATUS_SHORT` 13608) |
| Untouched | `getUserStatus` (13370) defaults to **`not_taken`** — legacy had NO `unknown`; untouched silently meant "not taken" |
| State owner | `userCourseStatuses[cid] = {status, planned_semester, override_reason}` |
| Persistence | `localStorage` `tau_user_course_statuses_v1` (2254), migrated from legacy `tau_my_courses` — survives refresh |
| Payload | `personal_status {completed,currently_taking,planned}` of `{course_id,name_he,hours}` (2383–2402); `not_taken` skipped (2386); ids in neither courseMap nor the Y1–2 table dropped (2393); **sent only when a list is non-empty, else `undefined` (2593)** → legacy also conflated "none" with "unknown" |
| Hours | `known_completed_hours = completed_status_hours` (2488–2499) — **DERIVED from the identified completed courses' authoritative hours**, not an independent aggregate (a separate manual `degreeHoursProfile` total also exists) |
| Planner consumption | completed ids → `excludedFromProposalIds` (2413) so never re-proposed; `_categoryPlacedCount` (2433) counts completed toward categories; `_year12PrereqIds` (11307) for prerequisites |
| Reusable vs replaced | REUSED: status vocabulary, authoritative-hours accounting, dedup/no-reschedule, category/prereq consumption. REPLACED: innerHTML grid, localStorage globals, the `not_taken` default |

### Contracts introduced
**Completed courses** — `api/ai/academic_status_knowledge.ts`:
`CourseIdKnowledge = known | known_empty | unknown` + provenance
(`explicit_user | authoritative_board | imported_record`). Wire marker
`plan_context.personal_status.completed_knowledge {status,provenance}`. **Absent → unknown**
(every legacy/unflagged caller byte-identical). A `known` claim with an unrecognized/absent
provenance falls back to unknown (fail-safe). `canonicalizeCourseIds` trims + de-dups
deterministically and never drops an unknown-to-catalog id silently.
`recognizedCompletedHours` sums only AUTHORITATIVE credits of uniquely identified courses —
derived, never additive onto an aggregate → **no double counting**; there is no code path from
an hours number to a course identity.

Server rule (`academic_clarification.ts`): the completedCourses gap now fires only while the set
is UNKNOWN. Not weakened — it stops conflating "none" with "never asked".

**Exclusions** — already correct server-side (`resolveHardExcludedCourseIds` returns `undefined`
when absent, `[]` when explicitly empty); the native UI simply never sent the key. Now: non-empty
selection = explicit; empty becomes an answer only via "אין קורסים שאני רוצה להימנע מהם" → `[]`;
untouched stays absent/unknown.

### Native workflow (replaces the legacy modal)
`shared/planner/early_year_courses.ts` — the Years 1–2 structure as typed DATA keyed by program
id (documented limitation: the catalog cannot identify early years, so this is the smallest
explicit typed configuration; components hold no course ids, other degrees are added as data).
`web/app/components/CompletedCoursesPanel.tsx` — **tri-state** per course
(completed/not_completed/**unknown**), explicit "none of these", catalog-backed completed-ELECTIVE
picker (new capability), removal/correction, recognized-credits summary from authoritative hours
only. Editing clears the confirmation and bumps a status version → a proposal built from older
status is stale → Apply blocked until an explicit Rebuild. Nothing in the panel Generates.

### Browser re-acceptance (local non-prod harness, deterministic)
- Unanswered Build → `clarification_required` / `applyEligible:false`, both criticals retained
  (**unknown is not treated as empty**).
- Panel saved as explicit "none" + explicit no-exclusions → Rebuild → `outcome:'proposal'`,
  `applyEligible:true`, criticals `[]`; candidates still the owner (`legacy_default`, proposal
  identity === `selectedNormalizedIdentity`).
- **Valid flagged Apply committed exactly once**: board went empty → C1@A + C2@B, draft cleared,
  Apply button removed (repeat structurally impossible), confirmation posted.
- One Build click = exactly one Generate (controlled delta); saving status / answering exclusions
  never generated.
- mechanical_engineering_2027: 4 semester fieldsets, **24 course groups**, explicit-none button,
  RTL, no horizontal overflow. Tri-state verified live (toggle returns to unknown); credits
  4.0 → 6.0 from authoritative data, each course counted once.
- Flag-off: no panel, no conversation, no new control, standalone Build, board renders — unchanged.
- Console/network: clean at rest (board 200, no error alert); earlier console entries are
  historical residue from the pre-fix load and the server-restart window.

**Verification:** full API **1730** (136 suites), full web **102** (12 suites), root+web tsc clean.
Commits: `8efadca` (knowledge contract), `aad8b21` (native completion UI + wiring).

**Remaining gaps (honest).** Category RECOGNITION for completed electives is not asserted by the
UI (it shows credits only and states that category comes from catalog data); the server's existing
authoritative rules do the category counting — a dedicated "uncertain recognition" surface is not
built. `known_completed_hours` remains the separate legacy aggregate the student types; it is NOT
merged with panel-derived credits (no double count, but also no unification yet). Wanted-course
semantics unchanged (soft/best-effort). currently_taking/planned are not collected natively.

## Session 2026-08-13 — flagged AI-planner journey: real-browser Preview acceptance

**Preview identity.** Local non-Production Preview (the only environment satisfying every
constraint: no Supabase, no paid provider, deterministic, non-prod). `dev_api_server.ts`
(`AI_DEV_MODE=true AI_DEV_BYPASS_QUOTA=true`, real root handlers, `DATABASE_URL=unset` →
`loadLocalBoardJson`, no DB/LLM) on :3002 behind `next dev` (:3001, `PLANNER_API_ORIGIN`
proxy). Deterministic Generate ≈15–30ms on the small fixtures (the 30–134s figure was the
full mechanical board), so the next-dev proxy timeout does NOT apply here. Vercel Production
untouched, no deploy, no alias change.

**Preview-only feature enablement (new, prod-safe).** `web/app/planner/native/agent-preview/
page.tsx` mounts `NativePlannerJourney` with `useAcademicDecisionAgent` on. Gated by
`process.env.ENABLE_ACADEMIC_AGENT_PREVIEW === '1'` (set only in git-ignored `web/.env.local`)
→ `notFound()` in every Production deployment; the canonical `/planner/native` page is
byte-identical and flag-off. `?program=` passes straight through (bypasses the registry) so
board fixtures are reachable; `?agent=0` renders the unflagged legacy path for comparison.
Fixtures: `test_program_agent_preview_2027` (2×8h dual electives, 16h target → material
balanced [8,8] vs compact [16,0]); `test_program_dual_balance_2027` (+`board_data_version` →
converged, 1 candidate, balance question suppressed). Commit `39c6f8c`.

**Verified in the REAL browser (accessibility-tree + network evidence; pixel screenshots
unavailable — Browser pane not composited).**
- Flag-off baseline (agent=0): board renders, NO conversation panel, standalone Build, legacy
  proposal [8,8], no candidate metadata leak, valid Apply commits exactly once, draft clears.
- Flag-on initial: `PreferenceConversation` visible, one question at a time, RTL, natural
  Hebrew (no ids as labels), "לא משנה לי" present, explicit Build, Build available without
  answering.
- No-auto-generate PROVEN by network count: select choice / "לא משנה לי" / free-text submit /
  confirm interpretation / remove all left the Generate count unchanged; only Build/Rebuild
  POSTs generate-plan.
- Candidate orchestration RAN in-browser and the proposal MATCHED the selected candidate
  (`selectedNormalizedIdentity` === the rendered board) every Build. First Build (no balance
  answer) → `legacy_default`, [8,8], validCandidateCount 2, hasMeaningfulAlternatives true.
  balanced → `confirmed_balanced` [8,8]; compact → `confirmed_compact` [16,0] (different
  candidate id; consolidation, not a first-semester bias — balanced distributes A+B);
  indifferent → `legacy_default`, identical candidate id/identity to neutral. Balance question
  appears once, is not re-asked after answering, and uses correct tradeoff Hebrew.
- Mobile 375px: no horizontal overflow, dir=rtl document+main.

**Defect found + fixed (RED→GREEN, TDD).** Impact-driven balance suppression only reacted to
`elicitationContext` at mount / on user transitions, so a `semester_balance` question already
on screen was NOT retracted when the first Build revealed the candidates converge
(`balanceAlternativesMaterial===false`) — it stayed askable though it could no longer change
the plan (acceptance blocker: "converged scenarios show no unnecessary question"). Fix:
`conversation_state.refreshQuestion` re-selects the current question against the latest ctx
(only while awaiting a question — never disturbs a pending confirmation/conflict/profile) +
a `PreferenceConversation` effect keyed on the irrelevant-topics set. New test
`PreferenceConversation.test.tsx` "reactive gating"; verified in-browser on the converged
fixture (balance question → time_of_day after Build). Commit `e50b493`.

**BLOCKER (pre-existing, unresolved) — flagged Apply unreachable in-browser.** The
`AcademicDecisionAgent` marks `completedCourses` and `excludedCourses` as CRITICAL clarifications
(academic_clarification.ts); unmet criticals → `outcome:'clarification_required'` →
`applyEligible:false` → `isProposalApplyable` correctly blocks Apply. The native `buildRequest`
hardcodes `personal_status.completed:[]` (prior completion is modeled as HOURS, no completed-
course-IDs input) and only sends `disallowed_course_ids` when the exclude picker is non-empty,
so `completedCourses` can never be cleared through the browser → a valid flagged Apply is not
reachable. Confirmed by curl: supplying `completed:[…]` + `disallowed_course_ids:[]` flips the
outcome to `proposal`/`applyEligible:true`. This is PRE-EXISTING (Slice 4 gating + native
completion-as-hours), surfaced by the first real browser journey. NOT fixed here (adding a
completed-courses input = new product capability, out of scope; changing clarification
criticality/sourcing = regression-sensitive core change — "do not weaken validation"). The
safety invariants it enforces are all correct (blocked/stale/version-mismatch/clarification
proposals cannot Apply; committed board never changes before a valid Apply). Recommended future
fix: source `completedCourseIds` from the board's `metadata.completed_course_ids` (+ the
journey's known_completed_hours), and send the exclude picker's value as `[]` when empty, so the
native journey answers the criticals it legitimately owns without weakening prerequisite checks.

**Late-response / stale Apply.** `NativePlannerJourney.build()` token guard (`++tokenRef.current`,
drop when `token !== tokenRef.current`) + version-gated `isProposalApplyable` — a browser race is
not reliably reproducible at ~20ms responses; covered by `NativePlannerJourney.agent.test.tsx`
(late response dropped; edit→stale→Apply rejected). In-browser: answering after a Build kept the
proposal non-applyable (version advanced), Apply stayed disabled.

**Automated verification (post-fix).** root tsc ✓; web tsc ✓; full API 1713/1713 (134 suites);
full web 92/92 (11 suites); web production build ✓ (new route builds dynamic/env-gated,
/planner/native unchanged). Lint not run (ESLint not non-interactively configured — pre-existing).

**Verdict.** Flagged journey is correct and browser-verified through conversation → Build →
candidates → balance question (+ materiality suppression) → answer → stale → Rebuild →
policy-selected proposal. Apply lifecycle on the flagged path is BLOCKED by the completedCourses
critical clarification (no native answer surface) → NOT production-ready for the flagged path;
flag-off unchanged. Do not recommend Production. Next smallest step: source completed courses
from board metadata / prior-hours so the flagged proposal reaches `applyEligible` legitimately,
then re-run the Apply-lifecycle acceptance.

## Session 2026-08-13 — candidate-set correctness gates (priority audit + neutral legacy selection)

**Gate 1 — objective-priority audit (no comparator change).** Traced the score vector
`[g1,g2a,g2b,g3,g4a,g4b,g5,g5b,gFit,g6]`. Finding: the order does NOT violate the required
hierarchy. HARD-AVOIDED (disallowed) is enforced at enumeration + validation
(`isCourseExcluded` gates `enumerateActions`; `validatePlanState` fails a plan with a
disallowed course) — ABOVE all scoring, so distribution can never place a hard-avoided
course. g5 (wanted) / g5b (unwanted) are SOFT terms, correctly BELOW the distribution
slots (distribution = required item 6, soft preferences = item 7); there is NO hard-wanted
gate (wanted = soft reward + recovery). Reordering would wrongly promote soft-wanted above
distribution and change legacy behavior → the correct action is to PROVE, not reorder.
`planner_priority_audit.test.ts` (6): disallowed never placed under any policy; distribution
can't defeat completion/mandatory; legal wanted still placed under compact. Test-only commit.

**Gate 2 — neutral = canonical legacy result (fix).** selectCandidate(neutral) no longer
means "first candidate" (order-dependent). `generateCandidateSet` runs an explicit 'neutral'
pass → records `legacyIdentity` (the flag-off stable result); neutral/indifferent selection
matches that identity independent of array/generation order; `selectionReason` labels it
`legacy_default` (never preference-derived). Proven: neutral == flag-off stable result;
reversing generation order doesn't change neutral selection; indifferent == neutral.
`candidate_set_neutral.test.ts` (4).

**Deferred — live candidate wiring (objectives 3–5).** Both gates were the explicit
prerequisite ("do not wire until proven") and are now proven. The live wiring (single
orchestration owner in generate-plan building the proposal from the selected candidate +
response metadata + impact-driven balance question through the real conversation state
machine + full Build→candidates→question→proposal→Apply lifecycle) is a large,
regression-sensitive refactor of the intricate planner-execution block — next session.
Note: the resolved distributionPolicy is ALREADY threaded into the single planner run
(17A), so the current proposal already reflects the selected policy; the wiring adds
candidate metadata + the gated question, ideally by building the proposal from the
candidate set as the single owner.

## Session 2026-08-13 — live candidate orchestration + impact-driven elicitation

**Slice 1 — candidate set is the single flagged proposal owner** (committed). generate-plan's
flagged path runs `generateCandidateSet` (neutral+balanced+compact through the SAME stable
planner over the current board/initialState — never emptyState), validates + dedups, selects
by resolved policy or canonical `legacy_default`, and builds the proposal from the SELECTED
candidate's exact PlanState (one selected state, one toProposal path, no post-selection rerun).
Provenance proven: proposal normalized identity === selected candidate id. Rationale parity:
the candidate carries `worker.explain().summary_he`, so the proposal is byte-identical to the
default single-run for the same state (fixed a rationale-only parity break found via
systematic-debugging). Lean metadata at `academicDecision.candidates` (selectedCandidateId,
selectedPolicy, selectionReason, validCandidateCount, hasMeaningfulAlternatives, converged,
contributingPolicies, differenceSummary, profileVersion, selectedNormalizedIdentity) — no full
PlanStates to the UI. Neutral/indifferent == flag-off (order-independent). Flag-off unchanged.
Tests: generate_plan_candidate_orchestration.test.ts (7); full API byte-identical.

**Slice 2 — impact-driven balance elicitation** (committed). `hasMeaningfulAlternatives` threaded
wire→adapter→GeneratedPlanModel.balanceAlternativesMaterial → the mounted journey passes an
ElicitationContext to PreferenceConversation; when a Generate's candidates showed no material
difference, semester_balance is marked `irrelevantTopicIds` so the REAL elicitation skips it (no
parallel store/banner). Test: PreferenceConversation (+1). Existing journey lifecycle tests
(answer≠Generate, edit→stale, Rebuild→profile, version-gated Apply) unchanged.

**Wanted-course semantic gap (recorded, unchanged):** disallowed/avoid is hard (enumeration +
validation); WANTED remains soft/best-effort (g5 + recovery) — the system does NOT guarantee
inclusion of every explicitly wanted course. Not redesigned (out of scope).

## Session 2026-08-12 (cont. 4) — Slice 17A investigation gate + planner policy consumption

**Investigation gate (mandatory, evidence-based).** Traced generate-plan → PlannerWorker →
scorePlan → PlanState:
- `PlannerWorker.step()` (planner_worker.ts:356-445) enumerates ALL legal mutations
  (`enumerateActions`), applies each to a `next` state, scores each with `scorePlan` (imm),
  sorts by `compareScore`, rollout-scores top-N (`estimateFinalScore`), accepts the best
  that advances. So scoring drives SELECTION, not just evaluation.
- `enumerateActions` emits "one alternative ADD_COURSE per legal semester"
  (planner_worker.ts:264) — semester placement for a dual-period course is chosen by
  `step()`'s scorePlan/compareScore comparison.
- g4a (peak) / g4b (spread) live in the score vector and participate in that per-step
  selection + rollout. Changing them CAN change the selected placement.
- Semester-A bias exists only on EXACT score ties (stable sort keeps enumeration order =
  earliest first) — the existing deterministic legacy tiebreak.
Conclusion: the stable planner already retains alternatives long enough for scoring to
affect selection. No new choice boundary needed for 17A — thread the policy into scorePlan
via the shared `model` (reaches every call), provable end-to-end via PlannerWorker.run().

**Slice 17A — real distribution-policy consumption** (committed). `scorePlan` reads
`model.distributionPolicy` for its OWNED slots (g4a/g4b) only: neutral/balanced = legacy
peak-then-spread (byte-identical); compact = fewer ACTIVE periods (order-invariant, no
earlier-period reward). Threaded via `DistributionPolicy` on `ConstraintModel` +
`BuildModelOptions`; generate-plan resolves the policy ONCE from `preference_profile`
(single source of truth, also drives eligibility disclosure) → `buildModel`; neutral →
undefined (byte-identical). Response exposes `academicDecision.distributionPolicy` +
provenance. End-to-end proof: PlannerWorker selects [8,8] under balanced, [16,0] under
compact on the same fixture. Priority preserved (g1/g2/g3 dominate). Full API 1684/1684.

**Slice 17B — internal validated candidate set** (committed). `candidate_set.ts`:
same engine per policy → existing validator → normalized-identity dedup → deterministic
FNV-1a id → real diff summary; `selectCandidate` (confirmed pref → matching candidate;
neutral → legacy first); `shouldAskBalanceQuestion` (ask one question only when ≥2
distinct legal candidates differ materially and unanswered; never on convergence).
Convergence → one candidate + empty summary. Internal module only — NOT yet wired into
the live proposal path (single-proposal UI unaffected); no Simulation/Decision/UI.
12 tests. **Remaining:** wire candidate generation + selection + the gated question into
the live flagged generate path (the single-proposal UI receives only the selected
candidate) — the final integration step.

## Session 2026-08-12 (cont. 3) — live conversation integration closure + distribution-policy mapping

**Integration closure (Slices 13/14 live).** `NativePlannerJourney` now mounts the real
`PreferenceConversation` on the flagged path. Single source of truth: the component owns
the one typed `ConversationState`; the journey mirrors only the profile VERSION scalar
(staleness) + holds the latest profile in a ref (Build payload). The conversation's
`onBuild(profile)` is the sole generation trigger when flagged (standalone Build renders
only flag-off). Proven end-to-end (no browser): answers/confirm/reject/edit/remove never
Generate; explicit Build sends the exact typed `preference_profile {version,preferences}`;
edit-after-Generate advances the version → proposal stale → the REAL Apply handler rejects
it (isProposalApplyable currentProfileVersion + the hard `apply()` guard, not a disabled
button); a late response superseded by a newer Build is dropped by the existing generation
token; valid Apply commits once. Flag-off byte-identical. `PreferenceConversation` no
longer calls `markPlanning` on Build (generation ownership belongs to the real action).
Tests: `NativePlannerJourney.agent.test.tsx` (7). Commit — feat(web): ...slice 13/14 closure.

**Slice 17A part 1 — distribution-policy mapping** (`distribution_policy.ts`):
`resolveDistributionPolicy` maps a confirmed active `semester_balance` → balanced|compact|
neutral; never infers compactness from missing data; provenance preserved. 6 tests.
**Deferred (own session, regression-sensitive):** 17A scorer consumption (make g4a/g4b
policy-dependent + thread through PlannerWorker/generate-plan; neutral must stay
byte-identical) and 17B (candidate-set retention + normalized dedup + preference-sensitive
elicitation). Design ready.

## Session 2026-08-12 (cont. 2) — preference lifecycle through Generate (14) + conversation UI (13)

**Slice 14 — preference lifecycle through Generate + Apply version gate.**
`preference_eligibility.ts` (`effectivePlannerPreferences`): classification filtering
BEFORE planning — confirmed hard→legality bucket, confirmed soft/goal→ranking bucket,
indifferent/uncertain/unconfirmed→excluded with a deterministic reason (never silently
dropped); source preserved (safe_default distinguishable). Generate request gains optional
typed `preference_profile {version,preferences[]}` (typed profile is the source of truth,
not the transcript). Flagged response echoes `academicDecision.profileVersion` +
`preferenceEligibility {hard,soft,excluded}`. Apply boundary (`isProposalApplyable`) now
rejects a flagged proposal whose `profileVersion` differs from / is missing against the
current draft profile version — at the real gate, not UI-hidden. Flag-off byte-identical.
No scorePlan consumption claimed (that's 17); unsupported categories stay typed, never
become hard constraints. Tests: preference_eligibility (5), generate_plan_preference_profile
(4), apply-eligibility (+4). Commit — feat(agent): ...slice 14.

**Slice 13 — native conversation UI (component).** `PreferenceConversation` is a thin
driver over the REAL `conversation_state` machine + elicitation (no parallel model): one
question at a time, options + "לא משנה לי" + free text, confirmation for vague consequential
answers, "מה הבנתי ממך" summary with remove, ready-to-build state. Answers/confirm/reject/
remove update DRAFT state only and never Generate; only Build calls onBuild(profile). Added
`removeCapturedPreference`/`rejectPending` transitions. 9 behavioral tests. web tsc clean.
**Remaining integration:** mount `PreferenceConversation` in `NativePlannerJourney` and route
its `onBuild` through the real generate request (`preference_profile` + `currentProfileVersion`
into `isProposalApplyable`). Deferred to keep the change safe (no broad journey redesign this
budget).

**Slice 17 — NOT STARTED** (planner balance policy + candidate-set retention + dedup). Design
ready from the Slice 16 investigation (two balance policies over the stable scorer,
candidate contract). It touches core `scorePlan`/candidate machinery and must preserve every
planner regression — reserved for its own full-rigor session.

## Session 2026-08-12 (cont.) — preference elicitation core + outcome details (slices 9–12, 15) + candidate investigation (16)

**Slice 10 — typed preference model** (`preference_model.ts`): generic Preference
(id, category, originalWording, normalized, value, classification [hard_constraint|
soft_preference|goal|indifferent|uncertain], confidence, source, confirmationStatus,
affects, scope/expiry, mayAffectPlanningBeforeConfirmation) + versioned
PreferenceProfile. Invariant: vague → uncertain + inert, never a hard constraint.

**Slice 11 — DeterministicPreferenceElicitation** (`preference_elicitation.ts`):
impact-driven single-question selection over a generic catalog; skips known/irrelevant/
cosmetic; sufficiency = nothing impactful left; vague answer → uncertain +
requiresConfirmation; contradictions surfaced. No external provider.

**Slice 12 — conversation state machine** (`conversation_state.ts`): typed bounded state
(status/profile/currentQuestion/pendingInterpretation/conflicts/proposalProfileVersion/
rebuildRequired). Answers update draft only, never auto-generate; proposal records
profile version; later change → stale + rebuildRequired; revise bumps version.

**Slice 9 — AgentOutcomeDetails** (web): accessible progressive disclosure (aria-expanded
toggle, labelled region, text-not-color) for clarification_required/validation_failed/
blocked/error; answerable vs authoritative distinction, provenance, safe error copy.
Lean VMs threaded wire→adapter→GeneratedPlanModel→DraftVM; rendered in the draft view.

**Slice 15 — authoritative_resolution.ts**: narrow auditable domain contract for an
AUTHORIZED actor to correct an academic fact (fixed AUTHORITY_TYPES; requires
provenance+actor+timestamp+original facts). Rejected without authority/provenance.
Contract only — no student-facing control, no persistence.

**Slice 16 — candidate-readiness investigation (read-only).** `scorePlan` (planner_goals.ts)
is a lexicographic vector `[g1,g2a,g2b,g3,g4a,g4b,g5,g5b,gFit,g6]`:
completion(g1) > mandatory(g2a) > categories(g2b) > legality/workload-cap(g3) >
balance-peak(g4a) > balance-spread(g4b) > wanted(g5) > unwanted-avoid(g5b) >
interest-fit(gFit) > difficulty(g6). **Exam load, morning/free-days: NOT represented.**
The `PlannerWorker` is greedy/rollout (topN) and `BeamSearchStrategy` (beamWidth 6)
collapse to ONE `getPlan()` — no distinct candidate SET is retained/compared. Alternatives
are discarded at each step's topN truncation and final single-plan selection. Dual-semester
A/B: balance (g4a/g4b) already lets B be chosen to cut peak ("[16,4] beats [20,0]"), but
the course is placed once, not kept as an alternative; `semester_balance` (compact vs
balanced) preference is elicited but NOT yet consumed by scorePlan (always balances).
**Smallest next candidate slice:** run the stable planner twice under two balance policies
(balanced vs compact) → two distinct legal candidates distinguished by `semester_balance`;
reuses existing scoring, needs no new search. (Deferred — Simulation/Decision not authorized.)

Remaining: Slice 13 (full conversational UI) and Slice 14 (thread confirmed preferences +
profile version through Generate, stale-profile Apply rejection) — next.

## Session 2026-08-12 — class-native grounding/validation/clarification stages (slices 5–8)

**THERMO-2 web test** — diagnosed (systematic-debugging) as a STALE test, not a
regression: commit 92f473a turned the native exclude control into a CourseNamePicker
(id added only on ranked-match selection); the MVP test (e7c0e14) typed a raw id and
expected exclusion without selecting. Hard-exclude mapping intact; planner invariant
covered by API regressions. Fixed by driving the picker (add THERMO-2 to the board,
type the name, select) — committed separately.

**Slice 5 — class-native GroundingCapability.** `AcademicDecisionAgent.run()` now owns
grounding: narrow `GroundingCapability` + default `PlanGroundingCapability`, invoked
AFTER Plan (grounds placed courses — documented ordering deviation), returned on
`AcademicDecisionResult.grounding`. Wrapper no longer calls `groundPlan` (single owner).

**Slice 6 — grounding-consuming ValidationCapability.** `DeterministicGroundingValidation`:
class-native stage turning unresolved authoritative conflicts into typed,
provenance-carrying findings (`GROUNDING_AVAILABILITY_CONFLICT` /
`GROUNDING_COMPLETION_CONFLICT`, severity error) that block Apply. Never re-plans,
never picks a source, never downgrades known facts or blocks on non-critical unknowns.
API `validation_failed` now derived from `agentRun.validation.applyBlocked` (real agent
result, not an API re-count); findings at `academicDecision.validationFindings`.

**Slice 7 — unified structured clarification.** `buildStructuredClarification` projects
clarification + validation into one list preserving the distinction:
`answerable_preference` (user-resolvable, answerType+inputKey; critical blocks Apply) vs
`authoritative_conflict` (answerable:false, provenance, blocks Apply — user never asked
to invent academic truth). At `academicDecision.structuredClarification`.

**Slice 8 — dev-only native flag.** Injectable `useAcademicDecisionAgent` prop (default
false) on `NativePlannerJourney`; Build sends `use_academic_decision_agent:true` only
when set. Production page never sets it → feature stays off. Tests prove both payloads.

Final `AcademicDecisionAgent.run()` sequence: Observe → detectGaps → Clarify → Plan
(injected stable planner) → **Ground** → **GroundingValidation** → (state Validate if
wired) → Simulate → Decide → Persist.

Verification: API 1623/1623, web 64/64, root+web tsc clean. Lint: ESLint not configured
in repo (interactive setup prompt) — pre-existing, unchanged. No paid provider, no
Supabase, no browser/Preview. Production/main/Vercel/env unchanged.

## Session 2026-08-11 (cont.) — real AcademicDecisionAgent class integration + Knowledge Grounding (owner-authorised)

Owner authorised integrating the real `AcademicDecisionAgent` class behind the
default-off flag, with the stable planner injected as its PlanningCapability (no
emptyState re-planning, proposal parity preserved).

**Slice 1+2 — real class/factory executes on the flagged Generate path** (commit
`1c262fb`). New `academic_decision_integration.ts` is the injection seam: reuses
the already-loaded board + already-built model as the ProgramProvider, wraps the
stable planner's final `PlanState` as the injected `AgentResult`, reuses the
already-computed `ClarificationResult`. So the real class runs its full
Observe→detectGaps→Clarify→Plan→Validate→Decide→Persist pipeline while the plan
stays byte-identical. `academicDecision.orchestration.engine ===
'AcademicDecisionAgent'` is class-only proof (adapter fallback marks
`'runtime-adapter-fallback'`). LEGACY_KEYS untouched (metadata nested inside
`academicDecision`). Controlled failure → adapter fallback, committed state never
touched. TDD: `generate_plan_academic_decision_agent_class.test.ts` RED→GREEN.

**Slice 3 — plan-inert Knowledge Grounding on the flagged path** (commit
`22f8913`). New `plan_grounding.ts` classifies every placed course's facts as
known/unknown/inferred/conflicting with provenance, and surfaces structured
conflicts (catalog `offered_semesters` vs normalized `effective_allowed_semesters`;
user-asserted-completed course also placed). Deterministic, no LLM/I/O, never
mutates the plan or fabricates a fact. Invoked from `academic_decision_integration.ts`
on the real flagged path (not a bare unit call), exposed at
`academicDecision.grounding`. TDD: `plan_grounding.test.ts` (8 unit) + integration
assertions (invoked/plan-inert/grounds-only-placed) RED→GREEN.

**Slice 4 — structured agent outcomes + Apply-eligibility** (commit `2e7aa65`).
`classifyAgentOutcome` (error > blocked > clarification_required > proposal) at
`academicDecision.outcome`; `applyEligible` server floor (true only for a clean
proposal). A draft is always still returned; Generate never mutates the committed
board. TDD: `academic_decision_outcome.test.ts` + integration outcome assertions
RED→GREEN.

**Slice 3b — grounded conflicts drive a structured outcome** (commit follows).
An unresolved grounding conflict on a placed course now yields
`academicDecision.outcome='validation_failed'` + `applyEligible=false` instead of a
clean proposal; neither source is silently chosen, the plan is unchanged, both facts
+ provenance survive. Outcome precedence: error > blocked > clarification_required >
validation_failed > proposal. TDD: `generate_plan_grounding_conflict.test.ts`
(full-boundary, generic mocked synthetic board — no catalog patch) +
`academic_decision_outcome.test.ts` RED→GREEN.

**Slice 4-ui — native contract for the 5 outcomes** (commit follows). Wire schema
types `academicDecision.outcome/applyEligible`; `generatePlanResponseToModel` maps
them onto `GeneratedPlanModel` (undefined on the legacy response); `buildDraftVM`
carries them into `DraftVM`. New pure `isProposalApplyable(proposal, stale)` is the
single native Apply gate — preserves blocked/errored/stale, and blocks Apply when
`applyEligible===false` even with no blocking error. `NativePlannerJourney` uses it +
renders a Hebrew badge per non-proposal outcome. Draft invariants unchanged. TDD:
`apply-eligibility.test.ts` + `draft-vm.test.ts` RED→GREEN. Root + web `tsc` clean.
Native UI now **consumes** `academicDecision` (was: not integrated).

Pre-existing unrelated failure: `NativePlannerJourney.test.tsx` THERMO-2 preferences
test fails at HEAD `8313c3b` independent of this work (proven by stash) — flagged as a
separate task, not touched.

**Corrected status (was overclaimed in the prior section as "reachable"):**
- Runtime adapter — reachable (unchanged).
- **AcademicDecisionAgent CLASS — now reachable/executing on the flagged path**
  (stable planner injected; proposal parity proven).
- **Knowledge Grounding — now invoked (plan-inert) on the flagged path.**

Default-off preserved; default response backward-compatible (LEGACY_KEYS). No paid
provider, no Supabase, no browser/Preview. Production/`main`/aliases/Vercel
unchanged. Native web/ app does NOT yet consume `academicDecision` → native-UI
contract tests deferred until that consumer seam is built.

## Session 2026-08-11 — planner-quality: wanted-course prerequisite recovery (issue #75 fixed)

**Starting state verified.** Branch `ui/frontend-modernization`, HEAD `ae4c68e`
== remote, clean tree. No unrelated uncommitted/untracked work. Test cmd
`npx jest --testPathPattern=tests/api` (+ `jest.ui.config.js`), `tsc --noEmit`.

**Integration-gap map (code evidence).** Active Generate path: native UI →
`POST /api/ai/generate-plan` → default `buildModel`→planner→`proposal` (stable).
`use_academic_decision_agent` (generate-plan.ts:132/1395/1708) drives (a)
pre-plan `clarifyForAcademicDecision` and (b) post-plan `buildAcademicDecision`
(academic_decision_runtime.ts) — an ADAPTER that WRAPS the already-generated
proposal (validation/evaluation/decision/explanation), NOT the
`AcademicDecisionAgent` class. That class + `createDefaultAcademicDecisionAgent`
factory remain **implemented-but-unintegrated** by deliberate design (their Plan
stage `runPlanningOrchestration` builds a different model from emptyState →
would change the plan; documented at academic_decision_runtime.ts:20-27).
Knowledge Grounding Slice 1 (`KnowledgeCapability`, 679ce47) is plan-inert /
reachable only via `runPlanningOrchestration` → **not used by the active
generate path**. Default-path response is locked byte-identical by
`LEGACY_KEYS` (generate_plan_academic_decision_agent.test.ts:67) — so a
top-level path-diagnostics field is intentionally NOT added (would break that
deliberate contract; the agent path is already observable by the presence of
`academicDecision`).

**Slice implemented (Workstream D — wanted-course enforcement).** Fixed
**issue #75** (was an `it.skip` in planner_orchestrator.test.ts:200, documented
as cross-cutting and deferred by prior sessions). Root cause: a wanted course
whose own bare-elective prerequisite is removed is unrecoverable — group 3
offers the wanted course but it fails strict-timing legality, the prerequisite
is only offered by the degree-fill group (gated off once degree hours are met),
and step()'s strict-improvement gate + the greedy rollout (same invariant)
cannot chain the two-step unlock. Fix: `PlannerWorker.recoverUnplacedWantedCourses`
— a deterministic finishing pass at run() convergence that places a wanted
course TOGETHER WITH its missing prerequisite chain atomically, committing only
when the bundle is valid AND strictly out-scores the current plan
(peak-minimizing layout preserves balance objective g4a). Monotonic-safe (never
a worse/illegal plan); seeded only from `wantedCourseIds` and kept OUT of
`requiredButUnplacedCourseIds` so `remainingMandatoryHours` reservation scoring
is untouched — the exact cross-cutting risk #75 flagged.

**Verification.** issue #75 test RED (WANTED absent) → GREEN. Full API suite
**115 suites / 1583 tests pass**; `tsc --noEmit` clean. No paid provider, no
Supabase, no browser/Preview (deferred per owner). Commit `4965004` on
`ui/frontend-modernization`. Production/`main`/aliases/Vercel settings
unchanged; unrelated work preserved.

## Session 2026-08-08 (cont.) — live enrichment run EXECUTED; promotion structurally blocked (no cache change)

**Owner unblocked both prerequisites** (verified by name only, secret value never retrieved): gh token now
carries the `workflow` scope, and GitHub Actions secret `OPENAI_API_KEY` exists (`gh secret list`).

**Workflow landed on default branch.** Opened a single-file PR (`.github/workflows/enrich-syllabi.yml`,
copied byte-identical from `c97ea6f` — blob `345a87a…` matched on both PR and `c97ea6f`) targeting `main`;
merged as **PR #80** (mergeCommit `b406a7d`). `main` is unprotected; `ci.yml` on `main` runs tests only (no
deploy step); Vercel project is **not connected to a Git repo** (owner-confirmed) → the merge cannot deploy.
Production/aliases unchanged.

**Genuine live run confirmed.** Dispatched workflow (id **329892984**) against `ref: ui/frontend-modernization`,
inputs `program=mechanical_engineering_2027`, `courses=0542-4425,0571-4174,0542-4226,0542-4420`.
Run **31251292816** — success. Provider/model: **OpenAI `gpt-4o-mini`** (`llm:gpt-4o-mini`). Log:
`[enrich] LIVE semantic extraction via llm:gpt-4o-mini`. Per-course status:
- `0542-4425` **enriched (live)** accepted=1 — explicit/0.9; matches reviewed `explicit`.
- `0542-4226` **enriched (live)** accepted=1 — explicit/0.9 — **OVER-CLASSIFIES** vs reviewed `derived`.
- `0571-4174` **provider_failed_kept_previous** — no live result; kept captured `derived`/0.6.
- `0542-4420` **provider_failed_kept_previous** — no live result; kept captured (no evidence).

**Artifact validated** (`enriched-profile-mechanical_engineering_2027`, id 9020080496): no secrets. Every
`snapshotHash` re-matched a freshly-built snapshot; every live excerpt is grounded **verbatim** in
`normalizedContent`; offsets consistent. Live spans for 0542-4425 (SOLIDWORKS/FEA/Injection-Molding phrases)
differ entirely from the captured fixture spans (`שיטות התכן`,`לתכן מתקדם`) → the live result is genuinely
model-produced, **not** a copy/rename of captured evidence.

**PROMOTION STRUCTURALLY BLOCKED → committed cache UNCHANGED (stays `captured`, honestly labeled).** Three
independent reasons: (1) the committed cache's homogeneity invariant — `semantic_provider_boundary.test.ts`
asserts every profile's `extractorKind` equals the top-level kind — forbids a mixed 1-live/6-captured cache;
(2) a full `live_semantic` promotion is unachievable from this run (only 4 of the 7 cached courses were in the
allowlist; 2 of those 4 hit provider failures); (3) promoting 0542-4226's live `explicit`/0.9 would break
`semantic_enrichment_acceptance.test.ts` (expects that course `derived`, ≤0.6) and would over-state a
precision-oriented claim beyond human review. So no `live_semantic` cache entry was written. The run stands as
**verified external validation** of the captured cache (0542-4425 confirmed), not a promotion.

**Planner control-vs-focus (rerun via the acceptance suite).** Design-focus (`interpret_free_text` +
`extra_request_he:'…להתמקד בתכן'`) places `0542-4425` where control does not (evidence-backed, cited) — but
that course is `explicit` design the **legacy** extractor also catches. Semantic-ONLY courses
(`0571-4174`,`0542-4226`) reach the fit map and influence fit-score (fit==cache strength) but are never shown
to flip a final legal proposal. Distinction holds: evidence→matcher ✓, fit-score influence ✓, final legal
proposal change ✗ for semantic-only. **`semantic-only planner decision acceptance: data-blocked` RETAINED.**

**Generate consumes the committed cache with NO model invocation** — `api/ai/generate-plan.ts` imports only
`loadEnrichedProfileCache`/`lookupProfile` (no `LlmSemanticExtractionProvider`/`ClaimSpecProvider`); boundary
test green.

**Gates (all green):** root `tsc --noEmit` ✓; web `tsc --noEmit` ✓; web `next build` ✓; full API suite
**1535 passed** (1 skipped) ✓; UI suite **835 passed** ✓. Working tree clean apart from this doc.

**Production unchanged; no preview created.** Change is documentation-only (no functional/UI delta), Vercel is
not Git-connected, no Vercel CLI is installed, and the sole available deploy MCP remains unsuited for this repo
— a preview would prove nothing, so none was made (not fabricated).

## Session 2026-08-08 — protected enrichment workflow + Supabase-503 diagnosis; live run owner-blocked

**Accepted baseline:** `5b6aa86` (HEAD=origin, clean tree). Production unchanged. Focus: close the
live-run gap via a protected execution mechanism, and diagnose the preview Supabase 503.

**Protected execution mechanism (implemented).** `.github/workflows/enrich-syllabi.yml` — a
manually-dispatched (`workflow_dispatch`) GitHub Actions workflow that runs the REAL
`scripts/enrich_syllabi.ts --live` (LlmSemanticExtractionProvider) and uploads the validated profile
as a REVIEWABLE ARTIFACT. Security boundary: dispatch-only (collaborators/write-access only);
`permissions: contents: read` (cannot push or deploy); inputs passed via env (`"$PROGRAM"`/`"$COURSES"`),
never interpolated into the shell → no command injection; a new `parseCourseAllowlist` re-validates the
allowlist (strict `NNNN-NNNN`, max 12) and bounds model calls to one per course; `timeout-minutes: 10`;
fails fast with the exact required-secret message if no provider credential is present; no secret/full-
prompt logging.

**Credential availability by environment (names only, never values).**
- Local: NO provider key (`OPENAI_/ANTHROPIC_/GOOGLE_*_API_KEY` absent; Vercel-Sensitive values pull as
  empty) → `resolveModel()` = null.
- Vercel Preview/Production: `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`AI_PROVIDER` configured but **Sensitive**
  (not retrievable to any non-runtime environment).
- **GitHub Actions: NO provider secret** (`gh secret list` empty).

**LIVE RUN — NOT PERFORMED (owner-blocked, two exact actions).** Dispatch of the workflow returned
`HTTP 404: workflow not found on the default branch` — GitHub only exposes `workflow_dispatch` for
workflows present on the **default branch (`main`)**; the workflow is on `ui/frontend-modernization`, and
this run must not merge. So a live run requires the OWNER to: **(1)** land
`.github/workflows/enrich-syllabi.yml` on the default branch (merge), and **(2)** add a GitHub Actions
repository secret **`OPENAI_API_KEY`** (or `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`; optional
`AI_PROVIDER`). No local key exists and I did not ask for or fabricate one. **No live_semantic profile was
produced this run; the committed cache remains `extractorKind:'captured'`** (honestly labeled; never
relabeled live). Gaps 1–3 remain OPEN pending those owner actions; the mechanism to close them is now in
place and tested.

**Preview Supabase 503 — ROOT CAUSE DIAGNOSED (external, owner-only; no code defect).** The failing call
is `POST /api/ai/generate-plan` → `runQuotaCheck` → `checkAndEnsureSession` (generate-plan.ts:147). When
the quota-check DB is unreachable it throws (verified locally: `getaddrinfo ENOTFOUND` on the pooler host)
→ fail-closed **503 `DB_ERROR` phase `quota_check`**. The app's Supabase project `lxwtycowmqosuyfumcbo`
(tau-course-planner, eu-north-1) is **currently `ACTIVE_HEALTHY`** — the 503 was the **free-tier
auto-pause** (paused project → pooler DNS NXDOMAIN → throw). This is correct fail-closed behavior:
generation must NOT bypass the quota/authorization policy when the DB is down (a test now locks this;
`AI_TEST_MODE` does not rescue a DB-down check). **Not a code defect — no code change.** Owner action for a
permanent fix: keep the DB reachable (upgrade the Supabase project off the auto-pausing free tier, or add a
keep-alive). While the project is ACTIVE, preview Generate is not DB-blocked; it re-pauses on inactivity.
(The board-load path already has a local fallback; the quota path deliberately does not.)

**RED→GREEN.** enrich_workflow.test.ts (7): parseCourseAllowlist accepts valid/dedupes/empty, rejects
shell-metachar/arbitrary tokens and over-cap sets; the committed workflow is dispatch-only, cannot
push/deploy, invokes `--live` (not ClaimSpecProvider), passes inputs via env (no injection), gates on the
secret. generate_plan_quota_db_error.test.ts (2): DB-unreachable → 503 DB_ERROR/quota_check, no plan
generated, `AI_TEST_MODE` no bypass. (Existing boundary tests already cover: Generate imports no provider;
captured never relabeled live; live run tags live_semantic + calls provider once/course; provider failure
keeps previous profile; version invalidation.)

**Planner decision (unchanged, honest).** No live profile exists yet, so no re-run against live evidence
was possible. Semantic-only status retained: **semantic-only planner decision acceptance: data-blocked**
(0571-4174/0542-4226 reach the fit map but never change the final generated plan on this board;
searched again k=84..100 last run — not manufactured). Matcher influence ≠ final-plan change: the cached
semantic-only evidence DOES reach the fit map (proven), but does NOT change the final legal proposal.

**Files changed.** New: `.github/workflows/enrich-syllabi.yml`, tests/api/enrich_workflow.test.ts,
tests/api/generate_plan_quota_db_error.test.ts. Modified: api/ai/syllabus_enrichment.ts (parseCourseAllowlist),
scripts/enrich_syllabi.ts (--courses). No production data relabeled.

**Verification.** Full API 1536 (1535 passed, 1 skipped); full UI 835/835 (clean tree, guard passes);
root+web typechecks clean; web build clean. Pre-existing: 38 pytest failures (no Python touched);
side-effect file restored, not staged. Live workflow NOT executed (owner-blocked, above).

**Production prerequisites (updated).** Before live semantic evidence can ship: (1) land the enrichment
workflow on the default branch; (2) add the `OPENAI_API_KEY` GitHub Actions secret; (3) dispatch the
workflow for the reviewed course allowlist; (4) review the artifact + re-verify grounding locally; (5)
commit the `live_semantic` cache; (6) keep Supabase reachable (upgrade off free tier) so preview/prod
Generate isn't 503'd by auto-pause. Everything else (real provider, validator, versioned cache, provenance,
deterministic wiring, deployment-safe artifact) is in place.

**Next recommended slice.** Once the two owner actions are done, execute the workflow (live), promote the
cache to `live_semantic`, and re-run the control-vs-focus acceptance against live evidence; then revisit the
data-blocked semantic-only decision on a program/state where a legacy-missed course is decision-relevant.

## Session 2026-08-07 (d) — REAL semantic provider (LLM) + protected enrichment; live call credential-blocked

**Accepted baseline:** `c1154b9` (HEAD=origin, clean tree). Production unchanged. This slice
turns the c1154b9 foundation into a production-capable real-model path and removes the manual
claims from the authoritative provider role.

**Manual-claim limitation removed.** `ClaimSpecProvider` (human-authored captured claims) is no
longer the intended production provider — it is now the deterministic test fixture / captured
evaluation artifact / comparison tool. A real model provider replaces it on the authoritative path.

**Real semantic provider (`api/ai/llm_semantic_provider.ts`, executable production code).**
`LlmSemanticExtractionProvider` uses the repo's existing AI SDK abstraction: `resolveModel()`
(course-planner.ts → `ai` `generateObject` with a strict zod schema). Guarantees: the syllabus
snapshot is the ONLY prompt authority (title excluded; no course ids / expected classifications /
planner choices injected — only a neutral bilingual capability gloss); bounded input (8k chars),
timeout (raced, 30s), retries (2); provider/timeout/parse/schema/no_model failures are CLASSIFIED
(`SemanticProviderError.kind`); the model returns verbatim excerpts only and WE compute offsets
against the snapshot (buildCapturedExtraction) so a bad offset can't smuggle a claim past grounding;
raw output never reaches the user; injectable `generate`/`model` for tests; NEVER imported by
generate-plan (Generate stays deterministic). Model default gpt-4o-mini (Hebrew-capable) via
resolveModel's OpenAI→Anthropic→Google fallback.

**Protected enrichment (`scripts/enrich_syllabi.ts --live`).** `--live` instantiates the real
provider (throws `no_model` naming the exact env vars if no credential), runs one real model call
per evaluated course, validates deterministically, fail-closed preserves the previous valid profile
on failure, and writes a validated, versioned, provenance-tagged profile. Not a public endpoint (a
script/job). Default (no `--live`) uses the captured fixture. Distinguishes enriched / no_content /
provider_failed_kept_previous / provider_failed_no_previous.

**Provenance (`extractorKind`: 'live_semantic' | 'captured' | 'legacy').** Added to every
ValidatedProfile and the ProfileCache; the app can distinguish live vs captured vs legacy. The
committed cache is honestly tagged `captured` (not mislabeled live). A test asserts a captured
profile never claims `llm:` provenance.

**Durable/deployment cache.** The committed `data/enriched_profiles/<program>.json` is a
deployment-safe IMMUTABLE PRECOMPUTED ARTIFACT bundled with the function exactly like `data/boards`
(which already works in deployed functions) — production-capable persistence with NO DB migration.
`loadEnrichedProfileCache` reads it read-only at plan time; Generate performs no extraction.

**LIVE model call — BLOCKED (precise blocker, not "missing credential").** `vercel env ls` shows
`AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL` configured for Preview+Production.
BUT they are stored **Sensitive/encrypted**: `vercel env pull --environment=preview` writes EMPTY
values for them (verified: key value length = 2 chars `""`), so locally `resolveModel()` → NULL and
a live call cannot run from this environment. The raw key values are injected only inside the
deployed preview/production runtime. I did NOT ask for or fabricate a key, and deleted the pulled
env file immediately (no secrets committed/logged). **The one live verification (an actual model
call) is blocked by the Sensitive-secret retrieval, isolated exactly here.** Everything else —
provider code, enrichment, validation, cache, provenance, wiring, deterministic tests — is complete
and GREEN. The provider's full code path (prompt build → schema → grounding → validation → error
classification) is proven with an INJECTED `generate` (identical code, deterministic).

**Semantic-only decision change — DATA-BLOCKED (searched thoroughly, not manufactured).** The two
semantic-only courses (0571-4174, 0542-4226; legacy-missed, semantic-derived, validated, bounded
0.6) reach the planner fit map, but a fine prior-credit sweep (k=84..100, this run) plus last slice's
exhaustive with/without-exclusion search finds NO state where either is placed by focus-only:
0542-4226 is always a control filler (never focus-only) and 0571-4174 (2h, cross-faculty) is never a
selected filler. Their design fit reaches scoring but does not flip the decision on this board's real
authoritative data. Reported honestly per the task; not forced by editing offerings/prereqs/syllabi
or deleting patterns. The real-board change remains 0542-4425 @92h (identified by both extractors),
now cache-sourced.

**Priority/legality (unchanged, re-verified).** interest_fit stays below legality/completion/
mandatory/offerings/prereqs/exclusions/hard-load/explicit-wanted; exclusion of 4425 → absent; explicit
wanted (4351) honored; no surplus; validated absence (4420) never introduced; Apply preserves the
proposal.

**RED→GREEN.** llm_semantic_provider.test.ts (6): structured-output parsing, verbatim grounding,
confidence bounding through the real provider path, timeout/schema/provider error classification,
no_model naming the env var, empty-content no-call. semantic_provider_boundary.test.ts (4): Generate
imports no provider (source scan); cache honestly provenance-tagged (never live-mislabeled); a live
run tags live_semantic and calls the provider once/course; provider failure keeps the previous valid
profile. course_profile_cache updated for extractorKind.

**Files changed.** New: api/ai/llm_semantic_provider.ts, tests/api/llm_semantic_provider.test.ts,
tests/api/semantic_provider_boundary.test.ts. Modified: api/ai/course_profile_cache.ts (extractorKind
+ ExtractorKind type), api/ai/syllabus_enrichment.ts (thread extractorKind), scripts/enrich_syllabi.ts
(--live real provider), data/enriched_profiles/mechanical_engineering_2027.json (regenerated with
extractorKind), tests/api/course_profile_cache.test.ts (extractorKind).

**Verification.** Full API 1526 passed (1 skipped); full UI 835 passed post-commit (pre-commit lone
failure = course_details_panel working-tree git-diff guard, green committed); root+web typechecks
clean; web build clean. Browser/network: control (4425 absent, no outcome) + focus (4425
@year_3_semester_b, 4420 absent, honored cites cached quote) via direct :3002; **server log shows NO
model/provider invocation during Generate** (deterministic); rendered /planner/native + Apply
preserves 4425; console clean. Pre-existing: 38 pytest failures (no Python touched); side-effect file
restored, not staged.

### PRODUCTION ROLLOUT CHECKLIST (semantic enrichment — do NOT auto-deploy)
- **Env vars (already set on Vercel, Sensitive):** `OPENAI_API_KEY` (and/or `ANTHROPIC_API_KEY`,
  `GOOGLE_GENERATIVE_AI_API_KEY`), optional `AI_PROVIDER`. No values in repo.
- **Model config:** default gpt-4o-mini via resolveModel; override with `AI_PROVIDER`. Cost control:
  bounded 8k-char input, 2 retries, 30s timeout, one call per evaluated course; enrichment is manual/
  batched (never per Generate).
- **Durable cache:** committed `data/enriched_profiles/<program>.json` (immutable artifact, bundled).
  No DB migration. (Optional future: durable store if profiles must be written at runtime.)
- **Enrichment trigger + authz:** run `npx tsx scripts/enrich_syllabi.ts <program> --live` in an
  environment that HAS the raw key (protected CI job / local with key), review the produced cache +
  `evaluation.json` diff, then commit the artifact. It is NOT a public endpoint.
- **Failure/rollback:** enrichment fails closed (keeps last valid profile); if the cache is absent/
  corrupt, `loadEnrichedProfileCache` returns null → Generate proceeds with NO fit (honest, available).
  Rollback = revert the cache artifact commit.
- **Deployment ordering:** commit the validated cache artifact BEFORE/with the deploy so Generate reads
  it; no runtime enrichment on the request path.
- **Observability:** provider errors are classified (`SemanticProviderError.kind`); enrichment prints a
  per-course summary (status/accepted/rejected) without raw output or secrets.
- **Stale profiles:** `lookupProfile` returns `stale` on syllabus content-hash change and
  `refresh_required` on schema/ontology/extractor-version change → re-run enrichment.
- **Before production:** run one real `--live` enrichment with the key (in a key-bearing env), review
  the live cache vs `evaluation.json`, commit as `extractorKind:'live_semantic'`, then deploy.

**Next recommended slice.** Run `--live` enrichment where the key is available (protected CI or a
key-bearing local env) to promote the committed cache to `live_semantic`; then broaden the ontology
(practical/lab/theoretical/assessment) through the same grounded pipeline. The semantic-only decision
change remains data-blocked on this board — revisit with a program/state where a legacy-missed course
is genuinely decision-relevant.

## Session 2026-08-07 (c) — semantic syllabus-enrichment pipeline (validated, versioned, cache-fed planner)

**Accepted baseline:** `22d9f3f` (HEAD=origin, clean tree). Production unchanged.

**Why.** `22d9f3f` extracted course-capability evidence with hand-written phrase patterns over
official syllabus text — sound but non-scaling. This slice adds the semantic-extraction pipeline
that supersedes the pattern extractor on the authoritative path.

**Provider status (audited).** The repo uses the Vercel AI SDK (`ai` + `@ai-sdk/anthropic|openai|
google`) via `resolveModel()`, which builds a model only if a provider API key env var is set.
`.env.local` has NO model key → **no runtime model provider is configured**. Per the provider rules
the semantic-model step is CAPTURED (real-source-grounded, reviewed, labeled) not live; a fake
provider covers failure/timeout tests; the LLM provider path (`resolveModel` + AI SDK generateObject)
is a documented deferred boundary. No checkpoint blocker (22d9f3f in history, tree clean, no DB/
crawler needed, grounding validator cleanly separates untrusted model output from evidence).

**Pipeline (real vertical, model-independent safety core):**
snapshot → semantic provider (untrusted) → grounding validator → validated versioned profile →
cache → evidence-backed matcher → real planner → traceable explanation.
- `syllabus_snapshot.ts` — `SyllabusSnapshot` {courseId, institution, programOrCatalog, sourceType,
  sourceUrl, sourceAuthority, sourceYear, language, retrievedAt, contentHash, normalizedContent},
  built from the board's official syllabus text (TITLE excluded); `contentHash`=sha256(normalized).
- `semantic_course_extraction.ts` — ontology (`mechanical_design`, ONTOLOGY_VERSION), untrusted
  `CandidateClaim` {capability, inferenceLevel, confidence, evidenceSpans[{excerpt,section,offsets}],
  rationale}, `SemanticExtractionProvider`, `ClaimSpecProvider` (captured, grounds excerpts against the
  live snapshot), `runExtractionWithTimeout` (bounded).
- `semantic_extraction_validator.ts` — DETERMINISTIC grounding: excerpt must exist verbatim in the
  snapshot, offsets must match, capability∈ontology, level/confidence valid, non-empty evidence for
  explicit/derived, title-citation rejected, contradictions reconciled (strongest grounded wins),
  `boundedConfidence` caps the model's number by inference level (explicit≤0.9 / derived≤0.6 /
  estimated≤0.35) × source authority + small span bonus. Accepted claims map to the existing
  `CourseCapabilityEvidence`.
- `course_profile_cache.ts` — versioned cache; key = courseId + snapshot contentHash + schema/
  ontology/extractor versions; `lookupProfile` → hit / stale (hash changed) / refresh_required
  (missing course, version mismatch, or capability never evaluated) / insufficient_evidence
  (evaluated, no positive evidence) / quarantined. `loadEnrichedProfileCache` reads the committed
  JSON. Storage = committed JSON (narrowest versioned storage; persistent DB is deferred).
- `syllabus_enrichment.ts` — the explicit (not-per-Generate) enrichment op; provider failure keeps
  the previous valid profile (fail-closed). `scripts/enrich_syllabi.ts` writes
  `data/enriched_profiles/mechanical_engineering_2027.json`.

**Legacy pattern extractor — contained.** `course_capability_evidence.ts` is RETIRED from the
authoritative planner path (`buildCourseFitById` now reads ONLY the validated cache) and kept only for
regression/comparison in the evaluation. It never overrides validated evidence and never produces new
high-confidence profiles.

**Real courses + official sources evaluated (data/enriched_profiles/evaluation.json).** All TAU IMS
syllabi already committed in the board (source urls + fetch dates + conf 0.8). Legacy vs semantic:
- BOTH catch (explicit): 0542-4425 (הדפסת תלת מימד; "שיטות התכן"), 0542-2400 (תכן מכני 1;
  "שיטות תכן שונות"), 0542-4722 (MEMS; "עקרונות תכן וייצור").
- **SEMANTIC-ONLY** (legacy MISSING → semantic DERIVED, validated, bounded conf 0.6):
  **0571-4174** (תיכון וחשיבה המצאתית; paraphrase "פתרונות יצירתיים וישימים"),
  **0542-4226** (יישומי אלמנטים סופיים; "משלבי התכן הראשוניים" = early design stages).
- Correct NEGATIVES (both missing): 0542-4420 (תורת המכונות — machine theory), 0542-4351 (marine/waves).

**Confidence bounding demonstrated.** Captured model confidences were 0.9–0.95; the deterministic
policy capped derived claims to 0.60 and explicit to 0.90 in the written cache — the model cannot
self-certify high confidence.

**User-goal → capability → course evidence chain.** "אני רוצה להתמקד בתכן" → focusArea/capability
mechanical_design → cache lookup on each course's content-hashed snapshot → validated official-syllabus
evidence → planner fit. External context (ABET, 22d9f3f) still attached to the explanation.

**Control vs preference (real board, prior credit 92h).** Control: 26 courses, blocked=false, 0542-4425
ABSENT, no intentOutcome. Focus: 0542-4425 placed at year_3_semester_b (real B offering), blocked=false,
errors=[], **fit sourced from the validated cache** (honored cites the cached quote "שיטות תכן שונות …");
0542-4420 (validated absence) NOT introduced. Exclusion of 4425 → absent (exclusion beats fit); explicit
wanted (0542-4351) honored alongside; no surplus.

**Honest planner-level limitation (NOT manufactured).** The semantic-only courses (0571-4174, 0542-4226)
carry validated design evidence that reaches the planner fit map, but on THIS board they do not change
the FINAL generated plan in any reachable legal state: 0571-4174 (2h, cross-faculty) is not a filler the
planner selects, and 0542-4226 is already a control filler / is out-competed by 4425 (explicit, 0.9). The
real-board plan change is driven by 4425 (which both extractors identify), now cache-sourced. Per the task
("do not manufacture this case"), this is reported, not forced. The semantic signal's ability to reach and
affect scoring IS proven (buildCourseFitById includes 0571-4174 & 0542-4226 with positive fit; scorePlan's
interest_fit consumes courseFitById — 544544d). Deferred: a board/state where a legacy-missed course is
genuinely decision-relevant, or connecting a runtime model provider to broaden coverage.

**Provider actually used.** CAPTURED (ClaimSpecProvider over reviewed real-source claims), deterministic,
no live model. Live LLM extraction is DEFERRED (no key configured) — the boundary (`SemanticExtractionProvider`
+ resolveModel/AI-SDK) exists but is not exercised.

**Cache key + reuse/refresh/invalidation.** Reuse only when snapshot contentHash matches AND schema/
ontology/extractor versions match AND the capability was evaluated. Changed syllabus → new hash → stale.
Changed schema/ontology/extractor version → refresh_required. Generate performs NO extraction — it builds
snapshots + reads the committed cache (proven: buildCourseFitById only calls loadEnrichedProfileCache +
lookupProfile; generate-plan imports no provider).

**Security/operability.** No secrets committed or logged; bounded timeout + fail-closed enrichment (keeps
last valid profile); raw provider output never reaches the user (validated first); planner remains available
with no fit when the cache is absent.

**RED→GREEN.** 4 core suites (snapshot/extraction/validator/cache, 24 tests) RED (modules missing) → GREEN.
A probe caught NO integration bug this time; a TS-narrowing fix in buildCapturedExtraction. Acceptance
suite (6) GREEN: semantic>legacy, hallucination rejected, cache→matcher, real cache-sourced plan change,
exclusion>fit, validated-absence-not-introduced.

**Files changed.** New: api/ai/syllabus_snapshot.ts, api/ai/semantic_course_extraction.ts,
api/ai/semantic_extraction_validator.ts, api/ai/course_profile_cache.ts, api/ai/syllabus_enrichment.ts,
scripts/enrich_syllabi.ts, data/enriched_profiles/{captured_extractions.json, mechanical_engineering_2027.json,
evaluation.json}, tests/api/{syllabus_snapshot, semantic_course_extraction, semantic_extraction_validator,
course_profile_cache, semantic_enrichment_acceptance}.test.ts. Modified: api/ai/generate-plan.ts
(buildCourseFitById reads the validated cache; legacy extractor retired from the fit path).

**Verification.** Full API 1516 passed (1 skipped); full UI 835 passed post-commit (pre-commit lone failure
= course_details_panel working-tree git-diff guard, green committed); root+web typechecks clean; web build
clean. Browser/network: control (4425 absent, no outcome) + focus (4425 @year_3_semester_b, 4420 absent,
honored cites the CACHED quote, ABET note) via direct :3002 and rendered /planner/native + Apply preserves
4425; console clean. Pre-existing/out-of-scope: 38 pytest failures (no Python touched); pytest side-effect
file restored, not staged.

**Next recommended slice.** (1) Connect a runtime model provider (resolveModel + AI SDK generateObject with
the schema) behind the same validator + cache, and run one real extraction; (2) broaden the ontology
(practical/lab/theoretical/assessment) with the SAME grounded pipeline; (3) find/curate a board state where a
legacy-missed course is decision-relevant so the semantic signal changes the generated plan end to end.

## Session 2026-08-07 (b) — evidence-backed course matching (three-layer): syllabus evidence replaces title inference

**Accepted baseline:** `544544d` (HEAD=origin, clean tree). `project_native_planner_journey_mvp.md`
is EXTERNAL Claude memory (not tracked in repo). Production unchanged.

**Problem fixed.** The 544544d fit path classified design from broad TITLE tokens
(`מכונות → mechanical_design`), so "תורת המכונות" (theory of machines — a machine-THEORY
syllabus, not design) got a false 0.7 design weight and was the course the design request
pulled in. Title is not proof of content.

**Three-layer evidence architecture implemented (smallest real vertical slice).**
1. COURSE-KNOWLEDGE (`api/ai/course_capability_evidence.ts`): `CourseCapabilityEvidence`
   {courseId, capability, claim, strength, sourceType, sourceUrl, sourceAuthority, sourceYear,
   extractedEvidence, inferenceLevel, confidence, retrievedAt}. `extractCourseCapabilityEvidence`
   reads ONLY the official syllabus text the board already carries (`syllabus_summary_he` +
   provenance: `syllabus_source_url`, `syllabus_last_fetched_at`, `syllabus_confidence`), title-
   blind. Distinguishes explicit / derived / estimated / missing. False-friend guard: "תכן הקורס"
   (=course CONTENT) and "תוכן" are neutralized before design matching (TAU syllabi head their body
   with "תכן הקורס", which otherwise reads nearly every course as design). Only `mechanical_design`
   has an extractor this slice; other capabilities → honest `missing`.
2. EXTERNAL-CONTEXT (`api/ai/external_context_evidence.ts`): `ExternalContextEvidence`
   {goalOrContext, capability, relationship, strength, sourceType, sourceUrl, publisher,
   publishedOrUpdatedAt, retrievedAt, confidence, corroborationCount, extractedEvidence} + a
   `ExternalContextProvider` boundary (NOT connected to a runtime provider this slice). One CACHED,
   real, authoritative relationship: engineering_design → mechanical_design, source **ABET**
   (Engineering Accreditation Commission), Criteria for Accrediting Engineering Programs 2026-2027,
   Criterion 3 Outcome (2) + Criterion 5, retrieved 2026-08-07 (fetched live during dev). It links
   GOAL→CAPABILITY and carries NO courseId — never a claim that a course teaches it.
3. USER-GOAL: reuses the 544544d `PlanningIntent.focusAreas` (the requested capability), unchanged.
4. MATCH → PLANNER: `buildCourseFitById(board, focusAreas)` now derives the per-course soft fit
   from course evidence strength (explicit 0.9 / derived 0.6 / estimated 0.3 / missing 0), feeding
   the same `interest_fit` scorePlan goal (544544d). It also returns `evidenceById`; the explanation
   (`buildIntentOutcome` focus branch) cites the OFFICIAL SYLLABUS quote per aligned placed course,
   plus the ABET external-context provenance as a note — the two layers stay distinct.

**Unsound behavior removed/contained.** `מכונות` removed from the mechanical_design TITLE rule
(`course_topic_profile_inference.ts`) — a machine course is not a design course. Negative regression
added (title `מכונות`/`תורת המכונות` alone ≠ mechanical_design). One machine-only course moved
inferred→default (static distribution pin updated 47/21 → 46/22). The planner fit no longer uses
title-topic-profiles at all.

**User-goal → capability → course evidence chain (proven).** goal "אני רוצה להתמקד בתכן" →
focusArea/capability `mechanical_design`; ABET (external) establishes the capability's relevance to
the design goal; official TAU syllabus (course) establishes that 0542-4425 teaches it — quote
"…שיטות התכן והחומרים…" (explicit). The two links are independent (external never asserts a course
teaches X).

**Official syllabus sources + extracted evidence (real, in-repo).**
- 0542-4425 הדפסת תלת מימד ותכן חלקי פלסטיקה — EXPLICIT ("שיטות התכן"×2, "לתכן מתקדם", SOLIDWORKS/FEA),
  src ims.tau.ac.il/…course=0542442501&year=2025, conf 0.8.
- 0542-2400 תכן מכני (1) — EXPLICIT ("שיטות תכן שונות", "נושאים מתקדמים בתכן"). (mandatory)
- 0542-4722 MEMS — EXPLICIT ("עקרונות תכן וייצור, תכן מפורט של התקנים").
- 0542-4420 תורת המכונות — MISSING (syllabus is machine THEORY; title "מכונות" is not proof).
- 0542-4422 תכן הנדסי — MISSING (official summary is boilerplate; not fabricated into evidence).

**Control vs preference (real board, fixed prior-credit 92h — a legitimate exposing state, NOT an
artificial fixture; scanned states 96/93/92/89/88 all expose it, 90/91 do not).**
- Control (no request): 26 courses, 94h, blocked=false, 0542-4425 ABSENT, no intentOutcome.
- Focus "אני רוצה להתמקד בתכן": 26 courses, **94h (equal — no surplus)**, blocked=false, errors=[],
  **0542-4425 placed at year_3_semester_b** (its real B offering). Equal-cost swap: 4425 (design, 3h,
  explicit evidence) IN ↔ **0542-4226 יישומי אלמנטים סופיים בתעשייה** (applied FEM, 3h, NOT design)
  OUT — so the soft interest_fit legitimately decides among equal-hours, equally-complete plans.
  **0542-4420 NOT placed** (the previously-unsound title swap is gone).
- Why 90h shows no change (honest data note): the only evidence-backed design ELECTIVES are 4425 (3h)
  and 4722 (5h, already in control); the 4h design-TITLED courses (4135/4422) have no extractable
  syllabus evidence. So a change needs a state where a 3h design course completes the plan with
  equal/less surplus than a 4h filler.

**Legality/priority/consistency.** interest_fit stays a soft tie-break BELOW explicit wanted/unwanted,
ABOVE difficulty. Verified: explicit exclusion of 4425 → absent; explicit wanted (non-design 4351) →
honored alongside focus; offerings/prereqs/annual/completion/mandatory/category all still enforced as
blocking gates; no surplus (equal hours); unsupported domain → honest unmet; control attaches no
intentOutcome. Evidence quality drives the score (explicit>derived>estimated; missing→0); estimated is
never presented as certain.

**RED→GREEN.** RED: 2 new modules missing + `מכונות` still resolved. Probe-driven fix of a FALSE-FRIEND
bug ("תכן הקורס"=content matched as design) — tightened to unambiguous design signals. GREEN: extractor
units (real fixtures + explicit/derived/estimated/missing), external-context units (ABET provenance, no
courseId), negative regression, and the real-board acceptance (evidence-backed swap, no surplus, syllabus-
cited outcome, priority, honesty).

**Capability matrix (end-to-end = a verified change in the ACTUAL legal proposal).**

| Dimension | User-goal repr | External ctx | Official course evidence | Confidence/authority | Changes course choice | Changes sem arrangement | Verified E2E | Missing provider/data |
|---|---|---|---|---|---|---|---|---|
| Academic domain / design | focusArea mechanical_design | ABET (cached, real) | official syllabus extractor | explicit 0.9 / high | **yes** | no | **YES** (4425 swap @92h) | broaden domains → per-capability extractors |
| Practical/project/lab | focusArea/style | none | styles inferred (partial) | low | potential | no | no | style extractor from syllabus + free-text style markers |
| Theoretical | style theoretical | none | none | absent | no | no | no | reviewed evidence rule/source |
| Assessment style | style exam_light + assessment_type | none | assessment_type mostly null | low/absent | no | no | no | populate assessment metadata |
| Difficulty | difficulty_score | none | difficulty_score present | present | as g6 tiebreak only | no | no | free-text difficulty + semester aggregation |
| Semester workload/balance | balance_load/max_hours | n/a | per-sem loads (authoritative) | authoritative | no | yes (existing) | balance/maxHours wired; free-text not | plan-level scheduling policy (separate slice) |
| Career/industry alignment | (careerGoals) | ExternalContextProvider boundary only | none | absent | no | no | no | connect runtime research provider + goal→capability ingestion |
| Personal project/activity | — | boundary only | none | absent | no | no | no | same as career |

**Cached vs live vs deferred vs unsupported.** Course evidence: CACHED from committed board syllabus
text (no live fetch at Generate; refresh path documented — re-run the board pipeline). External context:
CACHED (ABET), provider boundary DEFERRED (no runtime research connected). Runtime web-search research:
UNSUPPORTED at runtime (boundary only). Non-design course-fit dimensions: DEFERRED/data-limited.

**Files changed.** New: api/ai/course_capability_evidence.ts, api/ai/external_context_evidence.ts,
tests/api/course_capability_evidence.test.ts, tests/api/external_context_evidence.test.ts. Modified:
api/ai/course_topic_profile_inference.ts (remove מכונות token), api/ai/generate-plan.ts (evidence-driven
buildCourseFitById + evidence/external-context threaded to outcome), api/ai/planning_intent.ts
(buildIntentOutcome cites evidence + external context), tests/api/course_topic_profile_inference.test.ts
(negative regression), tests/api/course_topic_profiles_static.test.ts (distribution pin 46/22),
tests/api/generate_plan_free_text_fit_real_board.test.ts (rewritten to evidence-backed @92h).

**Verification.** Focused RED→GREEN; full API 1486 passed (1 skipped); full UI 835 passed post-commit
(pre-commit lone failure is the course_details_panel working-tree git-diff guard, green once committed);
root+web typechecks clean; web production build clean. Browser/network: control (4425 absent, no outcome)
+ focus (4425 @year_3_semester_b, 4420 absent, honored cites "שיטות התכן", ABET note) verified via direct
curl to :3002 AND the actual :3001 next-dev proxy (both HTTP 200 ~8.5s), AND rendered in /planner/native
with Apply → applied board preserves 4425 @year_3_semester_b; console clean. (Browser-automation note: ref-
based clicks intermittently failed to fire the build/apply onClick; JS-dispatched element clicks worked —
an automation quirk, not a product bug.) Pre-existing/out-of-scope: 38 pytest failures (test_seed_postgres
sqlite, test_supabase_normalize DB/network, test_viewer_structure) — no Python touched; pytest mutates
data/import_reports/normalized_courses_mechanical_2027.json as a side-effect (restored, not staged).

**Next recommended slice.** Course-STYLE evidence extractor (practical/project/lab from syllabus, e.g.
SOLIDWORKS/מעבדה/פרויקט) + free-text style markers → same evidence→fit path; then connect a real runtime
ExternalContextProvider (web research with provenance) for career/industry goals. Keep plan-level workload
free text as a separate scheduling-policy slice.

**Doc duplication (report only):** AUTONOMOUS_PROGRESS.md canonical; `.remember/current.md` detailed log;
`docs/current.md` still EMPTY (stray) — recommend deleting in a dedicated docs pass, not here.

## Session 2026-08-07 — general user-fit (focus-area) preferences connected to the real plan

**Accepted baseline:** `45e5a11` (branch `ui/frontend-modernization`, HEAD=origin, clean tree).
Prior accepted work untouched: explicit Hebrew exclusion, positive course preference,
fuzzy search, authoritative offering (4220 B-only / 4224 A-only / 3620 A+B). Production
unchanged. `project_native_planner_journey_mvp.md` is EXTERNAL Claude memory (not tracked
in the repo) — its earlier edit is intentionally external, no repo impact.

**Product outcome delivered.** A broad Hebrew user-fit request "אני רוצה להתמקד בתכן"
(focus on design) now measurably shifts the ACTUAL native proposal's ELECTIVE selection
toward design-aligned courses, resolved to a canonical `AcademicFocusArea` (mechanical_design)
+ strength — NOT a design-only flag — and reaching the planner as a soft per-course fit
signal. Verified through `/planner/native` end to end.

**Existing user-fit path + canonical representations (all pre-existing, were UNWIRED).**
The generic representation already existed but its own headers said "FOUNDATION EPIC ONLY —
nothing wired into planner scoring/generate-plan/UI": `AcademicInterestProfile`
(academic_interest_profile.ts) with canonical `AcademicFocusArea` (incl. `mechanical_design`,
`control_systems`, `robotics`, …) + `CourseStyle` (project_based/practical/lab_based/
theoretical/exam_light/math_heavy/industry_relevant) + `OptimizationPriority`; the course-side
evidence `CourseTopicProfile` inferred deterministically by `inferCourseTopicProfile`
(course_topic_profile_inference.ts, Hebrew/English keyword rules, e.g. `תכן|תיכון|מכונות|
design|cad → mechanical_design` @0.7, source `inferred`) over the committed catalog
(`getMechanicalEngineering2027TopicProfiles`); the per-course evaluator
`matchCourseToAcademicInterests → interestFitScore ∈[0,1]`; and the post-hoc, display-only
`buildGeneratePlanInterestEvaluation` (explicitly "no plan mutation, no ranking involvement").

**Smallest proven gap (non-vacuous baseline, real board, 90h prior credit).** CONTROL (no
request) designFitSum=3.50 (electives 4422, 4135 + mandatory design). Free-text
"אני רוצה להתמקד בתכן" via `interpret_free_text` → `interpretPlanningIntent` returned
`recognized:[{kind:'prefer',phrase:'להתמקד בתכן',status:'unresolved'}]`, NO focus preference
(the `רוצה` course-marker stranded it) → plan IDENTICAL to control. Two gaps: (A) no
focus-area recognition at the intent boundary; (B) `scorePlan` (GOAL_STACK) had no interest/
fit term, so even the existing `AcademicInterestProfile` could never change placements.

**Exact missing connection (reuse-first; canonical dimension+strength, not a boolean).**
1. `inferFocusAreasFromText` exported from course_topic_profile_inference.ts — reuses the SAME
   keyword→area vocabulary for the user's phrase (one taxonomy, supply+demand side).
2. planning_intent.ts extended: `PlanningIntent.focusAreas:{area,weight}[]` + a `focus`
   recognized kind; FOCUS_MARKERS (`להתמקד`/`להתמחות`/…) checked per clause BEFORE the
   course-prefer markers; negated `אל תשבץ` etc. still EXCLUDE (checked first).
3. generate-plan.ts `buildCourseFitById(focusAreas)` — builds `AcademicInterestProfile` and
   scores every catalog course via `matchCourseToAcademicInterests` (reused evidence+evaluator)
   → `Map<courseId, fit>`, threaded into `buildModel`/`buildConstraintModel`.
4. ConstraintModel gains `courseFitById?`; scorePlan gains goal `interest_fit` = Σ fit of
   placed courses, inserted BELOW `preferences`+`unwanted_avoidance`, ABOVE `difficulty_comfort`
   (soft: inert/zero when no fit map → control byte-identical).
5. `buildIntentOutcome` gains a `focus` branch driven by `fitAlignedPlacedCourseIds` computed
   from the FINAL proposal — truthful, placement-derived.
   No new parser/agent/policy/planner/endpoint/validator/UI; no course names/ids in production
   logic; ids are acceptance fixtures only.

**Control vs user-fit real proposal (before/after, evidence-backed).** With the focus request,
the planner SWAPPED `0542-4351 הנדסה ימית` (marine/fluids, mechanical_design weight 0) OUT for
`0542-4420 תורת המכונות` (mechanical_design 0.7 via `מכונות`) IN — one swap, same course count/
hours (NO surplus), designFitSum 3.50→4.20, blocked:false, errors:[]. Repository evidence:
`getTopicWeight(profile,'mechanical_design')` = 0.7 for 4420 (and 4422/4135/2400/4010/4020),
0 for 4351. intentOutcome.honored (derived from actual placements): "הותאמו קורסים להעדפת
ההתמקדות שלך («בתכן»): … תורת המכונות, …".

**Legality/priority/consistency.** interest_fit is a soft tie-break only: explicit exclusion
beats it (disallowed design course stays absent), explicit wanted-course outranks it
(0542-4220 honored alongside focus), authoritative B-only/A-only offerings + prereqs + degree
completion + mandatory/category + hard load all still enforced (all as blocking gates above
scoring). No surplus hours added. Unsupported focus domain ("...משהו שלא קיים כתחום") →
honest `unmet`, never fabricated. Control (no request) attaches NO intentOutcome. Browser:
Generate 200, 4420 at year_4_semester_a, 4351 dropped, UI honored text == network response,
Apply → applied board preserves 4420 (once) at year_4_semester_a; console clean; no server errors.

**Capability matrix (end-to-end = a verified change in the ACTUAL legal proposal).**

| Dimension | Canonical repr | Evidence | Confidence | Affects | Recognized (free text) | Verified E2E | Missing connection if deferred |
|---|---|---|---|---|---|---|---|
| Academic domain (design/control/fluids/robotics/…) | `AcademicFocusArea` | `CourseTopicProfile.topics` (keyword-inferred) | inferred, 0.6–0.7 | course choice | **yes** (`להתמקד ב…`) | **YES** (design proven; other domains share the identical path) | — |
| Practical / project / lab orientation | `CourseStyle` (practical/project_based/lab_based) | `CourseTopicProfile.styles` (keyword-inferred) | inferred (partial) | course choice | no (no style markers yet) | no | add style free-text markers → reuse `matchCourseToAcademicInterests` style path (already scores styles) → same `courseFitById` |
| Theoretical orientation | `CourseStyle.theoretical` | no inference rule emits `theoretical`/`math_heavy` yet | absent | course choice | no | no | add a deterministic evidence rule (or syllabus source) for theoretical/math_heavy; then same path |
| Assessment style (exam vs project) | `CourseStyle.exam_light`, `assessment_type` on CourseProfile | `assessment_type` largely null in catalog | low/absent | course choice | no | no | populate assessment metadata; consume via style fit |
| Difficulty | `difficulty_score` (planner) / no interest dim | `CourseProfile.difficulty_score` exists | present (course-level) | course choice + semester load | no (free text) | no | difficulty is already a scoring tiebreak (g `difficulty_comfort`); a "prefer easier" free-text request + semester-level aggregation is a distinct slice |
| Semester workload / balance | `balance_load`, `max_weekly_hours` | per-semester loads | authoritative | semester ARRANGEMENT | partial (balance/maxHours markers exist) | balance/maxHours already wired; "lighter semesters"/"spread demanding courses" free text NOT | plan-level scheduling policy — deliberately NOT forced into the course-fit score |
| Career / activity alignment | `careerGoals` (profile) / combine focus dims | none direct | absent | course choice | no | no | map career phrases → focus-area set (reuse focusAreas path) |

**Additional non-domain fixture — DEFERRED (data-limited, honest).** Preferred order was
practical/lab → assessment → difficulty. Practical/lab: `CourseStyle` styles ARE inferred
(lab_based/project_based/practical) and `matchCourseToAcademicInterests` already scores styles,
BUT there are no free-text STYLE markers yet and style evidence is partial; assessment_type is
largely null; no theoretical/math_heavy rule emits. Rather than fabricate classifications
(forbidden), the second fixture is deferred — the exact consumer (`courseFitById` via the style
branch of `matchCourseToAcademicInterests`) already exists; only free-text style markers + a
reviewed style/assessment evidence pass are missing.

**Files changed (this slice):** api/ai/course_topic_profile_inference.ts, api/ai/planning_intent.ts,
api/ai/generate-plan.ts, api/ai/planner_types.ts, api/ai/planner_model.ts, api/ai/planner_goals.ts;
tests/api/course_topic_profile_inference.test.ts, tests/api/planning_intent.test.ts,
tests/api/planner_goals.test.ts, new tests/api/generate_plan_free_text_fit_real_board.test.ts.

**Verification.** Focused RED→GREEN (4 suites); full API 1472 passed (1 skipped); full UI
835 passed post-commit (the lone pre-commit failure is the `course_details_panel.test.js`
working-tree git-diff guard, green once the api change is committed); root + web typechecks
clean; web production build clean; browser+network verified via `/planner/native` + Apply.
Pre-existing/out-of-scope: 38 pytest failures (test_seed_postgres sqlite env,
test_supabase_normalize DB/network, test_viewer_structure) — this slice touches no Python;
pytest mutates data/import_reports/normalized_courses_mechanical_2027.json as a side-effect
(restored, not staged).

**Next recommended product slice:** free-text COURSE-STYLE fit ("אני מעדיף קורסים מעשיים / יותר
פרויקטים ומעבדות") — add style free-text markers feeding the SAME `courseFitById` via the style
branch of `matchCourseToAcademicInterests` (already implemented), plus a reviewed
style/assessment evidence pass so theoretical/exam-style dims have authoritative data. Keep
plan-level workload free text ("סמסטרים קלים יותר") as a separate scheduling-policy slice — do
not fold it into the course-fit score.

**Doc duplication (report only):** AUTONOMOUS_PROGRESS.md canonical; `.remember/current.md`
detailed log; `docs/current.md` still EMPTY (stray) — recommend deleting in a dedicated docs
pass, not here. Not modified this slice.

## Session 2026-08-06 (b) — positive free-text course preference connected end to end

**Accepted baseline:** `92f473a` (branch `ui/frontend-modernization`). Prior accepted
work untouched: explicit Hebrew exclusion end-to-end, fuzzy course-name search,
authoritative offering (0542-4220 = תורת התנודות, Semester-B only). Production unchanged.

**Product outcome delivered.** The Hebrew request "שבץ לי את תורת התנודות" now makes the
ACTUAL native proposal prefer and include course `0542-4220`, placed ONLY in a Semester-B
slot (its authoritative offering), whenever a legal complete plan can contain it — verified
on the real Mechanical-Engineering board through `/planner/native`.

**Existing positive-preference path (reused, unchanged):**
`NativePlannerJourney.buildRequest` (always sends `interpret_free_text: true` +
`extra_request_he`) → `POST /api/ai/generate-plan` → `interpretPlanningIntent`
(planning_intent.ts) → `mergeIntentIntoPreferences` (wanted = union(UI, intent) MINUS
disallowed; exclusion always wins) → `buildModel` `wantedCourseIds` →
`buildCourseProfiles` `is_wanted` + `model.wantedCourseIds` → `enumerateActions` group 3
("wanted courses — every legal semester", offering-restricted via `addCourseActionsFor`/
`legalSemestersFor`) + `scorePlan` g5 (GOAL_STACK `preferences`, below degree/mandatory/
balance) → `buildIntentOutcome` (honored/unmet derived from ACTUAL placements) →
ProposalView. Every legality/workload gate (offered-semesters, prereqs, annual, degree
completion, hard load cap, explicit exclusion) already governs this path.

**Baseline behavior + smallest proven gap (non-vacuous).** On the real board (prior credit
90h): CONTROL (no preference) → `0542-4220` NOT placed; structured `wanted_course_ids:[4220]`
→ placed in `year_4_semester_b` (B); free-text "שבץ לי את תורת התנודות" via
`interpret_free_text` → NOT placed, `intentOutcome` empty. Root cause:
`interpretPlanningIntent` returned `preferCourseIds: []`, `recognized: []` — `PREFER_MARKERS`
had no imperative "schedule for me" verb, so the sentence produced an empty intent and never
reached `wanted_course_ids`. The downstream planner was already fully correct.

**Exact missing connection (reuse, not new machinery).** Added the imperative markers
`'תשבץ לי','שבץ לי','תשבץ','שבץ'` to `PREFER_MARKERS` in `api/ai/planning_intent.ts` — the
positive symmetry of the already-accepted `אל תשבץ` exclusion marker. `'לי'` (dative)
variants precede the bare verb so `afterMarker` consumes "שבץ לי" as one unit and the
accusative "את" strip yields the course phrase. `afterMarker` itself untouched, so the
exclusion phrase-extraction is byte-identical. No new parser/agent/policy/planner/endpoint/
validator/UI. The course id is used only as an acceptance fixture; no sentence/id is
special-cased in production logic (negated "אל תשבץ" is an EXCLUDE marker checked first per
clause, so it always wins).

**RED→GREEN evidence.** RED: 6 focused tests failed for the missing marker (intent empty →
4220 not placed). GREEN after the marker append: all pass. Before/after real proposal (curl
to the real handler): before → 4220 absent, `intentOutcome` undefined; after → 4220 in
`year_4_semester_b`, `intentOutcome.honored:["שובצו לפי העדפתך: תורת התנודות."]`, `unmet:[]`,
`blocked:false`, `errors:[]`.

**Acceptance results (files):** `tests/api/generate_plan_free_text_preference_real_board.test.ts`
(8 real-board tests — placement, B-only slot, structured↔free-text convergence, balance-load
non-discard, exclusion-beats-preference structured + free-text, never-into-A, non-vacuous
control) + 3 boundary unit tests in `tests/api/planning_intent.test.ts` (imperative resolve,
marker variants, negated-stays-exclusion). Full API suite 1459 passed; UI suite 834 passed
(1 pre-existing git-diff working-tree guard, `course_details_panel.test.js`, trips only on
an uncommitted api change — green once committed); root + web typechecks clean; web
production build clean; browser+network verified through `/planner/native` (Generate 200,
4220 in a B slot, UI "✓ שובצו לפי העדפתך: תורת התנודות" matching, Apply → applied board keeps
4220 in year_4_semester_b; console clean).

**Legality/workload/explanation/Apply consistency.** Positive preference never overrode
availability (B-only respected; never in an A slot), prereqs, annual rules, degree
completion, hard load cap, or explicit exclusion. Under `balance_load` the preference was not
discarded. `intentOutcome` is derived from the final proposal; proposal, validation, summary,
and Apply agree; the control does not falsely claim the preference was honored.

**Deferred product gaps (narrow):** broad NL preference phrasing beyond the imperative/
"מעדיף/רוצה" markers (e.g. "אני רוצה לשבץ …" strands "לשבץ"); domain-interest ranking; workload
requests in free text; the 3 single-syllabus-group offering records (4226/4559/4621) + 13
downgraded self-referential records still need authoritative multi-group verification. All
out of this slice's scope.

**Pre-existing, out of scope:** 38 pytest failures (test_seed_postgres sqlite env,
test_supabase_normalize network/DB, test_viewer_structure) exist on the baseline — this slice
touches no Python. `python -m pytest` also mutates
`data/import_reports/normalized_courses_mechanical_2027.json` as a side-effect (restored, not
staged).

**Doc duplication (report only, not redesigned):** `AUTONOMOUS_PROGRESS.md` canonical;
`.remember/current.md` its detailed log; `docs/current.md` still exists and is EMPTY (stray)
— recommend deleting in a dedicated docs pass, not here. Not modified this slice.

## Session 2026-08-06 — free-text exclusion locked + approximate course-name search across all bars

**Accepted baseline:** `966be5f` (authoritative offering-data remediation — 4220
B-only / 4224 A-only inversions corrected, self-referential provenance downgraded).

**Slice A — real-board free-text exclusion (commit `8346243`).** Investigated the
native path (NativePlannerJourney.buildRequest → `POST /api/ai/generate-plan` →
`interpret_free_text` → `planning_intent.ts interpretPlanningIntent` →
`mergeIntentIntoPreferences` → `buildModel` `disallowedCourseIds` → planner +
`disallowedGate`). Finding: **already works end-to-end** — "אל תשבץ תרמודינמיקה 2"
resolves to `0542-4120` and is enforced (reqA absent; reqB exclusion beats a
competing want; reqD pre-placed → honest BLOCK, never silently kept; reqC control
shows 4120 IS placeable). The only gap was **missing acceptance coverage** on the
real board (existing tests used a synthetic ALPHA/BETA fixture). Added
`tests/api/generate_plan_free_text_exclusion_real_board.test.ts` (5 tests) and
verified the real /planner/native browser journey (Generate + Apply keep 4120
absent). No production code changed.

**Slice B — approximate (fuzzy) Hebrew course-name search in ALL course bars
(this commit).** Reused: nothing existed (repository search was plain
`.includes`). New: one runtime-neutral matcher `shared/search/course-name-match.ts`
(normalize parens/nikkud/punct/spacing + ranked exact→prefix→substring→token-subset→
bounded-Levenshtein typo; 9 unit tests). Wired into all three surfaces:
`RepositoryExplorer.tsx` (fuzzy+ranked filter), new `CourseNamePicker.tsx` ranked
chooser in `NativePlannerJourney` add/exclude fields (name→id chips), and the
legacy `semester_board_viewer.html` repo-search + `setupCoursePicker` (mirrored JS
matcher). Browser-verified: "תרמודינמיקה 2" (no parens) and "תרמודנמיקה" (typo) both
find "תרמודינמיקה (2)"; native picker ranks "התנודות" → "תורת התנודות 0542-4220".

**Reused vs new:** reused the existing intent/exclusion pipeline unchanged (Slice A);
Slice B added one shared matcher + one picker component + three thin call-site swaps.

**Deferred (next product slices):** positive-preference / domain-interest ranking in
free text; the 3 single-syllabus-group offering records (4226/4559/4621) + 13
downgraded self-referential records still need authoritative multi-group
verification; broad NL intent coverage.

**Doc duplication (report, not redesigned):** `AUTONOMOUS_PROGRESS.md` is canonical;
`.remember/current.md` is its detailed log; `docs/current.md` exists but is EMPTY
(stray) — recommend deleting it in a dedicated docs pass, not here.

## Latest session — re-verification only: queue still resolved (PR #14 parked), deploy blocker unchanged (still `26500d4`, now 235 commits behind, still `source: cli`)

Re-checked from scratch rather than trusting this file's prior entry:
`list_pull_requests` (open) → exactly PR #14. `list_issues` (open) → #75,
#21, #20, #18, #15, none newly actionable under this session's release-gate
pause (all either pre-existing human-decision items or explicitly deferred
Agent-quality work). Vercel (`list_teams` → `list_projects` → `get_project`
→ `list_deployments` → `get_deployment`) → `tau-course-planner`'s latest
deployment is byte-identical to the prior session's finding: same deployment
ID, same `source: "cli"`, same `gitCommitSha: 26500d4`. No Git-integration
tool exists in this session's Vercel MCP surface to fix this autonomously.

Full detail in `.remember/current.md`'s matching entry. No code changed,
no PR opened for implementation work, no deploy attempted (the raw-upload
`deploy_to_vercel` path remains correctly declined — it has no Git linkage
and would break commit traceability for this multi-language repo, per
established precedent). This docs-only update is the sole change this
session made.

## Prior session — PR queue resolved (PR #77 merged, PR #74 closed as duplicate); production deploy blocker re-verified: still pinned at `26500d4`, now 232 commits behind

**Per this session's own external operating instructions, stopping here
rather than starting new Agent-quality work** (not a standing rule of this
file — see the correction the immediately-preceding session already made
about exactly this framing, a few sections below): this session's own
*external* scheduled-task prompt, given by the human operator, told it to
pause new roadmap work until the open-PR queue was resolved and a verified
production release was deployed, with an explicit escape valve for exactly
this situation — if deployment is blocked by missing authorization/
credentials, record the single external blocker and stop before deployment
rather than proceed. That instruction's own stored checkpoint (PR #53,
commit `36de50f`) was stale, as the prompt itself warned it might be —
verified fresh against GitHub before acting.

**Branch hygiene, same recurring gap as several prior sessions (issue #18's
finding, still not permanently fixed)**: this session's assigned branch
(`claude/youthful-tesla-xx4car`) was created from stale `main` (`92c19e0`,
0 unique commits, 391 behind `origin/ui/frontend-modernization` at session
start), not from `ui/frontend-modernization` as directed. Reset to
`ui/frontend-modernization` HEAD before doing anything else.

**Queue at session start**: two open PRs beyond the permanently-parked #14 —

- **PR #77** — a comment-only correction (a real Codex finding on PR #76's
  docs recap: `LlmOrchestrator.run()`'s code comment overclaimed safety/cost
  guarantees PR #73 didn't actually provide). CI green (TS/Python tests +
  Next.js build all passed), Codex reviewed the exact head commit (`b68d52d`)
  with no findings ("Didn't find any major issues"), current against
  `ui/frontend-modernization` HEAD. All merge gates satisfied — **merged as
  `1ce8bf2`**.
- **PR #74** — turned out to be a duplicate: it implemented the exact same
  fix as the already-merged PR #73 (`681d883`, closing issue #67), built
  independently in a parallel session against a now-stale base. Diffed both
  PRs to confirm before acting (not assumed) — functionally identical
  `LlmOrchestrator.run()` change and regression test. **Closed as superseded**
  with an explanatory comment; issue #67 was already closed by #73, so this
  PR had nothing left to contribute and would only have been a second,
  competing implementation of the same root cause.
- **PR #14** (Decision capability) — reconfirmed still correctly parked: a
  3rd consecutive D-classified milestone with no named production consumer,
  per issue #18's still-unresolved governance conflict. Left untouched, per
  every prior session's precedent.

With PR #74 closed, only PR #14 remains open — a deliberate, already-decided
parked state, not an unresolved item.

**Production deploy blocker — re-verified this session, not just carried
forward from memory**: queried the real Vercel API directly (`list_teams` →
`list_projects` → `get_project` → `get_deployment`). `tau-course-planner`
(the `fastapi`-framework project that's actually live) has no Git
integration — its `latestDeployment.meta` shows `"source": "cli"` and
`gitCommitSha: 26500d4ffe56fff145eadc0a8745cf7803cb788e`, deployed via a
one-off CLI upload, not linked to any branch. That commit is now **232
commits behind** `origin/ui/frontend-modernization` HEAD (confirmed via
`git log 26500d4..origin/ui/frontend-modernization --oneline | wc -l`) —
every Agent-quality and correctness fix from PR #27 onward, including every
milestone this file's history below documents, is unshipped. The sibling
`web` (Next.js) project is in the same state (`source` not git-linked,
`target: null`, never promoted to production). This is the exact blocker
Blockers item 1 (below) and many prior sessions have already recorded —
confirmed unchanged, not a new finding, but now quantified precisely rather
than just "some fixes are unshipped."

Per that scheduled-task prompt's own explicit fallback — *"if deployment is
unavailable because authorization or credentials are missing, prepare and
verify the exact release candidate, record the single external blocker and
stop before deployment"* — this session did not attempt `deploy_to_vercel`'s
raw-upload path (no git linkage, would break `gitCommitSha` traceability for
this multi-language repo, previously declined by name in this same file) and
did not attempt to reconfigure Vercel Git integration unilaterally. **Which
Vercel project is canonical is already resolved, not a second open
decision** (a real Codex finding on this PR correctly caught an earlier
draft of this entry re-opening it) — the root `vercel.json` wires the
Next.js app, the real serverless API endpoints, and the legacy static board
viewer into ONE deployment, and `tau-course-planner` deploying that root
config is the complete, correct production setup; `web` is a leftover
single-subdirectory deploy from before the root config existed, not a real
second candidate (see the fuller writeup a few sections below, from the
session that originally settled this via a real Codex finding). The
remaining blocker is purely authorization/configuration access — linking
`tau-course-planner`'s Vercel Git integration to this GitHub repo, or a
`vercel` CLI login reachable from an autonomous session — which is exactly
the kind of infrastructure/deployment-configuration action this routine's
own prohibited-actions list reserves for a human.

**No implementation milestone was started this session.** This session's
own scheduled-task instructions paused new roadmap work until the queue was
resolved and a release deployed and smoke-tested; the queue is now
resolved, but deployment remains externally blocked, so that instruction's
own "done" condition can't be reached this session. Stopping here rather
than starting new Agent-quality work, per that instruction — **not because
this file mandates it**; per the established multi-session convention a
few sections below, absent a specific directive to pause, the norm here is
to keep running the Agent Diagnosis Loop in parallel with this same
standing deploy blocker rather than block on it. A future session without
this same external pause instruction should default to that convention.

**Classification**: not applicable (no code changed) — a queue-resolution
housekeeping session (merge one clean PR, close one duplicate) plus a
verification pass. Does not enter the rolling A/B/C/D window.

## Prior session — PR #73 merged: LlmOrchestrator now always guarantees its finishing pass (issue #67), plus PR #71/#68 earlier the same session; a Codex finding on #73 uncovered and documented a distinct, still-open gap (issue #75)

Continuation of the same session as PR #71/#68 below (that entry is now
"Prior session" — see it for the branch-hygiene/queue-state notes at
session start, unchanged for this second milestone). After PR #71 and its
docs recap (PR #72) merged, picked up **issue #67** next — the other
Agent-quality item the immediately prior session had flagged and
deliberately left untouched to avoid parallel work on `planner_worker.ts`.

**The bug**: `buildPlannerTools`'s `finalize_plan` tool (`api/ai/planner_tools.ts`)
calls `worker.repair()` (which places any still-legal wanted course/balance
move, per PR #65/#68's fix), but its `execute()` does not terminate the
AI-SDK tool-calling loop — nothing stops the model from mutating further
afterward (e.g. removing a wanted course `finalize_plan` had just placed),
with no later `finalize_plan` call to recover it. `LlmOrchestrator.run()`'s
own outer fallback only re-ran the deterministic finishing pass when
`worker.validateCandidate().valid` was false, and that check has zero
`wantedCourseIds`/balance awareness — verified against `planner_validate.ts`
before writing any code. Also didn't match the class's own docstring
("Whatever the model does ... a deterministic finishing pass guarantees a
valid, complete plan" — unconditional in the comment, conditional in the
code).

**Fix** (`api/ai/planner_orchestrator.ts`): `LlmOrchestrator.run()` now
always calls `worker.run(500, 'greedy')` after the model's tool-calling loop
ends, not just when the candidate is invalid. Safe in the sense that
matters here — it only ever takes further legal actions, so it can never
corrupt the plan or reintroduce an error the model's own choices avoided.
**Correction (2nd Codex finding on PR #76)**: this entry originally also
claimed "no added cost in the common case" for an already-converged plan —
unsupported and likely false, not backed by any profiling. Removed. **3rd
correction on this same claim (Codex found the 2nd correction still
understated the worst case)**: three distinct cases exist, only one of
which is pre-existing behavior:
- **Already valid AND fully converged** (e.g. the model called
  `finalize_plan` and did nothing since) — `worker.run()` executes exactly
  one `step()` call: real, nonzero work under production defaults
  (`lookahead:true`, `topN:6`, `rolloutSteps:80` — enumerate/validate/score
  every legal action, forward-check, roll out the top `topN` candidates),
  bounded to that single check before it confirms nothing advances and
  stops. **New cost this fix adds** — the old validity gate skipped this
  entirely (plan already read as valid, so the gate never fired).
- **Valid but NOT fully optimized** — the exact motivating scenario for
  this whole fix (e.g. issue #67's own regression test: removing a wanted
  course still leaves `validateCandidate()` `true`) — `worker.run()` now
  takes further real ADD/MOVE/REPLACE actions until it reconverges, up to
  its full `500`-iteration bound, each iteration paying the same `step()`
  cost as above. **Also new cost this fix adds**, same reason.
- **Invalid** (legality/degree-hours/mandatory/category not yet satisfied)
  — `worker.run()` runs up to the same `500`-iteration bound. **Unchanged
  from before this fix** — the old validity gate already called
  `worker.run(500,'greedy')` unconditionally in this case.

None of the three cases' real-world latency was measured or profiled this
session — a future session should record real profiling evidence, not
assume any of these bounds is negligible in production. **Also corrected
(1st Codex finding on PR #76)**: the stronger claim this entry originally
made — "can't discard anything the model validly chose to keep" — is
inaccurate and has been removed. `enumerateActions`' group 6
(`REPLACE_COURSE`, `planner_actions.ts`)
CAN swap out one of the model's own validly-placed, legal, movable courses
(if it's among the placed set's bottom-3 by preference score) for a
higher-preference unplaced alternative when that improves the score — this
is pre-existing `worker.run()`/`step()` behavior, not new to PR #73 (the
same replace logic already fired via `finalize_plan`'s `repair()` call
before this fix), but PR #73's own code comment repeats the same overclaim
and still needs the same wording correction — **not yet fixed in the
merged code, flagged here as a fast-follow for the next session** (a
comment-only change, no behavior change, low risk).

**Tests**: new regression test reproduces the exact repro condition from
issue #67's own (twice-corrected) writeup, RED-verified against the
pre-fix code first (empirically confirmed `placedCourseIds` lost `WANTED`).
Full API suite: **86/86 suites, 1354/1354 tests**, zero regressions across
every pre-existing `LlmOrchestrator`/`GreedyOrchestrator`/tool test.
`tsc --noEmit` clean.

**One real Codex finding on this PR, NOT fixed inline (filed as issue #75
instead)**: if the model removes a wanted course AND that course's own
(non-mandatory, non-category) prerequisite post-`finalize_plan`, this fix
still can't recover it — `requiredButUnplacedCourseIds` (`planner_goals.ts`)
only seeds its prerequisite walk from `requiredMandatoryCourseIds`, never
`wantedCourseIds`, so no `enumerateActions` group ever proposes re-adding
that prerequisite once degree hours are otherwise met. **Verified this is
NOT a regression from this PR** — empirically confirmed the identical
outcome against the pre-PR-73 code too (its conditional fallback is equally
skipped whenever the resulting state already reads as valid). **Not fixed
inline**: `requiredButUnplacedCourseIds` also feeds `remainingMandatoryHours`'
reservation-budget scoring — broadening its contract is a cross-cutting
change to sensitive, shared scoring logic needing its own dedicated pass,
not a hasty addition inside this PR's narrower scope. Filed as **issue #75**
with the full analysis and a suggested fix direction; added a RED-verified
(empirically, via a throwaway repro script), currently `.skip`'d regression
test in `tests/api/planner_orchestrator.test.ts` as a ready starting point.

**Final state**: CI green, Codex clean on the final commit (`c548969`), the
one real finding documented with a filed issue and a resolved thread
(not silently dismissed — a new issue + a skipped test is the "fixed" outcome
for a deliberately-scoped-out finding, per this routine's own review-gate
rules). Full suite 86/86 suites, 1354 passing + 1 documented skip. `git
diff --stat` = `api/ai/planner_orchestrator.ts` (comment + one conditional
removed) + its test file only. **Merged as `681d883`.** Issue #67 closed
with the fix commit and evidence in the closing comment.

**Classification: C** (correctness/honesty — closes a reproduced gap on the
actual default production Agent path, `LlmOrchestrator`, same "valid plan
misreported" bug family as PR #48/#56/#58/#60/#62/#65/#71).

**Rolling window, corrected (Codex finding on PR #76 — the version below this
replaces an earlier draft that only counted this session's own two entries
and understated the streak)**: PR #65 (the milestone immediately preceding
this session's PR #71) is also classified **C**. The real sequence is
...62(C), 65(C), 71(C), 73(C) — `(62,65,71) = C/C/C` was ALREADY
non-compliant before this session started (not something either PR #71 or
#73 individually caused), and `(65,71,73) = C/C/C` extends it: **four
consecutive C-classified milestones in a row**. Per this routine's own
governance rule ("a fourth C-in-a-row pattern... worth a human sanity
check"), this is now explicitly that trigger — flagged here, not corrected
by picking an artificial A/B next just to satisfy the counter (each of these
four Cs was independently a legitimate, reproduced, real correctness fix,
not a rule violation in intent). **The next milestone genuinely should be A
or B** unless yet another higher-priority correctness finding preempts it
(a legitimate preemption per the priority order, but a fifth C in a row
would be worth escalating to the human product owner as an explicit
question rather than continuing to self-justify). Issue #75 (P2, just
filed) would itself be a fifth C if picked up next — prefer a fresh Agent
Diagnosis Loop pass specifically hunting for an A/B (UI-exposing or
end-to-end-integration) opportunity first.

**State as of this update**: only PR #14 remains open (still correctly
parked). Issues #67 and #68 both closed this session. Issue #75 newly filed,
open, not yet fixed. `AUTONOMOUS_PROGRESS.md`/`.remember/current.md` recap
for this merge: **PR #76** (this docs update — corrected from an earlier
draft that guessed #74 before the actual PR number was known; two real
Codex findings on PR #76 itself, including this one, are folded into this
entry rather than requiring a reader to cross-reference a separate PR).

## Prior session — PR #71 merged: a truly converged plan could be falsely reported as maxSteps-blocked (issue #68), including a Codex-caught rollout-cost fix mid-review

This was a scheduled autonomous run under the standing product-engineering
mandate (no special "release gate" directive this time). State inspected
fresh first, per this routine's own start-of-session order:

- **Branch hygiene, recurring issue**: this session's assigned branch
  (`claude/youthful-tesla-wq1g2x`) was created from stale `main` (0 unique
  commits, 375 behind `origin/ui/frontend-modernization`) — the same
  recurring gap issue #18 and several prior sessions have hit. Reset to
  `ui/frontend-modernization` HEAD (`4174abc`, PR #70) before doing
  anything else.
- **PR queue at session start**: only PR #14 (Decision capability) was
  open — reconfirmed still correctly parked (D-classified infra, no named
  production consumer), left untouched per multi-session precedent (issue
  #18, Blockers item 6).
- **Open issues reconfirmed**: #15 (superseded by #14's status), #18
  (reconciliation/D-stacking audit, still substantively accurate), #20 (386
  pre-existing UI jest failures, needs a human fixture decision), #21
  (dead-code decision, needs a human call), **#67** (LlmOrchestrator
  wanted-course reliance on `finalize_plan` — needs a repro before a fix,
  deliberately left untouched this session to avoid parallel work in the
  same file family as #68), **#68** (this session's subject, now closed).
- Vercel/production-deploy state **not re-checked this session** — no new
  directive to re-verify it; the prior 5+ sessions' identical finding
  (production pinned at `26500d4`, no Git integration on either Vercel
  project) has no reason to have changed on its own. **Still the single
  most valuable pending human action, stated directly here (the file's own
  `Blockers`/`Exact next action` sections near the bottom are a stale,
  superseded PR #48-era snapshot — do not follow them, per this file's own
  note at that section):** a human (or a session with real `vercel` CLI
  credentials, or the ability to configure Vercel Git integration) needs to
  either (a) link the `matan2439/syllo-course-planner` GitHub repo to the
  `tau-course-planner` Vercel project (Project Settings → Git), with
  `ui/frontend-modernization` (soon `main`, once branch reconciliation
  completes) as the production branch, or (b) explicitly authorize an agent
  session to use `deploy_to_vercel`'s raw-upload path as an interim
  measure, accepting that its deployment won't carry a verifiable
  `gitCommitSha`. No autonomous session can make this call unilaterally.

**This session's milestone**: picked up issue #68 (filed by the immediately
prior session, a real Codex finding on PR #66) — the highest-impact,
already-diagnosed, already-scoped, reproducible correctness gap on the
queue — rather than starting a fresh diagnosis pass, per this routine's own
"resume unfinished work before selecting anything new" instruction.

**The bug**: PR #65 removed `PlannerWorker.step()`'s early return on
`isGoalReached()` so post-goal optimization (wanted courses, balance moves)
keeps running to real convergence instead of silently dropping still-legal
improvements. That made a previously-unreachable state reachable: when the
very last permitted `step()` call inside `run(maxSteps)`'s loop is itself
the action that reaches full convergence, `run()`'s post-loop fallback has
no further `step()` call left to detect "nothing left to improve" — it
always recorded the "maxSteps" truncation message whenever
`isGoalReached()` was true, even when nothing was actually left undone.
`generate-plan.ts`'s `hitMaxSteps` detection then reported a complete,
fully legal, fully optimized plan as **blocked** (`STEP_LIMIT_ERROR`) — a
valid plan presented as broken, the mirror image of the bug PR #65 itself
fixed.

**Verified empirically before touching anything**: the existing PR #65
regression test turned out to be a live demonstration of the exact bug —
running the pre-fix code against it confirmed the "maxSteps" message fired
even though its own fixture's 3rd/last permitted step (placing `WANTED`)
was genuinely the plan's convergence point.

**Fix** (`api/ai/planner_worker.ts`): `run()` now performs one
non-consuming check when `isGoalReached()` is true — new private
`hasFurtherAdvancingAction()`, mirroring `step()`'s own "Reason" decision
without applying anything or touching the trace. When nothing legal
remains, `run()` records the same honest convergence message `step()`
itself would have. When something genuinely does remain, the existing
truncation message is unchanged.

**One real Codex finding, fixed same session** (P2): the initial version of
`hasFurtherAdvancingAction()` called `estimateFinalScore` (an expensive
`rolloutSteps`-deep rollout) once per *every* legal candidate when
lookahead was on — unbounded, unlike `step()`'s own `topN`-truncated
rollout (production uses `topN: 6`, `rolloutSteps: 80`). At the exact
convergence boundary this check exists to detect, a plan with many legal
but non-improving remaining moves could trigger roughly quadratic work and
risk a timeout instead of returning the valid plan. Fixed by splitting into
two passes: a cheap, unbounded immediate-score check over every legal
candidate first (no rollout needed to prove something advances), then a
lookahead rollout pass bounded to the same `opts.topN` candidates `step()`
itself would ever roll out per iteration. New regression test spies on
`estimateFinalScore` directly (`jest.spyOn` on the `planner_lookahead`
module) with a 20-legal-candidate fixture and proves the call count stays
≤9 regardless of how many legal candidates exist — empirically confirmed,
not just reasoned about. Codex re-reviewed the fix commit and came back
clean ("Didn't find any major issues").

**Tests**: updated the existing PR #65 regression test to assert the
corrected convergence message (renamed to describe what it now proves),
added a new two-independent-wanted-course fixture so genuine truncation
stays covered, and added the rollout-bound regression test above. Full API
suite: **86/86 suites, 1353/1353 tests**, zero regressions elsewhere.
`tsc --noEmit`: clean. `git diff --stat` = `api/ai/planner_worker.ts` (one
`run()` change + one new private method) + its test file only — no UI, no
`generate-plan.ts`, no other planner files touched.

**Final state**: CI green on the final commit (`19775da`), Codex clean on
that commit, the one real review finding fixed with evidence and its
thread resolved, `mergeable_state: clean`. **Merged as `5f67194`.** Issue
#68 closed with the fix commit and evidence recorded in the closing comment.

**Classification: C** (correctness/honesty — closes a reproduced regression
in already-merged code, same "valid plan misreported" bug family as PR
#48/#56/#58/#60/#62/#65).

## Prior session — Release-gate re-check: PR queue confirmed resolved (only PR #14, deliberately parked); production deploy still blocked by the same external Vercel gap, now directly reconfirmed via live Vercel MCP access

This was a scheduled autonomous run whose own external task prompt (from the
human operator) carried an explicit "CURRENT RELEASE GATE — AUTHORITATIVE"
directive: pause all new roadmap work, resolve the open PR/branch queue,
then deploy a verified production release — with the same standing fallback
every session since PR #27 has used: if deploy access is unavailable, record
the single external blocker and stop before deployment, rather than guess.

**State inspected fresh, per that instruction's own mandatory order** (not
assumed from the prompt's own stale checkpoint hints, which named PR #53 as
the "latest known open implementation" — that PR was merged 5 sessions ago,
per PR history):

- `git ls-remote`/GitHub API: **exactly one open PR — #14** (the Decision
  capability). No open PRs matching the old "#12/#13" checkpoint remain (both
  merged long ago). No competing `claude/*` or `feat/*` branch has an open PR
  against it. PR #14 was re-read in full and reconfirmed correctly parked —
  same D-classification precedent every session since issue #18 has upheld
  (no production consumer named, `academic_decision_factory.ts` untouched);
  left untouched again this session.
- `ui/frontend-modernization` HEAD is `0dc09f9` (merge of PR #69, the last
  docs-only PR). CI green on that commit (per PR #69's own merge gate,
  re-verified at merge time by the prior session). This branch remains the
  authoritative release candidate.
- Open issues: #67 and #68 (both real, both about the `LlmOrchestrator`/
  beam-search wanted-course-preservation edge cases from PR #65) are Agent-
  quality follow-ups, correctly left unfixed this session — the release gate
  explicitly pauses new roadmap work, and neither is a release blocker for
  the already-merged `ui/frontend-modernization` candidate. #18/#20/#21
  reconfirmed unchanged, zero new human comments on any of the four.

**Production/deploy re-check — this session had live Vercel MCP tool access
for the first time (previous sessions repeatedly reported no reachable
credentials at all)**, so this was verified directly rather than inferred:
- `tau-course-planner` (the canonical project — root `vercel.json` wires the
  Next.js app + real serverless API + legacy static board viewer into one
  deployment, settled by PR #41, re-confirmed unchanged): `get_project`
  shows `latestDeployment.target: "production"`,
  `gitCommitSha: 26500d4ffe56fff145eadc0a8745cf7803cb788e`
  ("Merge PR #11") — **byte-identical to every session's check since PR #27
  first flagged this, now 5+ sessions running**. `ui/frontend-modernization`
  HEAD (`0dc09f9`) has never been deployed.
- `list_deployments` (20 most recent): every single one has
  `creator.username: "matanyaron-1633"` and `meta.actor` set to a
  `claude-code_*_agent` identity — i.e. every past production deployment was
  a manual `vercel --prod` / `deploy_to_vercel`-style push by an agent
  session, never an automatic git-triggered build.
- `get_project` returns **no `link` field** on either `tau-course-planner` or
  `web` — Vercel's API only populates that field when a project has real Git
  integration configured. Its absence, directly observed this session (not
  inferred from tooling failures like prior sessions had to), is definitive
  confirmation: **neither project has Git integration to any branch**, so
  merging to `ui/frontend-modernization` (or eventually `main`) cannot
  trigger a deploy on its own, and no MCP tool in this session's toolset can
  configure that integration (`list_projects`/`get_project`/
  `list_deployments`/`get_deployment` are read/list-only; the one write tool,
  `deploy_to_vercel`, uploads a raw file tree with no git linkage — the same
  tradeoff every prior session declined to accept without an explicit human
  decision, upheld again this session for the same reason: it would break
  the "confirm the exact production commit after deployment" gate this same
  release-gate instruction requires).

**Why this session stops here rather than using `deploy_to_vercel` anyway**:
the release gate's own escape valve is explicit — "prepare and verify the
exact release candidate, record the single external blocker and stop before
deployment" — precisely for this situation. The release candidate
(`ui/frontend-modernization` HEAD, `0dc09f9`) is already prepared and CI-
verified. Using the raw-upload tool would produce a deployment that cannot
be traced back to a specific verified commit via the normal
`gitCommitSha` field, undermining the same release gate's own
post-deployment verification requirement ("confirm the exact production
commit after deployment"). That tradeoff is a product/ops decision for the
human operator, not something to guess at autonomously — consistent with
this repo's "never invent undocumented product policy" rule.

**The actual blocker, stated plainly for the human operator**: production
(`tau-course-planner`, `tau-course-planner.vercel.app`) is pinned at commit
`26500d4` ("Merge PR #11"), which predates every fix since — including PR
#48 (missing-mandatory legality), #56 (misattributed block cause), #58
(wanted-vs-excluded disclosure), #60 (prerequisite-sequencing disclosure),
#62 (degree-hours shortfall gate), #65 (post-goal wanted-course search
continuation), and everything else recorded below. **To unblock**: either
(a) link the `matan2439/syllo-course-planner` GitHub repo to the
`tau-course-planner` Vercel project via the Vercel dashboard (Project
Settings → Git), with `ui/frontend-modernization` (soon `main`, once branch
reconciliation completes) as the production branch, or (b) explicitly
authorize an agent session to use `deploy_to_vercel`'s raw-upload path as an
interim measure, accepting that its deployment won't carry a verifiable
`gitCommitSha`. No autonomous session can make this call.

**No code merged, no deploy performed, no roadmap work started this
session** — per the release gate's explicit pause, correctly upheld now that
the PR queue is confirmed resolved and the deploy blocker is confirmed
external and unchanged.

## Prior session — PR #66 merged (docs-only, records PR #65); release-gate queue now resolved down to the standing Vercel deploy blocker; no new roadmap work started this session

This was a scheduled autonomous run whose own external task prompt (from the
human operator, not anything written into this file — see the correction
below) said to pause new roadmap work, resolve the open PR queue, then
release. State inspected first, per that instruction's own mandatory order.

**Queue found at session start**: two open PRs — **#14** (Decision capability,
reconfirmed still correctly parked, see Blockers item 6, untouched) and
**#66** (this entry's subject — docs recording PR #65's merge), already deep
into a same-day Codex review cycle (11 commits, several real findings already
fixed) when this session picked it up.

**Concurrency note, worth recording explicitly**: partway through reviewing
PR #66's two newest (at the time) unresolved threads — narrowing issue #67's
repro condition, and making the beam-search priority claim conditional on
`AI_USE_AGENTIC_PLANNER`'s live status rather than absolute — this session
independently drafted the same fix, then found a **different concurrent
session** had already pushed an equivalent fix (`bc30909`, then one more
round `cd3bd90`) moments earlier. Discarded this session's own redundant
commit before pushing (`git reset --hard` back to the remote branch) rather
than create a duplicate/competing commit, per this routine's own "one
implementation owner" rule — then waited for that session's round to finish
rather than racing it.

**This session's actual contribution to PR #66**: once all 14 review threads
were resolved and CI was fully green (Python tests / Next.js build /
TypeScript API tests, 3/3) with `mergeable_state: clean` and no further
pushes for several minutes, merged it as `c923e0f`. No product code changed
(`AUTONOMOUS_PROGRESS.md` + `.remember/current.md` only). Not separately
classified (docs-only, same convention as PR #36/#38/#47).

**Fresh production/deploy re-check this session** (Vercel MCP tools, working
for the second session running now): `tau-course-planner`'s `latestDeployment`
is still `dpl_HJZTB8zqondbwuSnHx6TveggoPVg`, `target: production`,
`gitCommitSha: 26500d4` ("Merge PR #11") — byte-identical to the last several
sessions' checks, confirming **no deploy has happened since this was first
flagged, now 4+ sessions ago**. `web` (the Next.js project) still shows
`target: null` on its latest deployment — never successfully promoted to
production, unchanged. Neither `get_project` response exposes a linked git
repository, consistent with every prior session's finding that both projects
are still CLI-deployed (`vercel --prod`) with no Git integration configured.

**Per this session's own external operating instructions, stopping here
rather than starting new Agent-quality work** (see the correction below —
this is NOT a standing rule of this file): this session's own *external*
operating instructions (the scheduled-task prompt this specific session was
launched with, given by the human operator — **not** any section of this
file, and not something a future session should assume it also has, unless
its own task prompt says so too) told it to pause new roadmap work until the
open-PR queue was resolved and a verified production release was deployed,
with an explicit escape valve for exactly this situation: if deployment is
blocked by missing authorization/credentials, record the single external
blocker and stop before deployment rather than proceed. **Correction, per a
real Codex finding on this PR**: an earlier version of this entry described
that instruction as if it were an actual "CURRENT RELEASE GATE — AUTHORITATIVE"
section written into this file, quoted a "Definition of Done" from it, and
told future sessions to keep halting on it — none of that text exists
anywhere in this file or its history (verified via repo-wide search). That
was a real error, now fixed: the pause was this session's own one-off
instruction-following, not a standing rule recorded here. The open-PR-queue
part of it is still accurate on the merits regardless of that instruction's
source: PR #14 remains a deliberate, non-blocking exception (established
multi-session precedent), so the queue genuinely is resolved, and production
genuinely is still stuck on the same external Vercel tooling gap every
session since PR #27 has independently hit (no Vercel CLI login reachable
from any sandbox so far, no Git integration configured on either project,
and the one available deploy tool, `deploy_to_vercel`, uploads a raw file
tree with no git linkage — deliberately not used without a human decision to
accept that tradeoff). **The release candidate is `ui/frontend-modernization`
HEAD as of `c923e0f`** — already fully CI-green (every merge gate re-runs the
full suite) — ready to deploy whenever that access exists.

**Exact next action for the next session**: **a human (or a session with
real `vercel` CLI credentials or the ability to configure Vercel Git
integration) needs to deploy `ui/frontend-modernization` HEAD (`c923e0f`) to
production** — same standing ask as every session since PR #27. **The
"which Vercel project is canonical" question is already resolved, not a
second open decision** — a real Codex finding on this PR correctly pointed
out that `.remember/current.md`'s own PR #41 entry settled this by reading
the root `vercel.json` directly (re-verified this session): it wires the
Next.js app, the real serverless API endpoints, and the legacy static board
viewer into ONE deployment, and `tau-course-planner` deploying that root
config IS the complete, correct production setup — `web` is a leftover
single-subdirectory deploy from before the root config existed, not a real
second candidate. Deploy `tau-course-planner` from the root config; no
project-choice decision is needed first. **This file does not mandate
pausing Agent-quality work until that happens** — every session from PR #48
through PR #65 correctly kept shipping real Agent-quality fixes in parallel
with this same standing deploy blocker, treating it as a separate,
continuously-recorded, human-decision item rather than a gate on other work.
Follow whatever your own session's actual operating instructions say; absent
a specific directive to pause, the established multi-session convention here
is to keep running the Agent Diagnosis Loop (issue #67/#68 are the next
concrete leads) rather than block on this.

## Prior session — PR #65 merged: search stopped the instant bare goal was met, silently dropping a still-legal wanted course

Standing audit (scheduled autonomous run): production/branch/PR/CI/Codex/issue
state inspected first, per this routine's own start-of-session checklist.
`main` remains far behind `ui/frontend-modernization` (full reconciliation
still not done — unchanged, no new evidence this session, not re-investigated
further). Two open PRs existed: **#14** (Decision capability) — reconfirmed
still correctly parked per the standing D-stacking-cap precedent (issue #18);
left untouched, no new evidence changed that call — and **#65** (this entry's
subject), already opened earlier the same day by a prior session, one commit
deep, with CI still pending and only its first commit Codex-reviewed. Picked
up #65 per the anti-duplication/queue-resolution rule (resolve the oldest
in-flight item before starting anything new) rather than beginning a fresh
Agent Diagnosis Loop pass. Issues #15/#18/#20/#21 reconfirmed unchanged, zero
new human comments since the last check.

**The bug** (found by the prior session's fresh Agent Diagnosis Loop pass,
targeting dual-semester/multi-alternative **plan quality itself** — the area
every recent session's "exact next action" had flagged as not yet exercised):
`PlannerWorker.step()` (`api/ai/planner_worker.ts`) began with an
unconditional `if (this.isGoalReached()) return this.recordStop(...)`.
`isGoalReached()` reflects only bare degree-hours/mandatory/category/
legality/annual completion — it has zero awareness of
`model.wantedCourseIds` or of any further balance improvement. The instant
that bare goal became true, the loop stopped for good, even though
`enumerateActions`' group 3 (wanted courses) and group 5 (balance moves) are
unconditional and can still legally, strictly improve the plan's score at
that point. Reproduced against the real `mechanical_engineering_2027` board
fixture: a student with `preferences.wanted_course_ids: ['0512-2508']` (a
real dual-offered elective) got a plan back reporting `blocked:false`,
"valid and complete," while the wanted course was silently never placed —
the same "invalid/incomplete-in-effect plan reported as complete"
self-contradiction class this track exists to close (same family as PR #48's
`legalityGate`, PR #62's `degreeHoursGate`), this time for a dropped
preference rather than a dropped requirement. Reachable on `generate-plan.ts`'s
greedy `worker.run(500,'greedy')` call (used when no model is configured, or
in dev mode) and the beam-search fallback alike — **see the "Known related
gaps" section below for the `LlmOrchestrator` path's own, narrower, unverified
version of this gap (issue #67, downgraded from an initial overclaim after a
Codex correction).**

**Fix**: `step()` no longer exits early on `isGoalReached()`; it always falls
through to the same Reason → Act → Validate machinery and only stops once the
existing terminal "no legal action advances the plan" check finds nothing
left to improve. Can't reintroduce runaway extra-hour bloat: `g1` (degree
completion) is capped at a reservation budget, and group 4 (arbitrary
elective fill) stays gated on `degreeHours < target`, so neither fires
post-goal — only wanted-course and balance-move actions become newly
reachable, still filtered through the existing legality/hard-cap validation.

**One real Codex finding on the initial commit, fixed this session**: the
`run(maxSteps)` fallback recorded a truncation STOP only when
`!isGoalReached()` — correct before this fix (since `step()` used to STOP
the instant bare goal was met), but exactly wrong now that post-goal
optimization can consume the remaining step budget: a run that exhausts
`maxSteps` mid-optimization exited silently, with no STOP recorded and no
signal that further legal improvements existed and were never attempted.
Fixed (`006aad6`) by tracking whether `step()` itself ever produced a STOP,
rather than inferring it from the bare-goal predicate. New regression test
RED-verified against the pre-fix code first (trace ended on `ADD_COURSE`
with no STOP). This session requested a fresh Codex review of the fix commit
(the first round had only reviewed the initial commit) before merging, per
the standing "Codex must review the latest commit" gate — round 2 came back
clean ("Didn't find any major issues"). **This fix itself has its own residual
gap — see "Known related gaps" item 3 below (filed as issue #68): it can't
yet distinguish "genuinely truncated, real work left" from "the last
permitted action already reached convergence," so a complete, goal-reached
plan can in principle be falsely reported as blocked. Not reached at this
session's review time — found afterward on this docs PR, not before merging
PR #65.**

**Final state**: CI green (3/3: Python tests, Next.js build, TypeScript API
tests) on the final commit, `mergeable_state: clean`, the one review thread
resolved with evidence. Full API suite at merge time: **86/86 suites,
1351/1351 tests** (+2 across both commits), zero regressions; `tsc --noEmit`
clean. `git diff --stat`: `api/ai/planner_worker.ts` (+29/-4 for the base
fix, plus the maxSteps-truncation fix) + its test file only — no UI changes,
no other planner files touched. **Merged as `8d4b5f5`.**

**Classification: C** (correctness/honesty — same bug class as the
already-fixed disallowed/annual/legality/missing-mandatory/degree-hours
gates, this time for a silently-dropped preference rather than a dropped
requirement).

**Known related gaps PR #65 does NOT fix (three real Codex findings on this
docs PR, #66 — all three verified against the code, not taken on faith, before
acting):**

1. **[Filed as issue #67 — downgraded after a real Codex finding on this
   docs PR corrected the initial P0/P1 severity claim, see below]** PR #65
   only changed `PlannerWorker.step()`. `generate-plan.ts`'s actual default
   branch, whenever a model is configured and the app is not in dev mode,
   calls `LlmOrchestrator`, NOT `worker.run(500,'greedy')` directly
   (`generate-plan.ts:1529-1532`; `isDevMode()` always returns `false` under
   `VERCEL_ENV=production`). `LlmOrchestrator.run()`'s OWN outer fallback
   (`planner_orchestrator.ts:74-76`) only re-runs the deterministic loop when
   `!worker.validateCandidate().valid`, which has zero `wantedCourseIds`
   awareness. **However — verified after a Codex finding on this docs PR
   correctly pushed back on the initial severity claim — the LLM's `tools`
   include `finalize_plan` (`planner_tools.ts:82-95`), whose `execute()`
   calls `worker.repair()`, which itself calls `this.run(500,'greedy')`: the
   SAME fixed post-goal loop PR #65 patched.** The system prompt
   (`planner_orchestrator.ts`'s `DEFAULT_SYSTEM`) explicitly instructs the
   model to finish by calling `finalize_plan` ("סיים בקריאה ל-finalize_plan"),
   so the normal, designed flow already gets PR #65's fix on this path too.
   **A further Codex finding refined the condition once more**: `finalize_plan`'s
   `execute()` only calls `worker.repair()` and returns a report — it does
   NOT terminate or lock the tool-calling loop, so nothing stops the model
   from issuing more tool calls afterward (e.g. adding an ordinary filler,
   then removing the just-placed wanted course) and finishing in a state
   where `validateCandidate().valid` is still `true` — the outer fallback
   never fires, and the wanted course is dropped again. **A third Codex
   finding narrowed this further**: a mutation after `finalize_plan` only
   removes the deterministic convergence *guarantee* — it doesn't by itself
   reproduce the wanted-course loss (e.g. a post-finalize `move_course` can
   easily leave the wanted course placed and the plan still fully optimized).
   So the precise repro condition is not "any run whose final mutation
   happens after its last `finalize_plan` call," but one where that
   post-finalize activity **actually undoes or fails to redo an optimization**
   `worker.repair()` had achieved (e.g. removes a wanted course, or
   unbalances load) with no later `finalize_plan` call to recover it — still
   an LLM-behavior-dependent compliance mode, not an unconditional missing
   deterministic backstop.
   **Not reproduced against a real/mocked `LlmOrchestrator` run** — genuinely
   unknown how often real models exhibit either variant in practice. Filed as
   **issue #67** (now corrected twice) with this precise condition and a
   suggested repro-first approach, rather than fixed inline — this docs PR's
   diff stays docs-only, across both `AUTONOMOUS_PROGRESS.md` and
   `.remember/current.md`, no product code touched. **Downgraded from the
   initial P0/P1 label**: per Codex's correction, an unverified, conditional, model-dependent
   preference-quality gap should not automatically preempt the rolling-
   classification-window preference below without production reproduction
   first — that decision is deferred to whichever session actually
   reproduces (or rules out) the no-`finalize_plan` case.
2. The `AI_USE_AGENTIC_PLANNER=true` path (`PlannerAgent` +
   `planner_search_beam.ts`) has the identical predicate gap one level down —
   `TauPolicyProvider.isGoal` (`planner_policy.ts`) is the same bare
   degree/mandatory/category/legality/annual completion check, with zero
   `wantedCourseIds` awareness, and `planner_search_beam.ts`'s loop
   terminates (`terminationReason = 'goal_reached'`) the instant every beam
   state satisfies it. This session confirmed only that `AI_USE_AGENTIC_PLANNER`
   is not set in any *committed* config — no tool in this session's Vercel
   MCP access exposes live environment-variable values (`get_project` doesn't
   include them, and no dedicated env-var tool is available), so **this does
   NOT independently verify the live Vercel configuration** (real Codex
   finding on this docs PR, `discussion_r3663503721` — a fair correction:
   every prior session's identical "unreachable in production" claim about
   this flag carries the same unverified gap, worth a future session actually
   checking via `vercel env ls` or equivalent if/when that access exists).
   Recorded here as **default-off / not committed / not independently
   confirmed against the live environment** rather than "unreachable," per
   Codex's suggested wording. **A further Codex finding correctly caught
   that priority here is NOT "regardless" of #67 — it's conditional on the
   live flag**: `generate-plan.ts:1495-1526`'s `if
   (process.env.AI_USE_AGENTIC_PLANNER === 'true')` is a mutually-exclusive
   dispatch — if that flag IS set live, every real request routes through
   `PlannerAgent`/`planner_search_beam.ts` exclusively, the `LlmOrchestrator`
   path issue #67 describes is never reached at all, and this beam-search gap
   becomes the sole active production defect, not a lower-priority one. Not
   separately filed as its own issue; worth folding into the same future fix
   session as #67 since it's the identical bug class, but whichever of the
   two is confirmed live-reachable should be treated as the priority one (see
   "exact next action" below, which already states this correctly).
3. **[Filed as issue #68]** PR #65's OWN maxSteps-truncation fix (the
   `006aad6` commit, "One real Codex finding on the initial commit" above)
   has a residual regression, itself a real bug in already-merged code, not
   just a docs-accuracy gap: before PR #65, `step()` returned an instant STOP
   the moment `isGoalReached()` became true (message never mentions
   "maxSteps"), so `run(maxSteps)`'s loop always exited via that internal
   STOP well before the budget could run out in the goal-reached case — this
   was structurally unreachable. PR #65 removed that early return, making it
   newly possible for the loop's very last permitted iteration to be a real
   accepted action that itself reaches full convergence, with no further
   `step()` call left in budget to detect it and emit the normal convergence
   STOP — so `run()`'s post-loop code now always records a truncation STOP,
   and BOTH of its message variants contain the substring `"maxSteps"`.
   `generate-plan.ts:1543`'s `hitMaxSteps` detection (`.some(a => a.action
   === 'STOP' && a.reason?.includes('maxSteps'))`) doesn't distinguish the
   two cases, and `generate-plan.ts:1559-1561` unconditionally pushes
   `STEP_LIMIT_ERROR` into `blockingErrors` whenever `hitMaxSteps` is true —
   so a plan that is actually complete (bare goal met, fully legal) but
   merely ran out of step budget mid-optimization can be falsely reported as
   **blocked**, the mirror-image failure mode of the bug PR #65 fixed. Not
   reproduced against the real default production budget (`worker.run(500,
   'greedy')`) — 500 legal actions in one plan is implausible for any real
   board, so low real-world likelihood at that scale (Codex's own badge on
   this finding was P2, not P1) — but readily reproducible at small
   `maxSteps` values, which is exactly how PR #65's own regression test
   demonstrates the underlying mechanism. Filed as **issue #68** with a
   suggested fix direction (distinguish real truncation from
   last-action-was-the-convergence-point via a non-consuming post-loop
   convergence check) rather than fixed inline — needs its own RED-verified
   regression test isolating the exact boundary, out of scope for this
   docs-only PR.

**Rolling-three check: (60, 62, 65) = A/C/C — compliant** (all three are
A/B/C; PR #60 is the A/B). **Net: positions 62 and 65 are both C, so the
immediate next milestone should be A or B** — picking another C next would
produce (62, 65, next) = C/C/C, the same non-compliant pattern already
avoided once before at the (53, 56) juncture. Candidates already on record:
naming a real production consumer for one of the unwired Simulation/
Persistence/Decision capabilities (PRs #12/#13/#14) and wiring it in (B), or
a UI improvement to how `academicDecision.explanation`/blocked-plan states
are surfaced (A) — the diagnosis pass this session inherited also reconfirmed
a minor, not-yet-fixed accessibility gap in the blocked-plan panel
(`app/web/semester_board_viewer.html`: no `aria-live`/focus-move on
appearance) as one concrete A-classified candidate.

**Production check**: not re-verified via the Vercel API this session (no
new evidence prompting a re-check; standing pin at `26500d4`, "Merge PR #11",
unchanged since every session's check going back to PR #27). PR #65 (along
with every other merged fix since PR #11) joins the same growing
merged-but-not-deployed backlog — this remains the standing, previously
human-flagged (issue #18) deploy-mechanism blocker, not re-litigated this
session absent new evidence.

**Standing blockers, unchanged, not re-investigated further this session (no
new evidence since last check)**: issue #15/#18 (PR #14 D-stacking merge
decision, Vercel `tau-course-planner` vs `web` canonical-project question),
issue #20 (386/386 `jest.ui.config.js` failures, single root cause — missing
gitignored fixture, needs a human sign-off on a sanitized replacement), issue
#21 (dead-code delete-vs-restore call). All confirmed still open, zero new
human comments.

**Exact next action for the next session**: PR #65 is merged and closed — do
not reopen it or re-address the greedy-path (`PlannerWorker.step()`) fix
itself. **Issue #67 is NOT an automatic P0/P1 preemption** — corrected this
session after two real Codex findings: `finalize_plan` (the LLM's own tool,
which its system prompt instructs it to call to finish) already runs the
SAME fixed `worker.repair()` → `run(500,'greedy')` loop PR #65 patched, but
that tool doesn't terminate or lock the model's tool loop — so the precise
gap is any run whose final relevant mutation is NOT followed by a
`finalize_plan` call (covers both "never calls it" and "calls it, then
mutates again afterward and drops the wanted course"), unreproduced,
model-dependent, not a confirmed default-path break. Treat issue #67 as a
normal rolling-window candidate (reproduce both variants against a
real/mocked `LlmOrchestrator` first, per its own suggested approach), not
something that must jump the queue. The
`planner_search_beam.ts`/`AI_USE_AGENTIC_PLANNER` analog (gap #2
above) is lower priority — but per the "Known related gaps" caveat above,
its live-production status is **default-off/not-committed, not
independently confirmed**, not "unreachable"; if a future session with
Vercel env-var access confirms the flag IS set live, this stops being
lower priority and becomes as urgent as issue #67. Worth folding into the
same fix session as #67 regardless, since it's the identical bug class.
**Issue #68**
(the maxSteps-truncation false-block regression in PR #65's own merged code)
is real but lower real-world likelihood at the actual production `maxSteps:
500` budget — worth fixing in the same session as #67 given the shared file
(`planner_worker.ts`), but not itself urgent enough to preempt #67. Absent a
decision to pick up issue #67 immediately, run a fresh **Agent Diagnosis
Loop** against the real `generate-plan.ts` handler (both paths) if no A/B candidate
is otherwise picked up from the open queue; standing human-decision blockers
above (issues #15/#18/#20/#21) remain untouched pending a human call, and
this does not override the standing P0/correctness-preemption rule.

## Prior session — PR #62 merged: unrecoverable degree-hours shortfall silently reported as a soft warning instead of a blocking error, plus 20 real rounds of Codex-caught recovery-probe correctness gaps

Standing audit (scheduled autonomous run): this session's assigned branch
(`claude/youthful-tesla-cihf6a`) had zero commits of its own and was already
level with `origin/main`'s tip — `main` remains ~190+ commits behind
`ui/frontend-modernization`, unchanged, full reconciliation still not done
(see prior entries). At session start, PR #62 (this entry's subject) was
already open, mid-review, from a session provisioned earlier the same day —
picked it up per the anti-duplication/queue-resolution rule (resolve the
oldest in-flight item before starting anything new) rather than beginning a
fresh Agent Diagnosis Loop pass. PR #14 (Decision capability) remained the
only other open PR, correctly still parked per the standing D-stacking-cap
precedent; issues #15/#18/#20/#21 reconfirmed unchanged, zero new human
comments. Production reconfirmed via the Vercel API — `tau-course-planner`
still pinned at `26500d4` ("Merge PR #11"), unchanged since every check going
back to PR #27; every deployment's `creator`/`meta.actor` shape confirms
deploys remain one-off CLI `vercel --prod` invocations with no Git
integration on any branch (`get_runtime_errors` came back `403 Forbidden`
this session — a permissions gap on that specific endpoint, not evidence of
either a healthy or unhealthy production state, so not treated as a status
signal either way).

**The bug** (found via a fresh Agent Diagnosis Loop pass targeting
blocked/error-state honesty, an area no prior session had exercised): when a
plan satisfies every mandatory course and elective-category requirement, is
otherwise fully legal, but the visible catalog is genuinely exhausted before
reaching `model.degreeRequiredHours`, `generate-plan.ts` already computed
this internally (the pre-existing "מיצית את כל הקורסים הזמינים" `warnings_he`
message) but only ever surfaced it as a **soft warning** — never a
`blockingErrors` entry. Concretely reproduced: a 100h-target fixture against
a 12h catalog returned `blocked:false`, `academicDecision.validation.valid:
true`, *and* `academicDecision.explanation.whyThisPlan[0]` stating outright
"התוכנית אינה מלאה עדיין" (the plan is not yet complete) — a machine-visible
self-contradiction inside one API response, directly violating this repo's
own "no incomplete plan may be presented as complete" policy. Same bug class
as PR #48's `legalityGate` and PR #41's structural-gap disclosure, but the
one sibling case (of disallowedGate/annualCompletenessGate/legalityGate/
missingMandatoryGate) that had never gotten its own gate.

**Fix**: new `degreeHoursGate` (`generate-plan.ts`) independently re-derives
the same unrecoverability condition the existing warning already computed,
mirroring every other gate's "re-derive from the final placed set" pattern.
New `DEGREE_HOURS_SHORTFALL_ERROR_PREFIX` (`planner_validate.ts`) gives
`academic_decision_runtime.ts` a distinct cause-attribution instead of
folding into the generic overload catch-all, with its own `suggestedNextActions`
("expand the catalog/planning window or consult an advisor" — neither
"reduce load" nor "rebuild" can fix a catalog-side shortfall).

**Then 20 real, concrete, RED-verified Codex rounds followed**, each closing
a genuine gap in the recovery-probe logic that decides whether a shortfall is
truly unrecoverable (i.e. safe to hard-block) — every one reproduced with a
specific numeric scenario before being fixed, none rubber-stamped:
benign currently-taking-course-on-board reuse wrongly suppressing the gate
(round 1); the same course's hours double-counted, masking a genuine
shortfall (round 2); the recovery rollout itself having no currently-taking
awareness at all (round 3, widened round 5); the rollout's state
reconstruction dropping empty-semester keys that `applyMutation` needs
(round 4); the blocked-branch template suggesting a rebuild for a cause a
rebuild can't fix (round 5); recovery accepted on "any hours added" instead
of actually reaching the target (round 7); needing to search *combinations*
of soft-avoided electives, not just one at a time (round 8); needing to mix
soft-avoided and ordinary actions in one sequence (round 9); off-board
`personal_status.planned` hours never credited (round 10); the coarse
`total_hours_progress.currently_planned_hours` aggregate never credited when
per-course hours are missing (round 11); that credit applied as an
unconditional skip instead of a magnitude-bounded amount (round 12); the
generic completion warning and agent rationale still using uncredited raw
hours even after the gate itself was fixed (round 13); a decisive single-step
recovery candidate starved by 200+ smaller ones ahead of it in enumeration
order (round 14); `REPLACE_COURSE` always illegal for an `is_annual` inId,
and no `REMOVE_COURSE` candidate existing at all for "free this slot for
something bigger" recoveries (rounds 22/24 per the code's own inline
numbering); and, in the final two rounds, the off-board aggregate-credit
subtraction double-discounting an already-*placed* currently-taking course
(round 15) and then an already-placed `personal_status.planned` course
(round 16) — the live frontend's own placed-id filter
(`app/web/semester_board_viewer.html:2496-2498`) applies identically to both `personal_status`
arrays, and the fix had only reached one of them.

**One finding pushed back on rather than fixed blind**: a final review
comment (no concrete repro given, unlike all 20 prior ones) raised that the
hours-delta candidate sort (round 14's own fix) could in principle starve a
`REMOVE_COURSE` candidate the same way it once starved small ADDs, since
REMOVE always sorts last (non-positive delta). Replied with the technical
tradeoff rather than iterating further: this is an irreducible property of
any finite-budget heuristic search asked to prove a negative ("no legal path
exists") — already stacked with four independent mitigations (best-first
frontier expansion, the hours-delta sort itself, illegal candidates never
consuming budget, and the REMOVE_COURSE inclusion this exact concern is
about) — and, critically, the failure direction is the *safer* one
(over-conservative false-positive block, not the "invalid plan presented as
complete" direction this whole PR exists to close). Left the thread
unresolved rather than dismissing it, per this routine's own "reply with
evidence, leave unresolved if uncertain" rule — a concrete fixture would
still get fixed the same RED-verified way as every other finding here.

**Final state**: CI green (3/3: Python tests, Next.js build, TypeScript API
tests) on the final commit, `mergeable_state: clean`. **16 of 17 review
threads resolved with evidence** (15 by the prior session, the 16th — the
round-16 planned-course double-discount — resolved this session once its fix
landed); the 17th (the REMOVE_COURSE-starvation concern described above) was
**deliberately left unresolved**, not an oversight — see the paragraph above
for why. **Merged by the human product owner as `1a2fda2`** while that one
thread was still open (this session was subscribed to PR activity and
handled the final round's Codex finding and thread resolution; the merge
notification itself arrived as a webhook event, auto-unsubscribed per the
tooling's own notice). Full API suite at merge
time: 86/86 suites, 1349/1349 tests, zero regressions; `tsc --noEmit` clean.

**Classification: C** (correctness/honesty — closes a reproduced,
machine-verifiable in-product self-contradiction, same pattern as PR #48;
not a new user-facing explanation the way PR #58/#60 were).

**Rolling-three check: (58, 60, 62) = A/A/C — compliant** (3 of 3 are
A/B/C; 2 of 3 are A/B). No forced classification requirement on the
immediate next milestone.

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed. PR #62 (along with every other merged fix since PR #11) joins the
same growing merged-but-not-deployed backlog.

**Standing blockers, unchanged, not re-investigated further this session (no
new evidence since last check)**: issue #15/#18 (PR #14 D-stacking merge
decision, Vercel `tau-course-planner` vs `web` canonical-project question),
issue #20 (386/386 `jest.ui.config.js` failures, single root cause — missing
gitignored fixture, needs a human sign-off on a sanitized replacement), issue
#21 (dead-code delete-vs-restore call). All confirmed still open, zero new
human comments.

**Exact next action for the next session**: PR #62 is merged and closed — do
not reopen it or re-address it. Rolling-three window (58, 60, 62) = A/A/C is
compliant with no forced constraint on the next pick. Run a fresh **Agent
Diagnosis Loop** against the real `generate-plan.ts` handler (both paths)
targeting areas still not yet exercised by any session: dual-semester/multi-
alternative comparison PLAN QUALITY itself (distinct from "is a comparison
mechanism reachable at all," already answered clean by the PR #60 session),
simulate-then-apply user flows (once/if a real one ever becomes reachable —
currently confirmed not to exist), and accessibility/error-state UI behavior
for blocked plans. Standing human-decision blockers above (issues
#15/#18/#20/#21) remain untouched pending a human call; this does not
override the standing P0/correctness-preemption rule.

## Prior session — PR #60 merged: prerequisite-driven placement delay never explained, found via a fresh Agent Diagnosis Loop

Standing audit (scheduled autonomous run): session branch `claude/youthful-tesla-bybfn4`
was, again, the same recurring mistake several prior sessions have had to
correct, provisioned from a stale `main`-derived commit (`92c19e0`) — reset to
`ui/frontend-modernization` tip (`19d65f9`), zero commits lost. Only one open
PR existed (**#14**, Decision capability — correctly still parked per the
D-stacking-cap precedent; issues #15/#18/#20/#21 reconfirmed unchanged, zero
new human comments, `mergeable_state: dirty` against its own stale base but
deliberately left untouched). CI green on the base tip. Production
re-confirmed healthy via Vercel MCP tools (`tau-course-planner`, zero runtime
errors in the last 24h) but still pinned at `26500d4` ("Merge PR #11") — no
new deployment, same standing no-git-integration/no-CLI-credentials blocker
every session since PR #27 has confirmed; re-verified via `list_deployments`
that every deploy remains a one-off CLI `vercel --prod` invocation.

Per the prior session's own "exact next action," ran a fresh **Agent
Diagnosis Loop** (delegated to a background agent driving the real
`api/ai/generate-plan.ts` handler end-to-end with real Hebrew scenarios, both
the default and `use_academic_decision_agent` paths) targeting the four areas
explicitly flagged as not-yet-covered by any prior pass: multi-alternative
comparison, simulate-then-apply flows, multi-turn conversation honesty, and
in-plan prerequisite sequencing.

**Three areas came back clean** (reproduced against the real handler, not
just static-read): multi-alternative comparison (the only comparison-capable
path, `AI_USE_AGENTIC_PLANNER`, is unreachable in production — same standing
finding as Simulation/Persistence/Decision — and the reachable
`academicDecision.decision.rationale` already honestly discloses "זוהי
התוכנית היחידה שנוצרה בסבב זה", no false "best option" claim); simulate-then-
apply (no chat/free-text NLU entrypoint or simulate/apply distinction exists
anywhere reachable — every call is a real full recompute); multi-turn honesty
(the handler is fully stateless per request — a real 3-turn sequence produced
byte-identical, non-stale explanations turn to turn).

**The one real, reproduced finding — in-plan prerequisite sequencing**: when
a course's own prerequisite forces it to be placed later than its earliest
nominally-legal semester (the only gate is `plan_validation.ts`'s
prerequisite strict-timing rule), nothing in the response ever explained why.
`PlannerWorker`'s trace-reason buckets (mandatory/category/wanted/filler-
hours) never reference sequencing, and
`academicDecision.explanation.whyThisPlan` is plan-aggregate-only. A user who
explicitly wanted a course "as soon as possible" got zero signal that
prerequisite ordering — not preference, capacity, or any other visible
constraint — is why it landed a year later. Reachable on the real default
production path, not gated behind any inert flag.

**Fix** (`1f8cfc2`, PR #60): new `prerequisiteSequencingNotes()` in
`generate-plan.ts`'s `toProposal()`, following the file's existing gate
convention (`disallowedGate`/`annualCompletenessGate`/`legalityGate`) — a pure
function of `(finalState, model)` that re-derives the same strict-timing fact
`plan_validation.ts`'s own validator enforces, pushing a Hebrew explanatory
note into `warnings_he` when a placed course's delay is attributable to an
unresolved prerequisite's own placement. Reaches both the default path's UI
rendering and, via the shared warnings-composition,
`academicDecision.explanation.risksAndTradeoffs` on the agent path.

**Self-caught correctness guard, before any Codex round**: only fires when
the course's nominal legal-semester data is *confident*
(`getLegalSemesters`'s own flag) — the same "confident-or-stay-silent"
convention `buildValidationContext`/`addCourseActionsFor`/`annualSpansFor`
already use. Without this guard, an elective with no known offering
restriction would get a false-positive note for almost any unresolved
prerequisite (`legalSemestersFor`'s unconfident fallback treats every known
semester as "legal", making semester 0 look spuriously early). Caught during
self-review via a dedicated regression test, RED-verified specifically
against the unguarded implementation before the guard was added.

**Tests**: new `tests/api/generate_plan_prerequisite_sequencing_explanation.test.ts`
(5 tests — real scenario, negative/no-delay sanity check, agent-path
disclosure, agentic-planner-path disclosure, and the false-positive
confidence-guard check) + a dedicated new fixture
`data/boards/test_program_prereq_sequencing_2027.json` (the existing shared
`test_program_prereq_2027.json` fixture can't reproduce this scenario — its
`ADV` is only nominally legal starting *after* `PRE`'s own semester already,
so there's no gap to explain; a new fixture avoids touching the two existing
test files that depend on the shared one's exact shape). All 5 RED-verified
(both against the unfixed code, and the confidence guard specifically against
the unguarded version) before confirming green. Full API suite **85/85
suites, 1325/1325 tests** (+5, zero regressions), `tsc --noEmit` clean. `git
diff --stat`: `generate-plan.ts` (+90/-1) + the 2 new files only.

**PR #60 opened against `ui/frontend-modernization`, marked ready, `@codex
review` posted, subscribed to PR webhook activity.** Codex reviewed the only
commit (`1f8cfc2`) clean ("Didn't find any major issues"), CI completed
`success` (3/3: Python tests, Next.js build, TypeScript API tests),
`mergeable_state: clean`, no review threads. **Merged as `0e4ec0d`** in the
same session via the webhook-driven continuation; auto-unsubscribed on merge
per the tooling's own notice.

**Classification: A** (user-visible — the new note renders in the real chat
UI: `semester_board_viewer.html`'s `warnings_he` classifier has no
special-case regex match for this text, so it falls through to the generic
`details` bucket and is displayed, not dropped).

**Rolling-three check: (56, 58, 60) = C/A/A — compliant** (all three are
A/B/C; two are A/B). No forced A/B/C-mix requirement on the immediate next
milestone, though two A's in a row is worth noting for future tracking (not a
violation — the rule only forbids 0-A/B windows and >2-D windows).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed, re-verified this session. PR #60 (along with every other merged
fix since PR #11) joins the same growing merged-but-not-deployed backlog.

**Standing blockers, unchanged, not re-investigated further this session (no
new evidence since last check)**: issue #15/#18 (PR #14 D-stacking merge
decision, Vercel `tau-course-planner` vs `web` canonical-project question),
issue #20 (386/386 `jest.ui.config.js` failures, single root cause — missing
gitignored fixture, needs a human sign-off on a sanitized replacement), issue
#21 (dead-code delete-vs-restore call). All confirmed still open, zero new
human comments.

**Exact next action for the next session**: PR #60 is merged and closed — do
not reopen it or re-address it. Rolling-three window (56, 58, 60) = C/A/A is
compliant with no forced constraint on the next pick. Run a fresh **Agent
Diagnosis Loop** against the real `generate-plan.ts` handler (both paths)
targeting areas still not yet exercised by any session: dual-semester/multi-
alternative comparison PLAN QUALITY (distinct from the "is a comparison
mechanism reachable at all" question this session answered — e.g. does the
single plan the default greedy search produces actually balance dual-offered
electives well?), simulate-then-apply user flows (once/if a real one ever
becomes reachable — currently confirmed not to exist), and
accessibility/error-state UI behavior for blocked plans. Standing
human-decision blockers above (issues #15/#18/#20/#21) remain untouched
pending a human call; this does not override the standing
P0/correctness-preemption rule.

## Prior session — PR #58 merged: wanted-vs-excluded contradiction disclosure, including a Codex-caught stale-placement wording bug

Start-of-session audit: session branch `claude/youthful-tesla-t0vt3j` was —
again, the same recurring mistake several prior sessions have had to
correct — provisioned from a stale `main`-derived commit (`92c19e0`); reset
to the current `ui/frontend-modernization` tip (`95321e4`), confirmed zero
unique commits lost. Two open PRs found: #14 (Decision capability, still
correctly deferred per the issue #18 D-stacking-cap decision — reconfirmed
no new human comments on issues #15/#18/#20/#21 since the last check, so
left untouched) and #58, already opened this same day with the exact minor
finding the prior session's entry had flagged and deliberately deferred
("low severity... a candidate for a future minor milestone").

**Picked up PR #58** rather than starting new diagnosis work, since an
open PR already addressed the selected finding (per this routine's
own anti-duplication rule) and it already had one live Codex finding to
resolve: Codex correctly caught (`discussion_r3632198441`) that the new
wanted-vs-excluded disclosure text unconditionally claimed the exclusion
"won" and the course "was not placed" — but when the overlapping course was
already on the **incoming board**, `planContextToState` seeds that
pre-existing placement and the planner never removes it on its own;
`disallowedGate` then reports it as a blocking `DISALLOWED_PLACED_ERROR_PREFIX`
error instead, so the course is actually still present in
`proposal.semesters`. The old wording self-contradicted that same
response's own semesters/error content in that scenario.

**Fix** (`718945c`): split `contradictoryWantedNames` into two groups —
names that also appear in a `DISALLOWED_PLACED_ERROR_PREFIX` error (still
placed, stale) vs. names that don't (correctly excluded, genuinely not
placed) — each with its own accurate, non-contradictory
`risksAndTradeoffs` wording. Extraction mirrors the existing
`missingMandatoryNames` pattern (strip fixed Hebrew prefix, exact match).
New regression test RED-verified against the pre-fix code (reproduced the
exact self-contradiction Codex flagged) before confirming green.

**Tests**: full API suite **84/84 suites, 1320/1320 tests** (+6 from
baseline 1314 across both PR #58 commits), zero regressions. `tsc --noEmit`
clean.

**Merged** PR #58 (`5ea5d2f`) after CI green (3/3: Python tests, Next.js
build, TypeScript API tests) and a final clean Codex review on the fix
commit ("Didn't find any major issues"), with the one review thread
resolved with evidence. **Classification: A** (user-visible —
`risksAndTradeoffs`/`suggestedNextActions` render verbatim in the real chat
UI panel via `academicDecisionHtml()`).

**Rolling-three check: (53, 56, 58) = C/C/A — compliant** (at least two of
three are A/B/C — all three are; at least one is A/B — 58 is A). The
prior session's own note correctly anticipated this: two trailing C's
(53, 56) left no room for a third C, and this A-classified pickup
satisfied that constraint rather than extending the streak.

**Production check**: re-confirmed directly via Vercel MCP tools (now
reachable this session) — `tau-course-planner` (the project actually
serving production traffic) is still pinned at its newest `target:
production` deployment, commit `26500d4` ("Merge pull request #11"),
unchanged since every prior session's check going back to PR #27. No new
deployment exists. Deploys remain one-off `vercel --prod` CLI invocations
with no Git integration wired to any branch (confirmed again: `list_deployments`
shows every production deploy's `creator`/`meta` matches this known
mechanism, not a webhook-triggered one). This sandboxed session still has
no safe path to perform the deploy itself — `deploy_to_vercel` would upload
a raw file tree with no git linkage, breaking `gitCommitSha` traceability,
so deliberately not used, matching every prior session's same call. PR #58
(and every other merged fix since PR #11) joins the same growing
merged-but-not-deployed backlog — still not recomputing a precise count
this session (the counting methodology was never pinned down precisely
enough per the correction chain on PR #57), but confirming the trend is
unchanged: still growing, not shrinking.

**Standing blockers, unchanged, not re-investigated further this session
(no new evidence since last check)**: issue #15/#18 (PR #14 D-stacking
merge decision, Vercel production-architecture question — `tau-course-
planner` fastapi project vs. `web` nextjs project), issue #20 (386/386
`jest.ui.config.js` failures, 100% one root cause — the gitignored
`supabase_board_backup_2027_pre_sync.json` fixture — needs a human call on
committing a sanitized replacement), issue #21 (dead-code delete-vs-restore
call). All confirmed still open with zero human comments as of this
session's check.

**Exact next action for the next session**: PR #58 is merged and closed —
do not reopen it or re-address it. The rolling-three window (53, 56, 58) =
C/C/A is compliant with no forced constraint on the next pick beyond the
standing rule (never two C's followed by a third C). Run a fresh **Agent
Diagnosis Loop** against the real `generate-plan.ts` handler with Hebrew
scenarios in areas not yet covered (multi-alternative comparison,
simulate-then-apply flows, multi-turn conversation honesty, in-plan
prerequisite sequencing remain the standing candidates several prior
sessions have named but not yet exercised) to find the next highest-impact
real Agent failure — per this routine's "repeat until all critical
scenarios pass" instruction. This does not override the standing
P0/correctness-preemption rule, nor the standing human-decision blockers
above (issues #15/#18/#20/#21), which remain untouched pending a human
call.

## Prior session — PR #56 merged: missing-mandatory cause misattributed to the user's own hard exclusion

Start-of-session audit: no human comments landed on the standing decision
issues (#15/#18/#20/#21) since the last session — all still open, all still
correctly un-acted-on pending a human call (see "Standing blockers" below).
Only one open implementation PR existed (#14, Decision capability) — left
untouched per the D-stacking-cap precedent, unchanged. No Vercel MCP tools
were reachable this session either (confirmed via ToolSearch) — the
standing "no deploy path" blocker is unchanged, not re-investigated further
since no new evidence exists. Session branch `claude/youthful-tesla-sgzgz9`
was — again, the same recurring mistake several prior sessions have had to
correct — provisioned from a stale `main`-derived commit (`92c19e0`); reset
to the current `ui/frontend-modernization` tip (`4bda2ab`) before starting,
confirmed zero unique commits lost.

Per the exact next action the prior session (PR #53) left in this file, ran
a fresh **Agent Diagnosis Loop** (delegated to a background agent driving
the real `api/ai/generate-plan.ts` handler end-to-end via the same
dev-bypass/on-disk-fixture pattern `tests/api/generate_plan_academic_decision_agent.test.ts`
uses — read-only, no product code touched during diagnosis) with Hebrew
scenarios in areas not yet covered by issue #25's closed findings:
hard-avoid-vs-mandatory conflict wording, and contradictory
wanted-vs-disallowed preferences on the same elective course.

**The finding**: when a mandatory course is missing from the plan *solely*
because the user hard-excluded it themselves (`disallowed_course_ids` /
`strongly_avoided_course_ids`), `academic_decision_runtime.ts`'s
`buildAcademicDecision` told them to "check what prerequisites it needs, or
request a rebuild" — advice that can never help (a rebuild reproduces the
identical result while the exclusion stands; the course may have zero
prerequisites). Root cause: `hasMissingMandatoryError` was a single flat
boolean, never cross-referenced against `input.context.excludedCourseIds`
(already available at the call site, unused for this purpose). Same "wrong
remedial advice" bug class PR #44/#48 fixed for the annual/step-limit/
legality causes — a sub-case (missing-mandatory itself has two distinct
root causes) those fixes never covered.

**Fix** (`b84c1d9`, PR #56, against `ui/frontend-modernization`): splits the
flag into `hasMissingMandatoryDueToExclusion` vs
`hasMissingMandatoryOtherCause` (matched by course name extracted from the
error text, exact-match after stripping the fixed prefix — not a substring
check, which would false-positive on the prefix's own generic wording), each
with its own correct `blockingCauseClauses` entry and
`suggestedNextActions` line. Both fire together when a plan has one of each
cause. `api/ai/generate-plan.ts` and every other caller untouched — the
`excludedCourseIds` wiring this fix reads already existed at the real call
site.

Minor secondary finding from the same diagnosis pass, **not acted on** (low
severity — a disclosure gap, not a blocking-correctness bug): when a course
is both `wanted_course_ids` and `disallowed_course_ids` simultaneously, the
exclusion correctly wins silently, and the category-unsatisfied warning
already gives a truthful signal, but nothing states the two preferences
directly conflicted. Left as a candidate for a future minor milestone, not
worth a P1-priority fix on its own.

**Tests**: 3 new cases in `tests/api/academic_decision_runtime.test.ts`
(RED-verified against the unfixed code first), full API suite **1314/1314**
across 84 suites (+3, zero regressions), `tsc --noEmit` clean. `git diff
--stat`: only the runtime file + its test file.

**PR #56 opened, marked ready, `@codex review` requested, subscribed to PR
activity.** Codex reviewed the final commit (`edd69c1`) clean ("Didn't find
any major issues"), CI (`.github/workflows/ci.yml`) completed with
`conclusion: success` on that same commit, `mergeable_state: clean`, no
unresolved review threads. **Merged as `24d8877`** via the webhook-driven
continuation of this same session.

**Classification: C** (correctness/honesty — real, reproduced, in-product
wrong advice on a production-reachable path). **Rolling-three check: (50,
53, 56) = A/C/C — currently compliant, but constrained going forward.**
(Two rounds of real Codex findings on the docs PR #57 that recorded this,
`discussion_r3631848828` and `discussion_r3631880980`: round 1 caught that
an earlier draft skipped merged-and-A-classified PR #50, mis-deriving (48,
53, 56) = C/C/C; round 2 caught that the fix then over-corrected to "no
forced requirement at all," ignoring that positions 53 and 56 are BOTH C —
picking another C next would immediately produce (53, 56, next) = C/C/C,
the exact non-compliance already seen once before at (32,34,37). Both
corrected here.) **Net: the immediate next milestone should be A or B** —
not because the current window is broken, but because two trailing C's
leave zero room for a third before the window breaks. Candidates: wiring
one of the unconsumed Simulation/Persistence/Decision capabilities (PRs
#12/#13/#14) into a real production caller (B), or a UI improvement to how
`academicDecision.explanation` is surfaced (A).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed; re-confirmed this session that no Vercel MCP tool is reachable
either. PR #56 (now merged) joins the same growing backlog of merged-but-
not-deployed work. (Codex review on docs PR #57,
`discussion_r3631939655`, correctly caught that an earlier draft here
regressed this count to 14 — below the 17 already recorded as of PR #51's
merge — with no recount to justify a decrease. `git log
26500d4..origin/ui/frontend-modernization` shows at least 25 distinct
merged PR numbers since production's pin, several with many Codex-round
commits each; the backlog has only grown since the 17 count, not shrunk.
Not asserting a new precise "fixes only" number here — the 17-count's own
methodology (which PRs count vs. pure docs) was never pinned down
precisely enough to extend reliably — but the trend is unambiguously
upward, and the next session should either recompute a real count with a
stated methodology or simply state "unchanged, still growing" rather than
inventing a smaller figure.)

**Standing blockers, unchanged, not re-investigated further this session
(no new evidence since last check)**: issue #15/#18 (PR #14 D-stacking
merge decision, Vercel production-architecture question — `tau-course-
planner` fastapi project vs. `web` nextjs project), issue #20 (386/386
`jest.ui.config.js` failures, 100% one root cause — the gitignored
`supabase_board_backup_2027_pre_sync.json` fixture — needs a human call on
committing a sanitized replacement), issue #21 (dead-code delete-vs-restore
call). All confirmed still open with zero human comments as of this
session's check.

**Exact next action for the next session**: PR #56 is merged and closed —
do not reopen it or re-address it. The current rolling-three window is
compliant ((50, 53, 56) = A/C/C — see correction above), but positions 53
and 56 are both C, so **the next milestone selected should be A or B** —
picking another C now would immediately create a non-compliant (53, 56,
next) = C/C/C window. Two standing candidates: naming a real production
consumer for one of the unwired Simulation/Persistence/Decision
capabilities (PRs #12/#13/#14) and wiring it in (B), or improving how
`academicDecision.explanation` is actually surfaced in the UI (A). **This
does not override the standing P0/correctness-preemption rule**: a newly
discovered production incident, hard-constraint violation, or other P0/P1
correctness break still takes priority over the rolling-window preference,
exactly as this routine's own priority order already states ("Never select
a lower-priority item while feasible higher-priority work remains"). Absent
such an emergency, prefer A/B before returning to another C-classified
Agent Diagnosis Loop finding (candidates already surfaced: the
wanted-vs-disallowed disclosure gap noted above, or a fresh sweep of
multi-turn conversation honesty / simulate-then-apply areas per the P1
checklist).

## Prior session — PR #53 merged: issue #25 Finding #4 (planner front-loads elective hours ahead of mandatory obligations), closing issue #25

Resumed PR #53 (issue #25 Finding #4), found already 20 commits deep across
21 rounds of real Codex findings from prior sessions the same day. Picked up
the outstanding unresolved Codex finding (a shared-prerequisite boundary
that was tightened but never re-propagated to that prerequisite's own
prerequisites) and fixed it, then re-merged the base (`ui/frontend-
modernization` had moved 2 docs-only commits ahead) to clear the branch's
`dirty` mergeable state.

Four more real Codex rounds followed, each a genuine narrower gap in the
same reachability/reservation mechanism, all fixed with RED-verified
regression tests:
- Round 22: category-candidate (group 2) and wanted-course (group 3) action
  proposals had no boundary awareness, letting a required-but-unplaced
  prerequisite that was ALSO a category candidate/wanted course get offered
  at a semester that could never satisfy its dependent mandatory course.
- Round 23: two findings — (a) a required mandatory course that's ALSO
  another mandatory course's prerequisite wasn't boundary-filtered by group
  1 (fixed); (b) a repair MOVE that crosses a mandatory course's
  reachability threshold can transiently lower g1 in a no-lookahead
  configuration — empirically verified via two `PlannerWorker.run()` repros
  (including an adversarial one with 15 competing elective actions) that
  this does NOT reproduce under the ACTUAL production configuration every
  real caller constructs explicitly (`{ topN: 6, rolloutSteps: 80 }` —
  `generate-plan.ts`'s primary worker and fallback, `planner-run.ts`'s
  worker; a first verification pass only checked `PlannerWorker`'s bare
  default (`{ topN: 8, rolloutSteps: 200 }`), a looser and non-representative
  configuration, and was corrected by a Codex finding on the docs PR (#55)
  recording this fix) — documented as a known, investigated limitation
  rather than fixed, since a general fix would mean loosening the search's
  core accept-if-strictly-improves invariant.
- Round 24: a prerequisite id with no profile at all in `model.profiles`
  (data-integrity gap) was wrongly treated as "ambiguous, bias reachable"
  instead of definitively unreachable — fixed.
- Round 25: `isImmovableOccupant`'s "does this occupant have a real
  destination" check only verified raw load headroom, never whether
  relocating there would actually be legal under prerequisite strict-timing
  ordering (for the occupant's own prerequisites, or for another
  already-placed course depending on the occupant) — fixed by a different,
  concurrently-active session on this same branch (`f7e74ca`); verified
  correct (full suite green) and picked up from there rather than pushing a
  duplicate fix, per this repo's established concurrent-session-collision
  handling precedent.

**Concurrent-session note**: confirmed a second session was actively working
this same PR branch during this session (its fix for round 25 landed while
this session was independently implementing an equivalent one). Discarded
the redundant local commit rather than risk a force-push collision — same
handling precedent as the earlier `5742ded`/`isImmovableOccupant` collision
documented lower in this file.

**Merged** PR #53 (`2ccac27`) after CI green (3/3) and a final clean Codex
review ("Didn't find any major issues") with all 26 review threads resolved.
Full API suite: 1311/1311 across 84 suites. `tsc --noEmit` clean.
**Classification: C** (correctness).

**Closed issue #25** — all 5 ranked findings from the original Agent
diagnosis report are now resolved (Findings #1–#4 fixed and merged across
PRs #27/#31/#32/#53; #5 correctly deprioritized as non-exploitable
defense-in-depth debt).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed. PR #53 (along with every other merged fix this routine has
produced) is not live for real users yet.

**Standing blockers, unchanged, not re-investigated this session**: PR #14
(Decision capability) correctly remains unmerged per the D-stacking-cap
precedent (issue #18); issue #21 (dead code delete-vs-restore) still needs a
human call; issue #18's Vercel-architecture/canonical-branch reconciliation
question is unchanged.

**Exact next action for the next session**: with issue #25 now fully closed,
re-run the mandated Agent Diagnosis Loop against the real `generate-plan.ts`
handler with fresh Hebrew scenarios (targeting areas not yet covered — see
the "not fully verified" list issue #25 originally flagged, now stale) to
find the next highest-impact real Agent failure, per this routine's own
"repeat until all critical scenarios pass" instruction.

## Prior session — PR #48: Agent Diagnosis Loop finding — prerequisite/duplicate/pinned legality violations were silently discarded, fixed, 1 real Codex finding

Ran the standing start-of-session audit (production health, open `claude/*`
branches, open PRs, Codex reviews, CI, issues, `.remember/current.md`,
`AUTONOMOUS_PROGRESS.md`). Found the assigned session branch was — again, the
same recurring mistake every prior session has had to correct — provisioned
from a stale `main`-derived commit (`92c19e0`, 2026-06-30) instead of current
`ui/frontend-modernization`; confirmed it had zero unique unmerged commits
(fully contained in current history) and reset it. Merged the one
already-ready item in the queue, **PR #47** (docs-only recap of PR #46's
merge, CI green, no product code — same treatment as PR #36/#38).

**New finding this session: real Vercel API access, but no safe deploy path.**
For the first time, this session had genuine Vercel API credentials (not just
CLI-login failure like every prior session) — confirmed via `list_teams`/
`list_projects`/`get_project`/`list_deployments` against the real
`tau-course-planner` project. Re-confirmed production is still pinned at
`26500d4` (PR #11), now 13 merged fixes behind. However, the only deploy tool
available (`deploy_to_vercel`) uploads a raw inline file tree with no git
linkage — impractical and risky for this existing multi-language repo
(hundreds of files across a FastAPI backend and a Next.js app), and would
break the `gitCommitSha` traceability every real deployment has had so far.
**Deliberately did not use it.** The blocker is unchanged in substance: still
needs either a real `vercel` CLI login or Vercel Git integration configured —
now confirmed as an actual tooling gap rather than a credentials gap.

**Then ran the mandated Agent Diagnosis Loop** (delegated to a background
agent driving the real `generate-plan` handler via a throwaway Jest harness,
no product code touched), targeting the areas the last several sessions
flagged as still untested: multi-alternative comparison, simulate-then-apply
flows, multi-turn conversation honesty, and in-plan prerequisite sequencing.
Areas A/B (Simulation/Persistence/Decision wiring) re-confirmed clean — still
zero reachable production trigger path, matching every prior check.

**The finding, fixed as PR #48**: `validatePlanState` (`planner_validate.ts`)
already enforces prerequisite strict-timing, duplicate placement, completed/
currently-taking course reuse, pinned-course "don't move," and illegal
offering-semester placement against the FINAL state — but `generate-plan.ts`'s
`toProposal()` only ever read that same `validateCandidate()` call's
`report.warnings`, never `report.errors`/`report.legal`. Reproduced: a course
already on the board whose prerequisite was never completed or scheduled
anywhere reported `blocked:false, errors:[]`, and on the
`use_academic_decision_agent:true` path rendered a **green "passed legality ✓"
checkmark** right next to explanation text (`whyThisPlan`) admitting the plan
can't legally place the course — a reproduced, rendered, in-product
self-contradiction. Same "computed-but-discarded validation signal" bug class
as issue #25 Finding #1 (PR #27) and the `is_annual` gap (PR #37).

Fix: new `legalityGate()` in `generate-plan.ts`, mirroring the established
`disallowedGate`/`annualCompletenessGate` pattern — re-derives against the
final placed set via `validatePlanState`, prefixes each message with a new
`LEGALITY_VIOLATION_ERROR_PREFIX` so `academic_decision_runtime.ts`'s
cause-attribution (added in PR #44) names it correctly instead of defaulting
to overload guidance — the exact "fifth cause" gap that file's own comment
had anticipated.

**1 real Codex finding, fixed**: the initial version excluded only overload
and annual-incompleteness from the gate's output (to avoid duplicating
`overloadGate`/`annualCompletenessGate`'s own messages), but Codex correctly
caught that `validatePlanState`'s "currently_taking course must not be
re-proposed" check would now false-positive-block **any actively-enrolled
student** — the real board legitimately keeps a currently-taking course
visible in its placed semester slot (`buildPlanContext` in
`semester_board_viewer.html` filters only completed courses out of
`plan_context`, deliberately keeping current ones so they still render).
Verified against the real client code before fixing. Added a third exclusion
marker (`CURRENTLY_TAKING_REUSE_ERROR_MARKER`) and a regression test proving
a currently-taking course shown on the board is not blocked and still
satisfies a dependent course's prerequisite. Round 2: Codex clean.

**Merged** (`fe84c02`). Full API suite **1279/1279** (83 suites, +7 new tests
across both commits), `tsc --noEmit` clean. `web/` (Next.js) build untouched
— confirmed via grep that no file under `web/` references any changed
module. **Classification: C** (correctness/honesty — closes a real, rendered,
in-product self-contradiction; found via the mandated Agent Diagnosis Loop).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged. PR #48
(along with PR #12/13/27/31/32/34/37/39/41/44/46/47) is not live for real
users yet.

## Prior session — PR #46: issue #43 (track_or_focus clarification question) fixed, 3 rounds of real Codex findings

Continuing the same session that merged PR #44. Picked up issue #43 (filed in that same session) as the next milestone — small, already fully diagnosed, ready to implement, and the rolling window was already compliant so there was no forced A/B pressure.

**The bug**: `academic_clarification.ts`'s `track_or_focus` question gates on `!context.track`, but `academic_decision_runtime.ts`'s `extractClarificationContext` never set it — no field for track exists anywhere in `plan_context`/`preferences` (deliberate: `academic_clarification_plan_inputs.ts` documents no planner input consumes it). So the question re-asked identically forever, even after being validly answered — unlike every other clarification field.

**The fix, and 3 real rounds of Codex escalation, each a genuine narrower gap in the same mechanism**:
1. Base fix: `extractClarificationContext` reads a `track_or_focus` answer straight from the raw `clarification_answers` array (presentation-layer only, never reaches planning).
2. Codex: that only resolved the question for the SAME request as the answer — a later, separate submission answering a different question would forget it (the form only renders currently-unresolved questions). Fixed with a client-side accumulator (`_aiClarificationAnswersSoFar`) merging and resending answers across a clarification exchange.
3. Codex: the accumulator then had no scope boundary and could let a stale answer silently override fresh UI state on a later, UNRELATED build (since the server-side merge lets `clarification_answers` win over `preferences`). Fixed by clearing it on any fresh non-resume `requestPlanProposal` call.
4. Codex: the track-answer lookup picked the first matching entry regardless of validity, not the latest valid one. Fixed to scan from the end.

Round 5 (final): Codex clean, no further findings. All 3 threads resolved with evidence.

**Merged** (`b9823c8`), issue #43 closed. Full API suite **1272/1272** (82 suites), `tsc --noEmit` clean. Full `jest.ui.config.js` suite: 386 failing (unchanged pre-existing baseline, issue #20) / 447 passing (+6 new tests), zero regressions. **Classification: C** (correctness — real "the agent ignores my answer" defect on the production-reachable `use_academic_decision_agent:true` path).

Rolling-three check: (41,44,46) = A/C/C — compliant (3 of 3 are A/B/C; PR #41 is the A). No forced A/B requirement on the immediate next milestone.

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same standing Vercel deploy-mechanism blocker every session since PR #27 has confirmed. PR #46 (along with PR #12/13/27/31/32/34/37/39/41/44) is not live for real users yet.

## Prior session — PR #44: misattributed block-cause explanation, fixed via a fresh Agent Diagnosis Loop pass

Rolling window was compliant after PR #41 (no forced A/B pressure), so per the
standing instruction, ran the mandated **Agent Diagnosis Loop** again before
picking anything — this time targeting P1-checklist areas issue #25's prior
diagnosis pass hadn't covered: draft/applied-state isolation, explanation-vs-
plan-data faithfulness, multi-turn trace consistency, and the clarification-
answer round-trip. Delegated to a subagent driving the real `generate-plan.ts`
handler with real board fixtures (read-only; no product code touched during
diagnosis), then independently reviewed its evidence before acting.

Two areas came back clean (no finding): no surprise-rebuild path exists
(`action_type` is parsed but never read — matches the already-tracked,
deprioritized issue #25 Finding #5; `plan_simulation.ts`/
`planner_orchestration.ts` confirmed not wired into `generate-plan.ts`); the
handler is fully stateless per request, so no stale-trace/metadata leakage
across turns is possible.

Two real findings surfaced:

1. **[Fixed, PR #44]** `academic_decision_runtime.ts`'s `buildAcademicDecision`
   classified any blocking error that wasn't a disallowed-placed-course as
   "overload" — correct when PR #27 introduced this logic (disallowedGate was
   the only other `blockingErrors` source then), but PR #37
   (`annualCompletenessGate`) and PR #39 (`PLANNER_STEP_LIMIT`) both added new
   blocking-error sources afterward without this classification ever being
   extended. A plan blocked only by an incomplete annual course, or only by
   the step-limit cutoff, told the user to "reduce your weekly load or
   confirm an exception" — wrong remedial advice for a block with nothing to
   do with load. Reproduced via the real handler on
   `test_program_annual_course_blocked_2027`. Fixed by replacing the
   two-bucket classification with four explicit cause flags composed into the
   explanation/rationale/suggested-actions, with new shared constants
   (`ANNUAL_INCOMPLETE_ERROR_PREFIX`/`STEP_LIMIT_ERROR` in
   `planner_validate.ts`, avoiding a circular import with `generate-plan.ts`).
   TDD RED-verified (3 new tests reproduced the real "עומס" wording before the
   fix). Full API suite 1267/1267 (82 suites), `tsc --noEmit` clean. **Merged**
   (`c11df8a`) after a clean Codex review round (no findings) and green CI
   (3/3). **Classification: C** (correctness/honesty; production-reachable via
   `use_academic_decision_agent:true`, which the live frontend auto-enables
   for any AI-interested user).
2. **[Filed as issue #43, not fixed this session]** The clarification loop's
   `track_or_focus` question can never be resolved once answered — re-asked
   identically on every turn forever, unlike every other clarification field.
   Distinct root cause (`academic_clarification.ts`/
   `academic_clarification_plan_inputs.ts`), kept out of PR #44 to keep that
   PR's diff narrow. P2 — doesn't block or corrupt a plan, but a real
   user-visible "agent ignores my answer" trust defect.

Rolling-three check: (39,41,44) = C/A/C — compliant. No forced A/B
requirement on the next milestone.

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
Vercel deploy-mechanism blocker every session since PR #27 has confirmed. PR
#44 is not live for real users yet, same as every other merged fix this
routine has produced so far.

Also re-confirmed at start of this session (no new evidence, not
re-investigated further): PR #14/#15 (Decision capability) correctly remain
unmerged (would be a 3rd consecutive D-classified milestone with no named
production consumer); issue #18's Vercel-architecture/canonical-branch
reconciliation question is unchanged and still a genuine human decision;
issue #25 Findings #4/#5 still need a human `GOAL_STACK` design call /
remain correctly deprioritized; production is healthy (Vercel `READY`, zero
runtime errors in the last 24h) — no incident, just the same standing
staleness.

## Prior session — PR #41: structural degree-hours gap disclosure, merged after 25 Codex rounds

This is exactly the A-class milestone the prior session's own "Exact next
action" #1 (below) called for: "does the frontend surface ANY signal when a
plan is far from the degree target because the board window itself is too
narrow?" It didn't — the Agent Diagnosis Loop (mandated before selecting a
milestone, run against the real `handler` export with real Hebrew scenarios
and the real `mechanical_engineering_2027` fixture) found that a fully
mandatory/category-satisfied plan that legitimately can't reach
`degreeRequiredHours` (catalog exhausted within the visible window) got the
exact same generic "X/Y ש״ש" line as an ordinary, still-fixable shortfall —
and the live frontend then suggested actions (approve a risky elective, wait
for missing data) that don't exist in this scenario. Fixed additively in
`toProposal()` (`api/ai/generate-plan.ts`) and `postPlanChangeSummary`
(`semester_board_viewer.html`): a new, distinct Hebrew warning fires only
when mandatory/category requirements are fully satisfied AND no legal action
can still close the hours gap.

**25 rounds of real Codex review**, each a genuine, narrow, independently
reproduced-and-fixed gap — not rubber-stamped. Full history is in
`.remember/current.md` (top two entries); the short version: rounds 1–20
each caught one more actionable-recovery combination the exhaustion check
missed (soft-avoided electives, currently-taking hours, off-catalog
YEAR_1_2 mandatory courses, replace, move-then-add, annual bundling, ...).
By round 21 the guard had grown into four separate hand-rolled combinatorial
scans — round 22 was a genuine redesign, not another patch: replaced all
four with one `canRecoverMoreHours`, a bounded best-first branching rollout
(budget 200, matching this codebase's existing `rolloutSteps`/`maxSteps`
convention) reusing the same primitives `PlannerWorker.step()` itself uses
(`enumerateActions`/`applyMutation`/`validatePlanState`/`scorePlan`/
`compareScore`). Rounds 23–24 found two more real gaps in the redesign
itself (a budget-accounting bug counting illegal candidates; `REPLACE_COURSE`
having no atomic multi-semester form for `is_annual` courses) — both fixed,
the second by a follow-up session implementing a previously-paused analysis.
Round 25: clean, no new findings.

**Merged** (`d355e7a`, normal merge into `ui/frontend-modernization`). Full
API suite 82/82 suites, 1264/1264 tests; `tsc --noEmit` clean; CI green
(3/3). **Classification: A** (user-visible — honest vs. misleading guidance
for a real, reachable board-window scenario).

**Production check**: still pinned at `26500d4` (PR #11), unchanged — same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed. PR #41 is not live for real users yet.

## Prior session — PR #39: silent empty-plan bug found via the Agent Diagnosis Loop, fixed, merged

After PR #37 merged (see below), the rolling-three window (32,34,37)=C/C/C
was non-compliant per this routine's own governance rules (0 A/B in the
window). Per the standing instruction ("run the Agent Diagnosis Loop before
selecting a new milestone"), ran a throwaway Jest harness against the real
`generate-plan.ts` handler with realistic Hebrew/real-board scenarios
(delegated to a subagent for the initial sweep, independently verified the
top finding before acting on it — see below).

**Found and fixed a severe, previously-unknown bug**: whenever a board's
visible semester window can't mathematically fit the FULL remaining
degree-hours target (e.g. a real student's recorded prior-hours is
missing/low — the live frontend's `manual_completed_degree_hours` field,
`app/web/semester_board_viewer.html`, is optional and defaults to `null`,
falling back to `known_completed_hours`), the planner **silently returned a
completely empty plan**: 0 courses, `blocked:false`, `errors:[]`, on the
default (highest-traffic) path and the `use_academic_decision_agent` path
alike. Independently reproduced on the real `mechanical_engineering_2027`
fixture before trusting the subagent's report: `known_completed_hours: 80`
→ 0 courses; `known_completed_hours: 81` → 20 courses. A 1-hour data
difference flips a real user from a full plan to total silence.

Root cause: `planner_lookahead.ts`'s `projectFeasibility` computes an
aggregate "can the remaining degree-hours gap still close within total
headroom" check — its own docstring says an infeasible action "must be
ranked down" (a ranking signal). But `PlannerWorker.step()`
(`planner_worker.ts`) hard-filtered on `.feasible`, so when the full target
is structurally unreachable from the board's window, EVERY candidate
(including a trivially legal, clearly-needed mandatory course) looks
infeasible, and the filter removes 100% of candidates — the worker takes
zero actions and stops on step 1.

**Fixed in PR #39** (`ui/frontend-modernization` ← `claude/determined-
thompson-8ideqq`, merged `5de999f`), after **4 real rounds of Codex
findings**, each progressively subtler, all fixed with RED-verified
regression tests — none dismissed:
- Round 1 (initial fix, `b5fb243`): replaced the hard `.filter(x =>
  x.feasible)` with a sort that ranks feasible actions first but never
  eliminates infeasible ones. Verified end-to-end: the real-board repro
  went from 0 courses to 27, `blocked:false`.
- Round 2 (`fc8f902`): the initial fix collapsed `projectFeasibility`'s
  report to one boolean, so an action blocked ONLY by the aggregate
  `degree_hours` check ranked identically to one that blocks a SPECIFIC
  still-needed mandatory/category course. Fixed by ranking on
  `report.blocked.some(b => b !== 'degree_hours')` instead of the raw
  boolean — the aggregate reason alone no longer counts against ranking,
  but a genuine course-specific block still does.
- Round 3 (`b01d5ec`): the blocker-aware sort ran only on
  `legal.slice(0, topN)` — truncation-by-immediate-score happened BEFORE
  blocker status was known, so >topN blocking high-score actions could
  crowd the one non-blocking action out of consideration entirely. Fixed by
  computing blocker status for the FULL legal set and sorting before
  truncating (the expensive `estimateFinalScore` rollout still only runs
  post-truncation, preserving the original performance intent).
- Round 4 (`0c8be5f`): the `degree_hours` reason was excused
  unconditionally, but that's only correct when it was ALREADY blocked
  before the action (the structural case). An action that NEWLY makes a
  previously-reachable target unreachable (e.g. a "wanted" `is_annual`
  course consuming headroom in multiple semesters for single-count degree
  credit) could still win via preference even though it sabotages
  completion. Fixed by computing `projectFeasibility` once for the CURRENT
  state per step and only excusing `degree_hours` when it was already
  blocked pre-action. This test needed `rolloutSteps: 0` to isolate the bug
  from `estimateFinalScore`'s own (separately correct) downstream-impact
  reasoning, which already happened to mask it in a full-rollout scenario —
  a reminder that this file's two impact-reasoning mechanisms
  (`projectFeasibility` ranking + `estimateFinalScore` rollout) can each
  independently mask bugs in the other; both need direct test coverage.
- Round 5: Codex clean, no further findings — CI 3/3 green, all 3 review
  threads resolved with evidence, merged.

Final state: full API suite 81/81 suites, **1241/1241 tests** (was
1238/1238 at merge time of PR #37), zero regressions. `tsc --noEmit` clean.

**Classification: C** (correctness) — a core planner search-loop defect
causing silent, total planning failure on the default production path. Per
this routine's own priority order, a P0/C-severity correctness fix always
preempts the rolling-window classification rule — this surfaced via the
mandated Agent Diagnosis Loop rather than forcing an A/B milestone
artificially. The rolling-window history below reflects this honestly.

## Prior session work (PR #37) — real Agent-quality fix, finished and merged

Picked up where the prior session left off: PR #37 (`is_annual` course atomic
multi-semester placement fix) was open with a Codex review loop already 9
rounds deep. Re-synced the assigned branch to `ui/frontend-modernization` HEAD
first (this session was, again, provisioned from a stale intermediate point
in history rather than the branch tip — same recurring provisioning issue
prior sessions have had to correct each time).

Round 10 Codex review on commit `b94cad3` left 2 unresolved findings, both
fixed in commit `7a26bc9`:
- **P1**: when a partially-placed annual course's missing span can't legally
  accept it (e.g. the target semester is already at/over `HARD_LOAD_CAP`),
  the repair correctly rejects, but the loop then fell through to the normal
  search/STOP path with the annual course still split — and the
  `generate-plan.ts` response only turned `overloadGate`/`disallowedGate`
  findings into `blocked`, so this returned `blocked:false` even though
  `validateCandidate()` internally knew the plan was invalid. Fixed with a
  new `annualCompletenessGate()`, mirroring the existing `disallowedGate`
  pattern (same one issue #25 Finding #1 established): re-derives
  `incompleteAnnualCourseIds` against the FINAL placed set and turns an
  unrepaired split into a real blocking error.
- **P2**: `placedHours()` only deduplicated annual-hour double-counting via
  the older `root_course_id`+`count_hours_once` pairing (two distinct ids).
  The newer atomic `is_annual`/`spans_semesters` mechanism this PR added
  places the SAME id into multiple `state.semesters` entries — a board
  omitting the optional `count_hours_once`/`root_course_id` metadata had its
  hours counted once per occurrence (8h instead of 4h). Fixed by
  deduplicating on the course id itself first.

Round 11 Codex review on `7a26bc9` surfaced one more (fixed in `7546c21`):
`toProposal()`'s moves-diff reported a repaired annual span as
`{from: <original semester>, to: <new semester>}` even though the course
still occupied the original semester — any consumer applying `moves`
literally could undo the just-completed atomic placement. Fixed: a move's
`from` is only set when the course no longer occupies ANY of its original
semesters in the final state; otherwise `from: null` (an addition, not a
relocation).

Round 12 Codex review on `7546c21`: **clean, no further findings.** CI 3/3
green, all 13 review threads resolved with evidence, base still current.
**Merged** (`c325eb6`, normal merge commit) — 12 real Codex review rounds
across the PR's full lifetime (this session handled rounds 10–12), every
finding fixed with a regression test, none dismissed.

Full API suite at merge: **1237/1237 tests, 81/81 suites**, zero
regressions. `tsc --noEmit` clean. New fixture:
`data/boards/test_program_annual_course_blocked_2027.json` (an annual course
whose missing span is legally unrepairable — pinned to a fixed 23h mandatory
course, breaching the 26h hard cap if completed).

Re-confirmed production state (Vercel API): **unchanged from prior
sessions** — still stale at `26500d4` (`Merge pull request #11`), `live:
false`, no git integration on the project, same sandbox blocker (no Vercel
CLI credentials, `deploy_to_vercel` MCP deliberately avoided — see Blockers).
Now **7** merged, tested, Codex-reviewed fixes are unshipped to real users:
PR #12, #13, #27, #31, #32, #34, and now **#37**.

## Prior session (`claude/determined-thompson-fewuif`) — audit only, no new code

Ran the standing start-of-session audit (production health, open PRs/branches,
Codex/CI state, issues, this doc). Findings below; deliberately took no
autonomous action beyond one safe docs merge, since every substantive item
found is already a fully-diagnosed, open human decision from a prior session
— re-investigating them found nothing new to add.

- **Production confirmed healthy, no incident.** Vercel `tau-course-planner`
  (`prj_8Wn5yOXOxvOSfB6pZ3XVAnf8Y21e`) latest deployment `READY`, zero runtime
  errors in the last 24h. Still stale at `26500d4` ("Merge PR #11") — confirmed
  again via the Vercel API — now missing PR #12/#13/#27/#31/#32/#34, i.e. **6**
  merged, tested, Codex-reviewed fixes including the P0 hard-avoid gate
  (issue #25 Finding #1, PR #27) are unshipped to real users. Also confirmed
  via `get_project` on both Vercel projects: neither `tau-course-planner` nor
  `web` has a linked git repo, so there genuinely is no push-to-deploy path —
  this isn't a missing-secret problem, it's an unmade infra decision (also
  ties into issue #18's canonical-project question).
- **Issue #25 re-checked end to end**: Findings #1 (P0), #2 (High), #3
  (Medium-High) are all confirmed fixed and merged (PR #27/#31/#32) per the
  issue's own comment thread — the issue's top-level body is just stale (still
  describes #1 as unfixed; the comments tell the real story). Only #4
  (`GOAL_STACK` over-allocation, needs a design decision) and #5 (low severity,
  not exploitable) remain open. **No live P0 in the Agent today.**
- **PR #35 merged** (`2b74fd0`) — pure `.remember/current.md` +
  `AUTONOMOUS_PROGRESS.md` correction recording PR #34's already-merged state
  (independently verified accurate against the real merge and diff before
  merging). CI was 3/3 green; no functional change, so merged without waiting
  on a Codex round for this one docs-only PR.
- **PR #14/#15 (Decision capability) left untouched** — correctly still held
  per issue #18's D-milestone-stacking finding; nothing new to add.
- Did **not** attempt a production deploy via the MCP `deploy_to_vercel` tool
  (now available in this session's toolset, wasn't in prior sessions'). Not
  using it because (a) it uploads a raw file tree with no git linkage,
  permanently breaking `gitCommitSha` traceability for every future
  deployment inspection, same risk prior sessions flagged, and (b) it
  wouldn't even resolve the real open question — *which* of the two Vercel
  projects should be canonical is still undecided (issue #18). Deploying to
  the wrong/undecided target, or via a lossy mechanism, is a harder-to-reverse
  mistake than staying stale one more session. Flagging this explicitly as a
  human decision point rather than guessing.

> **⚠️ HISTORICAL SNAPSHOT — SUPERSEDED, DO NOT FOLLOW AS CURRENT STATUS.**
> Everything from here (`## Branch / release state`) through the end of this
> file (`## Exact next action`) is the unedited tail of the
> `claude/determined-thompson-fewuif` session write-up above, current only as
> of PR #48. It predates the "Latest session" / "Prior session" heading
> convention used everywhere above it, so it was never trimmed as newer
> sessions prepended their own summaries. Its rolling-window figures (e.g.
> `(44,46,48)`), blockers list, and "exact next action" are all several
> merged PRs stale (PR #53/#56/#58 and others happened after it) and must
> NOT be treated as the current handoff — **the "Latest session" section at
> the very top of this file is the only authoritative current status and
> next action.** Kept below only for historical/archival continuity, per
> this routine's own instruction to never delete durable progress history —
> flagged as stale rather than silently trusted, per a real Codex finding on
> PR #59 (`discussion_r3632582211`) that a reader could otherwise follow this
> obsolete block and skip the fresh work the top of the file authorizes.

## Branch / release state

- **Canonical development branch:** `ui/frontend-modernization` (transitional —
  `main` is ~190 commits behind it and contains nothing `ui/frontend-modernization`
  doesn't; full reconciliation to make `main` canonical again is NOT done —
  see "Blockers"). This session's assigned branch was, again, provisioned from
  stale `main` by default — reset to `ui/frontend-modernization` HEAD before
  starting, same recurring mistake every session so far has had to correct.
- **Production branch / deploy mechanism:** Vercel project `tau-course-planner`
  (prod domain `tau-course-planner.vercel.app`). **Deploys are one-off local
  `vercel --prod` CLI invocations, not Git-integration-driven** — confirmed via
  the Vercel API (every deployment's `source` is `"cli"`). No branch auto-deploys
  on push.
- **Production commit:** still `26500d4` ("Merge PR #11", 2026-07-19) as of this
  writing — re-confirmed directly via the Vercel API this session (latest
  `tau-course-planner` deployment, `dpl_HJZTB8zqondbwuSnHx6TveggoPVg`, `target:
  production`, unchanged since last session's check). **Stale** — missing PR
  #12/#13 (infra), #27/#31/#32 (issue #25 Findings #1–#3), and now #34 (issue
  #28, this session, merged). No deploy has happened since this was first
  flagged (3+ sessions ago).
- **Deploy blocker:** no session so far (including this one) has had Vercel CLI
  credentials in its sandbox (`vercel login` has no reachable network path).
  Deploying via the MCP `deploy_to_vercel` tool was deliberately avoided — it
  uploads a raw file tree with no git linkage, breaking every existing
  deployment's `gitCommitSha` traceability. **A human (or a session with real
  Vercel CLI access) needs to run a production deploy from `ui/frontend-modernization`
  HEAD.** Flagged repeatedly in issue #18, unresolved across at least 3 sessions.

## This session's milestones (in order)

1. Reset assigned branch from stale `main` to `ui/frontend-modernization` HEAD
   (recurring, see above).
2. Requested fresh Codex review on the two docs-only PRs left open from the
   prior session:
   - **PR #30 closed without merging** — its content (Finding #2 "needs a
     product decision") was superseded the same day by PR #31 actually
     shipping that fix, and it had a real git conflict against the current
     base. Closed with an explanation; the analysis it preserved is still on
     record in issue #25's comment thread.
   - **PR #33 merged** (`8ad6eee`) — Codex-clean on its final commit
     (`13a8017`, which itself already fixed the one prior Codex finding about
     a rolling-three compliance-claim error).
3. **PR #34 merged** (`19cb1e3`) — issue #28 (P2, deferred from PR #27's Codex
   review): client-side stale `blocked`/`overloadBlocked` signal in
   `semester_board_viewer.html` after `applyExplicitAvoidPostFilterLocal`
   locally resolves a disallowed-placement error the server flagged. Fix: new
   pure `resolveStaleDisallowedBlockLocal()`, mirrors the existing
   `hardOverloadRemains` re-check pattern. **2 rounds of real Codex findings
   fixed**, not rubber-stamped:
   - Round 1: the initial `.includes()` name match could wrongly resolve a
     *different*, still-disallowed course's error when one course's name is a
     substring of another's (real catalog prefix pairs exist, e.g. a course
     and its "- מעבדה" lab companion). Fixed with exact-name parsing
     (`parseDisallowedPlacedNameLocal`) instead of substring search.
   - Round 2: the resolution ran too early — right after the avoid
     post-filter, before later eligibility/degree-hours refills (which only
     exclude `unwantedCourseIds`, not hard-excludes) could silently re-add the
     exact flagged course from the elective pool. Fixed by checking the
     ACTUAL final placed course set (ground truth) after every repair/refill
     finishes, instead of a snapshot from one intermediate step.
   Final state: CI 3/3 green, Codex clean on the final commit, both review
   threads resolved with evidence, 8 regression tests (up from the initial 6),
   full API suite unaffected (1202/1202), full `jest.ui.config.js` suite at
   the same pre-existing fixture-gap baseline (386 failing out of 819, zero
   regressions), `tsc --noEmit` clean. Issue #28 closed. Classification: **C**
   (correctness/disclosure fix to an already-shipped feature).
4. Re-investigated issue #25 Finding #4 before picking a milestone: confirmed
   the previous session's conclusion still holds — a naive "cap goal-1's
   marginal near the target" mitigation only helps once the running total is
   close to the target minus remaining mandatory hours; it does NOT fix the
   general case (a large elective outranking a small mandatory course far from
   the target), which would require reordering/reweighting `GOAL_STACK`
   itself. Still a genuine design-tradeoff decision, not attempted this
   session either — picked issue #28 instead as the next item that doesn't
   require a product decision.

## Rolling A/B/C/D milestone history (most recent last)

1. PR #12 — Simulation capability — **D**
2. PR #13 — Persistence capability — **D**
3. PR #27 — hard-avoid plan correctness fix (Finding #1) — **C**
4. PR #31 — agent-path over-blocking fix (Finding #2) — **B**
5. PR #32 — max_weekly_hours disclosure fix (Finding #3) — **C**
6. PR #34 — client-side stale block-state fix, issue #28, merged (`19cb1e3`)
   after 2 rounds of real Codex findings fixed — **C**.
7. PR #36 — docs-only audit recap, merged (`b460f42`) — not classified (no
   product code).
8. PR #37 — `is_annual` course atomic multi-semester placement fix, **merged**
   (`c325eb6`) — **C** (correctness: prevents a real course's true weekly
   load from being silently under-reported, plus a latent state-corruption
   risk where an already-valid annual placement could be split during a
   routine rebuild).
9. PR #38 — docs-only progress recap, merged (`b0d0771`) — not classified (no
   product code).
10. PR #39 — feasibility-ranking fix for the silent-empty-plan bug, **merged**
    (`5de999f`), after 4 real rounds of Codex findings fixed — **C**
    (correctness: the default/highest-traffic planner path could silently
    return a totally empty, `blocked:false` plan; found via the mandated
    Agent Diagnosis Loop, not forced to satisfy the rolling-window rule).
11. PR #41 — structural degree-hours gap disclosure, **merged** (`d355e7a`),
    after 25 real rounds of Codex findings fixed (including a mid-stream
    redesign at round 22) — **A** (user-visible: honest vs. misleading
    guidance for a real, reachable board-window-exhaustion scenario; found
    via the mandated Agent Diagnosis Loop, specifically satisfying the prior
    session's own "must-be-A-or-B" rolling-window requirement).
12. PR #44 — academicDecision explanation block-cause misattribution fix,
    **merged** (`c11df8a`), Codex-clean on the first review round, CI green
    (3/3) — **C** (correctness/honesty: the agent path told users to reduce
    workload for blocks that were actually an incomplete annual course or a
    step-limit cutoff; found via a fresh Agent Diagnosis Loop pass targeting
    previously-uncovered P1-checklist areas).
13. PR #46 — issue #43, track_or_focus clarification question never
    resolving once answered, **merged** (`b9823c8`), after 3 real rounds of
    Codex findings fixed (each a narrower gap in the same fix — single-request
    resolution → multi-step accumulation → cross-flow staleness → duplicate-
    answer ordering) — **C** (correctness: real "agent ignores my answer"
    defect in the clarification-answer round-trip).
14. PR #47 — docs-only progress recap of PR #46's merge, merged (`d1235d8`)
    — not classified (no product code).
15. PR #48 — `legalityGate`: prerequisite-timing/duplicate-placement/pinned-
    move/illegal-semester violations were computed by `validatePlanState` but
    silently discarded from `blockingErrors`, **merged** (`fe84c02`), after 1
    real Codex round (a false-positive block on any currently-taking-course-
    on-board scenario, fixed) — **C** (correctness/honesty: closes a
    reproduced, rendered, in-product self-contradiction — a green "passed
    legality ✓" badge next to explanation text admitting the same violation;
    found via a fresh Agent Diagnosis Loop pass).

Rolling-three checks:
- (12,13,27) = D/D/C — **NOT compliant** (only 1 of 3 is A/B/C; 0 are A/B).
  Pre-existing shortfall from before PR #27 existed — the exact gap issue #18
  already flagged as the reason PR #14 could not be merged as a 3rd D
  milestone. Not retroactively fixable; recorded as an acknowledged historical
  exception, not a compliant window.
- (13,27,31) = D/C/B — compliant (2 of 3 are A/B/C; 1 is A/B).
- (27,31,32) = C/B/C — compliant (3 of 3 are A/B/C; 1 is A/B).
- (31,32,34) = B/C/C — compliant (3 of 3 are A/B/C; 1 is A/B).
- (32,34,37) = C/C/C — **NOT compliant** (0 are A/B). Flagged prospectively
  before #37 merged; the window is real once #37 landed.
- (34,37,39) = C/C/C — **STILL NOT compliant** (0 are A/B). PR #39 was a
  legitimate P0/C-severity correctness preemption (per this routine's own
  priority order: correctness always outranks the rolling-window rule), not
  a violation of the rule's intent — but it does NOT cure the window on its
  own, since the rule counts classifications, not justifications. **The
  next milestone genuinely must be A or B now** unless yet another
  higher-priority correctness issue surfaces (which would be the third in a
  row — still individually justified each time, but worth a human sanity
  check if a fourth C-in-a-row pattern continues, since that starts to look
  less like "correctness keeps winning" and more like "A/B work is being
  systematically avoided").
- (37,39,41) = C/C/A — **compliant** (3 of 3 are A/B/C; 1 is A/B). PR #41
  is the A milestone the prior window's own note required — resolves the
  two-consecutive-non-compliant-window flag; no rolling-window pressure on
  the immediate next milestone.

- (39,41,44) = C/A/C — **compliant** (3 of 3 are A/B/C; 1 is A/B, from PR #41).
  No rolling-window pressure on the immediate next milestone.
- (41,44,46) = A/C/C — **compliant** (3 of 3 are A/B/C; 1 is A/B, from PR #41).
  No rolling-window pressure on the immediate next milestone.
- (44,46,48) = C/C/C — **NOT compliant** (0 are A/B). PR #47 (docs-only) is
  skipped from the window, same convention as PR #36/#38. Like the
  (32,34,37)/(34,37,39) precedent, PR #48 was a legitimate Agent Diagnosis
  Loop correctness finding, not a rule violation in intent — but it does not
  cure the window on its own. **The next milestone genuinely should be A or
  B** unless another higher-priority correctness issue surfaces first.

Every merged window from PR #27 through PR #46 was compliant except the two
historical/prospective exceptions above ((12,13,27), now permanently
unfixable, and the now-cured (32,34,37)/(34,37,39) pair). (44,46,48) is a new
non-compliant window — the next real milestone should target A or B unless a
higher-priority correctness finding preempts it again.

## Blockers

1. **Vercel deploy access** — see above. Everything merged so far (PR #12,
   #13, #27, #31, #32, #34, #37, #39, #41, #44, #46, #48) is inert for real
   users until someone deploys `ui/frontend-modernization` HEAD. This session
   confirmed real Vercel API access for the first time (`list_projects`/
   `get_project`/`list_deployments` all work against the real
   `tau-course-planner` project) — but the only deploy-capable tool
   (`deploy_to_vercel`) uploads a raw inline file tree with no git linkage,
   impractical/risky for this existing multi-language repo and would break
   the `gitCommitSha` traceability every real deployment has had. **Still
   need either a real `vercel` CLI login or Vercel Git integration
   configured** — this is now a confirmed tooling gap, not a credentials gap.
   Do not attempt `deploy_to_vercel` as a substitute without a human decision
   to accept that tradeoff. Real, tested, Codex-reviewed correctness fixes
   (including a silent-empty-plan P0-severity bug, PR #39, the structural-gap
   disclosure fix, PR #41, the block-cause explanation fix, PR #44, the
   clarification round-trip fix, PR #46, and the legality-gate fix, PR #48)
   are sitting unshipped.
2. **Canonical branch reconciliation** (main rewrite / Vercel production-branch
   config, including the open question of which of the two Vercel projects —
   `tau-course-planner` (fastapi, currently serving prod) vs. `web` (nextjs,
   never successfully deployed to production) — is meant to be canonical) — a
   genuine human product decision, flagged multiple times in issue #18, not
   attempted unilaterally by any session including this one.
3. Issue #21 (dead code decision: delete or restore
   `requestPlanProposalFromDraft`/`runPrimaryAiAction`), issue #20 (386
   pre-existing UI test failures, single root cause: missing gitignored
   `supabase_board_backup_2027_pre_sync.json` fixture, needs a decision on
   whether a synthetic/sanitized fixture can replace it) — both need a human
   product call, already fully diagnosed, not blocking Agent-quality work.
4. Issue #25 Finding #4 — planner over-allocation (203h vs 185h target) — see
   milestone 4 above; needs a `GOAL_STACK` design decision before
   implementation, not just an approval to proceed.
5. Issue #25 Finding #5 — no server-side chat-vs-rebuild distinction. Assessed
   this session and **deprioritized, not just left pending**: `action_type`'s
   schema enum has no "chat" value, and the one real caller already never
   sends a rebuild request for a plain chat turn — a server-side gate would
   have zero reachable trigger path in production, i.e. an unused capability.
   Do not pick this up again without a concrete reason a real caller could
   hit it (e.g. a new client, or the field gaining a "chat" meaning).
6. PR #14 (Decision capability) remains open, deliberately unmerged — would be
   a 3rd consecutive D-classified milestone with no named production consumer.
   Recommend a human decide: close/park it as a reference implementation, or
   hold until a real multi-candidate producer exists to consume it. **This is
   also now the most obvious candidate production-consumer question for the
   next A/B milestone** (see Exact next action #1) — wiring Decision (or
   Simulation/Persistence) into a real caller would both resolve this blocker
   and satisfy the rolling-window B requirement in one milestone, IF a real
   multi-candidate producer can be justified by an actual Agent scenario
   (not manufactured just to consume the capability — that would violate
   "Do not build unused capabilities merely to advance an architectural
   checklist" from the other direction).
7. Issue #43 — **closed, fixed in PR #46** (see Latest session above). No
   longer a blocker.

## Exact next action

1. **Rolling window is NOT compliant ((44,46,48) = C/C/C, 0 are A/B) — the
   next real milestone genuinely should be A or B**, unless a higher-priority
   correctness finding preempts it (a legitimate preemption, per this
   routine's own priority order, but track it — a fourth C-in-a-row would be
   worth a human sanity check). Still run the mandated **Agent Diagnosis
   Loop** first (real Hebrew scenarios against the real `generate-plan`
   handler, both default and `use_academic_decision_agent` paths, using a
   real board fixture) to find the next highest-impact real Agent failure
   before picking anything. This session's diagnosis pass covered: Simulation/
   Persistence/Decision wiring (still clean, still unreachable), and
   prerequisite/duplicate/pinned-move/illegal-semester legality (now fixed,
   PR #48) — areas still flagged as untested by prior sessions and not yet
   covered by this one either: dual-semester/multi-alternative comparison
   quality, simulate-then-apply user flows once/if a real one exists, and
   accessibility/error-state UI behavior for blocked plans.
   - PR #14's Decision capability is the standing D candidate that could
     become a B if a genuine multi-candidate producer scenario exists — do
     not force this without a real scenario, per Blockers item 6's caveat.
     **PR #14 must stay unmerged** — D-classified infra with no production
     consumer, per established precedent (multiple sessions now). Wiring it
     into a real caller would satisfy BOTH the rolling-window B requirement
     above AND resolve Blockers item 6, IF a genuine scenario justifies it.
2. **Whoever has Vercel CLI access (or can configure Git integration): deploy
   `ui/frontend-modernization` HEAD to production.** Still the single most
   valuable pending action — 12 real, tested, Codex-reviewed fixes (PR #12,
   #13, #27, #31, #32, #34, #37, #39, #41, #44, #46, #48) are merged and
   waiting. This session confirmed real Vercel API access for the first time
   but found the only available deploy tool unsuited for this repo (see
   Blockers item 1) — do not re-investigate the `deploy_to_vercel` path
   further without a human decision to accept its tradeoffs (no git linkage,
   raw file-tree upload of a large multi-language repo).
3. Issue #25 Finding #4 (planner over-allocation) still needs a human decision
   on the intended `GOAL_STACK` tradeoff before implementation — see Blockers.
   If a decision arrives, the recommended starting point is unchanged: a
   dedicated failing test reproducing the 203h/185h scenario (TDD RED), then
   treat the exact scoring mechanism as an open design question, and run the
   FULL planner test suite (`planner_goals.test.ts`, `planner_scorecard.test.ts`,
   `generate_plan_load_distribution_policy.test.ts`,
   `generate_plan_dual_semester_load_balance.test.ts` at minimum) before
   considering it done.
4. Finding #5 is deprioritized (see Blockers item 5) — do not resume it as
   "the next unblocked item" without a new reason it's reachable in production.
5. Issues #20/#21/#18(reconciliation)/#14 all still need a human product call
   — already fully diagnosed by prior sessions, not re-investigated further
   this session since nothing new was learned.
