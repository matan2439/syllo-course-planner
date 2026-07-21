# Autonomous Progress

Durable handoff for the autonomous Syllo product-engineering routine. Read this
first; `.remember/current.md` is the detailed narrative log this summarizes
(read it for full root-cause writeups and prior-session detail).

_Last updated: 2026-07-21, session on branch `claude/determined-thompson-exmgrv`._

## Branch / release state

- **Canonical development branch:** `ui/frontend-modernization` (transitional —
  `main` is ~180 commits behind it and contains nothing `ui/frontend-modernization`
  doesn't; full reconciliation to make `main` canonical again is NOT done —
  see "Blockers").
- **Production branch / deploy mechanism:** Vercel project `tau-course-planner`
  (prod domain `tau-course-planner.vercel.app`). **Deploys are one-off local
  `vercel --prod` CLI invocations, not Git-integration-driven** — confirmed via
  the Vercel API (every deployment's `source` is `"cli"`). No branch auto-deploys
  on push.
- **Production commit:** `26500d4` ("Merge PR #11", 2026-07-19) as of this
  writing. **Stale** — missing PR #27 (Finding #1, P0) and PR #31 (Finding #2),
  both already merged into `ui/frontend-modernization`.
- **Deploy blocker:** no session so far (including this one) has had Vercel CLI
  credentials in its sandbox (`vercel login` has no reachable network path).
  Deploying via the MCP `deploy_to_vercel` tool was deliberately avoided — it
  uploads a raw file tree with no git linkage, breaking every existing
  deployment's `gitCommitSha` traceability. **A human (or a session with real
  Vercel CLI access) needs to run a production deploy from `ui/frontend-modernization`
  HEAD.** Flagged in issue #18.

## Active milestone

- **Classification:** C (correctness/disclosure) / P1.
- **User scenario:** a user states a weekly-hours preference
  (`preferences.max_weekly_hours`) that the generated plan exceeds. The default
  (no-flag) path's `warnings_he` says nothing about it at all — the only place
  this was ever disclosed was the opt-in agent path's
  `academicDecision.evaluation.workloadNotes`.
- **Root cause:** `max_weekly_hours` is used only as a soft search tiebreaker
  (`planner_goals.ts`); nothing in the default path's `toProposal()` ever
  checked the final plan against it to produce a warning.
- **GitHub issue:** #25 (Finding #3 of 5; Findings #1 and #2 fixed and merged —
  PR #27, PR #31).
- **Branch:** `claude/determined-thompson-exmgrv` (base `ui/frontend-modernization`).
  **PR not yet opened as of this writing** — implementation + tests complete,
  about to be pushed.
- **Completed:** new `maxWeeklyHoursWarnings()` in `generate-plan.ts` feeds
  `proposal.warnings_he` directly (shared by both paths); deduped
  `academic_decision_runtime.ts`'s `risksAndTradeoffs` construction (it already
  computed the byte-identical message for its own `overloaded` signal — without
  the dedupe, real users would see the same message twice in the agent path's
  UI). 5 new tests, RED-verified twice independently (once for the main fix via
  `git stash`, once for the dedupe alone by temporarily reverting just that
  line). Full API suite 1202/1202 across 79 suites, `tsc --noEmit` clean
  (root + `web/`).
- **Remaining criteria:** open the PR, Codex review with no blocking findings,
  CI green, then merge.
- **Codex review status:** not yet requested (PR not open yet).
- **CI status:** n/a yet.
- **Deployment status:** not deployed (see production-commit note above).

## This session's actions, in order

1. Merged **PR #27** (issue #25 Finding #1, P0: hard-excluded/already-placed
   course now correctly reports `blocked:true` instead of silently succeeding).
   `ui/frontend-modernization` @ `02551bd`.
2. Left **PR #14** (Decision capability) unmerged — merging it would be a 3rd
   consecutive D-classified (infra, no production consumer) milestone, which
   both issue #18 and this routine's operating rules cap at 2.
3. Posted the issue #18 standing-direction-conflict resolution + a new Vercel
   deploy-mechanism finding (confirmed independently by a concurrent session
   too — see `.remember/current.md`).
4. Opened, reviewed (Codex clean, CI 3/3 green), and merged **PR #31** (issue
   #25 Finding #2: agent path no longer withholds a plan for empty
   completed/excluded courses). `ui/frontend-modernization` @ `4d3a98e`.
5. Fixed issue #25 **Finding #3** (this section) — implementation complete,
   PR not yet opened.
6. Reset this session's assigned branch from stale `main` onto
   `ui/frontend-modernization` at the start (recurring mistake, 4th+ session in
   a row per `.remember/current.md` — the branch-provisioning default itself is
   still unfixed upstream of this repo).

## Rolling A/B/C/D milestone history (most recent last)

1. PR #12 — Simulation capability — **D**
2. PR #13 — Persistence capability — **D**
3. PR #27 — hard-avoid plan correctness fix (Finding #1) — **C**
4. PR #31 — agent-path over-blocking fix (Finding #2) — **B**
5. Finding #3 fix (this milestone, PR pending) — **C**

Rolling-three check (13/27/31): D/C/B — compliant (≥2 of 3 are A/B/C; ≥1 is
A/B). Next rolling-three (27/31/Finding-#3): C/B/C — compliant.

## Blockers

1. **Vercel deploy access** — see above. Everything merged is inert for real
   users until someone deploys.
2. **Canonical branch reconciliation** (main rewrite / Vercel production-branch
   config) — a genuine human product decision, flagged multiple times now in
   issue #18, not attempted unilaterally by any session including this one.
3. Issue #21 (dead code decision), issue #20 (386 pre-existing UI test
   failures, single root cause: missing gitignored fixture) — both need a
   human product call, already fully diagnosed, not blocking Agent-quality work.

## Exact next action

1. Push the Finding #3 branch, open a PR against `ui/frontend-modernization`,
   request Codex review, subscribe to its activity, merge once every gate
   passes.
2. After merge: continue issue #25 in severity order — Finding #4 (planner
   front-loads more elective hours than the degree needs) then #5 (no
   server-side chat-vs-rebuild distinction — currently defense-in-depth only,
   not exploitable).
3. Issue #28 (client-side stale block-state after local avoid-filter) is a
   good next candidate once the backend-only queue above is clear — it is
   UI-risk work (`semester_board_viewer.html`) needing live browser
   verification per this routine's own UI-work bar, not just code inspection.
