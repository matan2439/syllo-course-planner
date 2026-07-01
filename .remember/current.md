# Current — read this first

Branch: main @ e8a5d04 (PolicyProvider overload-consistency fix)
Session rule: read only this file by default; ask before opening architecture.md, roadmap.md, history.md, docs/*, or git log.

## Task
`e8a5d04` landed: `assessCompleteness`/`isGoal` now agree with `validate()` on overload-override acceptance (`ConstraintModel.overloadAccepted`/`overloadConfirmedAt`, same Phase 2C policy as `validatePlanState`). Overload semantics are internally consistent within the PlanningCapability/PolicyProvider path. Nothing in progress — awaiting direction.

**Follow-up not started:** no caller threads a real `overloadAccepted`/`overloadConfirmedAt` value into `buildConstraintModel`'s `BuildModelOptions` yet, so the fix is correct but inert in production until the request/preferences layer is wired up. Do not start until explicitly told to.

## Test status
API tests: 587/587. `tsc --noEmit`: clean.

## Blocker
Full `pytest` run leaks live Supabase TCP connections (39+, never closed). Root cause not found. Do not run unfiltered pytest with a real DATABASE_URL until diagnosed. Detail: architecture.md "Environment notes".

## Next step
Get direction on the pytest leak before running pytest broadly again. JS Jest-timeout fix and .venv ABI rebuild are ready whenever approved. The overloadAccepted/overloadConfirmedAt wiring follow-up (see Task above) is also ready to be scoped whenever approved.

## Boundaries
No Alembic/deploy/merge without approval. Never touch Supabase directly (incl. read-only). Never commit `.claude/settings.local.json` or `.claude/skills/`.
