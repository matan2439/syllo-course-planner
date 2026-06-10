# Current Production State — 2026-06-10

## Recent Updates (since 2026-05-30)

Five follow-up fixes hardened the AI assistant endpoint:
- Fixed AI panel hanging on stalled/failed responses
- Fixed Vercel Node runtime streaming for `/api/ai/course-planner`
- Fixed AI request payload validation
- Added a dev mode for AI that avoids paid model calls
- Fixed empty AI responses on Anthropic billing/auth errors and quota DB error handling

These were incremental robustness fixes — overall architecture and "What Works Now" below are unchanged.


## Live URLs

| URL | Status |
|---|---|
| https://tau-course-planner.vercel.app | ✅ Board viewer loads from Supabase |
| https://tau-course-planner.vercel.app/api/board/mechanical_engineering_2027 | ✅ Returns board JSON (161 KB) |
| https://tau-course-planner.vercel.app/api/ai/course-planner | ✅ AI assistant endpoint (streaming) |

---

## Current Architecture

```
Browser
  │
  │  HTTPS
  ▼
Vercel (tau-course-planner.vercel.app)
  ├─ / → app/web/semester_board_viewer.html   (static, 162 KB)
  ├─ /api/board/:programId → api/board.ts     (Node.js serverless)
  └─ /api/ai/course-planner → api/ai/course-planner.ts  (Node.js serverless + streaming)
          │
          │  SQL (pooled, port 6543)
          ▼
    Supabase Postgres
      program_versions.board_json  ← 161 KB pre-computed board snapshot
      courses (75 rows)
      grade_stats (767 rows from Arazim TAU Refactor)
      program_courses (68 rows, incl. 12 mandatory)
      course_categories (5 rows)
      + 11 other tables (seeded, ready for future features)
```

**Python pipeline** runs locally only. It generates board data, seeds Supabase, and is not deployed.

---

## How to Run Locally

### Full stack (API + viewer, reads from Supabase)

```bash
# Requires DATABASE_URL and ANTHROPIC_API_KEY in .env
npx vercel dev
# → http://localhost:3000
# Console: [board] source: api | program: mechanical_engineering_2027 | repo: 56
```

### Static fallback (no database)

```bash
python -m http.server 8080
# → http://localhost:8080/app/web/semester_board_viewer.html
# Console: [board] source: static-json | program: mechanical_engineering_2027 | repo: 56
```

### Python data pipeline

```bash
# Activate venv, then:
python -m pytest                              # 1136 tests
python -m app.pipeline.generate_2027_board   # regenerate board JSON
python -m app.pipeline.seed_postgres         # reseed Supabase
python -m app.grades.arazim_importer --all-2027  # refresh grade data
alembic upgrade head                          # apply DB migrations
```

---

## How to Deploy

```bash
# Set env vars in Vercel dashboard first (DATABASE_URL, ANTHROPIC_API_KEY)
vercel --prod
```

Or push to `master` — Vercel auto-deploys if GitHub is connected.

See `docs/vercel-deployment.md` for the full deployment guide.

---

## What Works Now

| Feature | Status | Notes |
|---|---|---|
| Board viewer (drag-drop, categories, prereqs) | ✅ | Full semester planning UI |
| Board data served from Supabase | ✅ | Via `/api/board/:programId` |
| Static JSON fallback | ✅ | Works with `python -m http.server` |
| AI course assistant (sidebar) | ✅ | Streams from `claude-3-5-sonnet` |
| AI course detail panel | ✅ | Per-course questions with context |
| Grade statistics display | ✅ | Arazim TAU Refactor data (767 rows) |
| Difficulty scoring | ✅ | 4-factor model, grade signal integrated |
| Prerequisite checking | ✅ | Visual warnings on blocked courses |
| Dark mode / theme | ✅ | Persisted in localStorage |
| Program picker | ✅ | 3 programs (2027 PDF, 2025 legacy, biomedical) |
| Postgres schema | ✅ | 17 tables, all seeded for ME 2027 |
| CI workflow | ✅ | GitHub Actions: Python + TS + Next.js build |
| Vercel deployment | ✅ | `framework: null` + rewrites |

---

## Known Limitations

### Data coverage

- **Single active program in Postgres**: Only `mechanical_engineering_2027` has `board_json` in Supabase. The 2025 programs load from gitignored local JSON files — they work locally but not in cloud.
- **Board snapshot is static**: The board JSON is pre-computed by the Python pipeline. There is no live rebuild on deploy. Run `seed_postgres.py` after any pipeline update.
- **Grade data coverage**: 767 grade-stat rows covering ~56 ME 2027 courses from Arazim. Data is unofficial and may not reflect the most recent academic year.

### Infrastructure

- **Python pipeline is local-only**: TAU IMS scraping, GraphQL fetches, Arazim import, board generation, and DB seeding all run on a developer machine. No automated cloud ingestion yet.
- **No user accounts yet**: Course plans are stored in `localStorage`. There is no login, no plan persistence across devices, and no per-user data in Postgres (users/plans tables are in the schema but empty).
- **No auth on API routes**: `/api/board/*` and `/api/ai/*` are public — no rate limiting or authentication.

### Technical

- **Alembic runs locally**: DB migrations must be run manually with `DIRECT_DATABASE_URL`. There is no automated migration on deploy.
- **`data/parsed_json/` is gitignored**: Static JSON fallback files are not in the Vercel deployment. In cloud, `DATABASE_URL` must be set.
- **Single Vercel project for everything**: `api/` TypeScript functions and `app/web/` static files share one deployment. The Next.js skeleton in `web/` is not deployed yet.
- **`framework: null` workaround**: Required to prevent Vercel from detecting the Python pipeline as a FastAPI application (Vercel CLI Windows path bug with `vc_init_dev.py`).

---

## Next Recommended Milestones

These are listed roughly in priority order. None are blocking the current working state.

### Step 4 — Read-only Next.js board page
Port the board viewer from the 162 KB monolith HTML to Next.js React components in `web/`. Feature-parity first; ship the Next.js page at the same URL.

### Step 5 — More programs in Postgres
Seed the 2025 programs so they also load from the API in cloud. Update `seed_postgres.py` to handle multiple program versions.

### Step 6 — Plan persistence (database)
Move user plan state from `localStorage` to Postgres (`user_course_plans`, `plan_courses`). Requires auth (Step 7).

### Step 7 — Auth (Supabase Auth or NextAuth.js)
Add sign-in so plans are tied to users and work across devices.

### Step 8 — Automated data ingestion
Schedule GitHub Actions workflows to run the Arazim grade import and board regeneration weekly, pushing updated data to Supabase automatically.

### Step 9 — AI tools with live Postgres data
Connect the AI assistant to Postgres via Vercel AI SDK tool calls so it can answer questions with live course data rather than the condensed board snapshot.

### Step 10 — Vercel production hardening
Rate limiting on API routes, environment variable validation at startup, Sentry/error tracking, preview deployments for PRs.
