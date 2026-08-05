/**
 * Deterministic Hebrew planning-intent interpreter (api/ai/planning_intent.ts).
 *
 * The interpreter is the provider-independent boundary that turns free-text
 * Hebrew requests into a VALIDATED structured PlanningIntent, resolved against
 * data-driven course-catalog metadata (never hard-coded course ids), which then
 * feeds the SAME structured planner fields the greedy planner already honors.
 *
 * A generic synthetic catalog is used here on purpose — no production degree,
 * course id, or semester is baked into the interpreter's logic.
 */
import {
  extractCatalog,
  interpretPlanningIntent,
  mergeIntentIntoPreferences,
  buildIntentOutcome,
  planningIntentSchema,
  type CatalogEntry,
} from '../../api/ai/planning_intent';

const CATALOG: CatalogEntry[] = [
  { id: 'C-PHYS2', nameHe: 'פיזיקה (2)' },
  { id: 'C-CTRL', nameHe: 'מבוא לבקרה' },
  { id: 'C-FEM', nameHe: 'מבוא לאלמנטים סופיים' },
  { id: 'C-VIB', nameHe: 'תורת התנודות' },
  { id: 'C-DES1', nameHe: 'תכן מכני (1)' },
  { id: 'C-DES2', nameHe: 'תכן מכני (2)' },
];

// ── extraction / normalization ────────────────────────────────────────────────

test('exclusion request → hard exclude, resolved against the catalog by name', () => {
  const intent = interpretPlanningIntent('אל תשבץ פיזיקה 2.', CATALOG);
  expect(intent.excludeCourseIds).toEqual(['C-PHYS2']); // "פיזיקה 2" ≡ "פיזיקה (2)"
  expect(intent.preferCourseIds).toEqual([]);
  const rec = intent.recognized.find((r) => r.kind === 'exclude');
  expect(rec).toMatchObject({ status: 'resolved', resolvedCourseIds: ['C-PHYS2'] });
});

test('positive preferences → wanted ids, comma/vav separated, each resolved', () => {
  const intent = interpretPlanningIntent('אני מעדיף בקרה, אלמנטים סופיים ותורת התנודות.', CATALOG);
  expect(new Set(intent.preferCourseIds)).toEqual(new Set(['C-CTRL', 'C-FEM', 'C-VIB']));
  expect(intent.excludeCourseIds).toEqual([]);
});

test('workload cap → maxWeeklyHours extracted with exact (half-hour) precision', () => {
  expect(interpretPlanningIntent('שמור על עד 25 ש״ש בסמסטר.', CATALOG).maxWeeklyHours).toBe(25);
  expect(interpretPlanningIntent('לא יותר מ-23.5 שעות בסמסטר', CATALOG).maxWeeklyHours).toBe(23.5);
});

test('balance request → balanceLoad flag', () => {
  const intent = interpretPlanningIntent('אם קורס מוצע גם בסמסטר א׳ וגם בסמסטר ב׳, בחר את הסמסטר שמאזן טוב יותר את העומס.', CATALOG);
  expect(intent.balanceLoad).toBe(true);
});

test('an unknown course in an exclusion is reported, never silently dropped or fabricated', () => {
  const intent = interpretPlanningIntent('אל תשבץ מכניקת הקוונטים.', CATALOG);
  expect(intent.excludeCourseIds).toEqual([]); // nothing fabricated
  const rec = intent.recognized.find((r) => r.kind === 'exclude');
  expect(rec).toMatchObject({ status: 'unresolved' });
  expect(rec!.phrase).toContain('קוונטים');
});

test('an AMBIGUOUS exclusion (matches multiple courses) is not applied — reported for safety', () => {
  // "תכן מכני" prefixes both "תכן מכני (1)" and "תכן מכני (2)".
  const intent = interpretPlanningIntent('אל תשבץ תכן מכני.', CATALOG);
  expect(intent.excludeCourseIds).toEqual([]); // never guess which one to hard-exclude
  expect(intent.recognized.find((r) => r.kind === 'exclude')).toMatchObject({ status: 'ambiguous' });
});

test('empty / non-request text yields an empty, schema-valid intent', () => {
  const intent = interpretPlanningIntent('שלום, מה שלומך?', CATALOG);
  expect(intent.excludeCourseIds).toEqual([]);
  expect(intent.preferCourseIds).toEqual([]);
  expect(intent.maxWeeklyHours).toBeUndefined();
  expect(planningIntentSchema.safeParse(intent).success).toBe(true);
});

// ── schema validation (untrusted-input boundary) ──────────────────────────────

test('interpret output always passes its own schema (validated boundary)', () => {
  for (const t of ['אל תשבץ פיזיקה 2', 'אני מעדיף בקרה', 'עד 24 ש״ש', '']) {
    expect(planningIntentSchema.safeParse(interpretPlanningIntent(t, CATALOG)).success).toBe(true);
  }
});

test('schema rejects malformed interpreted intent (e.g. a bad LLM payload)', () => {
  expect(planningIntentSchema.safeParse({ excludeCourseIds: 'not-an-array' }).success).toBe(false);
  expect(planningIntentSchema.safeParse({ excludeCourseIds: [1, 2], preferCourseIds: [], recognized: [] }).success).toBe(false);
  expect(planningIntentSchema.safeParse({ excludeCourseIds: [], preferCourseIds: [], maxWeeklyHours: -5, recognized: [] }).success).toBe(false);
});

// ── precedence / conflict rules vs structured UI preferences ───────────────────

test('exclusion beats preference: a course both excluded and preferred is hard-excluded, not wanted', () => {
  const intent = interpretPlanningIntent('אני מעדיף בקרה. אל תשבץ בקרה.', CATALOG);
  const merged = mergeIntentIntoPreferences({}, intent);
  expect(merged.disallowed_course_ids).toContain('C-CTRL');
  expect(merged.wanted_course_ids ?? []).not.toContain('C-CTRL'); // exclusion wins
});

test('merge unions with structured UI prefs and takes the most conservative hour cap', () => {
  const intent = interpretPlanningIntent('אני מעדיף אלמנטים סופיים. עד 25 ש״ש.', CATALOG);
  const merged = mergeIntentIntoPreferences(
    { wanted_course_ids: ['C-VIB'], disallowed_course_ids: ['C-PHYS2'], max_weekly_hours: 30 },
    intent,
  );
  expect(new Set(merged.wanted_course_ids)).toEqual(new Set(['C-VIB', 'C-FEM'])); // union
  expect(merged.disallowed_course_ids).toContain('C-PHYS2');
  expect(merged.max_weekly_hours).toBe(25); // min(30, 25) — most conservative
});

test('an explicit UI exclusion is never downgraded; free-text prefer cannot re-add it', () => {
  const intent = interpretPlanningIntent('אני מעדיף פיזיקה 2.', CATALOG); // prefer a UI-excluded course
  const merged = mergeIntentIntoPreferences({ disallowed_course_ids: ['C-PHYS2'] }, intent);
  expect(merged.disallowed_course_ids).toContain('C-PHYS2');
  expect(merged.wanted_course_ids ?? []).not.toContain('C-PHYS2');
});

// ── truthful outcome derived from the ACTUAL plan ─────────────────────────────

const semesters = (ids: string[][]) => ids.map((course_ids, i) => ({ semester_id: `s${i}`, course_ids }));

test('outcome: a preferred course that was placed is honored; one absent is unmet', () => {
  const intent = interpretPlanningIntent('אני מעדיף בקרה ותורת התנודות.', CATALOG);
  const outcome = buildIntentOutcome(intent, semesters([['C-CTRL'], []]), { catalog: CATALOG });
  expect(outcome.honored.join(' ')).toContain('מבוא לבקרה');
  expect(outcome.unmet.join(' ')).toContain('תורת התנודות');
});

test('outcome: excluding a MANDATORY course is reported as an unmet conflict, not silent', () => {
  const intent = interpretPlanningIntent('אל תשבץ בקרה.', CATALOG);
  const outcome = buildIntentOutcome(intent, semesters([[], []]), {
    catalog: CATALOG,
    requiredMandatoryCourseIds: ['C-CTRL'], // the excluded course is mandatory
  });
  expect(outcome.unmet.join(' ')).toMatch(/חובה|מתנגש/); // conflict with a mandatory requirement
});

test('outcome: an unresolved request phrase is surfaced truthfully (missing data)', () => {
  const intent = interpretPlanningIntent('אל תשבץ מכניקת הקוונטים.', CATALOG);
  const outcome = buildIntentOutcome(intent, semesters([[], []]), { catalog: CATALOG });
  expect(outcome.unmet.join(' ')).toContain('קוונטים');
});

// ── catalog extraction from a board_json ─────────────────────────────────────

test('extractCatalog gathers placed + repository courses, keyed by id (last wins), skips blanks', () => {
  const board = {
    metadata: { program_repository_courses: [{ course_id: 'R-1', name_he: 'קורס מאגר' }, { course_id: 'X', name_he: null }] },
    semesters: [{ semester_id: 's0', courses: [{ course_id: 'P-1', name_he: 'קורס משובץ' }] }],
  };
  const cat = extractCatalog(board);
  expect(cat.find((c) => c.id === 'R-1')?.nameHe).toBe('קורס מאגר');
  expect(cat.find((c) => c.id === 'P-1')?.nameHe).toBe('קורס משובץ');
  expect(cat.find((c) => c.id === 'X')).toBeUndefined(); // no usable name → not resolvable
});
