import {
  PostgresProposalStore,
  type PlannerProposalSql,
  type PlannerProposalTransaction,
} from '../../api/ai/postgres/postgres_proposal_store';
import type { ProposalRecord, StoredCandidate } from '../../api/ai/proposal_store';

type Row = Record<string, unknown>;

class ProposalSqlDouble implements PlannerProposalSql, PlannerProposalTransaction {
  proposals = new Map<string, Row>();
  candidates = new Map<string, Row[]>();
  boundValues: unknown[] = [];
  failCandidateId?: string;

  async begin<T>(fn: (sql: PlannerProposalTransaction) => Promise<T>): Promise<T> {
    const proposals = structuredClone(this.proposals);
    const candidates = structuredClone(this.candidates);
    try {
      return await fn(this);
    } catch (error) {
      this.proposals = proposals;
      this.candidates = candidates;
      throw error;
    }
  }

  async unsafe(query: string, parameters: readonly unknown[] = []): Promise<Row[]> {
    this.boundValues.push(...parameters);
    if (query.includes('INSERT INTO planner_proposals')) {
      const [proposalId, ownerHash, programId, createdAt, expiresAt, supersededBy,
        baseBoardVersion, profileVersion, academicDigest, fingerprint, snapshotId,
        recommendedId, outcome, applyEligible] = parameters;
      this.proposals.set(String(proposalId), {
        proposal_id: proposalId, owner_hash: ownerHash, program_id: programId,
        created_at: new Date(Number(createdAt)), expires_at: new Date(Number(expiresAt)),
        superseded_by: supersededBy, base_board_version: baseBoardVersion,
        profile_version: profileVersion, academic_status_digest: academicDigest,
        constraint_fingerprint: fingerprint, snapshot_id: snapshotId,
        recommended_candidate_id: recommendedId, outcome, apply_eligible: applyEligible,
      });
      return [];
    }
    if (query.includes('INSERT INTO planner_proposal_candidates')) {
      const [proposalId, candidateId, semesters, identity, valid, applyable, recommended] = parameters;
      if (candidateId === this.failCandidateId) throw new Error('candidate insert failed');
      const rows = this.candidates.get(String(proposalId)) ?? [];
      rows.push({
        proposal_id: proposalId, candidate_id: candidateId,
        semesters_json: JSON.parse(String(semesters)), normalized_identity: identity,
        valid, applyable, recommended,
      });
      this.candidates.set(String(proposalId), rows);
      return [];
    }
    if (query.includes('UPDATE planner_proposals')) {
      const [supersededBy, ownerHash, programId, currentId] = parameters;
      for (const row of this.proposals.values()) {
        if (row.owner_hash === ownerHash && row.program_id === programId
          && row.proposal_id !== currentId && row.superseded_by == null) {
          row.superseded_by = supersededBy;
        }
      }
      return [];
    }
    if (query.includes('FROM planner_proposals') && !query.includes('planner_proposal_candidates')) {
      const row = this.proposals.get(String(parameters[0]));
      return row && row.owner_hash === parameters[1] ? [structuredClone(row)] : [];
    }
    if (query.includes('FROM planner_proposal_candidates')) {
      return structuredClone(this.candidates.get(String(parameters[0])) ?? [])
        .sort((a, b) => String(a.candidate_id).localeCompare(String(b.candidate_id)));
    }
    throw new Error(`Unexpected query: ${query}`);
  }
}

const candidate = (id: string, recommended = false): StoredCandidate => ({
  candidateId: id,
  semesters: [{ semesterId: 'A', courseIds: [`course_${id}`] }],
  normalizedIdentity: `identity_${id}`,
  valid: true,
  applyable: true,
  recommended,
});

const proposal = (id: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord => ({
  proposalId: id,
  ownerId: 'A'.repeat(43),
  programId: 'mechanical_engineering_2027',
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_007_200_000,
  baseBoardVersion: 'bv_3',
  profileVersion: 4,
  academicStatusDigest: 'as_123',
  constraintFingerprint: 'constraints_123',
  snapshotId: 'snapshot_123',
  candidates: [candidate('B'), candidate('A', true)],
  recommendedCandidateId: 'A',
  outcome: 'alternatives',
  applyEligible: true,
  ...overrides,
});

describe('PostgresProposalStore', () => {
  test('round-trips the exact authoritative proposal and stable candidate set across instances', async () => {
    const sql = new ProposalSqlDouble();
    const input = proposal('prop_first');
    await new PostgresProposalStore(sql).put(input);

    const loaded = await new PostgresProposalStore(sql).get(input.proposalId, input.ownerId);

    expect(loaded).toEqual({ ...input, candidates: [candidate('A', true), candidate('B')] });
    expect(sql.boundValues).not.toContain(input.ownerId);
    expect(await new PostgresProposalStore(sql).get(input.proposalId, 'B'.repeat(43))).toBeNull();
    expect(await new PostgresProposalStore(sql).get(input.proposalId)).toBeNull();
  });

  test('supersedes only older proposals for the same owner and program', async () => {
    const sql = new ProposalSqlDouble();
    const store = new PostgresProposalStore(sql);
    await store.put(proposal('prop_old'));
    await store.put(proposal('prop_other_owner', { ownerId: 'B'.repeat(43) }));
    await store.put(proposal('prop_other_program', { programId: 'electrical_engineering_2027' }));
    await store.put(proposal('prop_new'));

    expect((await store.get('prop_old', 'A'.repeat(43)))?.supersededBy).toBe('prop_new');
    expect((await store.get('prop_other_owner', 'B'.repeat(43)))?.supersededBy).toBeUndefined();
    expect((await store.get('prop_other_program', 'A'.repeat(43)))?.supersededBy).toBeUndefined();
    expect((await store.get('prop_new', 'A'.repeat(43)))?.supersededBy).toBeUndefined();
  });

  test('rolls back the proposal when any candidate insert fails', async () => {
    const sql = new ProposalSqlDouble();
    sql.failCandidateId = 'B';
    const store = new PostgresProposalStore(sql);

    await expect(store.put(proposal('prop_partial'))).rejects.toThrow('candidate insert failed');
    expect(await store.get('prop_partial', 'A'.repeat(43))).toBeNull();
  });
});
