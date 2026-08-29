import { randomUUID } from 'crypto';
import postgres from 'postgres';
import { createPostgresPlannerState } from '../../api/ai/postgres/postgres_planner_state';
import { ownerStorageKey } from '../../api/ai/owner_key';

const databaseUrl = process.env.SYLLO_PLANNER_DATABASE_URL;
const describeReal = databaseUrl ? describe : describe.skip;

const identity = (semesters: Array<{ semesterId: string; courseIds: string[] }>) => {
  const pairs = semesters.flatMap((semester) =>
    semester.courseIds.map((courseId) => [courseId, semester.semesterId] as [string, string]));
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return JSON.stringify(pairs);
};

describeReal('isolated Preview Neon planner contract', () => {
  jest.setTimeout(30_000);
  const suffix = randomUUID();
  const ownerId = `real-owner-${suffix}`;
  const otherOwnerId = `other-owner-${suffix}`;
  const programId = `real-program-${suffix}`;
  const proposalId = `prop_${suffix}`;
  const candidateId = `cand_${suffix}`;
  const semesters = [{ semesterId: 'semester_a', courseIds: ['course_a'] }];
  const sql = databaseUrl ? postgres(databaseUrl, { max: 2 }) : null;
  const state = sql ? createPostgresPlannerState(sql as any) : null;

  afterAll(async () => {
    if (!sql) return;
    const ownerHashes = [ownerStorageKey(ownerId), ownerStorageKey(otherOwnerId)];
    await sql.unsafe('DELETE FROM planner_apply_receipts WHERE owner_hash = ANY($1::text[])', [ownerHashes]);
    await sql.unsafe('DELETE FROM planner_boards WHERE owner_hash = ANY($1::text[])', [ownerHashes]);
    await sql.unsafe('DELETE FROM planner_academic_contexts WHERE owner_hash = ANY($1::text[])', [ownerHashes]);
    await sql.unsafe('DELETE FROM planner_proposals WHERE proposal_id = $1', [proposalId]);
    await sql.end();
  });

  test('context, proposal, atomic Apply and replay survive independent adapters', async () => {
    await state!.ensureSchemaCurrent();
    await state!.academicContextStore.put({
      ownerId, programId, digest: 'as_real', personalStatus: { completed: [] },
      planContext: { personal_status: { completed: [] }, semesters: [] }, preferences: {},
    });
    await state!.proposalStore.put({
      proposalId, ownerId, programId, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      baseBoardVersion: null, profileVersion: 2, academicStatusDigest: 'as_real',
      constraintFingerprint: 'cf_real', snapshotId: 'snapshot_real',
      candidates: [{
        candidateId, semesters, normalizedIdentity: identity(semesters),
        valid: true, applyable: true, recommended: true,
      }],
      recommendedCandidateId: candidateId, outcome: 'proposal', applyEligible: true,
    });

    expect(await state!.academicContextStore.load(ownerId, programId)).toEqual(
      expect.objectContaining({ digest: 'as_real' }),
    );
    expect(await state!.proposalStore.get(proposalId, ownerId)).toEqual(
      expect.objectContaining({
        proposalId,
        recommendedCandidateId: candidateId,
        candidates: [expect.objectContaining({ candidateId, semesters })],
      }),
    );

    const request = {
      ownerId, programId, proposalId, candidateId, expectedBoardVersion: null,
      expectedProfileVersion: 2, expectedAcademicStatusDigest: 'as_real',
      idempotencyKey: `idem_${suffix}`, now: Date.now(),
      validateStoredCandidate: async () => ({ valid: true, constraintFingerprint: 'cf_real' }),
    };
    const applied = await state!.authoritativeApplyStore.apply(request);
    expect(applied).toEqual(expect.objectContaining({ ok: true, replayed: false }));
    expect(await state!.boardRepository.load(ownerId, programId)).toEqual(
      expect.objectContaining({ version: 'bv_1', semesters }),
    );
    expect(await state!.boardRepository.load(otherOwnerId, programId)).toBeNull();
    expect(await state!.authoritativeApplyStore.apply(request)).toEqual(
      expect.objectContaining({ ok: true, replayed: true }),
    );
  });
});
