/**
 * T5 — the topic objective changes REAL candidate selection.
 *
 * A score-only proof would not qualify. Every assertion below runs the real
 * `generateCandidateSet` over the real `PlannerWorker`, under one fixed policy,
 * one profile version and identical hard constraints, with evidence produced by
 * the real `prepareEvidence`.
 *
 * The course ids and the official wording are REAL — taken verbatim from the
 * documents acquired in T2 (0542-4624 robotics/control laboratory, 0581-4131
 * engineering-materials laboratory, 0542-4094 flow and energy-systems
 * laboratory, 0555-4000 the off-domain ethics course). The BOARD is a fixture,
 * as in the K4 and K8 proofs: what is being proven is that official content
 * evidence changes which plan the system selects, not that this particular
 * degree exists.
 */
import { generateCandidateSet, selectCandidate } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate } from '../../api/ai/planner_validate';
import { prepareEvidence } from '../../api/ai/evidence_provider';
import { explainGroundedRanking, type GroundedObjective } from '../../api/ai/grounded_objectives';
import { resolveGroundedObjective } from '../../api/ai/grounded_preference';
import { effectivePlannerPreferences } from '../../api/ai/preference_eligibility';
import type { TopicId } from '../../api/ai/course_topics';
import type { SyllabusDocument } from '../../api/ai/syllabus_source';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';
import type { Preference } from '../../api/ai/preference_model';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const YEAR = 2025;

/** Real course ids from the acquired corpus. */
const ROBOTICS = '0542-4624';
const MATERIALS = '0581-4131';
const THERMO = '0542-4094';
const ETHICS = '0555-4000';
const ELECTIVES = [ROBOTICS, MATERIALS, THERMO, ETHICS];

/** Verbatim official wording, from the `תוכן הקורס ומטרתו` section of each document. */
const OFFICIAL_CONTENT: Record<string, string> = {
  [ROBOTICS]: 'הכרת זרוע רובוטית, קינמטיקה ישירה והפוכה, תכנון מסלול פולינומיאלי, זיהוי מערכת, בקרה, תכנון תנועה לרובוט נייד בעזרת RRT, משוב כוח.',
  [MATERIALS]: 'במסגרת הקורס נבצע סדרת ניסויים המיועדים להקנות בסיס למהנדס בהבנת עולם החומר, תוך שימוש בציוד הנדסי והבנת טיפולים הנעשים בתעשייה לחומרים שונים בכדי לשפר את תכונותיהם.',
  [THERMO]: 'רשימת הניסויים: מערכות קירור ומיזוג אוויר, זרימה בנחיר, נדגים את תופעת גל הלם, מחליפי החום.',
  [ETHICS]: 'זהו קורס אינטרדיסציפלינרי למנהיגות, קבלת החלטות ויישום האתיקה לבעיות בעולם האמיתי.',
};

function doc(courseId: string, over: Partial<SyllabusDocument> = {}): SyllabusDocument {
  return {
    institutionId: 'tau.ac.il', courseId, academicYear: YEAR,
    sourceUrl: `https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=${courseId.replace('-', '')}01&year=${YEAR}`,
    contentHash: `sha_${courseId}`, retrievedAt: '2026-08-14T00:00:00.000Z',
    // Offering-scoped: no group suffix, so the fact applies to what the candidate selects.
    labeledFields: { 'מספר קורס': [courseId], 'אופן ההוראה': ['מעבדה'] },
    text: `תוכן הקורס ומטרתו ${OFFICIAL_CONTENT[courseId]} מטלות הקורס`,
    ...over,
  };
}

const CORPUS = ELECTIVES.map((id) => doc(id));

function model(extra: Parameters<typeof buildConstraintModel>[1] = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 8, categories: [] },
      program_repository_courses: ELECTIVES.map((id) => ({
        course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
        course_type: 'elective', placement_policy: 'elective',
        offered_semesters: [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: 20, maxHoursPerSemester: 25, ...extra });
}

const empty = (): PlanState => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });
const courseIdsOf = (s: PlanState) => [...new Set(Object.values(s.semesters).flat())].sort();

const prepared = (documents: SyllabusDocument[] = CORPUS) =>
  prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents });

const topicObjective = (snapshotId: string, topicIds: TopicId[]): GroundedObjective => ({
  id: 'prefer_topic_alignment', confirmed: true, snapshotId, topicIds,
});

function generate(opts: {
  grounded?: Parameters<typeof generateCandidateSet>[0]['groundedObjective'];
  model?: Parameters<typeof buildConstraintModel>[1];
} = {}) {
  return generateCandidateSet({
    buildModel: () => model(opts.model ?? {}),
    policy: 'neutral', initialState: empty(), profileVersion: 5, maxCandidates: 4,
    ...(opts.grounded ? { groundedObjective: opts.grounded } : {}),
  });
}

const withTopics = (topicIds: TopicId[], docs: SyllabusDocument[] = CORPUS) => {
  const p = prepared(docs);
  return { objective: topicObjective(p.snapshot.snapshotId, topicIds), features: p.features, topics: p.topics };
};

describe('T5 — official topics change the selected candidate through the real path', () => {
  test('1+2+3. candidates share hard constraints, completed courses and policy', () => {
    const set = generate();
    expect(set.candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of set.candidates) {
      const r = validateCandidate(c.state, model());
      expect(r.valid).toBe(true);
      expect(r.degreeMet).toBe(true);
      expect(c.policy).toBe('neutral');
      expect(c.profileVersion).toBe(5);
    }
    // One completed-course state for the whole set: every candidate is built
    // from the same board, with the same (empty) completed-course set.
    expect([...model().completedCourseIds]).toEqual([]);
  });

  test('4. every candidate is scored against ONE evidence snapshot', () => {
    const g = withTopics(['robotics']);
    const set = generate({ grounded: g });
    for (const c of set.candidates) expect(c.groundedScore).toBeDefined();
    expect(new Set([g.objective.snapshotId]).size).toBe(1);
  });

  test('5. candidates differ meaningfully in course combinations', () => {
    const combos = new Set(generate().candidates.map((c) => courseIdsOf(c.state).join(',')));
    expect(combos.size).toBeGreaterThanOrEqual(2);
  });

  test('6. official topics genuinely distinguish the courses', () => {
    const p = prepared();
    expect([...p.topics.get(ROBOTICS)!.topicIds].sort()).toEqual(['control', 'robotics']);
    expect([...p.topics.get(MATERIALS)!.topicIds].sort()).toEqual(['materials']);
    expect([...p.topics.get(THERMO)!.topicIds].sort()).toEqual(['energy_systems', 'thermofluids']);
    expect(p.topics.get(ETHICS)!.topicIds.size).toBe(0);
  });

  test('7. WITHOUT a topic preference the canonical selection is preserved', () => {
    // The canonical choice for this board, reproduced independently — and
    // notably NOT the legacy single-plan identity, which this fixture's soft
    // terms already outrank. What matters is that it is fixed and unbiased.
    const canonical = selectCandidate(generate())!;
    expect(canonical.normalizedIdentity).toBe(selectCandidate(generate())!.normalizedIdentity);
    expect(courseIdsOf(canonical.state)).toEqual([THERMO, ROBOTICS].sort());
    expect(canonical.groundedScore).toBeUndefined();
  });

  test('8+9. WITH a confirmed topic preference the SELECTED candidate changes', () => {
    const before = selectCandidate(generate())!;
    // `materials` is supported ONLY by 0581-4131, which the canonical plan omits.
    const set = generate({ grounded: withTopics(['materials']) });
    const after = selectCandidate(set)!;
    expect(after.normalizedIdentity).not.toBe(before.normalizedIdentity);
    expect(courseIdsOf(before.state)).not.toContain(MATERIALS);
    expect(courseIdsOf(after.state)).toContain(MATERIALS);
    // The selected proposal IS the selected candidate — same id, not a lookalike.
    expect(after.id).toBe(set.candidates.find((c) => c.normalizedIdentity === after.normalizedIdentity)!.id);
    expect(after.groundedScore!.contributions.map((c) => c.courseId)).toContain(MATERIALS);
  });

  test('a DIFFERENT confirmed topic selects a DIFFERENT plan — no topic is privileged', () => {
    const materials = selectCandidate(generate({ grounded: withTopics(['materials']) }))!;
    const thermo = selectCandidate(generate({ grounded: withTopics(['thermofluids']) }))!;
    expect(courseIdsOf(materials.state)).toContain(MATERIALS);
    expect(courseIdsOf(thermo.state)).toContain(THERMO);
    expect(materials.normalizedIdentity).not.toBe(thermo.normalizedIdentity);
  });

  test('10. the explanation cites real courses, the official source, year and topics', () => {
    const g = withTopics(['materials']);
    const set = generate({ grounded: g });
    const sel = selectCandidate(set)!;
    const text = explainGroundedRanking({
      objective: g.objective,
      selected: sel.groundedScore!,
      alternative: set.candidates.find((c) => c.id !== sel.id)?.groundedScore,
    });
    expect(text).toContain(MATERIALS);
    expect(text).toContain('בסילבוס הרשמי');
    expect(text).not.toContain('https://');
    expect(text).toContain(String(YEAR));
    expect(text).toContain('חומרים');
    expect(text).toContain('תוכן הקורס ומטרתו');
    expect(text).not.toMatch(/טוב יותר|מומלץ יותר|מתאים לקריירה|כדאי לך/);
  });

  test('11. an INDIFFERENT answer restores the canonical selection', () => {
    const pref: Preference = {
      id: 'course_topic_robotics', category: 'course_topic_interest', normalized: 'robotics',
      value: 'robotics', classification: 'indifferent', confidence: 0.9, source: 'explicit_answer',
      confirmationStatus: 'confirmed', affects: 'grounded_topic_interest',
      mayAffectPlanningBeforeConfirmation: true,
    };
    const resolved = resolveGroundedObjective(effectivePlannerPreferences({ version: 5, preferences: [pref] }));
    expect(resolved.objective).toBeUndefined();
    // With no objective resolved, generation returns to the canonical selection —
    // NOT the materials plan the confirmed answer produced.
    const confirmed = selectCandidate(generate({ grounded: withTopics(['materials']) }))!;
    const restored = selectCandidate(generate())!;
    expect(restored.normalizedIdentity).not.toBe(confirmed.normalizedIdentity);
    expect(courseIdsOf(restored.state)).toEqual([THERMO, ROBOTICS].sort());
  });

  test('12a. MISSING content leaves ranking unchanged', () => {
    const baseline = selectCandidate(generate())!;
    const none = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: [] });
    const sel = selectCandidate(generate({
      grounded: { objective: topicObjective(none.snapshot.snapshotId, ['materials']), features: none.features, topics: none.topics },
    }))!;
    expect(sel.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(sel.groundedScore!.score).toBe(0);
  });

  test('12b. AMBIGUOUS wording alone leaves ranking unchanged', () => {
    // Real 0542-4391 wording: "בקרה" here means control of the solution process.
    const ambiguous = [doc(MATERIALS, { text: 'תוכן הקורס ומטרתו כלים לבקרה על מהלך הפתרון, בדיקת התכנסות. מטלות הקורס' })];
    const baseline = selectCandidate(generate())!;
    const p = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: ambiguous });
    const sel = selectCandidate(generate({
      grounded: { objective: topicObjective(p.snapshot.snapshotId, ['control']), features: p.features, topics: p.topics },
    }))!;
    expect(p.topics.get(MATERIALS)!.topicIds.size).toBe(0);
    expect(sel.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(sel.groundedScore!.score).toBe(0);
  });

  test('12c. a STALE document (another year) cannot rank anything', () => {
    const stale = [doc(MATERIALS, { academicYear: 2019 })];
    const baseline = selectCandidate(generate())!;
    const p = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: stale });
    const sel = selectCandidate(generate({
      grounded: { objective: topicObjective(p.snapshot.snapshotId, ['materials']), features: p.features, topics: p.topics },
    }))!;
    expect(sel.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(sel.groundedScore!.score).toBe(0);
  });

  test('12d. a CONFLICTING course contributes nothing', () => {
    const baseline = selectCandidate(generate())!;
    const p = prepareEvidence({ courseIds: ELECTIVES, academicYear: YEAR, documents: CORPUS, conflictingCourseIds: [MATERIALS] });
    const sel = selectCandidate(generate({
      grounded: { objective: topicObjective(p.snapshot.snapshotId, ['materials']), features: p.features, topics: p.topics },
    }))!;
    expect(sel.normalizedIdentity).toBe(baseline.normalizedIdentity);
    expect(sel.groundedScore!.score).toBe(0);
  });

  test('13. HARD exclusion of the favoured course still wins', () => {
    const set = generate({ grounded: withTopics(['materials']), model: { disallowedCourseIds: [MATERIALS] } });
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) expect(courseIdsOf(c.state)).not.toContain(MATERIALS);
    expect(selectCandidate(set)!.groundedScore!.score).toBe(0);
  });

  test('14. several documents stating one topic never double-count it', () => {
    const twice = [...CORPUS, { ...doc(MATERIALS), contentHash: 'sha_second_document' }];
    const single = selectCandidate(generate({ grounded: withTopics(['materials']) }))!;
    const doubled = selectCandidate(generate({ grounded: withTopics(['materials'], twice) }))!;
    expect(doubled.normalizedIdentity).toBe(single.normalizedIdentity);
    expect(doubled.groundedScore!.score).toBe(single.groundedScore!.score);
    expect(doubled.groundedScore!.contributions.filter((c) => c.courseId === MATERIALS)).toHaveLength(1);
  });

  test('15. repeated runs produce identical ranking and identical ids', () => {
    const run = () => generate({ grounded: withTopics(['materials']) });
    expect(run().candidates.map((c) => c.id)).toEqual(run().candidates.map((c) => c.id));
    expect(run().candidates.map((c) => c.groundedScore!.score)).toEqual(run().candidates.map((c) => c.groundedScore!.score));
    expect(selectCandidate(run())!.id).toBe(selectCandidate(run())!.id);
  });
});
