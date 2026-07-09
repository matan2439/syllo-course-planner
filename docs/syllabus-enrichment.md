# Syllabus Enrichment Workflow

This documents how to (re-)run the syllabus content extraction pipeline,
push the result to Supabase, and verify it end-to-end. This is an **offline
data pipeline** — syllabus pages are fetched and parsed ahead of time, never
during an AI chat request.

## Overview

1. `app/pipeline/fetch_syllabus_summaries.py` fetches each course's
   `syllabus_url` (cached under `data/raw_html/syllabus/`), parses it with
   `app/parsing/syllabus_parser.py`, and builds a compact structured Hebrew
   summary via `app/parsing/syllabus_summary.py`. Results are merged into
   `data/parsed_json/mechanical_semester_board_2027.json`.
2. `scripts/update-board-json.mjs` pushes that local board JSON into
   Supabase's `program_versions.board_json` for a given program/year.
3. `/api/board/[programId]` serves `board_json` as-is, and
   `buildCourseContext()` / `buildPlanContext()` in
   `app/web/semester_board_viewer.html` surface the new fields to the AI.

## 1. Run syllabus enrichment for all courses

```bash
cd /c/Users/matan/tau-course-planner
python -m app.pipeline.fetch_syllabus_summaries \
  --board data/parsed_json/mechanical_semester_board_2027.json
```

Notes:
- Already-cached HTML under `data/raw_html/syllabus/` is reused and skipped.
  Pass `--force` to re-fetch (e.g. `--force --course 0542-3792`).
- A 1-second delay is applied between live fetches (not cached hits) to
  rate-limit requests to the TAU server.
- A failed/unparseable page sets `syllabus_text_available: false` and
  `syllabus_ai_analysis_status: "failed"` for that course — it does not stop
  the run.
- To limit to specific courses: `--course 0542-3792 --course 0542-4020`.

## 2. Update Supabase `program_versions.board_json`

The live `/api/board/[programId]` endpoint reads `board_json` from
**Supabase**, not from the local JSON file directly — so the update must be
pushed after every enrichment run.

### Place `.env.production.local` temporarily

`scripts/update-board-json.mjs` needs a valid `DATABASE_URL`. If you don't
already have one in `.env`, create `.env.production.local` in the project
root (it's gitignored) containing **either**:
- a standard `DATABASE_URL=postgresql://...` line, or
- just the raw `postgresql://...` connection string on its own.

```bash
cd /c/Users/matan/tau-course-planner
ENV_FILE=.env.production.local node scripts/update-board-json.mjs \
  mechanical_engineering 2027 data/parsed_json/mechanical_semester_board_2027.json
```

This runs a single targeted `UPDATE program_versions SET board_json = ...
WHERE program_id = ... AND academic_year = ...` — no schema changes, no
other rows/tables touched. Expect output `Rows updated: 1`.

### ⚠️ Delete `.env.production.local` after use

```bash
rm -f .env.production.local
```

Never commit this file or print its contents.

## 3. Verify the live API

```bash
curl -s "https://tau-course-planner.vercel.app/api/board/mechanical_engineering_2027" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for s in d['semesters']:
    for c in s['courses']:
        if c.get('syllabus_url'):
            print(c['course_id'], 'available=', c.get('syllabus_text_available'),
                  'has_summary=', bool(c.get('syllabus_summary_he')))
"
```

Confirm each course with `syllabus_url` shows `available=True` and
`has_summary=True`.

## 4. Test the course AI chat

Open https://tau-course-planner.vercel.app, open a course with a syllabus
(e.g. **0542-3792 — הנדסת ניסויים ומדידות - מעבדה**) and ask in the AI chat:

> מה דרישות הקדם של הקורס ומה עושים בו לפי הסילבוס?

The answer should cite the actual syllabus content (prerequisites, topics,
labs/reports) and must **not** say "הסילבוס זמין רק כקישור ללא תוכן מנותח"
or similar "no syllabus content" messages.

## Course topic-profile inference (deterministic, TS — the interest-eval supply side)

Separate from the offline syllabus pipeline above, `api/ai/course_topic_profile_inference.ts`
turns each catalog course (`courseId` + `nameHe` + `categoryId`) into a
`CourseTopicProfile` using **only explicit Hebrew/English keyword and category
rules** — no LLM, no syllabus-text mining. This is the supply side that
academic-interest evaluation matches a user's interests against
(`interest_course_match.ts` reads only the `topics`/`styles` weights).

Data-quality invariants worth keeping honest:

- **Hebrew substring false friends.** Rules match with `String.includes`, so a
  short keyword can hide inside an unrelated word. Prefer the **fuller phrase**
  when a bare token collides — e.g. maritime uses `'הנדסה ימית'`, not `'ימית'`
  (a substring of `'פנימית'`=internal and `'כימית'`=chemical), and manufacturing
  uses `'תהליכי עיבוד'`, not `'עיבוד'` (which would catch `'עיבוד אותות'`=signal
  processing). Note `'תכן'` (final nun ן) intentionally does **not** match
  `'תכנון'` (planning) — that's a feature, not a miss.
- **Honest `default`/`needs_review`.** A course with no confident topic area is
  `source: 'default'` with a `needs_review:` note — never a fabricated topic.
  In the ME-2027 catalog this is **21 of 68** courses; they are genuinely
  non-ME electives (EE / CS / operations research / ethics / space-systems) or
  unnamed board entries. That count only drops when real evidence supports it.
- **Current honest distribution:** 47 inferred / 21 default / 0 manual / 0
  syllabus. `tests/api/course_topic_profiles_static.test.ts` pins these so the
  numbers cannot silently drift.

## Run tests

```bash
cd /c/Users/matan/tau-course-planner && npm test
cd /c/Users/matan/tau-course-planner && npm run typecheck
cd /c/Users/matan/tau-course-planner && pytest tests/test_syllabus_summary.py
```

## Checklist

- [ ] Enriched count matches number of courses with `syllabus_url`
- [ ] No failed URLs (or failures listed and understood)
- [ ] Supabase update reported `Rows updated: 1`
- [ ] Live API response includes non-empty `syllabus_summary_he` for
      enriched courses
- [ ] AI chat no longer says the syllabus is unavailable for an enriched
      course
- [ ] `.env.production.local` deleted
