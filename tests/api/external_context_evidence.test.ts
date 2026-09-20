/**
 * External-context layer: WHY a capability is relevant to a goal, sourced from an
 * authoritative external body with provenance. It links goal → capability and must
 * NEVER assert that a particular course teaches the capability (that is the
 * course-knowledge layer's job — kept strictly separate).
 */
import {
  getExternalContextEvidence,
  EXTERNAL_CONTEXT_CACHE,
  type ExternalContextEvidence,
} from '../../api/ai/external_context_evidence';

describe('external contextual evidence (cached, authoritative, provenance-carrying)', () => {
  test('there is a real goal→capability relationship for engineering design, with authoritative provenance', () => {
    const rels = getExternalContextEvidence('engineering_design');
    expect(rels.length).toBeGreaterThan(0);
    const r = rels[0];
    expect(r.goalOrContext).toBe('engineering_design');
    expect(r.capability).toBeTruthy();
    expect(r.relationship).toBe('relevant_to');
    expect(r.sourceUrl).toMatch(/^https:\/\//);
    expect(r.publisher).toBeTruthy();
    expect(r.publishedOrUpdatedAt).toBeTruthy();
    expect(r.retrievedAt).toBeTruthy();
    expect(r.extractedEvidence).toBeTruthy();
    expect(r.confidence).toBeGreaterThan(0);
  });

  test('external context NEVER carries a course id — it cannot claim a course teaches a capability', () => {
    for (const r of EXTERNAL_CONTEXT_CACHE as ExternalContextEvidence[]) {
      expect(r).not.toHaveProperty('courseId');
      expect(JSON.stringify(r)).not.toMatch(/\b0\d{3}-\d{4}\b/); // no TAU course id anywhere in the record
    }
  });

  test('an unknown goal returns no fabricated relationships', () => {
    expect(getExternalContextEvidence('some_unlisted_goal_xyz')).toEqual([]);
  });
});
