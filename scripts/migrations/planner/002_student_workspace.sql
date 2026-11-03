-- Additive student feature tables. Does not change the proven planner schema/version.
BEGIN;
CREATE TABLE IF NOT EXISTS public.student_workspace_documents (
  owner_hash text NOT NULL,
  scope_key text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  payload_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_hash,scope_key)
);
CREATE TABLE IF NOT EXISTS public.student_bidding_observations (
  owner_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id text NOT NULL,
  academic_year integer NOT NULL CHECK(academic_year BETWEEN 2000 AND 2200),
  semester smallint NOT NULL CHECK(semester IN (1,2)),
  round smallint NOT NULL CHECK(round BETWEEN 1 AND 20),
  kind text NOT NULL CHECK(kind IN ('course','bundle')),
  course_id text NOT NULL DEFAULT '',
  group_key text NOT NULL,
  points integer CHECK(points BETWEEN 0 AND 1000000000),
  initial_points integer NOT NULL CHECK(initial_points BETWEEN 0 AND 1000000000),
  bundle_signature text NOT NULL DEFAULT '',
  outcome text NOT NULL CHECK(outcome IN ('accepted','rejected','other_group','canceled')),
  rejection_reason text NOT NULL DEFAULT '',
  contributed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_hash,program_id,academic_year,semester,round,kind,course_id,group_key,bundle_signature)
);
CREATE INDEX IF NOT EXISTS student_bidding_history_idx ON public.student_bidding_observations(program_id,semester,round,academic_year);
ALTER TABLE public.student_workspace_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_bidding_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_workspace_documents FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.student_bidding_observations FROM PUBLIC,anon,authenticated;
-- No browser policies: verified server endpoints own all access. Account FK cascades erase personal data.
COMMIT;
