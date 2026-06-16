/**
 * Issue 2/3 — a >26h plan must NOT surface as a normal proposed schedule, and
 * the PRIMARY blocked recovery experience is the AI chat (diagnoseBuildBlock).
 *
 * Extracts diagnoseBuildBlock and asserts the overload branch produces the
 * spec'd Hebrew explanation + targeted relief chips (relax-overload-26,
 * drop-one-elective, move-flexible-mandatory, relax-grade, and a GENERAL
 * prioritize-topic chip derived from the user's OWN parsed interest terms),
 * never labeling the result valid/recommended.
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

function loadDiagnose() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const src = grab(html, 'diagnoseBuildBlock');
  // Stub globals diagnoseBuildBlock reads.
  const factory = new Function(
    'courseMap', '_aiPickerState', 'extractPreferenceTermsLocal', '_aiPlanLastPreferences',
    `${src}\nreturn diagnoseBuildBlock;`,
  );
  return factory(
    {},
    { strongUnwanted: [], unwanted: [] },
    () => ({ interest_terms: ['חוזק', 'זרימה'], grade_target: 85 }),
    {},
  );
}

describe('Issue 2/3 — 27h overload routed to chat with targeted chips', () => {
  const diagnoseBuildBlock = loadDiagnose();

  const validation = {
    errors: ['ב-שנה ג׳ סמסטר א׳ יש 27 שעות שבועיות — חריגה מהמגבלה הקשיחה (26 ש"ש).'],
    completeness: { incomplete: true, reasons: [] },
    overloadBlocked: true,
  };

  test('overload category with a clear Hebrew explanation (not "מומלצת"/"אופטימלית")', () => {
    const diag = diagnoseBuildBlock(validation, {});
    expect(diag.category).toBe('overload');
    expect(diag.explanation_he).toMatch(/חריג|עומס/);
    expect(diag.explanation_he).not.toMatch(/מומלצת|אופטימלית/);
  });

  test('offers the spec relief chips', () => {
    const diag = diagnoseBuildBlock(validation, {});
    const actions = diag.chips.map(c => c.action);
    expect(actions).toContain('relax-overload-26');
    expect(actions).toContain('drop-one-elective');
    expect(actions).toContain('move-flexible-mandatory');
    expect(actions).toContain('relax-grade');
  });

  test('prioritize-topic chip is GENERAL — built from the user OWN parsed terms', () => {
    const diag = diagnoseBuildBlock(validation, {});
    const topicChip = diag.chips.find(c => c.action === 'prioritize-topic');
    expect(topicChip).toBeTruthy();
    // terms come from the stubbed parser ('חוזק'/'זרימה'), not hardcoded.
    expect(topicChip.label).toContain('חוזק');
    expect(topicChip.payload.terms).toContain('חוזק');
  });
});
