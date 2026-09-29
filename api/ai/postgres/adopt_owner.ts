import { ownerStorageKey } from '../owner_key';
import type { PlannerPostgresSql } from './postgres_planner_state';

/**
 * Copy an anonymous browser's durable planner state onto a signed-in account.
 *
 * Deterministic rule, per program: the ACCOUNT wins. A program the account
 * already has a board / academic context for is left untouched
 * (`ON CONFLICT DO NOTHING`); a program it lacks adopts this device's copy.
 * The anonymous rows are copied, never deleted. Proposals and apply receipts
 * are short-lived and rebuilt by the next Generate, so they are not carried over.
 */
export async function adoptOwnerState(
  sql: PlannerPostgresSql,
  fromOwnerId: string,
  toOwnerId: string,
): Promise<void> {
  const from = ownerStorageKey(fromOwnerId);
  const to = ownerStorageKey(toOwnerId);
  if (from === to) return;
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `INSERT INTO planner_boards (
         owner_hash, program_id, version_number, semesters_json, updated_at,
         last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
       )
       SELECT $2, program_id, version_number, semesters_json, updated_at,
              last_proposal_id, last_candidate_id, last_idempotency_key, last_applied_at
         FROM planner_boards WHERE owner_hash = $1
       ON CONFLICT (owner_hash, program_id) DO NOTHING`,
      [from, to],
    );
    await tx.unsafe(
      `INSERT INTO planner_academic_contexts (
         owner_hash, program_id, digest, personal_status_json,
         plan_context_json, preferences_json, updated_at
       )
       SELECT $2, program_id, digest, personal_status_json,
              plan_context_json, preferences_json, updated_at
         FROM planner_academic_contexts WHERE owner_hash = $1
       ON CONFLICT (owner_hash, program_id) DO NOTHING`,
      [from, to],
    );
  });
}
