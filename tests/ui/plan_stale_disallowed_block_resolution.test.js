/**
 * Issue #28 — a course excluded via the avoid-list picker
 * (prefs.strongly_avoided_course_ids / hard_exclude_course_ids) can already be
 * placed on the board when the user adds it to avoid and rebuilds. The server
 * (generate-plan.ts's disallowedGate, PR #27) correctly reports `blocked:true`
 * with a `DISALLOWED_PLACED_ERROR_PREFIX` error naming the course. But
 * requestPlanProposal's own local safety net, applyExplicitAvoidPostFilterLocal,
 * ALSO strips that same course from the displayed proposal (with its own
 * "הוסרו X קורסי בחירה..." toast) — after which the server's `blocked`/error
 * signal is stale: it still describes a course no longer in the plan.
 *
 * resolveStaleDisallowedBlockLocal is the fix: given the server's blocked
 * signal + errors and the course ids ACTUALLY placed in the final proposal
 * (checked as ground truth, not a snapshot from any one repair step — see the
 * "reintroduced by a later refill" test below, added after a Codex review
 * caught that an earlier snapshot-based version could resolve an error for a
 * course a later refill then silently re-placed), it drops any
 * disallowed-placement error whose named course is no longer among them, and
 * recomputes `blocked` from what's left. Extracted as a small pure function
 * (this file's `grab` pattern) so it's testable without mocking
 * fetch/DOM/the full requestPlanProposal pipeline.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'app', 'web', 'semester_board_viewer.html');

function grab(html, name) {
  const decl = `function ${name}(`;
  const start = html.indexOf(decl);
  if (start === -1) throw new Error(`${name} not found in viewer`);
  const braceOpen = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name}: unbalanced braces`);
}

function grabConst(html, name) {
  const decl = `const ${name} =`;
  const start = html.indexOf(decl);
  if (start === -1) throw new Error(`${name} not found in viewer`);
  const end = html.indexOf(';', start);
  if (end === -1) throw new Error(`${name}: no terminating semicolon`);
  return html.slice(start, end + 1);
}

function load() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const prefixConst = grabConst(html, 'DISALLOWED_PLACED_ERROR_PREFIX_LOCAL');
  const parseSrc = grab(html, 'parseDisallowedPlacedNameLocal');
  const src = grab(html, 'resolveStaleDisallowedBlockLocal');
  const factory = new Function(`${prefixConst}\n${parseSrc}\n${src}\nreturn resolveStaleDisallowedBlockLocal;`);
  return factory();
}

describe('issue #28 — resolveStaleDisallowedBlockLocal', () => {
  const resolveStaleDisallowedBlockLocal = load();
  const courseMap = {
    '0542-4120': { name_he: 'יסודות זרימה' },
    '0542-4999': { name_he: 'קורס אחר' },
  };

  test('drops the disallowed-placement error and un-blocks when the named course is absent from the final placed set', () => {
    const result = resolveStaleDisallowedBlockLocal(
      true,
      ['קורס לא-זמין שובץ בתוכנית: יסודות זרימה.'],
      ['0542-4999'], // final plan contains some other course, not the flagged one
      courseMap,
    );
    expect(result.blocked).toBe(false);
    expect(result.errors).toEqual([]);
  });

  test('stays blocked when another, unrelated blocking error remains (e.g. overload)', () => {
    const result = resolveStaleDisallowedBlockLocal(
      true,
      [
        'קורס לא-זמין שובץ בתוכנית: יסודות זרימה.',
        'ב-שנה ג׳ סמסטר א׳ יש 27 שעות שבועיות — חריגה מהמגבלה הקשיחה (26 ש"ש).',
      ],
      [],
      courseMap,
    );
    expect(result.blocked).toBe(true);
    expect(result.errors).toEqual(['ב-שנה ג׳ סמסטר א׳ יש 27 שעות שבועיות — חריגה מהמגבלה הקשיחה (26 ש"ש).']);
  });

  test('leaves a disallowed-placement error alone when its course IS still in the final placed set', () => {
    // Covers both "never removed" and (see the dedicated test below) "removed
    // by the avoid filter, then silently reintroduced by a later refill".
    const result = resolveStaleDisallowedBlockLocal(
      true,
      ['קורס לא-זמין שובץ בתוכנית: יסודות זרימה.'],
      ['0542-4120'],
      courseMap,
    );
    expect(result.blocked).toBe(true);
    expect(result.errors).toEqual(['קורס לא-זמין שובץ בתוכנית: יסודות זרימה.']);
  });

  test('regression (Codex, PR #34 review, 2nd finding): a course removed by the avoid filter but reintroduced by a LATER refill must stay blocked', () => {
    // Simulates: applyExplicitAvoidPostFilterLocal removed 0542-4120, but
    // repairAddMissingElectivesLocal / repairAddHoursToDegreeLocal (which only
    // exclude unwantedCourseIds, not hard-excludes) picked it right back up
    // from analysis.elective_pool during a later refill pass. The caller must
    // pass the course ids from the FINAL proposal (after all refills), not a
    // snapshot from right after the avoid filter — here that final set still
    // contains 0542-4120, so its error must NOT be resolved.
    const result = resolveStaleDisallowedBlockLocal(
      true,
      ['קורס לא-זמין שובץ בתוכנית: יסודות זרימה.'],
      ['0542-4120'], // reintroduced — present in the FINAL placed set
      courseMap,
    );
    expect(result.blocked).toBe(true);
    expect(result.errors).toEqual(['קורס לא-זמין שובץ בתוכנית: יסודות זרימה.']);
  });

  test('no-op when there were no server errors to begin with', () => {
    const result = resolveStaleDisallowedBlockLocal(false, [], ['0542-4120'], courseMap);
    expect(result.blocked).toBe(false);
    expect(result.errors).toEqual([]);
  });

  test('falls back to the course id when courseMap has no name_he (matches server fallback: name_he ?? id)', () => {
    const result = resolveStaleDisallowedBlockLocal(
      true,
      ['קורס לא-זמין שובץ בתוכנית: 0542-9999.'],
      [], // 0542-9999 is not in the final placed set
      {},
    );
    expect(result.blocked).toBe(false);
    expect(result.errors).toEqual([]);
  });

  test('regression (Codex, PR #34 review, 1st finding): a course whose name is a PREFIX of another still-placed disallowed course must NOT resolve that other course\'s block', () => {
    // Real catalog prefix pair: a course and its "- מעבדה" (lab) companion.
    const prefixCourseMap = {
      SHORT: { name_he: 'מבוא למדע והנדסה של חומרים' },
      LONG: { name_he: 'מבוא למדע והנדסה של חומרים - מעבדה' },
    };
    const result = resolveStaleDisallowedBlockLocal(
      true,
      ['קורס לא-זמין שובץ בתוכנית: מבוא למדע והנדסה של חומרים - מעבדה.'],
      ['LONG'], // LONG is still placed — its error must survive
      prefixCourseMap,
    );
    expect(result.blocked).toBe(true);
    expect(result.errors).toEqual(['קורס לא-זמין שובץ בתוכנית: מבוא למדע והנדסה של חומרים - מעבדה.']);
  });

  test('regression (Codex, PR #34 review, 1st finding): resolving the LONGER-named course\'s error must not touch the SHORTER one\'s', () => {
    const prefixCourseMap = {
      SHORT: { name_he: 'מבוא למדע והנדסה של חומרים' },
      LONG: { name_he: 'מבוא למדע והנדסה של חומרים - מעבדה' },
    };
    const result = resolveStaleDisallowedBlockLocal(
      true,
      [
        'קורס לא-זמין שובץ בתוכנית: מבוא למדע והנדסה של חומרים.',
        'קורס לא-זמין שובץ בתוכנית: מבוא למדע והנדסה של חומרים - מעבדה.',
      ],
      ['SHORT'], // only SHORT is still placed — LONG's error must resolve, SHORT's must not
      prefixCourseMap,
    );
    expect(result.blocked).toBe(true);
    expect(result.errors).toEqual(['קורס לא-זמין שובץ בתוכנית: מבוא למדע והנדסה של חומרים.']);
  });
});
