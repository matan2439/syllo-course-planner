# Current — read this first

Branch: main @ 5b1dad9 (AcademicDecisionAgent Phase 1b — load-cap thresholds behind the model, complete)
Session rule: read only this file by default; ask before opening architecture.md, roadmap.md, history.md, docs/*, or git log.

## Direction change (2026-07-01)
The existing production planner is now frozen: do NOT modify `generate-plan` default behavior, `PlannerWorker`/`planner-run` production paths, UI, API contracts, DB/migrations, or feature flags. All new work targets the future `AcademicDecisionAgent → DecisionCapability → SimulationCapability → PlanningCapability (PlannerAgent) → SearchCapability` architecture, built infrastructure-only behind the scenes with no production wiring until the whole stack is complete. Full phase-ordered roadmap is in `.remember/roadmap.md`.

## Task
Phase 0 shipped (`232271a`, `0b45b98`, `e16ba9c`) — institution/program identity plumbing on `ConstraintModel`. Phase 1a shipped (`959a4f5`) — `enumerateActions` moved behind `PolicyProvider.generateActions`; `PlannerAgent` no longer imports it directly. Phase 1b shipped (`5b1dad9`) — load-cap thresholds (`hardCap`/`softLoadMax`/`absoluteMaxReasonable`) moved behind `ConstraintModel`/model context, defaulting to `load_constants.ts`'s existing values via `??` fallback everywhere they're read. `planner_goals.ts`/`plan_validation.ts` are shared with the frozen `PlannerWorker` engine — verified zero behavior drift (full suite, including `planner_worker.test.ts`, passed unchanged). Production website path unchanged throughout. Nothing in progress — awaiting direction.

## Test status
API tests: 605/605. `tsc --noEmit`: clean.

## Blocker
Full `pytest` run leaks live Supabase TCP connections (39+, never closed). Root cause not found. Do not run unfiltered pytest with a real DATABASE_URL until diagnosed. Detail: architecture.md "Environment notes".

## Next step
Get direction on the pytest leak before running pytest broadly again (unrelated to the AcademicDecisionAgent track). Next recommended phase (see roadmap.md): Phase 2 — define `ProgramProvider` interface + `TauProgramProvider` wrapping the existing `queryBoardJson`/`board_loader`/`buildCourseProfiles`/`buildConstraintModel` pipeline — ready to be scoped whenever approved.

## Boundaries
No Alembic/deploy/merge without approval. Never touch Supabase directly (incl. read-only). Never commit `.claude/settings.local.json` or `.claude/skills/`.
