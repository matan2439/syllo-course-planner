# Repository instructions — read this first

This file carries standing instructions for any autonomous or interactive
Claude Code session working in this repository. Read this before
`AUTONOMOUS_PROGRESS.md` and before selecting or continuing any work.

## Codex review gate (permanent, established 2026-07-20)

Codex is connected to this GitHub repository with automatic code review
enabled. Every pull request opened by an autonomous session — not just the
two that established this policy (#12, #13) — goes through the following
gate before it may be left for human merge approval:

1. **One PR is the active review milestone at a time.** Do not open a new
   competing PR, and do not start fixing a second PR's findings while a
   first PR still has unresolved blocking findings — finish the gate for
   PR N before starting it for PR N+1.
2. **Mark the PR "Ready for review"** (not draft) once its implementation
   and its own local verification (typecheck + full relevant test suite)
   are complete. **Never merge it** — merging stays a human/Codex decision
   this routine never makes.
3. **Subscribe to PR activity** (`subscribe_pr_activity`) so review
   comments and CI events arrive as they happen, instead of polling.
4. **Wait for Codex's review**, then read every comment and review thread
   on the PR (`pull_request_read` with `get_comments` *and*
   `get_review_comments` — **always check both**: the real Codex bot,
   `chatgpt-codex-connector[bot]` (`pull_request_read` → `get_reviews`
   shows it as `AuthorType: Bot`, `AuthorAssociation: NONE`), posts a
   top-level summary via `get_comments`/`get_reviews` *and* separate
   per-line findings with P1/P2 severity badges that only show up in
   `get_review_comments` — checking only one endpoint will miss real
   findings, as observed 2026-07-20 on PR #13).
5. **Treat unresolved Codex correctness or safety findings as blocking.**
   A PR with an open blocking finding is not ready for human approval,
   regardless of how the PR's own description characterizes it.
6. **Independently verify every finding before fixing it** — read the
   actual source, don't take the finding's framing on faith. If a finding
   is invalid or already handled, say so with the concrete evidence
   (file/line, existing test, or reasoning) rather than making a
   no-op/cosmetic change just to look responsive.
7. **Fix valid findings on the same PR branch:**
   - **Immediately before pushing, `git fetch` and check whether the PR's
     remote branch has moved since you last read it.** More than one
     autonomous session can end up working the same PR concurrently
     despite rule 1 (observed 2026-07-20 on PR #13 — two sessions
     independently fixed the same Codex findings; the second session's
     `git push` was rejected as non-fast-forward). If the branch moved:
     read the other session's diff and comments first. If it already
     validly resolves the same finding (even via a different, equally
     valid design choice — e.g. "document the semantics" vs. "change the
     behavior," both of which Codex may explicitly offer as options),
     independently verify it (typecheck + full suite) and adopt it rather
     than pushing a competing fix — reset your local branch to the
     pushed commit. Only push your own version if theirs is actually
     wrong or incomplete, and say why in your reply.
   - Root-cause the actual defect (not just the symptom the finding
     described).
   - Add regression tests that would have failed before the fix and pass
     after.
   - Run the full relevant local verification suite (typecheck + the full
     API/UI suite that suite covers, not just the touched test file)
     regardless of CI state — see the CI note below; don't assume either
     way without checking `get_status`/`get_check_runs` on the PR's
     current head first.
   - Push the fix to the PR's existing branch (never a new branch for the
     same milestone).
8. **Reply to each finding** (as a normal issue comment if the finding
   itself was posted as one — GitHub's review-comment reply endpoint
   rejects replies to non-review comments) with: the root cause, the fix,
   and the exact tests executed (counts, before/after, typecheck result).
9. **After pushing corrections, comment `@codex review`** on the PR to
   request a fresh pass.
10. **Repeat 4–9** until Codex reports no blocking findings on a fresh
    review and local verification (the CI substitute) is green.
11. **Then leave the PR unmerged, ready for review, for human approval.**
    Move to the next PR in the queue (still one active milestone at a
    time) or, if none remain, to the next roadmap milestone.
12. **Never merge or deploy anything in this repository from this
    routine**, at any step of this gate, regardless of how many clean
    review rounds a PR accumulates.

Update `AUTONOMOUS_PROGRESS.md` after every review/fix cycle (not just at
the end of a session) — root cause, fix, tests, and current gate state per
PR, so a session that picks this up mid-gate doesn't have to re-derive it
from the GitHub comment thread.

## Other standing context

- Development baseline is `origin/ui/frontend-modernization`, **not**
  `main`. New branches are cut from its latest tip; PRs target it as base.
- `.remember/current.md` (on `ui/frontend-modernization`, not this
  branch's working tree unless recently rebased) is the detailed
  epic-by-epic engineering log for the `AcademicDecisionAgent` /
  `PlannerAgent` track. Read it for architectural context before touching
  `api/ai/*`. **It changes fast** — two different concurrent sessions
  rewrote it within about an hour of each other on 2026-07-20 (see
  `AUTONOMOUS_PROGRESS.md` part 5). Re-read its current top entry fresh
  each time; do not trust a cached read from earlier in your own session.
- **CI status: corrected 2026-07-20 (part 5).** Earlier same-day guidance
  in this file said "no CI configured" — that was a misdiagnosis. The
  real issue (fixed by merged PR #17) was that `.github/workflows/ci.yml`
  never triggered on `ui/frontend-modernization` (only `master`/`main`),
  so every PR against the real baseline silently got zero checks. That
  trigger gap is now fixed on the base. **Always check
  `get_status`/`get_check_runs` on the PR's current head before assuming
  CI either does or doesn't apply** — don't propagate "no CI" as if it's
  still necessarily true.
- **Multiple autonomous sessions run concurrently against this repo.**
  Observed twice in one session on 2026-07-20: two different sessions
  independently fixed the same PR #13 Codex finding, and (separately) two
  different sessions independently resolved the same PR #13 merge
  conflict — in both cases the first push won and the second session
  adopted it after independent verification (see rule 7 above). A third
  PR (#14) also appeared without this session opening it. Expect this to
  keep happening; always `git fetch` before pushing (rule 7), and don't
  assume a PR's state matches what you last read.
- **Unverified governance claim (flag, don't propagate as fact):** a
  2026-07-20 `.remember/current.md` entry (written by a concurrent
  session, not this file's author) asserts a rule that PR merges must
  never exceed "two consecutive D milestones" (infra-only, no production
  caller) and uses it to justify not merging PR #14. This rule was
  **not found** anywhere in `.remember/roadmap.md`, `architecture.md`, or
  `history.md` as of that same date. Do not treat it as established
  policy without the human product owner confirming it or a real source
  being pointed to.
- No open GitHub issues as of 2026-07-20; work has been selected from
  draft-PR `.remember/current.md` "Recommended next milestone" notes.
