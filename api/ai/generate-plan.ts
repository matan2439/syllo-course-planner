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
import { planProposalSchema } from './plan_validation';

const preferencesSchema = z.object({
  max_weekly_hours:        z.number().nullish(),
  balance_load:            z.boolean().optional(),
  avoid_multiple_labs:     z.boolean().optional(),
  avoid_multiple_projects: z.boolean().optional(),
  preferred_categories:    z.array(z.string()).optional(),
  wanted_course_ids:       z.array(z.string()).optional(),
  unwanted_course_ids:     z.array(z.string()).optional(),
  extra_request_he:        z.string().max(1000).optional(),
});

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

הנחיות מחייבות:
- אסור לשבץ קורס שמופיע ב"סטטוס אישי" כ"הושלם" (completed) — קורסים אלה אינם חוזרים לתוכנית.
- קורסים "בלימוד כעת" (currently_taking) ו"מתוכננים" (planned) יש לשבץ בהתאם לסטטוס שלהם ולא להסיר אותם ללא סיבה.
- כל קורס מחויב (mandatory) חייב להיות משובץ בתוכנית, בסמסטר מתוך effective_allowed_semesters שלו אם זה מוגדר.
- אין לשבץ קורס פעמיים.
- אין לחרוג מ-effective_allowed_semesters כאשר הוא מוגדר עבור קורס.
- התחשב בדרישות קדם, בדרישות הקטגוריות (קורסי בחירה), במגבלת השעות השבועית שהוגדרה, ובנתוני העומס מהסילבוס.

החזר אך ורק אובייקט JSON התואם בדיוק לסכימה הבאה (ללא טקסט נוסף):
{
  "semesters": [{ "semester_id": "string", "course_ids": ["string"] }],
  "moves": [{ "course_id": "string", "from": "string|null", "to": "string" }],
  "warnings_he": ["string"],
  "rationale_he": "string — הסבר קצר בעברית לבחירות שנעשו",
  "requirements_status": [{ "name": "string", "required": number, "placed": number, "satisfied": boolean }]
}`;

  try {
    const result = await generateObject({
      model: modelConfig.model,
      schema: planProposalSchema,
      system: planSystemPrompt,
      prompt: 'בנה את הצעת התוכנית לפי ההנחיות וההעדפות שלעיל.',
    });

    await Promise.allSettled([
      incrementCreditsUsed(session_token, dbUrl),
      logUsageEvent(session_token, modelConfig.name, dbUrl),
    ]);

    res.status(200).json(result.object);
  } catch (err) {
    console.error('[ai/generate-plan] generateObject failed:', err instanceof Error ? err.message : String(err));
    sendError(res, 503, 'לא ניתן ליצור הצעת תוכנית כעת. נסה שוב.', 'AI_PROVIDER_ERROR',
      { detail: err instanceof Error ? err.message : String(err) });
  }
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
