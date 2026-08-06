/**
 * PLANNING-INTENT BOUNDARY — turns a free-text Hebrew request into a VALIDATED,
 * structured PlanningIntent that feeds the SAME structured planner fields the
 * greedy planner already honors (disallowed / wanted / max hours / balance).
 *
 * Why this exists: `extra_request_he` previously reached only the LLM prompt
 * context (_context.ts), so free text could not measurably change the
 * deterministic plan. This module is the canonical intent/planning boundary:
 *
 *   free text ──▶ interpret ──▶ PlanningIntent (schema-validated) ──▶ merge into
 *   structured preferences ──▶ existing planner (unchanged) ──▶ truthful outcome.
 *
 * Design constraints honored:
 *  - PROVIDER-INDEPENDENT: the interpreter here is fully deterministic. An LLM
 *    interpreter can later replace/augment it behind the SAME validated schema
 *    (treat its output as untrusted → planningIntentSchema.safeParse → on
 *    failure fall back to the deterministic result or an empty, safe intent).
 *  - DATA-DRIVEN: course phrases are resolved against the board's own catalog
 *    (name_he), never against hard-coded course ids/names/degree specifics.
 *  - SAFE-BY-DEFAULT: an ambiguous or unknown course is NEVER guessed into a
 *    hard exclusion — it is reported, so the caller can explain it truthfully.
 *  - EXCLUSION IS HARD: an explicit exclusion is never downgraded to a soft
 *    preference, and a preference can never re-add an excluded course.
 */
import { z } from 'zod';

export interface CatalogEntry {
  id: string;
  nameHe: string;
}

// ── validated intent schema (the untrusted-input boundary) ────────────────────
const recognizedItemSchema = z.object({
  kind: z.enum(['exclude', 'prefer', 'maxHours', 'balance']),
  phrase: z.string(),
  resolvedCourseIds: z.array(z.string()),
  status: z.enum(['resolved', 'ambiguous', 'unresolved', 'applied']),
});
export const planningIntentSchema = z.object({
  excludeCourseIds: z.array(z.string()),
  preferCourseIds: z.array(z.string()),
  maxWeeklyHours: z.number().positive().optional(),
  balanceLoad: z.boolean().optional(),
  recognized: z.array(recognizedItemSchema),
});
export type PlanningIntent = z.infer<typeof planningIntentSchema>;
export type RecognizedItem = z.infer<typeof recognizedItemSchema>;

// ── Hebrew normalization + catalog resolution ─────────────────────────────────
/** Strip nikkud/te'amim + punctuation, collapse whitespace. "פיזיקה (2)" → "פיזיקה 2". */
export function normalizeHebrew(s: string): string {
  return (s ?? '')
    .replace(/[֑-ׇ]/g, '')                 // nikkud / cantillation
    .replace(/["'׳״`()\[\].,;:!?׀|/\\־–—-]/g, ' ')    // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Placed ∪ program_repository_courses, keyed by id (last wins); blanks skipped. */
export function extractCatalog(boardJson: any): CatalogEntry[] {
  const byId = new Map<string, string>();
  const add = (c: any) => {
    const id = typeof c?.course_id === 'string' ? c.course_id.trim() : '';
    const name = typeof c?.name_he === 'string' ? c.name_he.trim() : '';
    if (id && name) byId.set(id, name);
  };
  for (const s of boardJson?.semesters ?? []) for (const c of s?.courses ?? []) add(c);
  for (const c of boardJson?.metadata?.program_repository_courses ?? []) add(c);
  return [...byId].map(([id, nameHe]) => ({ id, nameHe }));
}

/** Ids whose normalized name equals (preferred) or contains the normalized phrase. */
function matchCourses(phrase: string, catalog: CatalogEntry[]): string[] {
  const np = normalizeHebrew(phrase);
  if (!np) return [];
  const exact = catalog.filter((c) => normalizeHebrew(c.nameHe) === np).map((c) => c.id);
  if (exact.length) return exact;
  return catalog.filter((c) => normalizeHebrew(c.nameHe).includes(np)).map((c) => c.id);
}

// ── marker-driven extraction ──────────────────────────────────────────────────
// Longest-first so a longer marker is matched before a shorter substring of it.
const EXCLUDE_MARKERS = ['אל תשבץ', 'אל תכלול', 'לא לשבץ', 'לא לכלול', 'אין לשבץ', 'לא רוצה', 'להוציא', 'בלי', 'ללא'];
// Imperative "schedule for me" verbs ('שבץ'/'תשבץ') are the positive symmetry of
// the 'אל תשבץ' exclusion marker. The 'לי' (dative) variants come before the bare
// verb so afterMarker consumes "שבץ לי" as one unit (leaving the accusative object)
// rather than matching "שבץ" and stranding "לי". Negated forms ("אל תשבץ", …) are
// EXCLUDE markers checked first per clause, so they always win over these.
const PREFER_MARKERS = ['אני מעדיף', 'הייתי רוצה', 'מעדיף', 'אשמח', 'רוצה', 'תשבץ לי', 'שבץ לי', 'תשבץ', 'שבץ'];

/** Text after the first occurrence of `marker`, with a leading accusative "את " removed. */
function afterMarker(clause: string, marker: string): string {
  return clause.slice(clause.indexOf(marker) + marker.length).replace(/^\s*את\s+/, '').trim();
}

/** Split a preference list on commas and the Hebrew vav conjunction. */
function splitPreferenceList(segment: string): string[] {
  return segment
    .split(/[,،]|\s+ו/) // comma or " ו…" (vav conjunction, space-preceded)
    .map((p) => p.trim())
    .filter(Boolean);
}

function firstMarker(clause: string, markers: string[]): string | null {
  return markers.find((m) => clause.includes(m)) ?? null;
}

/**
 * Deterministic Hebrew → PlanningIntent. Always returns a schema-valid intent
 * (safe empty intent when nothing is recognized).
 */
export function interpretPlanningIntent(text: string, catalog: CatalogEntry[]): PlanningIntent {
  const excludeCourseIds = new Set<string>();
  const preferCourseIds = new Set<string>();
  const recognized: RecognizedItem[] = [];
  let maxWeeklyHours: number | undefined;
  let balanceLoad: boolean | undefined;

  const raw = text ?? '';

  // Whole-text signals (order-independent):
  const hoursMatch =
    raw.match(/עד\s*(\d+(?:\.\d+)?)\s*ש/) ||
    raw.match(/לא\s+יותר\s+מ[-־]?\s*(\d+(?:\.\d+)?)/) ||
    raw.match(/מקסימום\s*(\d+(?:\.\d+)?)/);
  if (hoursMatch) {
    const n = Number(hoursMatch[1]);
    if (Number.isFinite(n) && n > 0) {
      maxWeeklyHours = n;
      recognized.push({ kind: 'maxHours', phrase: hoursMatch[0].trim(), resolvedCourseIds: [], status: 'applied' });
    }
  }
  if (/מאזן|לאזן|איזון|שמאזן/.test(raw)) {
    balanceLoad = true;
    recognized.push({ kind: 'balance', phrase: 'איזון עומס', resolvedCourseIds: [], status: 'applied' });
  }

  // Clause-scoped course intents. Exclusion takes precedence within a clause.
  for (const clause of raw.split(/[.;\n!?]+/).map((c) => c.trim()).filter(Boolean)) {
    const exMarker = firstMarker(clause, EXCLUDE_MARKERS);
    if (exMarker) {
      const phrase = afterMarker(clause, exMarker);
      if (!phrase) continue;
      const ids = matchCourses(phrase, catalog);
      if (ids.length === 1) {
        excludeCourseIds.add(ids[0]);
        recognized.push({ kind: 'exclude', phrase, resolvedCourseIds: ids, status: 'resolved' });
      } else if (ids.length > 1) {
        // never guess which one to hard-exclude
        recognized.push({ kind: 'exclude', phrase, resolvedCourseIds: [], status: 'ambiguous' });
      } else {
        recognized.push({ kind: 'exclude', phrase, resolvedCourseIds: [], status: 'unresolved' });
      }
      continue;
    }
    const prMarker = firstMarker(clause, PREFER_MARKERS);
    if (prMarker) {
      for (const phrase of splitPreferenceList(afterMarker(clause, prMarker))) {
        const ids = matchCourses(phrase, catalog);
        if (ids.length) {
          ids.forEach((id) => preferCourseIds.add(id));
          recognized.push({ kind: 'prefer', phrase, resolvedCourseIds: ids, status: 'resolved' });
        } else {
          recognized.push({ kind: 'prefer', phrase, resolvedCourseIds: [], status: 'unresolved' });
        }
      }
    }
  }

  const intent: PlanningIntent = {
    excludeCourseIds: [...excludeCourseIds],
    // exclusion always wins over preference (safety): a course can't be both
    preferCourseIds: [...preferCourseIds].filter((id) => !excludeCourseIds.has(id)),
    maxWeeklyHours,
    balanceLoad,
    recognized,
  };
  // Self-validate the boundary (guards against a future non-deterministic source).
  return planningIntentSchema.parse(intent);
}

// ── merge with structured UI preferences (explicit precedence) ────────────────
export interface MergedPrefFields {
  disallowed_course_ids?: string[];
  wanted_course_ids?: string[];
  max_weekly_hours?: number;
  balance_load?: boolean;
}

/**
 * Merge interpreted intent into the structured preferences per explicit rules:
 *  - disallowed = union(UI disallowed, intent excludes)                [hard]
 *  - wanted     = union(UI wanted, intent prefers) MINUS disallowed    [exclusion wins]
 *  - max hours  = min(UI, intent) when both present (most conservative)
 *  - balance    = UI OR intent
 */
export function mergeIntentIntoPreferences(
  prefs: {
    disallowed_course_ids?: string[];
    wanted_course_ids?: string[];
    max_weekly_hours?: number | null;
    balance_load?: boolean;
  } | null | undefined,
  intent: PlanningIntent,
): MergedPrefFields {
  const disallowed = new Set<string>([...(prefs?.disallowed_course_ids ?? []), ...intent.excludeCourseIds]);
  const wanted = new Set<string>([...(prefs?.wanted_course_ids ?? []), ...intent.preferCourseIds]);
  for (const id of disallowed) wanted.delete(id); // exclusion is never downgraded to a want

  const out: MergedPrefFields = {};
  if (disallowed.size) out.disallowed_course_ids = [...disallowed];
  if (wanted.size) out.wanted_course_ids = [...wanted];

  const uiMax = typeof prefs?.max_weekly_hours === 'number' ? prefs.max_weekly_hours : undefined;
  const caps = [uiMax, intent.maxWeeklyHours].filter((n): n is number => typeof n === 'number');
  if (caps.length) out.max_weekly_hours = Math.min(...caps);

  if (prefs?.balance_load || intent.balanceLoad) out.balance_load = true;
  return out;
}

// ── truthful outcome derived from the ACTUAL resulting plan ────────────────────
export interface IntentOutcome {
  honored: string[];
  partiallyHonored: string[];
  unmet: string[];
  notesHe: string[];
}

export interface IntentOutcomeContext {
  catalog: CatalogEntry[];
  /** Mandatory course ids still required — an excluded mandatory course is a conflict. */
  requiredMandatoryCourseIds?: string[];
  /** course id → weekly hours, to evaluate the max-hours request against actual loads. */
  hoursById?: Map<string, number | null | undefined>;
}

/**
 * Compare the interpreted intent against the ACTUAL placements. Nothing here is
 * generated prose — every line is derived from whether a resolved course id is
 * present in `semesters`, whether an excluded id is mandatory, and the real
 * per-semester loads.
 */
export function buildIntentOutcome(
  intent: PlanningIntent,
  semesters: Array<{ semester_id?: string; course_ids: string[] }>,
  ctx: IntentOutcomeContext,
): IntentOutcome {
  const nameOf = new Map(ctx.catalog.map((c) => [c.id, c.nameHe]));
  const label = (id: string) => nameOf.get(id) ?? id;
  const placed = new Set<string>();
  for (const s of semesters) for (const id of s.course_ids) placed.add(id);
  const mandatory = new Set(ctx.requiredMandatoryCourseIds ?? []);

  const honored: string[] = [];
  const partiallyHonored: string[] = [];
  const unmet: string[] = [];

  for (const r of intent.recognized) {
    if (r.kind === 'exclude') {
      if (r.status === 'resolved') {
        for (const id of r.resolvedCourseIds) {
          if (mandatory.has(id)) {
            unmet.push(`החרגת "${label(id)}" מתנגשת עם דרישת קורס חובה — לא ניתן להשלים תואר חוקי בלעדיו.`);
          } else {
            honored.push(`"${label(id)}" לא שובץ, לפי בקשתך.`);
          }
        }
      } else {
        unmet.push(`לא זוהה קורס יחיד עבור «${r.phrase}» — הבקשה להחרגה לא יושמה (נא לדייק את שם הקורס).`);
      }
    } else if (r.kind === 'prefer') {
      if (r.status !== 'resolved') {
        unmet.push(`לא זוהה קורס עבור «${r.phrase}».`);
        continue;
      }
      const here = r.resolvedCourseIds.filter((id) => placed.has(id));
      const missing = r.resolvedCourseIds.filter((id) => !placed.has(id));
      if (here.length) honored.push(`שובצו לפי העדפתך: ${here.map(label).join(', ')}.`);
      if (missing.length) {
        const line = `לא שובצו (העדפה נכנעת לדרישות התואר/זמינות): ${missing.map(label).join(', ')}.`;
        (here.length ? partiallyHonored : unmet).push(line);
      }
    }
  }

  const notesHe: string[] = [];
  if (typeof intent.maxWeeklyHours === 'number' && ctx.hoursById) {
    const over = semesters
      .map((s) => ({ id: s.semester_id ?? '', hrs: s.course_ids.reduce((sum, id) => sum + (ctx.hoursById!.get(id) ?? 0), 0) }))
      .filter((s) => s.hrs > intent.maxWeeklyHours!);
    if (over.length === 0) honored.push(`נשמרה מגבלת ${intent.maxWeeklyHours} ש״ש בכל הסמסטרים.`);
    else partiallyHonored.push(`חריגה מהמגבלה שביקשת (${intent.maxWeeklyHours} ש״ש) בסמסטרים: ${over.map((s) => s.id).join(', ')}.`);
  }
  if (intent.balanceLoad) notesHe.push('העומס אוזן בין הסמסטרים ככל שהאילוצים איפשרו.');

  return { honored, partiallyHonored, unmet, notesHe };
}
