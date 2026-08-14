/**
 * T4 — the typed course-content/topic-interest preference, and the ONE boundary
 * that maps it to a grounded planner objective.
 *
 * The engine must stay generic: no topic is privileged, and the current user's
 * interests are never hard-coded. A topic id is a valid INPUT here (unlike the
 * delivery-feature path, where the internal objective id is not), because the
 * topic vocabulary is the shared, evidence-derived language between the profile
 * and the evidence — but only ids the mapper can actually ground are accepted.
 */
import { resolveGroundedObjective } from '../../api/ai/grounded_preference';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import { scoreCandidateOnObjective, explainGroundedRanking, type GroundedObjective } from '../../api/ai/grounded_objectives';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import { TOPIC_IDS, type TopicId } from '../../api/ai/course_topics';
import type { Preference } from '../../api/ai/preference_model';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';

const YEAR = 2025;

const topicPref = (topic: string, over: Partial<Preference> = {}): Preference => ({
  id: `course_topic_${topic}`, category: 'course_topic_interest', normalized: topic, value: topic,
  classification: 'soft_preference', confidence: 0.9, source: 'explicit_answer',
  confirmationStatus: 'confirmed', affects: 'grounded_topic_interest',
  mayAffectPlanningBeforeConfirmation: true, ...over,
});

const resolve = (p: Preference[], version = 5) =>
  resolveGroundedObjective(effectivePlannerPreferences({ version, preferences: p }));

/** An OFFERING-scoped official document whose content section carries `content`. */
function doc(courseId: string, content: string): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${courseId}&year=${YEAR}`,
    contentHash: `sha_${courseId}`, retrievedAt: '2026-08-14T00:00:00.000Z',
    labeledFields: { 'מספר קורס': [`0542-30${courseId.slice(1)}`], 'אופן ההוראה': ['שיעור'] },
    text: `תוכן הקורס ומטרתו ${content} מטלות הקורס`,
  };
}

// ── the preference contract ──────────────────────────────────────────────────

describe('T4 — the typed topic-interest preference', () => {
  test('a confirmed topic interest resolves to the topic-alignment objective', () => {
    const r = resolve([topicPref('robotics')]);
    expect(r.objective).toBe('prefer_topic_alignment');
    expect(r.topicIds).toEqual(['robotics']);
    expect(r.provenance).toMatchObject({ preferenceId: 'course_topic_robotics', source: 'explicit_answer', profileVersion: 5 });
  });

  test('several confirmed topics are carried together, deduplicated and sorted', () => {
    const r = resolve([topicPref('robotics'), topicPref('control'), topicPref('robotics', { id: 'dup' })]);
    expect(r.topicIds).toEqual(['control', 'robotics']);
  });

  test.each([
    ['indifferent', { classification: 'indifferent' as const }],
    ['uncertain', { classification: 'uncertain' as const, mayAffectPlanningBeforeConfirmation: false }],
    ['unconfirmed', { confirmationStatus: 'unconfirmed' as const, mayAffectPlanningBeforeConfirmation: false }],
  ])('%s never activates the topic objective', (_l, over) => {
    expect(resolve([topicPref('robotics', over)]).objective).toBeUndefined();
  });

  test('a topic the mapper cannot ground is reported, never approximated', () => {
    const r = resolve([topicPref('quantum_computing')]);
    expect(r.objective).toBeUndefined();
    expect(r.excluded).toEqual([{ id: 'course_topic_quantum_computing', value: 'quantum_computing', reason: 'unsupported_grounded_topic' }]);
  });

  test('the preference stays SOFT — it can never become a hard constraint', () => {
    const eff = effectivePlannerPreferences({ version: 5, preferences: [topicPref('robotics', { classification: 'hard_constraint' })] });
    // Even classified hard, the mapping yields only the same soft objective and
    // no legality output exists on this path at all.
    const r = resolveGroundedObjective(eff);
    expect(r.objective).toBe('prefer_topic_alignment');
    expect(r).not.toHaveProperty('mustInclude');
    expect(r).not.toHaveProperty('disallowedCourseIds');
  });

  test('a confirmed DELIVERY feature still takes precedence, deterministically', () => {
    const feature: Preference = {
      id: 'course_feature_practical', category: 'course_feature', normalized: 'practical_laboratory',
      value: 'practical_laboratory', classification: 'soft_preference', confidence: 0.9,
      source: 'explicit_answer', confirmationStatus: 'confirmed', affects: 'grounded_course_feature',
      mayAffectPlanningBeforeConfirmation: true,
    };
    expect(resolve([topicPref('robotics'), feature]).objective).toBe('prefer_laboratory_courses');
    expect(resolve([feature, topicPref('robotics')]).objective).toBe('prefer_laboratory_courses');
  });

  test('the engine hard-codes no particular topic — every vocabulary id resolves', () => {
    for (const t of TOPIC_IDS) expect(resolve([topicPref(t)]).topicIds).toEqual([t]);
  });
});

// ── scoring semantics ────────────────────────────────────────────────────────

describe('T4 — topic scoring counts affirmative evidence only', () => {
  const CORPUS = [
    doc('E1', 'הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, זיהוי מערכת.'),      // robotics + control
    doc('E2', 'תהליכי ייצור ועיבוד שבבי.'),                                     // manufacturing
    doc('E3', 'הקורס עוסק בקבלת החלטות ובאתיקה מקצועית.'),                      // nothing
  ];
  const prepared = () => prepareEvidence({ courseIds: ['E1', 'E2', 'E3'], academicYear: YEAR, documents: CORPUS });

  const objective = (topicIds: TopicId[], snapshotId: string): GroundedObjective => ({
    id: 'prefer_topic_alignment', confirmed: true, snapshotId, topicIds,
  });

  test('prepareEvidence exposes topics on the SAME snapshot as features', () => {
    const p = prepared();
    expect([...p.topics.get('E1')!.topicIds].sort()).toEqual(['control', 'robotics']);
    expect([...p.topics.get('E2')!.topicIds]).toEqual(['manufacturing']);
    expect(p.topics.get('E3')!.topicIds.size).toBe(0);
    // Provenance travels with the fact, so an explanation never re-derives it.
    expect(p.topics.get('E1')!.sourceRef).toContain('ims.tau.ac.il');
    expect(p.topics.get('E1')!.academicYear).toBe(YEAR);
    expect(p.coverage.topicUnknownCourseIds).toEqual(['E3']);
  });

  test('a course supporting a requested topic contributes, with provenance', () => {
    const p = prepared();
    const s = scoreCandidateOnObjective(['E1'], objective(['robotics'], p.snapshot.snapshotId), p.features, p.topics);
    expect(s.score).toBe(1);
    expect(s.contributions[0]).toMatchObject({ courseId: 'E1', feature: 'topic', topicId: 'robotics' });
    expect(s.contributions[0].sourceRef).toContain('ims.tau.ac.il');
    expect(s.contributions[0].academicYear).toBe(YEAR);
  });

  test('a course with NO topic evidence adds zero and is disclosed, never penalised', () => {
    const p = prepared();
    const alone = scoreCandidateOnObjective(['E1'], objective(['robotics'], p.snapshot.snapshotId), p.features, p.topics);
    const withUnknown = scoreCandidateOnObjective(['E1', 'E3'], objective(['robotics'], p.snapshot.snapshotId), p.features, p.topics);
    expect(withUnknown.score).toBe(alone.score);
    expect(withUnknown.unknownCourseIds).toEqual(['E3']);
  });

  test('a course covering a topic the user did NOT name adds nothing', () => {
    const p = prepared();
    expect(scoreCandidateOnObjective(['E2'], objective(['robotics'], p.snapshot.snapshotId), p.features, p.topics).score).toBe(0);
  });

  test('one course covering TWO requested topics counts both', () => {
    const p = prepared();
    expect(scoreCandidateOnObjective(['E1'], objective(['robotics', 'control'], p.snapshot.snapshotId), p.features, p.topics).score).toBe(2);
  });

  test('repeated wording and a second document never double-count one topic', () => {
    const repeated = doc('E1', 'זרוע רובוטית, רובוטיקה, רובוט נייד, קינמטיקה.');
    const twice = prepareEvidence({
      courseIds: ['E1'], academicYear: YEAR,
      documents: [repeated, { ...repeated, contentHash: 'sha_E1_second' }],
    });
    const s = scoreCandidateOnObjective(['E1'], objective(['robotics'], twice.snapshot.snapshotId), twice.features, twice.topics);
    expect(s.score).toBe(1);
    expect(s.contributions).toHaveLength(1);
  });

  test('with no topic index at all the objective is inert, not an error', () => {
    const p = prepared();
    const s = scoreCandidateOnObjective(['E1'], objective(['robotics'], p.snapshot.snapshotId), p.features);
    expect(s.score).toBe(0);
  });

  test('scoring is deterministic and order-independent', () => {
    const p = prepared();
    const o = objective(['robotics', 'control'], p.snapshot.snapshotId);
    expect(scoreCandidateOnObjective(['E1', 'E2'], o, p.features, p.topics))
      .toEqual(scoreCandidateOnObjective(['E2', 'E1'], o, p.features, p.topics));
  });
});

// ── explanation ──────────────────────────────────────────────────────────────

describe('T4 — the explanation is factual and cites the official source', () => {
  const CORPUS = [doc('E1', 'הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה.'), doc('E3', 'קבלת החלטות ואתיקה.')];
  const p = () => prepareEvidence({ courseIds: ['E1', 'E3'], academicYear: YEAR, documents: CORPUS });

  test('it names the courses, the official source and the year', () => {
    const prep = p();
    const o: GroundedObjective = { id: 'prefer_topic_alignment', confirmed: true, snapshotId: prep.snapshot.snapshotId, topicIds: ['robotics'] };
    const text = explainGroundedRanking({
      objective: o,
      selected: scoreCandidateOnObjective(['E1', 'E3'], o, prep.features, prep.topics),
    });
    expect(text).toContain('E1');
    expect(text).toContain('ims.tau.ac.il');
    expect(text).toContain(String(YEAR));
  });

  test('it discloses the coverage limit and makes no superiority claim', () => {
    const prep = p();
    const o: GroundedObjective = { id: 'prefer_topic_alignment', confirmed: true, snapshotId: prep.snapshot.snapshotId, topicIds: ['robotics'] };
    const text = explainGroundedRanking({
      objective: o,
      selected: scoreCandidateOnObjective(['E1', 'E3'], o, prep.features, prep.topics),
    });
    expect(text).toMatch(/לא נמצא|לא קיימת|לא פורסם/);
    expect(text).not.toMatch(/טוב יותר|קל יותר|מומלץ יותר|מתאים לקריירה/);
  });

  test('with nothing supported it says so plainly', () => {
    const prep = p();
    const o: GroundedObjective = { id: 'prefer_topic_alignment', confirmed: true, snapshotId: prep.snapshot.snapshotId, topicIds: ['thermofluids'] };
    const text = explainGroundedRanking({ objective: o, selected: scoreCandidateOnObjective(['E3'], o, prep.features, prep.topics) });
    expect(text).toMatch(/לא נמצאה עדות רשמית/);
  });
});
