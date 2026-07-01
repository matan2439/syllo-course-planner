# Current — read this first

Branch: main @ 5c323d3 (AcademicDecisionAgent pipeline-shell epic — AcademicDecisionAgent + Clarification/Simulation/Decision/Persistence capability shells, complete)
Session rule: read only this file by default; ask before opening architecture.md, roadmap.md, history.md, docs/*, or git log.

## Direction change (2026-07-01)
The existing production planner is now frozen: do NOT modify `generate-plan` default behavior, `PlannerWorker`/`planner-run` production paths, UI, API contracts, DB/migrations, or feature flags. All new work targets the future `AcademicDecisionAgent → DecisionCapability → SimulationCapability → PlanningCapability (PlannerAgent) → SearchCapability` architecture, built infrastructure-only behind the scenes with no production wiring until the whole stack is complete. Full phase-ordered roadmap is in `.remember/roadmap.md`.

## Task
Phase 0 shipped (`232271a`, `0b45b98`, `e16ba9c`) — institution/program identity plumbing on `ConstraintModel`. Phase 1a shipped (`959a4f5`) — `enumerateActions` moved behind `PolicyProvider.generateActions`; `PlannerAgent` no longer imports it directly. Phase 1b shipped (`5b1dad9`) — load-cap thresholds (`hardCap`/`softLoadMax`/`absoluteMaxReasonable`) moved behind `ConstraintModel`/model context, defaulting to `load_constants.ts`'s existing values via `??` fallback everywhere they're read. Phase 2 shipped (`52010b2`) — new `api/ai/program_provider.ts`: generic `ProgramProvider` interface + `TauProgramProvider` (first impl), delegating verbatim to `parseProgramVersionId`/`queryBoardJson`/`loadLocalBoardJson`/`buildConstraintModel` (same DB-then-local-file fallback order `generate-plan.ts` already uses inline). Phase 2b shipped (`1c985f3`) — new `api/ai/planner_orchestration.ts`: `runPlanningOrchestration(req, deps)`, a transport-agnostic function composing `ProgramProvider` with the existing `PlannerAgent`/`PolicyProvider`/capability stack (program id + user context in, `AgentResult` out; no HTTP/env knowledge; `SearchCapability` stays a required dep, no `BeamSearchStrategy` default). Both phases are pure additions — no existing file edited, not wired into `planner-run.ts`, `generate-plan.ts`, or `PlannerWorker`. `planner_goals.ts`/`plan_validation.ts` are shared with the frozen `PlannerWorker` engine — verified zero behavior drift (full suite, including `planner_worker.test.ts`, passed unchanged). Production website path unchanged throughout.

**AcademicDecisionAgent pipeline-shell epic shipped** (`6fbb1d6`, `5c323d3`) — closed the four remaining north-star capability slots and added the top-level pipeline orchestrator:
- `6fbb1d6` — new `api/ai/academic_decision_types.ts`: `ClarificationCapability`/`SimulationCapability`/`DecisionCapability`/`PersistenceCapability` interfaces + no-op default impls (`NoOpClarificationCapability`, `NoOpSimulationCapability`, `PassThroughDecisionCapability`, `NoOpPersistenceCapability`), mirroring `PassThroughKnowledgeCapability`'s pattern.
- `5c323d3` — new `api/ai/academic_decision_agent.ts`: `AcademicDecisionAgent` class implementing Observe (`ProgramProvider`) → Detect Gaps (pure `detectGaps`, top-level, over the Observe-stage model) → Clarify if gaps found → Plan (delegates entirely to an injected `PlanningCapability`, treated as a black box — `PlannerAgent`'s own internal detect-gaps/enrich/search/explain flow is untouched) → Validate if a `ValidationCapability` is wired (throws on invalid) → Simulate if needed → Decide if needed → Persist. Returns `{ agentResult, gaps }`.

Both new files are pure additions. `planner_agent.ts`, `planner_capabilities.ts`, `planner_orchestration.ts`, `program_provider.ts`, `generate-plan.ts`, `planner-run.ts`, and `PlannerWorker` are all untouched (confirmed via `git status`/`git diff --stat` — only the 4 new files appear). Not wired into any production path. The duplicate top-level `detectGaps` call (also run internally by `PlannerAgent`) is intentional — pure function, cheap, avoids hoisting logic out of `PlannerAgent`.

Nothing in progress — awaiting direction on the next epic (e.g. wiring `AcademicDecisionAgent` to actually construct/inject its own `PlanningCapability` via `runPlanningOrchestration`, or building out real Clarification/Simulation/Decision/Persistence implementations).

## Test status
API tests: 640/640 (was 622; +8 `academic_decision_types.test.ts`, +10 `academic_decision_agent.test.ts`). `tsc --noEmit`: clean.

## Blocker
Full `pytest` run leaks live Supabase TCP connections (39+, never closed). Root cause not found. Do not run unfiltered pytest with a real DATABASE_URL until diagnosed. Detail: architecture.md "Environment notes".

## Next step
Get direction on the pytest leak before running pytest broadly again (unrelated to the AcademicDecisionAgent track). Phase 2 and 2b (ProgramProvider, runPlanningOrchestration) are done; next phase is unscoped — ready whenever approved.

## Boundaries
No Alembic/deploy/merge without approval. Never touch Supabase directly (incl. read-only). Never commit `.claude/settings.local.json` or `.claude/skills/`.
