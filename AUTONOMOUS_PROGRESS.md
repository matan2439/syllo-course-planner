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
  writing. **Stale** — missing PR #27, #31, and #32 (issue #25 Findings #1–#3),
  all already merged into `ui/frontend-modernization`.
- **Deploy blocker:** no session so far (including this one) has had Vercel CLI
  credentials in its sandbox (`vercel login` has no reachable network path).
  Deploying via the MCP `deploy_to_vercel` tool was deliberately avoided — it
  uploads a raw file tree with no git linkage, breaking every existing
  deployment's `gitCommitSha` traceability. **A human (or a session with real
  Vercel CLI access) needs to run a production deploy from `ui/frontend-modernization`
  HEAD.** Flagged in issue #18.

## This session's milestones (in order)

1. **PR #27 merged** — issue #25 Finding #1 [P0]: hard-excluded, already-placed
   course now correctly blocks instead of silently succeeding. Classification: **C**.
2. **PR #14 (Decision capability) deliberately left unmerged** — would be a 3rd
   consecutive D-classified milestone (infra, no production consumer); both
   issue #18 and this routine's operating rules cap that at 2.
3. **PR #31 merged** — issue #25 Finding #2 [High]: agent path no longer
   withholds a plan for empty completed/excluded courses (first-time-user
   over-blocking). Classification: **B**.
4. **PR #32 merged** — issue #25 Finding #3 [Medium-High]: `max_weekly_hours`
   overage now disclosed in the default path's `warnings_he` too (previously
   agent-path-only, and unreachable there until #31 fixed Finding #2).
   Classification: **C**.
5. **Finding #4 investigated, deliberately NOT implemented** — root cause fully
   traced (`planner_goals.ts`'s lexicographic goal-stack comparison lets a
   large elective's marginal hour-gain outrank a smaller pending mandatory
   course while under the hours cap, before `degree_completion`'s cap kicks
   in). This is a core planner-scoring change, not a narrow additive fix —
   needs a deliberate design decision + broad regression testing across every
   planner test suite before attempting it. Full reasoning + a recommended
   starting approach in `.remember/current.md`'s top entry.
6. Posted the issue #18 standing-direction-conflict resolution + a Vercel
   deploy-mechanism finding (independently corroborated by a concurrent
   session around the same time).
7. Reset this session's assigned branch from stale `main` onto
   `ui/frontend-modernization` at the start (recurring mistake, 4th+ session in
   a row per `.remember/current.md` — the branch-provisioning default itself is
   still unfixed upstream of this repo).

All three merged PRs: CI green (3/3) on the final commit, Codex-reviewed with
zero blocking findings, full API suite green throughout (ended the session at
**1202/1202** across 79 suites), `tsc --noEmit` clean (root + `web/`).

## Rolling A/B/C/D milestone history (most recent last)

1. PR #12 — Simulation capability — **D**
2. PR #13 — Persistence capability — **D**
3. PR #27 — hard-avoid plan correctness fix (Finding #1) — **C**
4. PR #31 — agent-path over-blocking fix (Finding #2) — **B**
5. PR #32 — max_weekly_hours disclosure fix (Finding #3) — **C**

Rolling-three checks:
- (12,13,27) = D/D/C — **NOT compliant** (only 1 of 3 is A/B/C; 0 are A/B).
  Pre-existing shortfall from before this session (PR #12/#13 both merged the
  same day, before #27 existed) — this is the exact gap issue #18 already
  flagged as the reason PR #14 could not be merged as a 3rd D milestone.
  Not retroactively fixable; recorded here as an acknowledged historical
  exception, not a compliant window.
- (13,27,31) = D/C/B — compliant (2 of 3 are A/B/C; 1 is A/B).
- (27,31,32) = C/B/C — compliant (3 of 3 are A/B/C; 1 is A/B).

Every window from PR #27 onward is compliant; the one non-compliant window
predates this session's first action and could not be cured after the fact —
it's the reason #14 stayed held rather than evidence the rule is being ignored
going forward.

## Blockers

1. **Vercel deploy access** — see above. Everything merged this session is
   inert for real users until someone deploys `ui/frontend-modernization` HEAD.
2. **Canonical branch reconciliation** (main rewrite / Vercel production-branch
   config) — a genuine human product decision, flagged multiple times now in
   issue #18, not attempted unilaterally by any session including this one.
3. Issue #21 (dead code decision), issue #20 (386 pre-existing UI test
   failures, single root cause: missing gitignored fixture) — both need a
   human product call, already fully diagnosed, not blocking Agent-quality work.
4. Issue #25 Finding #4 — see investigation summary above; needs a design
   decision before implementation, not just an approval to proceed.

## Exact next action

1. **First choice**: issue #25 Finding #4 — start with a dedicated failing
   test reproducing the 203h/185h over-allocation scenario (TDD RED), then
   explore capping `scorePlan`'s goal-1 marginal once the running total nears
   the target so goal 2a's marginal can win comparisons earlier. Treat the
   exact mechanism as an open design question. Run the FULL planner test suite
   (not just the new test) before considering this done — `planner_goals.test.ts`,
   `planner_scorecard.test.ts`, `generate_plan_load_distribution_policy.test.ts`,
   `generate_plan_dual_semester_load_balance.test.ts` at minimum.
2. **Second choice**: issue #25 Finding #5 (no server-side chat-vs-rebuild
   distinction) — lower severity, currently defense-in-depth only.
3. **Third choice**: issue #28 (client-side stale block-state after local
   avoid-filter) — UI-risk work (`semester_board_viewer.html`) needing live
   browser verification per this routine's own UI-work bar, not just code
   inspection.
4. Whoever has Vercel CLI access: deploy `ui/frontend-modernization` HEAD to
   production — 3 real fixes are merged and waiting.
