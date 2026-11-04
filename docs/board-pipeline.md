# Board build / audit / sync / verify pipeline

Entry points for keeping `data/parsed_json/{program}_semester_board_{year}.json`
consistent and in sync with Supabase, replacing ad-hoc manual edits.

## The four commands (`scripts/degree.py`)

Every registered degree (`data/config/programs.json`) is driven by one CLI, `--program <id>`:

| Command | What it does |
| --- | --- |
| `evidence` | Collects the official sources (TAU GraphQL, regulations PDF, tochniot pages) into `evidence.json` (`--live` fetches, `--offline` replays the stored snapshot). |
| `build` | spec -> boards: `spec.json` + `curation.json` + official facts -> `data/parsed_json/..._semester_board_<y>.json`, `data/boards/<id>.json`, the Years 1-2 board and `data/config/early_year_courses.json`. `--out-dir DIR` redirects the output. |
| `check` | Compares the spec against the evidence: every official item covered, course rules enforced, no unresolved conflicts or gaps. Exits non-zero on failure. |
| `refresh` | Updates the per-year official course facts snapshot (`--apply` patches boards). |

Flow: `evidence` -> review/edit `spec.json` (+ `curation.json` overlay) -> `check` -> `build`.
`--live` / `--offline` choose between fetching and replaying stored data.

Where files live:

- `data/config/programs.json` - the registry (program ids, tcid, source year, board file names).
- `data/degrees/<inst>/<base>/<year>/{spec,evidence,curation}.json` - e.g. `data/degrees/tau/mechanical_engineering/2027/`.
- `data/official/tau_course_facts_<shana>.json` - per-year official course facts shared by all programs (TAU `shana` 2026 = TAU year tashpaz).

npm scripts:

```bash
npm run build:board    # degree.py build --program mechanical_engineering_2027 --offline (byte-identical rebuild)
npm run degree:check   # degree.py check --program mechanical_engineering_2027 --offline
npm run audit:board    # course_planner_pipeline.py --audit on data/boards/mechanical_engineering_2027.json
npm run sync:board     # audit, then push that board to Supabase program_versions.board_json
npm run verify:live    # compare the live API against that board
```

`audit`, `sync` and `verify-live` stay in `scripts/course_planner_pipeline.py` (it is the only
step that writes to the DB). Production `program_versions.board_json` holds the FULL board
`data/boards/mechanical_engineering_2027.json`, so these scripts pass `--board-json` to it;
the older 56-course `data/parsed_json/...` board must not be synced.

### Known failures of `degree:check` for mechanical engineering 2027

`npm run degree:check` exits non-zero today, by design, on two pinned checks:

- `rules_enforced`: 6 course rules in the spec are not yet enforced by the planner/board logic.
- `known_gaps`: the regulations PDF has not been read (recorded as a gap, not silently assumed).

It will pass once the rules are enforced and the regulations source is read.

Deprecated names kept for one release as re-exports: `app/pipeline/enrich_mechanical_2027.py`
(now `enrich_board_graphql.py`) and `app/pipeline/generate_2027_board.py` (now `generate_board.py`).

## Building a degree's boards (`scripts/degree.py`)

Every registered degree (`data/config/programs.json`) builds from its spec:

```bash
python scripts/degree.py refresh  --program mechanical_engineering_2027 [--live|--offline] [--apply]
python scripts/degree.py build    --program mechanical_engineering_2027 --offline [--out-dir DIR]
python scripts/degree.py check    --program mechanical_engineering_2027 --live      # or --offline (never passes)
python scripts/degree.py evidence --program mechanical_engineering_2027 --offline
```

`build` = `spec.json` → `spec_to_program` (the mandatory-courses input is generated from the
spec) → the legacy generate path (board, course-detail links, GraphQL names/hours) →
official facts (`refresh` apply + syllabus summaries) → the reviewed overlay
`data/degrees/<inst>/<base>/<year>/curation.json` → the Years 1–2 window board and its
course index. Each overlay entry names the board, course, field, the value the builder produced
when it was written (`built`), a `retire` tag (`post_migration` = history to drop with the first
real update, `null` = durable hand correction) and the reason. The build fails if an entry's
target is gone, if the build now produces the overlay's value, or if it produces anything other
than `built` (so fresh official data is never silently masked). Files are written in the
previous file's layout (key order, number spelling; offline also its fetch timestamps), so an
offline rebuild into `data/` changes only `board_data_version`.
`tests/test_degree_build_golden.py` proves that byte-for-byte for the ME boards (it skips when
the gitignored `data/raw_html/` or `data/database.sqlite` are absent). `refresh` covers every
course the spec references (all mandatory years, every category, the general-requirement pool),
merges into the per-year facts snapshot shared by all programs, and never touches boards
without `--apply`. `build --live` re-fetches every source and rewrites the facts snapshot first.

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

- Fetches `https://syllo-course-planner.vercel.app/api/board/mechanical_engineering_2027`.
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
- Offered semesters, weekly hours, credits and syllabus links come from TAU's
  official sources for the current academic year (TAU year code `2026` = תשפ"ז):

  ```bash
  python scripts/refresh_course_data.py            # fetch + review report (boards untouched)
  python scripts/refresh_course_data.py --apply --syllabi   # patch boards + rebuild stale summaries
  npm run build:board && npm run audit:board
  ```

  It writes `data/official/tau_course_facts_2026.json` (the snapshot
  `semester_board.py` also reads) and `data/import_reports/course_data_review_2026.md`
  (one row per mismatch). Courses IMS lists as not offered get
  `offered_in_year: false` and are excluded from planning. Bump `ACADEMIC_YEAR`
  in the script each year. `tests/test_board_data_integrity.py` fails when the
  committed boards drift from the snapshot.

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
