# Current State — read this first
_Last updated: 2026-07-01 (annual-dedup fix landed this session)._

**Status:** V1/P0/P1/P2-A complete. **P2-C (annual dedup) is now actually fixed — commit `45286c5`.** (Prior commit `2119c6d` had only shipped the type, not the fix; do not confuse the two.)

**Current task:** Annual-dedup RED→GREEN done and committed. Nothing else in progress. Not starting another roadmap item until explicitly told to.

**Blockers:**
1. **NEW — unresolved:** a full `pytest` run opened 39+ live TCP connections to the Supabase Postgres host (port 6543) that never closed, discovered via `netstat` mid-run and killed. Static grep of every call site in `tests/` for functions defaulting to the shared `_DB_PATH` singleton (`app/database/db.py`, `eligibility_engine.py`, `recommendation_engine.py`, `prerequisite_graph.py`) found no missing-argument bug — every call passes an explicit path. Root cause **not found**; diagnosing further would require either reading `pg_stat_activity` on Supabase (blocked — violates "do not touch Supabase") or re-running subsets of the suite (which recreates the same live-connection exposure). Left as an open item pending user direction. No full pytest pass/fail count exists for this session as a result.
2. `.venv` has ABI-mismatched binaries (`cp313` wheels in a `cp311` interpreter) — 2 packages patched (`psycopg2`, `pydantic-core`) just to unblock collection; ~15 more `cp313` `.pyd` files remain. Needs a clean rebuild, not further patching.
3. JS/UI test suite (`npm test`) is flaky under this sandbox: default 5000ms Jest timeout collides with jsdom-heavy suites under parallel-worker contention. Not a code regression (confirmed via `git diff`). Fix not yet applied (proposed: `testTimeout` bump in `jest.ui.config.js`).
4. No `data/boards/*.json` regeneration script exists (`npm run refresh-boards` in `docs/roadmap-v2.md` is aspirational). Both `data/boards/mechanical_engineering_2027.json` and `data/parsed_json/mechanical_semester_board_2027.json` are manually kept in sync — this session's fix applied the same script to both directly.

**Test status:**
- `npm test`: 647 JS/TS tests; API suite (563/563) reverified clean after the annual-dedup change. Full UI suite still subject to blocker #3.
- `pytest`: 1321 tests collect cleanly (ABI fix holds). No completed full-suite run exists — see blocker #1. Focused check: `tests/test_board_audit.py` (19/19) passes with the tightened annual check, including the strict real-board assertion.
- `tsc --noEmit`: clean.

**Immediate next step:** Get direction on blocker #1 (live-DB connection leak) before running `pytest` broadly again. Otherwise: JS timeout fix (#3) and venv rebuild (#2) are both ready to execute whenever approved; no roadmap item beyond annual-dedup has been started.

**Hard boundaries (unchanged):** No Alembic migration applied without approval. No deploy without approval. No merge without approval. Do not touch Supabase (this includes read-only diagnostic queries — confirmed enforced this session). `.claude/settings.local.json` / `.claude/skills/` never committed.

See `.remember/architecture.md` for the system design (read only when you need it — this file is the default).
