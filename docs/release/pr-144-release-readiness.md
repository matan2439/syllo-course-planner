# PR #144 — release readiness (assessment of 2026-11-16)

Status: **Preview not yet fully validated.** One configuration blocker (below). No Production change has been made.

## 1. Preview deployment facts

| Item | Value |
|---|---|
| Preview URL (branch alias) | `https://syllo-course-planner-git-claud-370fd6-matanyaron-1633s-projects.vercel.app` (Vercel sign-in required) |
| Latest verified build | `700be5325a2fc99f9f5144703bf27a37915f9797`, source `git`, environment Preview, state READY |
| `AI_PLANNER_SESSIONS` | Active in the Preview build (the session view reports `read_error`, not `flag_off`) |
| Auth, billing, workspace database (`DATABASE_URL`) | `syllo-preview` (`ddgpnjskzntlcagkrzgl`), confirmed by a pooler connection seen in that project at the time of the request |
| **Planner state database** | **NOT `syllo-preview`.** `SYLLO_PLANNER_DATABASE_URL` takes precedence over `DATABASE_URL` for planner storage. In Preview it points at a Neon database (`neondb`, project `neon-citron-fence`) that has the planner tables but not `planner_sessions`, so the session read fails with `relation "planner_sessions" does not exist`. |

Isolation: that Neon database is not Production's. Production planner state lives in the Production Supabase project (13 boards / 54 contexts, written today); the Neon database holds 15 boards / 120 contexts, last written 2026-11-06. The code's isolation guard only recognises the Production Supabase ref, so it cannot tell a Neon URL from a Preview one. See "Hardening" below.

## 2. Blocker and the two ways out (needs a decision)

- **A (recommended):** remove or repoint the Preview-scoped `SYLLO_PLANNER_DATABASE_URL`, so Preview planner state follows `DATABASE_URL` → `syllo-preview`, where `planner_sessions` already exists and was verified. Preview planner data currently in Neon (test data from before 6 Nov) would no longer be read by Preview.
- **B:** keep Neon for Preview planner state and apply a Neon variant of the migration. Not recommended: the migration references `auth.users(id)` (a Supabase schema Neon does not have), so it would need a different table design, and Preview would keep a different planner database from Preview auth.

## 3. Test results (no model, no billable calls)

| Check | Result |
|---|---|
| API suite | 3113 passed, 1 skipped |
| Web suite | 635 passed |
| Python parser suite | 15 passed (full local pytest needs `psycopg2`; CI runs it) |
| Type check (API and web) | clean |
| CI on PR head | green (API tests, Next.js build, Python tests) |
| Persistence scenarios on real Postgres + real migration SQL (PGlite) | reload, draft persistence, accepted/rejected suggestions, board edited between turns, two concurrent tabs (one wins, one conflicts), reset, expiry, signed-out owners — all pass |
| Migration in `syllo-preview` | applied, RLS on, no policies, no browser-role privileges, constraints and cascade verified, rollback ready |
| Deployed app, end to end | **not done**: blocked by section 2; needs a signed-in Preview session, and any real model turn needs separate authorization |

## 4. What launches immediately and what stays behind flags

| Feature | Recommendation |
|---|---|
| Strict locking of committed placements, partial-plan transparency | Ship (no flag; covered by regression tests) |
| Offering status (confirmed / projected / unavailable / unknown) | Ship |
| Shadow prerequisite audit and equivalences (incl. inferred Materials Science, Mechanical only) | Ship in shadow mode; **strict enforcement stays off** |
| Persistent AI sessions | Ship the code **disabled**: `AI_PLANNER_SESSIONS` is unset in Production, and the code degrades to today's behaviour without the table. Enable only after the Production steps in section 6 |

## 5. Review summary

- Compatibility: every change is additive; with the flag off, behaviour matches today's. No existing table, column or row changes.
- Security: new table has RLS on, no policies, no browser privileges; rows addressed by a server-derived owner hash; only `auth:` accounts get sessions; size bounded (200 KB constraint, ~150 KB schema cap), 90-day expiry; session view endpoint exposes only a public project ref and variable names when sessions are off (never a password or URL).
- Hardening to add (not yet done): the isolation guard should also refuse a non-Supabase planner URL in Production unless explicitly allowed, and Preview should assert that the planner database ref equals the Preview project's ref. Recommended before enabling sessions in Production.
- Known data issue unchanged: `0542-2600` vs `0542-2500` same-semester inconsistency (shadow mode only).

## 6. Steps and approvals needed for Production

1. Decide section 2 (A or B) and complete Preview validation.
2. **Approval needed:** apply `scripts/migrations/planner/003_planner_sessions.sql` to the Production Supabase project (`lxwtycowmqosuyfumcbo`). Not required for the code to ship with the flag off.
3. **Approval needed:** privacy-policy text (below) published first.
4. **Approval needed:** merge PR #144 into `main` (deploys the code to Production with sessions off).
5. **Approval needed:** set `AI_PLANNER_SESSIONS=true` for Production (only after 2–4), confirm the session view reports `enabled:true`, then watch logs.
6. Rollback: unset the flag (instant), or `003_planner_sessions.down.sql`; redeploy the previous Production deployment if needed.

## 7. Privacy-policy wording (Hebrew, for approval — `web/app/privacy/page.tsx`, not yet edited)

Add under "איזה מידע נשמר":

> שיחה עם עוזר התכנון: כשאתם מחוברים לחשבון, נשמרים כדי להמשיך את התכנון מאותה נקודה — העדפות ועדיפויות שציינתם, שינויים מוצעים בטיוטה, החלטות שקיבלתם, 12 ההודעות האחרונות וסיכום קצר של ההודעות הקודמות. לא נשמר העתק מלא של השיחה. המידע נמחק אוטומטית אחרי 90 ימים ללא פעילות, בלחיצה על "שיחה חדשה", ובמחיקת החשבון.

Add under "למה משתמשים במידע" (extending the OpenAI sentence):

> ההודעות האחרונות והסיכום השמור נשלחים לספק מודל ה-AI (OpenAI) יחד עם בקשתכם, רק כדי לייצר את התשובה.

The existing line about credit records ("בלי תוכן השיחה") remains accurate. Update the "last updated" date when published.
