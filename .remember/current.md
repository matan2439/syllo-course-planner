# Current — read this first

Branch: main @ 03b3dac (overload override wired end-to-end)
Session rule: read only this file by default; ask before opening architecture.md, roadmap.md, history.md, docs/*, or git log.

## Task
`e8a5d04` made the PolicyProvider-internal overload semantics consistent (`assessCompleteness`/`isGoal` agree with `validate()`). `1dcbc41` + `03b3dac` finished the follow-up: `generate-plan.ts`'s `buildModel()` and `planner-run.ts`'s `buildModelFromRequest()` now both thread `preferences.overload_accepted`/`overload_confirmed_at` into `buildConstraintModel`. `planner-run.ts`'s request schema also gained those two fields (it had none before). Overload override is now wired end-to-end for both endpoints — no more caller-layer gap. Nothing in progress — awaiting direction.

## Test status
API tests: 591/591. `tsc --noEmit`: clean.

## Blocker
Full `pytest` run leaks live Supabase TCP connections (39+, never closed). Root cause not found. Do not run unfiltered pytest with a real DATABASE_URL until diagnosed. Detail: architecture.md "Environment notes".

## Next step
Get direction on the pytest leak before running pytest broadly again. JS Jest-timeout fix and .venv ABI rebuild are ready whenever approved. Next recommended roadmap item (see roadmap.md): institution/program identity in `ConstraintModel` (no `institution_id`/`program_id`/`catalog_year` anywhere; courses keyed by bare `course_id` globally) — ready to be scoped whenever approved.

## Boundaries
No Alembic/deploy/merge without approval. Never touch Supabase directly (incl. read-only). Never commit `.claude/settings.local.json` or `.claude/skills/`.
