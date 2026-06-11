# Board build / audit / sync / verify pipeline

Single entry point for keeping `data/parsed_json/{program}_semester_board_{year}.json`
consistent and in sync with Supabase, replacing ad-hoc manual edits.

## Commands

```bash
# Refresh metadata.board_data_version (hash of semesters + repository courses)
npm run build:board

# Run all consistency checks (read-only, no network/DB)
npm run audit:board

# Audit, and if it passes, push board_json to Supabase program_versions
npm run sync:board

# Compare the live deployed API against the local board JSON
npm run verify:live
```

All four are thin wrappers around:

```bash
python3 scripts/course_planner_pipeline.py --program mechanical_engineering --year 2027 \
    [--build] [--audit] [--sync] [--verify-live] [--live-base https://...]
```

Flags can be combined; they always run in order build -> audit -> sync -> verify-live,
and `--audit` failing (any error-level issue) stops the pipeline before `--sync`.

## Audit-only workflow (safe, no writes)

```bash
npm run audit:board
```

Prints a report with `board_hash`, total course count, and any errors/warnings from
`app/analysis/board_audit.py`. Exit code is non-zero if any error-level issue exists.
Run this after any manual edit to the board JSON, before considering a sync.

## Supabase sync

```bash
npm run sync:board
```

- Requires `DATABASE_URL` to be set, either directly or via `ENV_FILE=path/to/.env`.
- Updates only `program_versions.board_json` for the matching `program_id` /
  `academic_year` row (currently `program_id='mechanical_engineering'`,
  `academic_year=2027` for this board).
- Refuses to run if `--audit` reports any errors.
- Never prints the connection string or any other secret — only "Rows updated: N".

## Live verification

```bash
npm run verify:live
```

- Fetches `https://tau-course-planner.vercel.app/api/board/mechanical_engineering_2027`.
- Compares `metadata.board_data_version` between live and local; mismatch means
  Supabase hasn't been synced yet or the deployment is serving stale data.
- Spot-checks that every locally placed course exists live, in the same semester,
  and within its `effective_allowed_semesters`.

Run this after `sync:board` to confirm the change reached the live site. If
`board_data_version` still mismatches after a sync, redeploy (or wait for the
serverless function cache to refresh) and re-run `verify:live`.

## Handling syllabus URLs that fail to fetch/parse

- `audit:board` reports `syllabus_not_summarized` (warning) for any course that has
  a `syllabus_url` but no `syllabus_summary_he`, and `syllabus_parse_failed`
  (warning) for any course with a `syllabus_parse_error` field.
- These are warnings, not errors — they do not block `sync:board`. Use the report
  to prioritize which courses still need manual syllabus review/enrichment.
- Offered-semester data for flexible mandatory courses currently comes from the
  `OFFERED_SEMESTERS_OVERRIDES` dict in `app/analysis/semester_board.py`
  (mirrored in `scripts/add_offered_semester_fields.py`), each entry carrying its
  own `offering_source_url` and `offering_source_confidence`. A course is only
  restricted to a subset of `program_allowed_semesters` when
  `offering_source_confidence == "high"`; otherwise `effective_allowed_semesters`
  falls back to the full `program_allowed_semesters`.

## Avoiding committing secrets

- `DATABASE_URL` must live in `.env` (gitignored) or be passed via `ENV_FILE`
  pointing at a gitignored file.
- `course_planner_pipeline.py` and `scripts/update-board-json.mjs` never print the
  connection string, only row counts / status.
- Before committing, double-check `git status` does not include `.env`,
  `token_b64.txt`, or any other credential file.

## Manual pre-release checklist

1. `npm run audit:board` — must report `PASS` (0 errors).
2. `npm run build:board` — confirm `board_data_version` is up to date (re-run audit
   if it changed).
3. `npm test` and `npm run typecheck` — must pass.
4. `python3 -m pytest tests/test_board_audit.py tests/test_semester_board.py tests/test_syllabus_summary.py -q` — must pass.
5. `npm run sync:board` — only after the above are green and a human has reviewed
   the audit report / diff.
6. `npm run verify:live` — must report `PASS`. If it fails on `board_data_version`
   mismatch, redeploy and retry.
