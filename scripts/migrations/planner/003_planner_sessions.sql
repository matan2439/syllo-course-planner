-- Persistent AI planning sessions: ONE row per student per program holding structured state
-- (profile, draft changes, decisions, rolling window + summary) — never a full chat log.
-- Additive: no existing table, column or row changes. Spec: docs/proposals/planner-sessions-migration.md
-- Rollback: 003_planner_sessions.down.sql
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
