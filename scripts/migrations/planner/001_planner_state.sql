BEGIN;

CREATE TABLE IF NOT EXISTS planner_schema_versions (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planner_boards (
  owner_hash text NOT NULL,
  program_id text NOT NULL,
  version_number bigint NOT NULL CHECK (version_number > 0),
  semesters_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_proposal_id text,
  last_candidate_id text,
  last_idempotency_key text,
  last_applied_at timestamptz,
  PRIMARY KEY (owner_hash, program_id)
);

CREATE TABLE IF NOT EXISTS planner_apply_receipts (
  owner_hash text NOT NULL,
  program_id text NOT NULL,
  idempotency_key text NOT NULL,
  proposal_id text NOT NULL,
  candidate_id text NOT NULL,
  produced_version_number bigint NOT NULL CHECK (produced_version_number > 0),
  committed_board_json jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_hash, program_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS planner_academic_contexts (
  owner_hash text NOT NULL,
  program_id text NOT NULL,
  digest text NOT NULL,
  personal_status_json jsonb NOT NULL,
  plan_context_json jsonb NOT NULL,
  preferences_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_hash, program_id)
);

CREATE TABLE IF NOT EXISTS planner_proposals (
  proposal_id text PRIMARY KEY,
  owner_hash text NOT NULL,
  program_id text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  superseded_by text,
  base_board_version text,
  profile_version integer NOT NULL,
  academic_status_digest text NOT NULL,
  constraint_fingerprint text NOT NULL,
  snapshot_id text NOT NULL,
  recommended_candidate_id text,
  outcome text NOT NULL,
  apply_eligible boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_proposals_owner_program_created_idx
  ON planner_proposals (owner_hash, program_id, created_at DESC);

CREATE INDEX IF NOT EXISTS planner_proposals_current_idx
  ON planner_proposals (owner_hash, program_id)
  WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS planner_proposal_candidates (
  proposal_id text NOT NULL REFERENCES planner_proposals(proposal_id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  semesters_json jsonb NOT NULL,
  normalized_identity text NOT NULL,
  valid boolean NOT NULL,
  applyable boolean NOT NULL,
  recommended boolean NOT NULL,
  PRIMARY KEY (proposal_id, candidate_id)
);

INSERT INTO planner_schema_versions (version) VALUES (1)
ON CONFLICT (version) DO NOTHING;

COMMIT;
