# Autonomous Progress — Syllo Course Planner

_Last updated: 2026-07-20 by Claude (session on branch `claude/determined-thompson-wqgcsb`)._

## Canonical / production branch state (transitional — NOT reconciled yet)

- **Development base (per standing instructions):** `ui/frontend-modernization` — treat as authoritative until reconciliation milestone runs.
- **`main`**: older baseline, NOT current — do not assume it reflects production.
- Reconciliation (main ⟷ ui/frontend-modernization ⟷ Vercel production branch) has **not** been done yet. Do not deploy from anything until that milestone runs.

## What this session found (do not re-derive — act on this)

### 1. The Codex/CI review gate had a real hole (now partially fixed, one PR pending)

CI (`.github/workflows/ci.yml`) only triggered on push/PR to `main`/`master`. Every PR opened against `ui/frontend-modernization` — the branch this whole routine is told is the real dev base — got **zero CI signal** (0 check runs). On top of that, `requirements.txt` pinned `alembic>=2.0.0` (a version that has never existed), so even `main`'s one historical CI run failed at `pip install` before a single test ran.

**PR #17** (branch `claude/compassionate-ptolemy-tccl5l`, open, Codex-approved, NOT merged) fixes both. Its first real CI run: TypeScript API tests ✅, Next.js build ✅, **Python tests ❌ (39 failed + 4 errored)** — tracked in **issue #16**. This is the first time CI has ever actually run Python tests on this repo.

**Consequence:** PRs #12, #13, #14 (see below) were Codex-reviewed and passed the agent's own local test runs, but **CI itself never validated any of them** — their "full suite green" claims were never independently checked by an actual CI run. This isn't necessarily wrong, but it means the CI merge gate ("CI passes on the latest commit") has not literally been satisfied for any of them yet.

### 2. Three consecutive infra-only PRs conflict with this routine's own anti-pattern rule — UNRESOLVED, flagged to human, do not merge without a decision

- **PR #12** — `LocalSearchSimulationCapability` (Simulation). Codex-approved (2 real findings fixed: stale `meta`/`rationale_he` after simulation, validation-precedence drift). Clean re-review.
- **PR #13** — `InMemoryPersistenceCapability` (Persistence). Codex-approved (state-isolation/mutation-leak questions asked and fixed with `structuredClone`).
- **PR #14** — `ScoreBasedDecisionCapability` (Decision). Codex-approved (3 rounds: default validity gate too narrow, injected-validator precedence unsafe for Decision specifically, missing `policy.validate` call — all fixed).

All three are individually clean, well-tested (Codex found real bugs, they got fixed properly), and each PR body **explicitly states it is not wired into any production consumer** — "left for a future, separately-approved epic." That is three consecutive D-classification (infrastructure) milestones with no named production consumer, which directly violates this routine's own stated rule: *"Never merge more than two consecutive D milestones"* and *"An isolated capability is not complete until it is integrated into the real production flow."* The routine's mandatory sequence also explicitly told me to merge #12 then #13 regardless — a direct contradiction inside the standing instructions.

**I did not resolve this myself. I pushed a notification to the human flagging the contradiction and am waiting for a decision**: merge as pure infra anyway, hold until one of the three capabilities gets wired to a real caller, or close/rescope the track. **Do not merge #12/#13/#14 until that decision is made** (and regardless, CI has never run on any of their commits — that gate isn't satisfied either; would need `update_pull_request_branch` + a fresh CI run once #17 merges).

### 3. Issue #16 (CI test triage) — triaged, PR #19 open awaiting Codex review + human merge

Background agent triage complete. Result: **23 of 43 failures fixed** (test-only changes, each backed by the specific prior commit proving current behavior is intentional — e.g. `1f98a004` deliberately emptied `renderProposalCard()`, `45286c5` intentionally double-places annual course 0542-3792 across semesters and dedups downstream). **16 left failing**, documented as fixture/environment gaps (real gitignored data files — `tau_program_8715_2025.json`, `supabase_board_backup_2027_pre_sync.json`, `data/database.sqlite` — that a fresh checkout can never have). **4 left genuinely unresolved**, flagged on issue #16 for a human call: `requestPlanProposalFromDraft()`/`runPrimaryAiAction()` are defined but have zero live call sites — either intentionally dead (delete them + the 4 tests) or an accidentally-dropped fallback (wire back in). Before/after: 1200→1223 passed, 39→12 failed, 4 errors unchanged (documented).

Opened **PR #19** (`claude/issue-16-ci-triage` → `ui/frontend-modernization`) with full before/after evidence and per-test reasoning. **Codex review gate now closed** (2 rounds, both real live-bug findings fixed, clean 3rd review on `91ef57f`). Still not merged — CI can't run on it until #17 merges (fixes the trigger), and awaiting human merge approval like #12/#13/#14/#17.

**Codex review round 1 on PR #19 found a real, live product bug** (not just a test-staleness issue): my broadened test let a genuine defect through — `semester_board_viewer.html`'s difficulty-signals block checked `syllabus_ai_analysis_status === 'complete'`, a value no pipeline step has ever written (real pipeline writes `'done'`/`'failed'`). Confirmed against real board data: 61 courses have `status:'done'`, 0 have `'complete'` — meaning all 61 were shown to users as "AI syllabus analysis missing" despite analysis having completed. Fixed in `3f248f5` (check `'done'` instead), new regression test added, full suite re-verified (1224 passed, same pre-existing/documented failures unchanged), replied to Codex with root cause + evidence, thread resolved, requested re-review.

**Codex review round 2 found a second, related gap**: `normalizeCourse()` (used by `init()` to build `courseMap` for PLACED board courses) copies every other `syllabus_*` field but omitted `syllabus_ai_analysis_status` entirely — so the round-1 fix didn't help the 13 placed courses with `status:'done'` in the real board data; their `aiStatus` was `undefined` after normalization regardless. Fixed in `91ef57f`, regression test added, full suite re-verified clean (1225 passed). Thread resolved, requested re-review. (Side note: hit and diagnosed a known, already-documented footgun mid-verification — a stray 0-byte `data/database.sqlite` auto-created by a `test_seed_postgres.py` run broke 9 unrelated DB-dependent tests' skip-guards; deleting the gitignored file restored the clean baseline. Not a regression, already flagged in PR #19's own description.)

**New, separate, bigger issue found and filed as #20**: the JS/TS `jest.ui.config.js` suite (the DOM-level analog of the Python structural tests) has **386 of 811 tests failing** — verified pre-existing (not caused by PR #19's changes). This is a much larger, previously-unscoped triage than #16 ever covered (Python-only), and it's currently hidden behind `continue-on-error: true` in `ci.yml`. PR #17 said that flag should come off "once #16 is resolved" — it can't safely come off until #20 is also triaged, or a real regression could ship under a green badge.

### 4. New instruction received mid-session (from human, not yet acted on)

Once PR #12/#13 (now effectively #12/#13/#14/#17, the whole open queue) are resolved, during the **"Canonical Branch Reconciliation and Safe Release Baseline"** milestone, add:
1. Root `AGENTS.md` — concise, shared instructions for Claude/Codex/other coding agents, pointing to the detailed policy doc. Must state: Agent quality/planner correctness is priority 1, UI/UX priority 2, infra only as a named prerequisite, isolated capabilities aren't "done" until integrated, normal chat must never rebuild a plan, only explicit rebuild actions may, draft/applied/simulation state must stay isolated, ConstraintModel is the authoritative deterministic source, never invent academic facts, every PR needs user-failure/root-cause/before-after/tests/risks/production-consumer, Codex must review correctness/state-consistency/validation-semantics/explanation-faithfulness/test-coverage, merge/deploy only through documented gates.
2. `docs/AUTONOMOUS_PRODUCT_POLICY.md` — the full detailed policy + the 10-step mandatory sequence (finish #12 → finish #13 → reconcile branches → establish baseline → diagnose real Agent via Hebrew scenarios → rank failures → fix highest-impact → integrate existing capabilities before new ones → repeat until critical scenarios pass → then broader UI/UX).

**Explicitly told: do not open a competing documentation PR while #12/#13 are active.** So this has NOT been done yet — do it once the PR queue above is actually resolved, as part of the reconciliation milestone, and get it Codex-reviewed like everything else.

## Open GitHub state as of this session

- **Open PRs:** #12 (Simulation), #13 (Persistence), #14 (Decision), #17 (CI fix), #19 (issue #16 test triage) — all against `ui/frontend-modernization`. #12/#13/#14/#17 Codex-approved. #19 just opened this session, not yet Codex-reviewed. None merged.
- **Open issues:** #16 (Python CI triage — mostly resolved via PR #19, 4 tests need a human call, see comment), #20 (JS/UI suite has 386/811 failing, new, untriaged, separate from #16).
- **My designated branch** `claude/determined-thompson-wqgcsb`: no PR ever opened against it previously — recreated fresh from `origin/ui/frontend-modernization` this session; carries only this progress doc.

## Exact next action for whoever picks this up

1. Wait for/check Codex review on PR #19 (issue #16 triage). Resolve any findings the same way #12/#13/#14 did. Get human approval before merging.
2. Get a human decision on the PR #12/#13/#14 infra-track question (see §2) — do not merge any of them until then. Also get a human decision on the 4 dead-code-adjacent tests flagged on issue #16 (delete vs. rewire `requestPlanProposalFromDraft`/`runPrimaryAiAction`).
3. Recommended merge order once decisions land: PR #19 first (fixes the Python CI gate for real) → PR #17 (CI trigger fix, will then show fully green Python job) → #12/#13/#14 per the human's call on §2, rebasing/re-triggering CI on each since none has ever had a real CI run.
4. Issue #20 (386/811 JS/UI test failures) is a substantial, separate, not-yet-started triage — likely the next big P0/correctness milestone after the PR queue clears, before `tests/ui`'s `continue-on-error` can safely come off.
5. Then run the Canonical Branch Reconciliation milestone (main ⟷ ui/frontend-modernization ⟷ Vercel), including the AGENTS.md / docs/AUTONOMOUS_PRODUCT_POLICY.md files described in §4.
6. Only after that: resume the real Agent-quality diagnosis loop (Hebrew end-to-end scenarios) per the standing mission — not started yet; this session's time went entirely to unblocking a genuine, evidence-backed P0 (broken CI/Codex gate integrity across the whole open PR queue), which was blocking everything else from being verifiable.

## Rolling A/B/C/D milestone history

- This session performed no merges (blocked on a genuine, flagged product decision). Investigation/triage work (issue #16) is classified **C (correctness/safety)** once it lands — it's fixing a broken CI gate and pre-existing test regressions/stale assertions, not adding new capability surface.
