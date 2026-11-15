# Proposal: persistent AI planning sessions

**Status: APPROVED for Preview only (2026-11-14). NOT YET APPLIED: the Preview database refused the connection (password authentication failed for `postgres`), so nothing has been executed anywhere. Production is not authorized.**

The migration is now at `scripts/migrations/planner/003_planner_sessions.sql` (rollback: `003_planner_sessions.down.sql`) and is tested against PGlite. The feature is behind `AI_PLANNER_SESSIONS=true` (off by default) and degrades to the old transcript behaviour if the table is missing.

The SQL below is deliberately kept out of `scripts/migrations/` so it cannot be applied by accident. It moves there only after approval.

## 1. What is stored, and what is not

One row per student per program: the **active planning session**. It holds structured state, not a chat log.

| Kept | Not kept |
|---|---|
| Planning profile (priorities, specialization directions, free days), each marked stated / inferred and confirmed or not | The full conversation |
| Draft changes relative to the committed board (add / move / remove, with reason and whether the student accepted it) | A copy of the board |
| Courses the student released for change | Raw tool outputs |
| Decisions the student made (up to 40 short lines) | Anything after the session expires |
| The last 12 conversation turns and a running summary of everything older | |
| The pending question, if the assistant is waiting for an answer | |

The shape is already defined and tested in `shared/planner/planning-session.ts`. A session cannot exceed about 150 KB however long the student talks; 10–25 KB is expected.

## 2. Schema

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.planner_sessions (
  owner_hash         text        NOT NULL,
  program_id         text        NOT NULL,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revision           bigint      NOT NULL CHECK (revision > 0),
  base_board_version text,
  state_json         jsonb       NOT NULL,
  state_bytes        integer     NOT NULL CHECK (state_bytes BETWEEN 0 AND 200000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  PRIMARY KEY (owner_hash, program_id)
);

CREATE INDEX IF NOT EXISTS planner_sessions_expiry_idx ON public.planner_sessions (expires_at);
CREATE INDEX IF NOT EXISTS planner_sessions_user_idx   ON public.planner_sessions (user_id);

ALTER TABLE public.planner_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_sessions FROM PUBLIC, anon, authenticated;
-- No browser policies: only the verified server endpoints read or write this table.

COMMIT;
```

Relationships:

- `user_id → auth.users(id) ON DELETE CASCADE`. Deleting the account deletes its sessions with no change to the existing `delete_account` function.
- `(owner_hash, program_id)` is the same key the committed board (`planner_boards`) and the academic context (`planner_academic_contexts`) use, so one student's board, context and session line up one to one. There is no foreign key to those tables on purpose: a session may exist before a board is first saved.
- No existing table, column, index or row is changed.

## 3. Persisting and restoring

- **Read** at the start of each assistant turn. No row means a new session.
- **Write** once at the end of the turn, in a single statement guarded by `revision` (compare-and-swap). If two tabs race, the second write is refused and that turn reloads the session; nothing is merged blindly.
- **Interrupted turn**: nothing is written until the turn ends, so a timeout or a closed tab leaves the previous state intact. The student's own message is not lost: the client resends it.
- **Restore across devices**: the page asks for the session on load and shows the recent turns, the draft preview and any pending question.
- **Compaction**: when the 12-turn window overflows, the oldest turns are folded into the summary. That needs one short model call, only on overflow; it is charged to the student's credits like any other inference, through the existing metering.
- **Lifecycle**: `expires_at` is 90 days after the last update. An expired row is ignored on read, and the session endpoint deletes a small bounded batch of expired rows when it writes. No new scheduled task, and the billing reconciliation job is not touched. The student can also start a new session, which replaces the row.

## 4. Staying in step with the committed board

The session stores the board version its draft was built on (`base_board_version`).

- Same version: the draft is used as is.
- Different version (the student edited the board, or applied a proposal): the draft is **rebased** — `rebaseDraft` in `planning-session.ts`. A draft change the board has overtaken is dropped and reported to the student; the rest survive. The board always wins.
- Applying a proposal clears the draft changes it contained and keeps the profile and decisions.
- Committed courses stay locked. The session can only record which ones the student released; it never holds authority over the board.

## 5. Compatibility

- Additive only. Old code ignores the table; new code treats a missing row as a new session. Deploy order does not matter and either can be rolled back independently.
- The conversation endpoint keeps accepting the transcript the client sends today. During the transition the server prefers the stored session and falls back to the sent transcript when there is no row.
- The digest checks on academic status and preferences are unchanged. Preferences keep living in the academic context; the session's profile adds priorities that have no home today.
- Anonymous (signed-out) use is unaffected: AI replies already require sign-in, so every session has a `user_id`.

## 6. Security and privacy

- Row level security enabled with no policies, and all privileges revoked from `anon` and `authenticated` — the same posture as every other planner table. Only server endpoints, after verifying the Supabase session, touch the table.
- Rows are addressed by `owner_hash`, which is derived from the verified account id on the server; a client cannot name another student's session.
- The stored text is bounded: 12 recent turns and a summary. The privacy policy needs one added sentence saying recent assistant conversation and a summary are stored to continue planning, and are deleted with the account or after 90 days of inactivity. That wording needs your approval before release.
- Nothing is stored at the model provider beyond the request itself; the current "sent only to generate the answer" statement stays true.

## 7. Storage behaviour

| Students with an active session | Expected (15 KB each) | Ceiling (150 KB each) |
|---|---|---|
| 1,000 | 15 MB | 150 MB |
| 10,000 | 150 MB | 1.5 GB |

One row per student per program, removed after 90 idle days, so growth follows the number of active students, not the amount of conversation.

## 8. Risks

| Risk | Mitigation |
|---|---|
| A bug writes a malformed state | The server validates against the schema before every write and after every read; an unreadable row is treated as a new session and logged |
| Two tabs overwrite each other | `revision` compare-and-swap |
| A stale draft is applied to a changed board | Rebase on every turn, and the existing apply-time board-version check is unchanged |
| The summary drifts from what was said | Decisions and the profile are structured and authoritative; the summary is context only and never a source of constraints |
| Table grows unexpectedly | `state_bytes` check constraint, expiry index, one row per student per program |

## 9. Rollback

1. Turn the feature off (the endpoint falls back to the client-sent transcript, as today).
2. `DROP TABLE public.planner_sessions;` — nothing references it.

No existing data is touched at any step, so rollback cannot lose board, context, proposal or billing data.

## 10. Order of work after approval

1. Apply to **Preview** only; verify with test accounts.
2. Ship the store and endpoint changes behind a flag, off by default.
3. Enable in Preview, run the multi-turn scenarios (reload mid-conversation, board edited mid-session, two tabs, expiry).
4. Production migration and enablement on a separate, explicit approval.
