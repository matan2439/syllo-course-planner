# Autonomous Progress

Durable handoff for the autonomous Syllo product-engineering routine. Read this
first; `.remember/current.md` is the detailed narrative log this summarizes
(read it for full root-cause writeups and prior-session detail).

_Last updated: 2026-07-22, session on branch `claude/youthful-tesla-sgzgz9`
(PR #56 opened — see below; supersedes the PR #53 entry as the latest
milestone). Issue #25 remains fully closed; this is a fresh Agent Diagnosis
Loop finding from a re-run after that closure, per this routine's own
"repeat until all critical scenarios pass" instruction._

## Latest session — PR #56 opened (awaiting Codex review): missing-mandatory cause misattributed to the user's own hard exclusion

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
activity.** CI had not yet reported (0 check runs) as of this write-up —
next session (or a resumed webhook-driven turn in this same session) must
confirm CI green and Codex clean before merging, per the standard gate.

**Classification: C** (correctness/honesty — real, reproduced, in-product
wrong advice on a production-reachable path). Rolling-three check: most
recent three merged milestones remain (48=C, 53=C, this one pending) — once
#56 merges, the next milestone after it must be A or B per the governance
rule (two C's in a row is fine; a third C would need to be checked against
the "at least one of every three is A/B" rule depending on what's already
counted — flagging for the merging session to verify against the fuller
history in `.remember/current.md` before selecting the next milestone).

**Production check**: still pinned at `26500d4` (PR #11) — unchanged, same
standing Vercel deploy-mechanism blocker every session since PR #27 has
confirmed; re-confirmed this session that no Vercel MCP tool is reachable
either. PR #56 (once merged) will join the same growing backlog of merged-
but-not-deployed fixes.

**Standing blockers, unchanged, not re-investigated further this session
(no new evidence since last check)**: issue #15/#18 (PR #14 D-stacking
merge decision, Vercel production-architecture question — `tau-course-
planner` fastapi project vs. `web` nextjs project), issue #20 (386/386
`jest.ui.config.js` failures, 100% one root cause — the gitignored
`supabase_board_backup_2027_pre_sync.json` fixture — needs a human call on
committing a sanitized replacement), issue #21 (dead-code delete-vs-restore
call). All confirmed still open with zero human comments as of this
session's check.

**Exact next action for the next session**: resume PR #56 — check CI/Codex
status (subscribed via webhook this session; if the webhook already
delivered events, act on them first), merge once every gate passes, then
continue the Agent Diagnosis Loop for the next highest-impact real Agent
failure (candidates already surfaced: the wanted-vs-disallowed disclosure
gap noted above, or a fresh sweep of multi-turn conversation honesty /
simulate-then-apply areas per the P1 checklist).

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
