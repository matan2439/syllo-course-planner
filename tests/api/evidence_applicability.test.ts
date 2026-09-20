/**
 * K7.5 — evidence APPLICABILITY: course / offering / section scope.
 *
 * Derived directly from the live K7 result: course 0542-3792 in year 2025 has
 * `laboratory=true` for group 05 and `laboratory=false` for group 01. The
 * planner selects a course and a period, never a group — so a section-level fact
 * must NOT be attributed to a course-level candidate.
 *
 * The first test is the RED regression for exactly that.
 */
import { prepareEvidence } from '../../api/ai/evidence_provider';
import {
  aggregateCourseLevelFeature,
  groupIdOfDocument,
  type ScopedFeatureValue,
} from '../../api/ai/feature_applicability';
import { scoreCandidateOnObjective, type GroundedObjective } from '../../api/ai/grounded_objectives';
import { RuleBasedFeatureExtractor } from '../../api/ai/course_features';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const YEAR = 2025;
const COURSE = '0542-3792';

/** A document exactly as the live endpoint returns one, for a given group. */
function doc(group: string, delivery: string, over: Partial<SyllabusDocument> = {}): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il',
    courseId: COURSE,
    academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=05423792${group}&year=${YEAR}`,
    contentHash: `sha_${group}_${delivery}`,
    retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [`${COURSE}-${group}`], 'אופן ההוראה': [delivery] },
    text: `אופן ההוראה ${delivery}`,
    ...over,
  };
}

// The exact live pair.
const LAB_GROUP_05 = doc('05', 'מעבדה');
const LECTURE_GROUP_01 = doc('01', 'שיעור');

const objective: GroundedObjective = {
  id: 'prefer_laboratory_courses', confirmed: true, snapshotId: 'snap_test',
};

// ── the RED regression from the live finding ─────────────────────────────────

describe('K7.5 RED — the live mixed-group case must not label the course', () => {
  test('group 05 laboratory=true + group 01 laboratory=false ⇒ course level is NOT true', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR,
      documents: [LAB_GROUP_05, LECTURE_GROUP_01],
    });
    const feature = prepared.features.get(COURSE);
    // The course-level value must express ambiguity, never inherit one group.
    expect(feature?.laboratory.value).not.toBe(true);
    expect(['varies_by_section', 'unknown']).toContain(String(feature?.laboratory.value));
  });

  test('an unsectioned candidate is NOT rewarded by one favourable group', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR,
      documents: [LAB_GROUP_05, LECTURE_GROUP_01],
    });
    const score = scoreCandidateOnObjective([COURSE], objective, prepared.features);
    expect(score.score).toBe(0);
    expect(score.contributions).toEqual([]);
  });

  test('an unsectioned candidate is NOT penalised by one unfavourable group either', () => {
    const mixed = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR, documents: [LAB_GROUP_05, LECTURE_GROUP_01],
    });
    const none = prepareEvidence({ courseIds: [COURSE], academicYear: YEAR, documents: [] });
    // Identical influence: mixed evidence is exactly as inert as no evidence.
    expect(scoreCandidateOnObjective([COURSE], objective, mixed.features).score)
      .toBe(scoreCandidateOnObjective([COURSE], objective, none.features).score);
  });

  test('the arbitrary "first" or "lowest" group never decides the course value', () => {
    const forward = prepareEvidence({ courseIds: [COURSE], academicYear: YEAR, documents: [LAB_GROUP_05, LECTURE_GROUP_01] });
    const reversed = prepareEvidence({ courseIds: [COURSE], academicYear: YEAR, documents: [LECTURE_GROUP_01, LAB_GROUP_05] });
    expect(String(forward.features.get(COURSE)?.laboratory.value))
      .toBe(String(reversed.features.get(COURSE)?.laboratory.value));
  });
});

// ── scope extraction ─────────────────────────────────────────────────────────

describe('K7.5 — evidence scope', () => {
  test('the group/section id is read from the official document itself', () => {
    expect(groupIdOfDocument(LAB_GROUP_05)).toBe('05');
    expect(groupIdOfDocument(LECTURE_GROUP_01)).toBe('01');
  });

  test('a document with no group marker has no section identity', () => {
    const noGroup = doc('05', 'מעבדה', { labeledFields: { 'אופן ההוראה': ['מעבדה'] } });
    expect(groupIdOfDocument(noGroup)).toBeUndefined();
  });

  test('the prepared evidence records the observed groups and the scope', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR, documents: [LAB_GROUP_05, LECTURE_GROUP_01],
    });
    expect(prepared.coverage.variesBySectionCourseIds).toEqual([COURSE]);
  });
});

// ── aggregation rules ────────────────────────────────────────────────────────

describe('K7.5 — safe aggregation', () => {
  const agg = (
    docs: Array<{ groupId?: string; value: true | false | 'unknown' }>,
    groupUniverse?: string[],
  ) => aggregateCourseLevelFeature({ observations: docs, ...(groupUniverse ? { groupUniverse } : {}) });

  test('ALL groups true AND complete authoritative coverage ⇒ course-level true', () => {
    const r = agg([{ groupId: '01', value: true }, { groupId: '02', value: true }], ['01', '02']);
    expect(r.value).toBe(true);
    expect(r.universeKnown).toBe(true);
  });

  test('ALL groups true but INCOMPLETE coverage ⇒ unknown, never true', () => {
    const r = agg([{ groupId: '01', value: true }], ['01', '02', '03']);
    expect(r.value).toBe('unknown');
    expect(r.reason).toMatch(/incomplete/);
  });

  test('ALL groups true but the universe is UNKNOWN ⇒ unknown', () => {
    expect(agg([{ groupId: '01', value: true }]).value).toBe('unknown');
  });

  test('ALL groups false AND complete coverage ⇒ course-level false', () => {
    expect(agg([{ groupId: '01', value: false }, { groupId: '02', value: false }], ['01', '02']).value).toBe(false);
  });

  test('ALL groups false but incomplete coverage ⇒ unknown, never false', () => {
    expect(agg([{ groupId: '01', value: false }], ['01', '02']).value).toBe('unknown');
  });

  test('MIXED true/false ⇒ varies_by_section, even with complete coverage', () => {
    const r = agg([{ groupId: '05', value: true }, { groupId: '01', value: false }], ['01', '05']);
    expect(r.value).toBe('varies_by_section');
  });

  test('a missing/failed group acquisition is never read as false', () => {
    // Only group 01 was acquired; 02 and 03 failed. That is incomplete, not false.
    const r = agg([{ groupId: '01', value: false }], ['01', '02', '03']);
    expect(r.value).toBe('unknown');
    expect(r.value).not.toBe(false);
  });

  test('an unknown feature among observations keeps the result unknown', () => {
    expect(agg([{ groupId: '01', value: true }, { groupId: '02', value: 'unknown' }], ['01', '02']).value).toBe('unknown');
  });

  test('no observations at all ⇒ unknown', () => {
    expect(agg([]).value).toBe('unknown');
  });

  test('aggregation is deterministic under observation reordering', () => {
    const a = agg([{ groupId: '05', value: true }, { groupId: '01', value: false }], ['01', '05']);
    const b = agg([{ groupId: '01', value: false }, { groupId: '05', value: true }], ['05', '01']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('a course-scope observation (no group) resolves on its own', () => {
    // A document that is not group-addressed describes the offering itself.
    expect(agg([{ value: true }]).value).toBe(true);
    expect(agg([{ value: false }]).value).toBe(false);
  });
});

// ── applicability of the wrong year / group ──────────────────────────────────

describe('K7.5 — inapplicable evidence never contributes', () => {
  test('evidence for another academic year is not applicable', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR,
      documents: [doc('05', 'מעבדה', { academicYear: 2019, contentHash: 'sha_old' })],
    });
    expect(prepared.coverage.staleCourseIds).toEqual([COURSE]);
    expect(scoreCandidateOnObjective([COURSE], objective, prepared.features).score).toBe(0);
  });

  test('complete-coverage TRUE at course level does contribute — the rule is not vacuous', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR,
      documents: [doc('01', 'מעבדה'), doc('02', 'מעבדה')],
      groupUniverse: { [COURSE]: ['01', '02'] },
    });
    expect(prepared.features.get(COURSE)?.laboratory.value).toBe(true);
    expect(scoreCandidateOnObjective([COURSE], objective, prepared.features).score).toBe(1);
  });
});

// ── the extractor still reports SECTION-level truth faithfully ───────────────

describe('K7.5 — section-level facts are retained, not destroyed', () => {
  test('the per-document extraction is unchanged — group 05 really is a laboratory', () => {
    const extractor = new RuleBasedFeatureExtractor();
    expect(extractor.extract(LAB_GROUP_05).laboratory.value).toBe(true);
    expect(extractor.extract(LECTURE_GROUP_01).laboratory.value).toBe(false);
  });

  test('aggregation only governs the COURSE-level view used for ranking', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR, documents: [LAB_GROUP_05, LECTURE_GROUP_01],
    });
    // Section facts remain available for a future section-selecting planner.
    expect(prepared.sectionFeatures?.get(COURSE)?.length).toBe(2);
    const values = prepared.sectionFeatures!.get(COURSE)!.map((s) => `${s.groupId}:${s.laboratory}`).sort();
    expect(values).toEqual(['01:false', '05:true']);
  });
});

// ── explanation must not generalize ──────────────────────────────────────────

describe('K7.5 — the explanation never generalizes one group to the course', () => {
  test('varies_by_section is never described as "the course includes a laboratory"', () => {
    const prepared = prepareEvidence({
      courseIds: [COURSE], academicYear: YEAR, documents: [LAB_GROUP_05, LECTURE_GROUP_01],
    });
    const score = scoreCandidateOnObjective([COURSE], objective, prepared.features);
    // Nothing is contributed, so nothing can be claimed about the course.
    expect(score.contributions).toEqual([]);
    expect(score.variesBySectionCourseIds).toEqual([COURSE]);
  });
});

export type { ScopedFeatureValue };
