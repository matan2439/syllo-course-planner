# Autonomous Progress

Durable handoff for the autonomous Syllo product-engineering routine. Read this
first; `.remember/current.md` is the detailed narrative log this summarizes
(read it for full root-cause writeups and prior-session detail).

_Last updated: 2026-07-29, session on branch `claude/youthful-tesla-wq1g2x`
(PR #71 merged as `5f67194` closing issue #68, PR #73 merged as `681d883`
closing issue #67, both in the same session; production deploy blocker
unchanged, not re-checked this session — no new directive to do so)._

## Latest session — PR #73 merged: LlmOrchestrator now always guarantees its finishing pass (issue #67), plus PR #71/#68 earlier the same session; a Codex finding on #73 uncovered and documented a distinct, still-open gap (issue #75)

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
ends, not just when the candidate is invalid. Safe by construction —
`worker.run()` only ever takes further legal, score-improving actions, so
it can't discard anything the model validly chose to keep; an
already-converged plan returns almost immediately, no added cost in the
common case.

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
open, not yet fixed. `AUTONOMOUS_PROGRESS.md`/`​.remember/current.md` recap
for this merge: PR #74 (this docs update).

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
