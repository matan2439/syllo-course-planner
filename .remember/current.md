# Current — read this first

Branch: main @ e16ba9c (AcademicDecisionAgent Phase 0 — identity plumbing complete)
Session rule: read only this file by default; ask before opening architecture.md, roadmap.md, history.md, docs/*, or git log.

## Direction change (2026-07-01)
The existing production planner is now frozen: do NOT modify `generate-plan` default behavior, `PlannerWorker`/`planner-run` production paths, UI, API contracts, DB/migrations, or feature flags. All new work targets the future `AcademicDecisionAgent → DecisionCapability → SimulationCapability → PlanningCapability (PlannerAgent) → SearchCapability` architecture, built infrastructure-only behind the scenes with no production wiring until the whole stack is complete. Full phase-ordered roadmap is in `.remember/roadmap.md`.

## Task
Phase 0 shipped (`232271a`, `0b45b98`, `e16ba9c`): `ConstraintModel`/`BuildModelOptions` gained optional `institutionId`/`programId`/`catalogYear`. `generate-plan.ts`'s `buildModel()` and `planner-run.ts`'s `buildModelFromRequest()` both now derive `programId`/`catalogYear` from the `program_id` each already parses via `parseProgramVersionId`. `institutionId` intentionally stays `undefined` everywhere — no real multi-institution source exists yet, never fabricated. Metadata-only, no behavior change. Nothing in progress — awaiting direction.

## Test status
API tests: 596/596. `tsc --noEmit`: clean.

## Blocker
Full `pytest` run leaks live Supabase TCP connections (39+, never closed). Root cause not found. Do not run unfiltered pytest with a real DATABASE_URL until diagnosed. Detail: architecture.md "Environment notes".

## Next step
Get direction on the pytest leak before running pytest broadly again (unrelated to the AcademicDecisionAgent track). Next recommended phase (see roadmap.md): move load-cap thresholds (`load_constants.ts`) and `enumerateActions` (`planner_actions.ts`) behind `PolicyProvider`, so `PlanningCapability` (`PlannerAgent`) has zero embedded academic strategy left inline — ready to be scoped whenever approved.

## Boundaries
No Alembic/deploy/merge without approval. Never touch Supabase directly (incl. read-only). Never commit `.claude/settings.local.json` or `.claude/skills/`.
