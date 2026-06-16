/**
 * Issue 2 — EXHAUSTIVE auto-fill of missing degree hours BEFORE the gate blocks.
 *
 * The real shipped repairAddHoursToDegreeLocal is grabbed from the HTML in
 * isolation (matching the repo's UI-test convention) together with the helper
 * functions it depends on, then exercised directly to assert:
 *   - it fills legal, eligible, load-respecting candidates up to the required total;
 *   - a candidate violating legality (no legal semester) is NOT added;
 *   - a candidate violating the load cap is NOT added (load-respecting);
 *   - when the pool can complete the degree, the proposal reaches required hours;
 *   - when the pool CANNOT complete the degree, it reports exhaustion + the
 *     reason machinery (no_legal_semester / candidates exhausted) the build
 *     pipeline turns into a targeted missing-hours chat message.
 *
 * The build-pipeline wiring (re-run after eligibility/legal post-filters, and
 * the deferred degreeHoursStatusFinal blocker + targeted exhaustion reason) is
 * asserted by source-substring checks, mirroring the existing convention.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function grab(name) {
  const decl = `function ${name}(`;
  const start = html.indexOf(decl);
  if (start < 0) throw new Error(`${name} not found`);
  const braceOpen = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name}: unbalanced braces`);
}

// Assemble the real fill function with its real scoring/picking dependencies.
const sandbox = `
  const DEFAULT_MAX_HOURS_PER_SEMESTER = 20;
  const MAX_ADDED_ELECTIVES_FOR_HOURS = 12;
  const DEFAULT_ADDED_ELECTIVES_WHEN_PRIOR_HOURS_UNKNOWN = 6;
  const DEFAULT_WEAK_RELEVANCE_REASON = 'weak';
  const WEAK_MATCH_FILLER_REASON = 'filler';
  // No general (שער רוח) requirement in these fixtures → null short-circuits the
  // gate so generic electives may be added immediately.
  function getGeneralRequirementStatusReportLocal() { return null; }
  // Relevance/scoring is irrelevant to the legality/load/exhaustion behavior
  // under test — stub with neutral scores so candidate ORDER is stable and the
  // real legality + load + gap logic in repairAddHoursToDegreeLocal is exercised.
  function _scoreCareerRelevanceLocal() { return { score: 0, reason: DEFAULT_WEAK_RELEVANCE_REASON, tag: 'general' }; }
  function _scoreCandidateLocal() { return 0; }
  ${grab('_pickBestCandidateLocal')}
  ${grab('_pickBestCandidateForGapLocal')}
  ${grab('repairAddHoursToDegreeLocal')}
  return repairAddHoursToDegreeLocal;
`;
const repairAddHoursToDegreeLocal = new Function(sandbox)();

const KNOWN_SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function mkAnalysis({ knownTotal, required, pool }) {
  return {
    scheduled_course_ids: [],
    hours: { known_total_hours: knownTotal, required_total: required, prior_hours_known: true, general_hours_shortfall: 0 },
    elective_pool: pool,
    general_requirement: null,
  };
}

describe('Issue 2 — repairAddHoursToDegreeLocal exhaustive fill', () => {
  test('fills legal, load-respecting candidates up to the required total', () => {
    const pool = [
      { course_id: 'E1', hours: 4 }, { course_id: 'E2', hours: 4 },
      { course_id: 'E3', hours: 4 }, { course_id: 'E4', hours: 4 },
    ];
    const courses = {};
    for (const c of pool) courses[c.course_id] = { hours: c.hours, effective_allowed_semesters: KNOWN_SEMS };
    const analysis = mkAnalysis({ knownTotal: 170, required: 185, pool });
    const r = repairAddHoursToDegreeLocal({ semesters: [] }, analysis, {
      courses, maxHoursPerSemester: 20, knownSemesterIds: KNOWN_SEMS,
    });
    expect(r.proposed_total_hours).toBeGreaterThanOrEqual(185);
    expect(r.exhausted).toBe(false);
  });

  test('does NOT add a candidate that has no legal semester (legality respected)', () => {
    const pool = [{ course_id: 'BAD', hours: 8 }];
    const courses = { BAD: { hours: 8, effective_allowed_semesters: ['year_9_nonexistent'] } };
    const analysis = mkAnalysis({ knownTotal: 180, required: 185, pool });
    const r = repairAddHoursToDegreeLocal({ semesters: [] }, analysis, {
      courses, maxHoursPerSemester: 20, knownSemesterIds: KNOWN_SEMS,
    });
    expect(r.added.find(a => a.course_id === 'BAD')).toBeUndefined();
    expect(r.exhausted).toBe(true);
    expect((r.debug.rejected || []).some(x => x.course_id === 'BAD' && x.reason === 'no_legal_semester')).toBe(true);
  });

  test('does NOT add a candidate that would exceed the load cap (load respected)', () => {
    // Single legal semester already near the cap; the only candidate (8h) would
    // overflow it → cannot be placed → not added.
    const pool = [{ course_id: 'BIG', hours: 8 }];
    const courses = { BIG: { hours: 8, effective_allowed_semesters: ['year_3_semester_a'] } };
    const analysis = mkAnalysis({ knownTotal: 180, required: 185, pool });
    const proposal = { semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['FILL'] }] };
    courses.FILL = { hours: 18, effective_allowed_semesters: ['year_3_semester_a'] };
    const r = repairAddHoursToDegreeLocal(proposal, analysis, {
      courses, maxHoursPerSemester: 20, knownSemesterIds: ['year_3_semester_a'],
    });
    expect(r.added.find(a => a.course_id === 'BIG')).toBeUndefined();
  });

  test('reports exhaustion when the candidate pool cannot reach the requirement', () => {
    const pool = [{ course_id: 'E1', hours: 4 }];
    const courses = { E1: { hours: 4, effective_allowed_semesters: KNOWN_SEMS } };
    const analysis = mkAnalysis({ knownTotal: 170, required: 185, pool });
    const r = repairAddHoursToDegreeLocal({ semesters: [] }, analysis, {
      courses, maxHoursPerSemester: 20, knownSemesterIds: KNOWN_SEMS,
    });
    expect(r.proposed_total_hours).toBeLessThan(185);
    expect(r.exhausted).toBe(true);
  });
});

describe('Issue 2 — build pipeline wires exhaustive refill before the gate', () => {
  test('re-runs the hours fill AFTER the eligibility/legal post-filters', () => {
    // The refill loop calls repairAddHoursToDegreeLocal on eligibleProposal
    // (the post-filter proposal) and loops until a pass adds nothing.
    expect(html).toContain('EXHAUSTIVE auto-fill RE-RUN');
    expect(html).toMatch(/for \(let pass = 0; pass < \d+; pass\+\+\)/);
    expect(html).toContain('eligibleProposal = r.proposal;');
  });

  test('the missing-hours blocker is computed on the FINAL post-refill proposal', () => {
    expect(html).toContain('const degreeHoursStatusFinal = getDegreeHoursStatusLocal(analysis, eligibleProposal.semesters');
    expect(html).toContain('!degreeHoursStatusFinal.satisfied && degreeHoursStatusFinal.missing_hours > 0');
  });

  test('the missing-hours message carries a TARGETED exhaustion reason', () => {
    expect(html).toContain('refillExhaustReason');
    expect(html).toContain('לא נותרו קורסי בחירה זמינים');
    expect(html).toContain('הוספת קורסים נוספים תחרוג ממגבלת העומס');
    // The blocking reason string keeps the parseable "ש״ש להשלמת התואר" prefix.
    expect(html).toContain('ש״ש להשלמת התואר —');
  });

  test('diagnoseBuildBlock surfaces the exhaustion reason in insufficient_hours', () => {
    expect(html).toContain("category = 'insufficient_hours';");
    expect(html).toContain('exhaustReason');
    expect(html).toMatch(/חסרות \$\{exactMissingHours\} ש״ש להשלמת התואר — \$\{exhaustReason\}/);
  });

  test('validateFinalPlan still rejects <185 (not weakened)', () => {
    // The central validator keeps its degree_completion blocker for total<required.
    expect(html).toContain("add('degree_completion',");
    expect(html).toMatch(/if \(total != null && total < required\)/);
  });
});
