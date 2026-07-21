# Autonomous Progress

Durable handoff for the autonomous Syllo product-engineering routine. Read this
first; `.remember/current.md` is the detailed narrative log this summarizes
(read it for full root-cause writeups and prior-session detail).

_Last updated: 2026-07-21, session on branch `claude/determined-thompson-76nzgq`._

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

Rolling-three checks:
- (12,13,27) = D/D/C — **NOT compliant** (only 1 of 3 is A/B/C; 0 are A/B).
  Pre-existing shortfall from before PR #27 existed — the exact gap issue #18
  already flagged as the reason PR #14 could not be merged as a 3rd D
  milestone. Not retroactively fixable; recorded as an acknowledged historical
  exception, not a compliant window.
- (13,27,31) = D/C/B — compliant (2 of 3 are A/B/C; 1 is A/B).
- (27,31,32) = C/B/C — compliant (3 of 3 are A/B/C; 1 is A/B).
- (31,32,34) = B/C/C — compliant (3 of 3 are A/B/C; 1 is A/B).

Every window from PR #27 onward is compliant; the one non-compliant window
predates PR #27 and could not be cured after the fact — it's the reason #14
stayed held rather than evidence the rule is being ignored going forward.

## Blockers

1. **Vercel deploy access** — see above. Everything merged so far (PR #12,
   #13, #27, #31, #32, #34) is inert for real users until someone deploys
   `ui/frontend-modernization` HEAD. This is the single highest-value unblock
   available right now — real, tested, Codex-reviewed correctness fixes are
   sitting unshipped.
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
5. Issue #25 Finding #5 — no server-side chat-vs-rebuild distinction; low
   severity, currently defense-in-depth only (the live frontend never calls
   the endpoint for a plain conversational turn), not blocking.
6. PR #14 (Decision capability) remains open, deliberately unmerged — would be
   a 3rd consecutive D-classified milestone with no named production consumer.
   Recommend a human decide: close/park it as a reference implementation, or
   hold until a real multi-candidate producer exists to consume it.

## Exact next action

1. **Whoever has Vercel CLI access: deploy `ui/frontend-modernization` HEAD to
   production.** This is now the single most valuable pending action — 6 real,
   tested, Codex-reviewed fixes (PR #12, #13, #27, #31, #32, #34) are merged
   and waiting.
2. Issue #25 Finding #4 (planner over-allocation) still needs a human decision
   on the intended `GOAL_STACK` tradeoff before implementation — see Blockers.
   If a decision arrives, the recommended starting point is unchanged: a
   dedicated failing test reproducing the 203h/185h scenario (TDD RED), then
   treat the exact scoring mechanism as an open design question, and run the
   FULL planner test suite (`planner_goals.test.ts`, `planner_scorecard.test.ts`,
   `generate_plan_load_distribution_policy.test.ts`,
   `generate_plan_dual_semester_load_balance.test.ts` at minimum) before
   considering it done.
3. If Finding #4 stays blocked, issue #25 Finding #5 (no server-side
   chat-vs-rebuild distinction) is the next real-Agent item that doesn't need
   a product decision — low severity, defense-in-depth only.
4. Issues #20/#21/#18(reconciliation)/#14 all still need a human product call
   — already fully diagnosed by prior sessions, not re-investigated further
   this session since nothing new was learned.
