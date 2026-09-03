# Verified Preview and Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the verified semester-table planner and conversational Agent to the live site using an immutable Preview artifact with rollback evidence.

**Architecture:** Push only coherent commits from `ui/frontend-modernization`, let Vercel create or explicitly create an immutable Preview, run deterministic browser acceptance there, then promote that exact deployment to Production. No merge to `main`, database mutation, alias hand-edit, environment-variable change or rebuild occurs during promotion.

**Tech Stack:** Git, Vercel CLI/Git integration, Next.js, Jest, TypeScript, browser acceptance

**Spec:** `docs/superpowers/specs/2026-09-02-semester-table-conversational-agent-production-design.md`

## Global Constraints

- Production promotion is authorized by the user's 2026-09-02 request but occurs only after all gates pass.
- The exact accepted Preview artifact is promoted; do not run a separate Production rebuild.
- Record the prior Production deployment before promotion.
- Do not modify `main`, Supabase, catalog/data sources, remote databases, aliases, domains or Production environment variables.
- Electrical Engineering remains hidden.
- Automated acceptance does not call paid/LLM providers; one bounded real conversation is a separately identified live smoke.

---

### Task 1: Local release gate

**Files:**
- Modify: `AUTONOMOUS_PROGRESS.md`

- [x] Confirm `git status --short` contains only the explicitly preserved unrelated files.
- [ ] Run complete Python, root Jest, web Jest, root/web typecheck and `web` production build commands from repository manifests.
- [x] Run `git diff --check` and record exact test/build evidence.
- [x] Commit only the release evidence update.

### Task 2: Push and immutable Preview

**Files:** none

- [x] Confirm branch is `ui/frontend-modernization`, list commits ahead of `origin`, and verify no preserved file is staged.
- [x] Push explicitly to `origin/ui/frontend-modernization` after egress approval.
- [x] Confirm Vercel CLI availability. If unavailable, install only with user/system approval or use the configured Git deployment and inspect its resulting commit SHA.
- [x] Capture Preview URL, deployment id, commit SHA, framework and READY status.
- [ ] Confirm Preview uses isolated durable storage and does not target Production data.

### Task 3: Deterministic Preview acceptance

**Files:**
- Create or modify only focused browser acceptance tests under `tests/ui/` when a missing automated assertion is found through RED.

- [x] Verify `/planner?program=mechanical_engineering_2027` loads the purple React workspace with no legacy iframe.
- [ ] Desktop: verify repository category/search, drag add, board move, remove, selected state, details and refresh persistence.
- [ ] Keyboard: verify repository add menu, board move menu, tab order, focus visibility and live error/status announcements.
- [x] Mobile: verify three views, horizontal semester navigation, no clipped controls and no page-level horizontal overflow.
- [ ] Agent with provider calls disabled: verify truthful unavailable or deterministic test mode, alternatives never mutate before Apply, manual edit stales, stale Apply blocks, selected candidate server-applies and survives refresh.
- [ ] Verify session isolation, console errors, failed requests and unexpected network calls.
- [ ] Record immutable acceptance evidence and exact Preview URL.

### Task 4: Bounded real conversational smoke

**Files:** none

- [ ] Confirm the Preview runtime has an already-configured model through read-only inspection; do not alter secrets.
- [ ] Send one bounded Hebrew planning question and verify an assistant turn plus redacted tool activity.
- [ ] Verify the response references the current board and cannot commit before explicit Apply.
- [ ] Record provider/model family, request count and result without exposing secrets or full prompts.
- [ ] If no model is configured, stop Production promotion and report the truthful blocker rather than enabling a provider implicitly.

### Task 5: Promote exact artifact and verify live

**Files:** none

- [ ] Record current Production deployment URL/id and rollback command.
- [ ] Reconfirm Preview deployment id and accepted commit SHA.
- [ ] Run `vercel promote <accepted-preview-url>`; do not use `vercel --prod`.
- [ ] Inspect Production until READY and confirm the promoted deployment id matches the accepted artifact.
- [ ] Run live `/planner` smoke for load, manual edit persistence and one bounded Agent conversation; do not mutate shared catalog/program data.
- [ ] Scan recent deployment logs for errors and retain rollback readiness.

### Task 6: Release record

**Files:**
- Modify: `AUTONOMOUS_PROGRESS.md`

- [ ] Record live URL, deployment id, commit, test/build counts, Preview acceptance, real-conversation smoke, previous Production id and rollback command.
- [ ] Commit and push the release record to `ui/frontend-modernization`.
- [ ] Report any intentionally deferred items, especially Electrical visibility, accounts/cross-device sync and monetization.
