/**
 * Workload-aware load balancing (client mirror of api/ai/completion_analysis.ts).
 *
 * Extracts repairPlanLoad and its balance helpers from the viewer source and
 * runs them in isolation (no jsdom) to assert:
 *   - a FLEXIBLE mandatory course is moved out of an overloaded semester to a
 *     lighter legal one (and the source drops to <= the hard cap when possible),
 *   - a FIXED mandatory course is never moved,
 *   - within a tier, the HEAVIER course (higher workload_score) is shed first,
 *   - a flexible-mandatory move is logged with is_mandatory + a Hebrew note,
 *   - a course restricted to its current semester (no legal target) is reported,
 *     so prerequisite/allowed-semester constraints are respected by the mover.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');

function loadRepair() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  // Extract a top-level `function NAME(...) { ... }` by brace-matching from its
  // declaration to the closing brace at column 0 — robust to nested braces.
  const grab = (name) => {
    const decl = `function ${name}(`;
    const start = html.indexOf(decl);
    if (start === -1) throw new Error(`${name} not found in viewer`);
    const braceOpen = html.indexOf('{', start);
    let depth = 0;
    for (let i = braceOpen; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) return html.slice(start, i + 1);
      }
    }
    throw new Error(`${name}: unbalanced braces`);
  };
  const helpers = [
    'function _normalizeSemId(id) { return (id || "").replace(/(_[ab])\\d+$/, "$1"); }',
    'function _formatSemIdHe(id) { return _normalizeSemId(id); }',
    grab('getSemesterLoadLocal'),
    grab('isAnnualCourse'),
    grab('_isMovableForBalance'),
    grab('_isElectiveLike'),
    grab('_isFlexibleMandatory'),
    grab('_balanceTier'),
    grab('_balanceWeight'),
    grab('repairPlanLoad'),
  ].join('\n\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${helpers}\nreturn repairPlanLoad;`);
  return factory();
}

const repairPlanLoad = loadRepair();
const ctx = (courses, extra = {}) => ({ courses, maxHoursPerSemester: 20, ...extra });

describe('client repairPlanLoad — workload-aware balancing', () => {
  test('moves a FLEXIBLE mandatory course out of a 27h semester to a lighter legal one', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['M1', 'MF'] }, // fixed 12 + flexible mandatory 15 = 27
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      M1: { hours: 12, placement_policy: 'fixed', course_type: 'mandatory', effective_allowed_semesters: ['s1'] },
      MF: { hours: 15, placement_policy: 'flexible', course_type: 'mandatory', effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal, ctx(courses));
    expect(result.repaired).toBe(true);
    const s1 = result.proposal.semesters.find(s => s.semester_id === 's1');
    const s2 = result.proposal.semesters.find(s => s.semester_id === 's2');
    expect(s2.course_ids).toContain('MF');
    const s1Hours = s1.course_ids.reduce((sum, c) => sum + courses[c].hours, 0);
    expect(s1Hours).toBeLessThanOrEqual(20);
  });

  test('does NOT move a FIXED mandatory course', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['MFX'] },
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      MFX: { hours: 25, placement_policy: 'fixed', course_type: 'mandatory', effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal, ctx(courses));
    expect(result.repaired).toBe(false);
    expect(result.unmovedOverloaded[0].not_movable_reasons)
      .toEqual([{ course_id: 'MFX', reason: 'fixed_mandatory' }]);
  });

  test('prefers shedding the HEAVIER same-tier candidate (higher workload_score)', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['E_LIGHT', 'E_HEAVY'] }, // 12 + 12 = 24
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      E_LIGHT: { hours: 12, course_type: 'elective', workload_score: 2, effective_allowed_semesters: ['s1', 's2'] },
      E_HEAVY: { hours: 12, course_type: 'elective', workload_score: 5, effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal, ctx(courses));
    const s2 = result.proposal.semesters.find(s => s.semester_id === 's2');
    expect(s2.course_ids).toEqual(['E_HEAVY']);
  });

  test('logs is_mandatory + a Hebrew note when a flexible mandatory is moved', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['M1', 'MF'] },
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      M1: { hours: 12, placement_policy: 'fixed', course_type: 'mandatory', effective_allowed_semesters: ['s1'] },
      MF: { hours: 15, name_he: 'מבוא לרובוטיקה', placement_policy: 'flexible', course_type: 'mandatory', effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal, ctx(courses));
    const entry = result.moveLog.find(m => m.accepted && m.course_id === 'MF');
    expect(entry).toBeDefined();
    expect(entry.is_mandatory).toBe(true);
    expect(entry.reason).toContain('קורס חובה גמיש');
    expect(entry.reason).toContain('מבוא לרובוטיקה');
  });

  test('does not move a course with no legal target (restricted allowed semesters)', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['MF'] }, // 25h, but only allowed in s1
        { semester_id: 's2', course_ids: [] },
      ],
    };
    const courses = {
      MF: { hours: 25, placement_policy: 'flexible', course_type: 'mandatory', effective_allowed_semesters: ['s1'] },
    };
    const result = repairPlanLoad(proposal, ctx(courses));
    expect(result.repaired).toBe(false);
    const s1 = result.proposal.semesters.find(s => s.semester_id === 's1');
    expect(s1.course_ids).toEqual(['MF']);
    expect(result.unmovedOverloaded[0].not_movable_reasons)
      .toEqual([{ course_id: 'MF', reason: 'no_legal_target' }]);
  });

  // Annual courses (e.g. 0542-3792 הנדסת ניסויים ומדידות - מעבדה) span A+B and
  // must NOT be moved or split out of either spanned semester by the balancer.
  test('does NOT move/split an annual course out of an overloaded semester', () => {
    const proposal = {
      semesters: [
        { semester_id: 's1', course_ids: ['ANN', 'MF'] }, // annual 8 + flexible 20 = 28h
        { semester_id: 's2', course_ids: ['ANN'] },        // annual present in both spans
      ],
    };
    const courses = {
      ANN: {
        hours: 8, is_annual: true, placement_policy: 'annual', course_type: 'mandatory',
        spans_semesters: ['s1', 's2'], count_hours_once: true,
        effective_allowed_semesters: ['s1', 's2'],
      },
      MF: { hours: 20, placement_policy: 'flexible', course_type: 'mandatory', effective_allowed_semesters: ['s1', 's2'] },
    };
    const result = repairPlanLoad(proposal, ctx(courses));
    const s1 = result.proposal.semesters.find(s => s.semester_id === 's1');
    const s2 = result.proposal.semesters.find(s => s.semester_id === 's2');
    // Annual course stays in BOTH semesters; never moved or removed.
    expect(s1.course_ids).toContain('ANN');
    expect(s2.course_ids).toContain('ANN');
    // The flexible non-annual course is the one that gets shed instead.
    expect(result.moveLog.some(m => m.accepted && m.course_id === 'ANN')).toBe(false);
  });
});
