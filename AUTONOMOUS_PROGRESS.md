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

### 3. Issue #16 (CI test triage) — in progress, background agent running

I personally confirmed one of the two previously-spot-checked failures is a **stale test, not a regression**: `tests/test_viewer_structure.py::test_degree_progress_helper_exists_and_used_in_draft_and_modal` expects `renderProposalCard()` to call `renderDegreeProgressHtml(...)`. It doesn't — but `git log -S "This element renders nothing"` shows this was an **intentional** human-authored refactor (commit `1f98a004`, "remove duplicate draft buttons") that deliberately emptied that function; the pre-refactor version didn't call `renderDegreeProgressHtml` either. Not a real regression.

I launched a background agent (isolated worktree) to triage **all 39 failed + 4 errored** Python tests the same way: classify each as fixture/environment gap vs. stale assertion (fix the test, with evidence of intentional change) vs. genuine regression (fix the source, add a regression test). It's pushing its work to branch **`claude/issue-16-ci-triage`** (based on `ui/frontend-modernization`, not merged, no PR opened by it — that's a human/next-session call). Check that branch and the agent's final report before doing anything else with issue #16.

### 4. New instruction received mid-session (from human, not yet acted on)

Once PR #12/#13 (now effectively #12/#13/#14/#17, the whole open queue) are resolved, during the **"Canonical Branch Reconciliation and Safe Release Baseline"** milestone, add:
1. Root `AGENTS.md` — concise, shared instructions for Claude/Codex/other coding agents, pointing to the detailed policy doc. Must state: Agent quality/planner correctness is priority 1, UI/UX priority 2, infra only as a named prerequisite, isolated capabilities aren't "done" until integrated, normal chat must never rebuild a plan, only explicit rebuild actions may, draft/applied/simulation state must stay isolated, ConstraintModel is the authoritative deterministic source, never invent academic facts, every PR needs user-failure/root-cause/before-after/tests/risks/production-consumer, Codex must review correctness/state-consistency/validation-semantics/explanation-faithfulness/test-coverage, merge/deploy only through documented gates.
2. `docs/AUTONOMOUS_PRODUCT_POLICY.md` — the full detailed policy + the 10-step mandatory sequence (finish #12 → finish #13 → reconcile branches → establish baseline → diagnose real Agent via Hebrew scenarios → rank failures → fix highest-impact → integrate existing capabilities before new ones → repeat until critical scenarios pass → then broader UI/UX).

**Explicitly told: do not open a competing documentation PR while #12/#13 are active.** So this has NOT been done yet — do it once the PR queue above is actually resolved, as part of the reconciliation milestone, and get it Codex-reviewed like everything else.

## Open GitHub state as of this session

- **Open PRs:** #12 (Simulation), #13 (Persistence), #14 (Decision), #17 (CI fix) — all against `ui/frontend-modernization`, all Codex-approved, none merged, none CI-verified end-to-end except #17 itself (whose own Python job is red for the reason above).
- **Open issues:** #16 (CI test triage — being worked by background agent, see above).
- **My designated branch** `claude/determined-thompson-wqgcsb` had no PR ever opened against it (confirmed via search) — recreated fresh from `origin/ui/frontend-modernization` this session; only carries this progress doc so far.

## Exact next action for whoever picks this up

1. Read the background agent's final report on issue #16 triage (branch `claude/issue-16-ci-triage`). Review its diff, re-verify its classifications spot-check style, decide whether to open a PR for it.
2. Get a human decision on the PR #12/#13/#14 infra-track question (see §2). Do not merge any of them until then.
3. Once decided: if merging, first merge #17 (CI fix) — note its Python job will still be red until issue #16's fixes land; decide whether that's acceptable to merge anyway (it's a pre-existing, non-regression, already-documented failure) or whether to wait for the issue-16 branch to land first so #17 merges fully green. Recommend: land issue-16 fixes first, rebase #17 on top (or merge issue-16 branch first), so CI is genuinely green before anything merges.
4. Then work through #12/#13/#14 per whatever the human decides in §2.
5. Then run the Canonical Branch Reconciliation milestone (main ⟷ ui/frontend-modernization ⟷ Vercel), including the AGENTS.md / docs/AUTONOMOUS_PRODUCT_POLICY.md files described in §4.
6. Only after that: resume the real Agent-quality diagnosis loop (Hebrew end-to-end scenarios) per the standing mission — has not been started yet this session; all time this session went to unblocking the CI/PR-queue mess above, which was a genuine, evidence-backed P0 (broken review/CI gate integrity) blocking everything else safely.

## Rolling A/B/C/D milestone history

- This session performed no merges (blocked on a genuine, flagged product decision). Investigation/triage work (issue #16) is classified **C (correctness/safety)** once it lands — it's fixing a broken CI gate and pre-existing test regressions/stale assertions, not adding new capability surface.
