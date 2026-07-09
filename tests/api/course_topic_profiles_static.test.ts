/**
 * Full-catalog static Course Topic Profile seed — tests for
 * api/ai/course_topic_profiles_static.ts.
 *
 * getMechanicalEngineering2027TopicProfiles() builds a deterministic
 * courseId->CourseTopicProfile map covering EVERY course in the TAU Mechanical
 * Engineering 2027 catalog universe, by running the deterministic inference
 * rules over the committed catalog. It fabricates nothing beyond those
 * explicit rules and flags low-evidence courses as needs_review.
 *
 * This file also proves the end-to-end slice: full-catalog resolver -> 100%
 * coverage -> evaluateAcademicInterestFit over real catalog course ids.
 */

import {
  getMechanicalEngineering2027TopicProfiles,
  createMechanicalEngineering2027Resolver,
  summarizeCourseTopicProfileSources,
} from '../../api/ai/course_topic_profiles_static';
import { loadMechanicalEngineering2027Catalog } from '../../api/ai/course_catalog';
import { auditCourseTopicProfileCoverage } from '../../api/ai/course_topic_profile_coverage';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import { NEEDS_REVIEW_NOTE_PREFIX } from '../../api/ai/course_topic_profile_inference';
import { normalizeAcademicInterestProfile } from '../../api/ai/academic_interest_profile';
import { evaluateAcademicInterestFit } from '../../api/ai/academic_interest_evaluation';

const CATALOG_IDS = loadMechanicalEngineering2027Catalog().map((c) => c.courseId);

describe('getMechanicalEngineering2027TopicProfiles — full catalog integrity', () => {
  test('covers every unique catalog course id', () => {
    const map = getMechanicalEngineering2027TopicProfiles();
    for (const id of CATALOG_IDS) {
      expect(Object.prototype.hasOwnProperty.call(map, id)).toBe(true);
    }
    expect(Object.keys(map).length).toBe(CATALOG_IDS.length);
  });

  test('has no duplicate course ids (map size equals unique catalog size)', () => {
    const map = getMechanicalEngineering2027TopicProfiles();
    expect(new Set(CATALOG_IDS).size).toBe(CATALOG_IDS.length);
    expect(Object.keys(map).length).toBe(new Set(CATALOG_IDS).size);
  });

  test('every profile carries a courseId matching its map key', () => {
    const map = getMechanicalEngineering2027TopicProfiles();
    for (const [key, profile] of Object.entries(map)) {
      expect(profile.courseId).toBe(key);
    }
  });

  test('every profile is already normalized (re-normalizing is a no-op)', () => {
    const map = getMechanicalEngineering2027TopicProfiles();
    for (const profile of Object.values(map)) {
      expect(normalizeCourseTopicProfile(profile)).toEqual(profile);
    }
  });

  test('no profile carries a topic weight above 0.7 (no fabricated strong evidence)', () => {
    const map = getMechanicalEngineering2027TopicProfiles();
    for (const profile of Object.values(map)) {
      for (const t of profile.topics) expect(t.weight).toBeLessThanOrEqual(0.7);
    }
  });

  test('is deterministic: two calls return a deeply-equal map', () => {
    expect(getMechanicalEngineering2027TopicProfiles()).toEqual(getMechanicalEngineering2027TopicProfiles());
  });
});

describe('summarizeCourseTopicProfileSources — source distribution', () => {
  test('only inferred + default sources are used (no manual/syllabus this epic), summing to the full catalog', () => {
    const summary = summarizeCourseTopicProfileSources(getMechanicalEngineering2027TopicProfiles());
    expect(summary.manual).toBe(0);
    expect(summary.syllabus).toBe(0);
    expect(summary.inferred).toBeGreaterThan(0);
    expect(summary.default).toBeGreaterThan(0);
    expect(summary.inferred + summary.default).toBe(CATALOG_IDS.length);
  });

  test('honest distribution is pinned: 47 inferred, 21 default over the 68-course catalog', () => {
    // Data-quality regression pin. The 21 defaults are genuinely non-ME electives
    // (EE/CS/OR/ethics/space) or unnamed courses — no topic can be added without
    // fabrication, so the count must NOT silently drift.
    const summary = summarizeCourseTopicProfileSources(getMechanicalEngineering2027TopicProfiles());
    expect(summary).toEqual({ manual: 0, syllabus: 0, inferred: 47, default: 21 });
    expect(summary.inferred + summary.default).toBe(68);
  });

  test('0542-4131 (internal combustion engines) carries no fabricated fluids topic', () => {
    const profile = getMechanicalEngineering2027TopicProfiles()['0542-4131'];
    expect(profile.topics.map((t) => t.area)).not.toContain('fluids');
    // still an honest, evidenced inferred profile (combustion/energy)
    expect(profile.source).toBe('inferred');
    expect(profile.topics.map((t) => t.area)).toEqual(expect.arrayContaining(['thermal_systems', 'energy']));
  });

  test('needs_review count equals the number of default-source profiles', () => {
    const map = getMechanicalEngineering2027TopicProfiles();
    const summary = summarizeCourseTopicProfileSources(map);
    const needsReview = Object.values(map).filter((p) =>
      (p.notes ?? []).some((n) => n.startsWith(NEEDS_REVIEW_NOTE_PREFIX)),
    ).length;
    expect(needsReview).toBe(summary.default);
    expect(needsReview).toBeGreaterThan(0);
  });
});

describe('full-catalog coverage audit', () => {
  test('the static seed reaches 100% coverage over the canonical catalog', () => {
    const resolver = createMechanicalEngineering2027Resolver();
    const audit = auditCourseTopicProfileCoverage(CATALOG_IDS, resolver);
    expect(audit.totalCourseIds).toBe(CATALOG_IDS.length);
    expect(audit.missingCourseIds).toEqual([]);
    expect(audit.coverageRatio).toBe(1);
  });
});

describe('end-to-end evaluateAcademicInterestFit over resolved full-catalog profiles', () => {
  test('real catalog planned courses all resolve (none reported unmatched)', () => {
    const resolver = createMechanicalEngineering2027Resolver();
    const planned = ['0542-4120', '0542-4320', '0542-4223']; // thermo, fluid mechanics, FEM
    const { profilesByCourseId } = resolver.resolveCourseTopicProfiles(planned);
    const evaluation = evaluateAcademicInterestFit({
      academicInterestProfile: normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] }),
      courseTopicProfilesByCourseId: profilesByCourseId,
      plannedCourseIds: planned,
    });
    expect(evaluation.unmatchedCourseIds).toEqual([]);
    expect(evaluation.evaluatedCourseIds.sort()).toEqual([...planned].sort());
  });

  test('a fluids-focused interest surfaces fluids as a matched focus area in the scorecard', () => {
    const resolver = createMechanicalEngineering2027Resolver();
    const planned = ['0542-4320']; // מכניקת הזורמים (2)
    const { profilesByCourseId } = resolver.resolveCourseTopicProfiles(planned);
    const evaluation = evaluateAcademicInterestFit({
      academicInterestProfile: normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] }),
      courseTopicProfilesByCourseId: profilesByCourseId,
      plannedCourseIds: planned,
    });
    expect(evaluation.scorecard.matchedFocusAreas.map((g) => g.area)).toContain('fluids');
    expect(evaluation.hasMeaningfulAcademicInterests).toBe(true);
  });

  test('a planned course id absent from the catalog is reported unmatched (not fabricated)', () => {
    const resolver = createMechanicalEngineering2027Resolver();
    const planned = ['0542-4320', 'NOT-A-REAL-COURSE'];
    const { profilesByCourseId } = resolver.resolveCourseTopicProfiles(planned);
    const evaluation = evaluateAcademicInterestFit({
      academicInterestProfile: normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] }),
      courseTopicProfilesByCourseId: profilesByCourseId,
      plannedCourseIds: planned,
    });
    expect(evaluation.unmatchedCourseIds).toEqual(['NOT-A-REAL-COURSE']);
    expect(evaluation.evaluatedCourseIds).toEqual(['0542-4320']);
  });

  test('a needs_review/default course contributes no focus-area alignment (honest, weak)', () => {
    const resolver = createMechanicalEngineering2027Resolver();
    const planned = ['0555-4000']; // אתיקה מעשית — no confident topic area
    const profile = resolver.resolveCourseTopicProfile('0555-4000');
    expect(profile?.source).toBe('default');
    const { profilesByCourseId } = resolver.resolveCourseTopicProfiles(planned);
    const evaluation = evaluateAcademicInterestFit({
      academicInterestProfile: normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] }),
      courseTopicProfilesByCourseId: profilesByCourseId,
      plannedCourseIds: planned,
    });
    expect(evaluation.scorecard.matchedFocusAreas).toEqual([]);
    expect(evaluation.alignment.interestAlignmentScore).toBe(0);
  });
});
