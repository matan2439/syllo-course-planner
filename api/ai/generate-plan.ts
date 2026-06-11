/**
 * POST /api/ai/generate-plan
 *
 * Generates a personalized semester-plan proposal as structured JSON
 * (see api/ai/plan_validation.ts for the schema). The proposal is a
 * PREVIEW ONLY — the client must validate it (validatePlanProposal) and
 * the user must explicitly confirm before any local board state changes.
 *
 * Reuses the same provider selection / quota / dev-mode infrastructure as
 * /api/ai/course-planner (no changes to that logic).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateObject } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt, type PlanContext } from './_context';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';
import {
  resolveModel,
  isDevMode,
  isBypassQuota,
  sendError,
  PROVIDER_LABEL,
  PROVIDER_KEY_ENV,
  type AiProvider,
} from './course-planner';
import { planProposalSchema, normalizePlanProposal, droppedPlacementWarnings } from './plan_validation';

export const preferencesSchema = z.object({
  max_weekly_hours:        z.number().nullish(),
  balance_load:            z.boolean().optional(),
  avoid_multiple_labs:     z.boolean().optional(),
  avoid_multiple_projects: z.boolean().optional(),
  preferred_categories:    z.array(z.string()).optional(),
  wanted_course_ids:       z.array(z.string()).optional(),
  unwanted_course_ids:     z.array(z.string()).optional(),
  extra_request_he:        z.string().max(1000).optional(),
  action_type:             z.enum(['full_plan', 'balance_load', 'add_electives', 'fix_prerequisites', 'minimal_changes']).optional(),
  pinned_course_ids:       z.array(z.string()).optional(),
});

const ACTION_TYPE_HE: Record<string, string> = {
  full_plan:          'בנה תוכנית מלאה ומאוזנת לכל הסמסטרים שנותרו, כולל כל קורסי החובה וכמה שיותר מדרישות הבחירה.',
  balance_load:       'המטרה העיקרית היא איזון עומס השעות בין הסמסטרים על בסיס הלוח הנוכחי — העבר קורסים גמישים/בחירה בין סמסטרים כדי לאזן את העומס, מבלי להוסיף קורסים חדשים שלא נדרשים לכך.',
  add_electives:      'המטרה העיקרית היא להשלים דרישות בחירה שטרם מולאו — הוסף קורסי בחירה מתאימים מבלי לשנות את שיבוץ הקורסים הקיימים אלא אם הכרחי.',
  fix_prerequisites:  'המטרה העיקרית היא לתקן בעיות דרישות קדם — שנה את סדר/שיבוץ הקורסים כך שדרישות הקדם יתמלאו, עם כמה שפחות שינויים אחרים.',
  minimal_changes:    'הצע שינוי מינימלי בלבד — בצע את כמות השינויים הקטנה ביותר האפשרית בלוח הנוכחי כדי לשפר אותו, ושמור על שאר השיבוצים כפי שהם.',
};

const requestSchema = z.object({
  program_id:    z.string().min(1, 'program_id is required'),
  plan_context:  z.any(), // validated by buildSystemPrompt's lenient consumer; same shape as course-planner
  course_context: z.string().max(8000).optional(),
  preferences:   preferencesSchema,
  session_token: z.string().uuid('session_token must be a valid UUID'),
});

function isTestModeBypass(): boolean {
  return process.env.AI_TEST_MODE === 'true';
}

async function runQuotaCheck(session_token: string, dbUrl: string, res: VercelResponse): Promise<boolean> {
  let quota;
  try {
    quota = await checkAndEnsureSession(session_token, dbUrl);
  } catch (err) {
    const errClass = (err as any)?.constructor?.name ?? 'UnknownError';
    const errMsg   = err instanceof Error ? err.message : String(err);
    console.error(`[ai/generate-plan] quota DB error [${errClass}]:`, errMsg);
    sendError(res, 503, 'לא ניתן לבדוק מכסת AI — בעיה זמנית במסד הנתונים.', 'DB_ERROR', { phase: 'quota_check' });
    return false;
  }
  if (!quota.allowed) {
    if (isTestModeBypass()) {
      res.setHeader('X-AI-Quota-Bypass', 'true');
      return true;
    }
    sendError(res, 429, 'מכסת שאלות ה-AI החינמית נוצלה.', 'QUOTA_EXCEEDED', {
      credits_used: quota.credits_used,
      free_limit:   quota.free_limit,
      credits_paid: quota.credits_paid,
      remaining:    0,
    });
    return false;
  }
  return true;
}

function preferencesToHebrew(prefs: z.infer<typeof preferencesSchema>): string {
  const lines: string[] = [];
  if (prefs.max_weekly_hours != null) lines.push(`- עומס מקסימלי לשבוע בכל סמסטר: ${prefs.max_weekly_hours} שעות.`);
  if (prefs.balance_load) lines.push('- העדפה לאיזון העומס בין הסמסטרים.');
  if (prefs.avoid_multiple_labs) lines.push('- להימנע משיבוץ מספר קורסים עם מעבדה באותו סמסטר.');
  if (prefs.avoid_multiple_projects) lines.push('- להימנע משיבוץ מספר קורסים עם פרויקט/דוחות מרובים באותו סמסטר.');
  if (prefs.preferred_categories?.length) lines.push(`- העדפה לקטגוריות בחירה: ${prefs.preferred_categories.join(', ')}.`);
  if (prefs.wanted_course_ids?.length) lines.push(`- קורסים שהמשתמש רוצה לכלול: ${prefs.wanted_course_ids.join(', ')}.`);
  if (prefs.unwanted_course_ids?.length) lines.push(`- קורסים שהמשתמש לא רוצה לכלול (אם אפשרי): ${prefs.unwanted_course_ids.join(', ')}.`);
  if (prefs.extra_request_he) lines.push(`- בקשה נוספת מהמשתמש: ${prefs.extra_request_he}`);
  if (prefs.pinned_course_ids?.length) lines.push(`- קורסים מסומנים כ"אל תזיז" (אסור להזיז אותם מהסמסטר הנוכחי שלהם בלוח): ${prefs.pinned_course_ids.join(', ')}.`);
  return lines.length ? lines.join('\n') : 'לא הוגדרו העדפות מיוחדות.';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
    console.error('[ai/generate-plan] validation failed:', JSON.stringify(issues));
    sendError(res, 400, 'Invalid request', 'INVALID_REQUEST', { issues });
    return;
  }

  const { program_id, plan_context, course_context, preferences, session_token } = parsed.data;

  // ── Dev mode fast path — return a deterministic mock proposal ──────────────
  if (isDevMode()) {
    if (isBypassQuota()) {
      res.status(200).json(mockPlanProposal(plan_context as PlanContext));
      return;
    }
    const dbUrl = (process.env.DATABASE_URL ?? '').trim();
    if (!dbUrl) {
      sendError(res, 503, 'Database not configured. Set DATABASE_URL or AI_DEV_BYPASS_QUOTA=true for local dev.', 'NO_DATABASE_URL');
      return;
    }
    const allowed = await runQuotaCheck(session_token, dbUrl, res);
    if (!allowed) return;
    await Promise.allSettled([
      incrementCreditsUsed(session_token, dbUrl),
      logUsageEvent(session_token, 'dev-mock-plan', dbUrl),
    ]);
    res.status(200).json(mockPlanProposal(plan_context as PlanContext));
    return;
  }

  // ── Production path ─────────────────────────────────────────────────────────
  const modelConfig = resolveModel();
  if (!modelConfig) {
    const requested = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
    const provider: AiProvider = requested === 'anthropic' || requested === 'openai' || requested === 'google' ? requested : 'openai';
    const keyEnv = PROVIDER_KEY_ENV[provider];
    sendError(res, 503, `לא הוגדר מפתח AI עבור ${PROVIDER_LABEL[provider]}. הוסף ${keyEnv}.`, 'NO_API_KEY');
    return;
  }

  const dbUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!dbUrl) {
    sendError(res, 503, 'Database not configured. Set DATABASE_URL to enable AI quota tracking.', 'NO_DATABASE_URL');
    return;
  }

  const allowed = await runQuotaCheck(session_token, dbUrl, res);
  if (!allowed) return;

  const baseSystemPrompt = buildSystemPrompt({
    program_id,
    plan_context: plan_context as PlanContext,
    course_context,
  });

  const planSystemPrompt = `${baseSystemPrompt}

## משימה: בניית תוכנית סמסטרים מותאמת אישית

המשתמש ביקש שתבנה הצעת תוכנית סמסטרים מעודכנת, בהתאם להעדפות הבאות:

${preferencesToHebrew(preferences)}

${preferences.action_type && preferences.action_type !== 'full_plan' ? `## סוג הפעולה המבוקשת\n${ACTION_TYPE_HE[preferences.action_type]}\n` : ''}
${preferences.pinned_course_ids?.length ? `## קורסים מסומנים כ"אל תזיז"\nאסור בשום אופן להזיז את הקורסים הבאים מהסמסטר הנוכחי שלהם בלוח: ${preferences.pinned_course_ids.join(', ')}. אם קורס כזה משובץ כיום בסמסטר מסוים, הוא חייב להישאר באותו סמסטר בדיוק בתוכנית המוצעת.\n` : ''}
${(!preferences.action_type || preferences.action_type === 'full_plan') ? `חשוב מאוד: עליך לבנות תוכנית מלאה להשלמת התואר עבור כל הסמסטרים שנותרו — לא רק להוסיף את הקורסים שהמשתמש ביקש. אסור להחזיר תוכנית חלקית שמכילה רק את הקורסים המבוקשים (wanted_course_ids) בתוספת הקורסים הקבועים שכבר משובצים. "קורסים שהמשתמש רוצה לכלול" הם העדפה בלבד, לא רשימת הקורסים המלאה.` : 'בהתאם לסוג הפעולה שצוין למעלה, התמקד בשינוי המבוקש בלבד והימנע משינויים נוספים שלא נדרשים.'}

הנחיות מחייבות:
- אסור לשבץ קורס שמופיע ב"סטטוס אישי" כ"הושלם" (completed) — קורסים אלה אינם חוזרים לתוכנית.
- קורסים "בלימוד כעת" (currently_taking) ו"מתוכננים" (planned) יש לשבץ בהתאם לסטטוס שלהם ולא להסיר אותם ללא סיבה.
- כל קורס מחויב (mandatory) שלא הושלם חייב להיות משובץ בתוכנית, בסמסטר מתוך effective_allowed_semesters שלו אם זה מוגדר. קורסי חובה גמישים (effective_allowed_semesters עם יותר מאפשרות אחת) — בחר עבורם את הסמסטר שמאזן את העומס בצורה הטובה ביותר.
- הוסף קורסי בחירה (electives) כדי למלא ככל הניתן את דרישות הקטגוריות (category requirements) — לא רק קורסים שהמשתמש ביקש. קורסים שהמשתמש סימן כ"להימנע" הם אילוץ רך: הוסף אותם רק אם נדרשים למילוי דרישה ואין חלופה סבירה.
- אין לשבץ קורס פעמיים.
- אין לחרוג מ-effective_allowed_semesters כאשר הוא מוגדר עבור קורס.
- התחשב בדרישות קדם, בדרישות הקטגוריות (קורסי בחירה), ובנתוני העומס מהסילבוס.
${preferences.max_weekly_hours != null ? `- מגבלת השעות השבועיות (${preferences.max_weekly_hours} ש״ש לסמסטר) היא אילוץ מחייב ורציני: חלק את הקורסים בין הסמסטרים — כולל קורסי חובה גמישים וקורסי בחירה — כך שאף סמסטר לא יחרוג ממנה. אל תשאיר סמסטר עמוס אם ניתן להעביר קורס גמיש/בחירה לסמסטר אחר. אם פיזור מוחלט בלתי אפשרי בגלל קורסים שמותרים רק בסמסטר מסוים (חובה קבוע), צמצם את החריגה למינימום האפשרי וציין זאת במפורש ב-warnings_he יחד עם הסיבה.` : ''}

ב-requirements_status החזר שורה לכל אחד מהבאים, אם ידוע:
- "קורסי חובה" — כמה קורסי חובה שלא הושלמו שובצו מתוך הסך הכול שנותר.
- כל קטגוריית בחירה (category requirement) שצוינה בהקשר — כמה קורסים שובצו מתוך הנדרש.
- "שעות/נקודות שנותרו" — אם ניתן להעריך מהנתונים שסופקו.
אם לא ניתן למלא דרישה כלשהי במלואה, הסבר מדוע ב-warnings_he והצע קורסים מתאימים להמשך.

החזר אך ורק אובייקט JSON התואם בדיוק לסכימה הבאה (ללא טקסט נוסף):
{
  "semesters": [{ "semester_id": "string", "course_ids": ["string"] }],
  "moves": [{ "course_id": "string", "from": "string|null", "to": "string" }],
  "warnings_he": ["string"],
  "rationale_he": "string — הסבר קצר בעברית לבחירות שנעשו",
  "requirements_status": [{ "name": "string", "required": number, "placed": number, "satisfied": boolean }]
}`;

  // Valid semester ids for this plan — used to keep the AI's semester_id
  // values consistent, and to retry with a stricter reminder if it deviates.
  const validSemesterIds = ((plan_context as PlanContext).semesters ?? []).map(s => s.id);
  const semesterIdHint = validSemesterIds.length
    ? `\n\nחשוב: שדה semester_id בכל סמסטר חייב להיות אחד מהערכים המדויקים הבאים (ללא שינוי): ${validSemesterIds.map(id => `"${id}"`).join(', ')}.`
    : '';

  let object: z.infer<typeof planProposalSchema> | null = null;
  let lastErr: unknown = null;

  // Up to 2 attempts: structured output occasionally returns malformed JSON
  // or paraphrased semester_id values — retry once with a stricter reminder.
  for (let attempt = 0; attempt < 2 && !object; attempt++) {
    try {
      const result = await generateObject({
        model: modelConfig.model,
        schema: planProposalSchema,
        system: planSystemPrompt + (attempt > 0 ? semesterIdHint : ''),
        prompt: attempt > 0
          ? 'הפלט הקודם לא תאם את הסכימה הנדרשת. בנה מחדש את הצעת התוכנית, והקפד להחזיר JSON תקין בלבד התואם בדיוק לסכימה, עם semester_id מתוך הרשימה שצוינה.'
          : 'בנה את הצעת התוכנית לפי ההנחיות וההעדפות שלעיל.',
      });
      object = result.object;
    } catch (err) {
      lastErr = err;
      console.error(`[ai/generate-plan] generateObject attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  if (!object) {
    sendError(res, 503, 'לא ניתן ליצור הצעת תוכנית כעת — תשובת ה-AI לא תאמה את הפורמט הנדרש. נסה שוב.', 'AI_PROVIDER_ERROR',
      { detail: lastErr instanceof Error ? lastErr.message : String(lastErr) });
    return;
  }

  await Promise.allSettled([
    incrementCreditsUsed(session_token, dbUrl),
    logUsageEvent(session_token, modelConfig.name, dbUrl),
  ]);

  // Normalize semester_id values (Hebrew labels, casing variants, etc.) to
  // the canonical ids used by the board, and surface any placements that
  // could not be mapped as Hebrew warnings instead of silently dropping them.
  const { proposal: normalized, dropped } = normalizePlanProposal(object);
  if (dropped.length) {
    const courseNames: Record<string, string> = {};
    for (const sem of (plan_context as PlanContext).semesters ?? []) {
      for (const c of sem.courses) {
        if (c.name_he) courseNames[c.course_id] = c.name_he;
      }
    }
    normalized.warnings_he = [
      ...normalized.warnings_he,
      ...droppedPlacementWarnings(dropped, courseNames),
    ];
  }

  res.status(200).json(normalized);
}

/** Deterministic mock proposal for dev mode — echoes the current plan unchanged. */
function mockPlanProposal(planContext: PlanContext): unknown {
  return {
    semesters: (planContext.semesters ?? []).map(s => ({
      semester_id: s.id,
      course_ids: s.courses.map(c => c.course_id),
    })),
    moves: [],
    warnings_he: ['[מצב פיתוח] זוהי תוכנית לדוגמה — אין קריאה לספק AI אמיתי.'],
    rationale_he: 'מצב פיתוח: התוכנית המוצעת זהה לתוכנית הנוכחית (ללא קריאת AI אמיתית).',
    requirements_status: [],
  };
}
