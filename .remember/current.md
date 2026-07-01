# Current — read this first

Branch: main @ 45286c5 (root_course_id fix)
Session rule: read only this file by default; ask before opening architecture.md, roadmap.md, history.md, docs/*, or git log.

## Task
Annual-dedup fix landed and verified. Nothing in progress — awaiting direction.

## Blocker
Full `pytest` run leaks live Supabase TCP connections (39+, never closed). Root cause not found. Do not run unfiltered pytest with a real DATABASE_URL until diagnosed. Detail: architecture.md "Environment notes".

## Next step
Get direction on the pytest leak before running pytest broadly again. JS Jest-timeout fix and .venv ABI rebuild are ready whenever approved.

## Boundaries
No Alembic/deploy/merge without approval. Never touch Supabase directly (incl. read-only). Never commit `.claude/settings.local.json` or `.claude/skills/`.
