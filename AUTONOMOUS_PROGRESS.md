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
- **Production commit:** `26500d4` ("Merge PR #11", 2026-07-19). **Stale** —
  missing PR #27 (issue #25 Finding #1, P0) and everything after it on
  `ui/frontend-modernization`, including this session's PR #31 once merged.
- **Deploy blocker:** no session so far (including this one) has had Vercel CLI
  credentials in its sandbox (`vercel login` has no reachable network path).
  Deploying via the MCP `deploy_to_vercel` tool was deliberately avoided — it
  uploads a raw file tree with no git linkage, breaking every existing
  deployment's `gitCommitSha` traceability. **A human (or a session with real
  Vercel CLI access) needs to run a production deploy from `ui/frontend-modernization`
  HEAD.** Flagged in issue #18.

## Active milestone

- **Classification:** B (end-to-end Agent integration) / P1.
- **User scenario:** a first-time Hebrew-speaking user with no recorded
  completed/excluded courses picks a single AI-interest chip → the live
  frontend auto-sets `use_academic_decision_agent:true` → the agent path
  returned `needsClarification:true` with **no plan at all**, while the
  identical input on the default (no-flag) path already returns an honest
  partial plan.
- **Root cause:** `generate-plan.ts`'s agent-path gate treated
  `completedCourseIds`/`excludedCourseIds` being empty/unset — the default
  state for any first-time account — as a hard block, even though both fields
  safely default to empty on the (already-working) default path.
- **GitHub issue:** #25 (Finding #2 of 5; Finding #1 fixed in merged PR #27).
- **Branch / PR:** `claude/determined-thompson-exmgrv` → PR #31 (base
  `ui/frontend-modernization`).
- **Current commit:** `8f281c5`.
- **Completed:** removed the early-return; clarification still flows into the
  response (still asks) but no longer withholds the plan. Zero frontend
  changes needed (verified, not assumed — the frontend's early-return keys off
  a different, now-never-true flag). 4 tests updated, RED-verified against the
  pre-fix code first. Full API suite 1197/1197, `tsc --noEmit` clean (root +
  `web/`), `next build` clean.
- **Remaining criteria:** Codex review of the latest commit with no blocking
  findings; CI green; then merge into `ui/frontend-modernization`.
- **Codex review status:** requested (`@codex review` posted), pending as of
  this writing.
- **CI status:** pending (no check runs reported yet as of this writing).
- **Unresolved findings:** none yet — too early in the review cycle.
- **Deployment status:** not deployed (see production-commit note above; this
  PR isn't merged yet either).

## This session's other actions

- Merged **PR #27** (issue #25 Finding #1, P0: hard-excluded/already-placed
  course now correctly reports `blocked:true` instead of silently succeeding).
  Now on `ui/frontend-modernization` @ `02551bd`.
- Left **PR #14** (Decision capability) unmerged — merging it would be a 3rd
  consecutive D-classified (infra, no production consumer) milestone, which
  both issue #18 and this routine's operating rules cap at 2.
- Posted the issue #18 standing-direction-conflict resolution + the Vercel
  deploy-mechanism finding above.
- Reset this session's assigned branch from stale `main` onto
  `ui/frontend-modernization` (recurring mistake, 4th session in a row per
  `.remember/current.md` — the branch-provisioning default itself is still
  unfixed upstream of this repo).

## Rolling A/B/C/D milestone history (most recent last)

1. PR #12 — Simulation capability — **D**
2. PR #13 — Persistence capability — **D**
3. PR #27 — hard-avoid plan correctness fix — **C** (correctness/safety)
4. PR #31 (this session, pending merge) — agent-path over-blocking fix — **B**
   (end-to-end Agent integration / real Agent-quality correction)

Rolling-three check (12/13/27): 1 D-adjacent... actually 2 D (#12,#13) + 1 C
(#27) → satisfies "at least two of three are A/B/C" and "at least one is A/B"
only via #27 alone being C, not A/B — flagged in issue #18 as the reason #14
was held rather than merged as a 3rd. Once #31 merges, the rolling three
(13/27/31) is D/C/B — compliant on both counts.

## Blockers

1. **Vercel deploy access** — see above. Everything merged is inert for real
   users until someone deploys.
2. **Canonical branch reconciliation** (main rewrite / Vercel production-branch
   config) — a genuine human product decision, flagged three times now in
   issue #18, not attempted unilaterally by any session including this one.
3. Issue #21 (dead code decision), issue #20 (386 pre-existing UI test
   failures, single root cause: missing gitignored fixture) — both need a
   human product call, already fully diagnosed, not blocking Agent-quality work.

## Exact next action

1. Wait for CI + Codex review on PR #31 (subscribed to its activity this
   session — events will arrive automatically). Fix any real findings, then
   merge once every gate passes.
2. After merge: continue issue #25 in severity order — Finding #3
   (`max_weekly_hours` exceeded but never surfaced as a `warnings_he` entry on
   the default path), then #4 (planner front-loads more hours than the degree
   needs), then #5 (no server-side chat-vs-rebuild distinction — currently
   defense-in-depth only, not exploitable).
3. Issue #28 (client-side stale block-state after local avoid-filter) is a
   good next candidate once the backend-only queue above is clear — it is
   UI-risk work (`semester_board_viewer.html`) needing live browser
   verification per this routine's own UI-work bar, not just code inspection.
