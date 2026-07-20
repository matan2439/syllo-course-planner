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
     API/UI suite that suite covers, not just the touched test file) —
     this repo has **no CI configured** (verified 2026-07-20: `pull_request_read`
     → `get_status` returns `state: pending`, `total_count: 0` on every
     open PR's head commit), so this local run *is* the CI signal. Do not
     wait for a CI check that will never appear.
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
  `api/ai/*`.
- No open GitHub issues as of 2026-07-20; work has been selected from
  draft-PR `.remember/current.md` "Recommended next milestone" notes.
