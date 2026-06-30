/**
 * POST /api/ai/generate-plan
 *
 * Generates a personalized semester-plan proposal. As of the agentic refactor
 * this is a THIN WRAPPER over the deterministic Planner Worker: it builds the
 * ConstraintModel (full universe from board_json when available, else from the
 * client plan_context), seeds the worker from the current board, drives it (the
 * LLM orchestrator when a model is configured, otherwise the deterministic
 * greedy orchestrator), and returns the SAME PlanProposal response contract as
 * before — plus an additive, optional `trace`.
 *
 * The response is a PREVIEW ONLY — the client validates it and the user must
 * confirm before any board state changes. The response shape (semesters, moves,
 * warnings_he, rationale_he, requirements_status, errors, blocked) is unchanged
 * so the existing apply/reject UI flow keeps working without modification.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { parseProgramVersionId, queryBoardJson } from '../board';
import { buildConstraintModel, planContextToState } from './planner_model';
import { loadLocalBoardJson } from './board_loader';
import { PlannerWorker } from './planner_worker';
import { LlmOrchestrator } from './planner_orchestrator';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';
import { resolveModel, isDevMode, isBypassQuota, isTestModeBypass, sendError } from './course-planner';
import { getSemesterLoad } from './completion_analysis';
import { HARD_LOAD_CAP, ABSOLUTE_MAX_REASONABLE } from './load_constants';
import type { ConstraintModel, PlanState } from './planner_types';

export const preferencesSchema = z.object({
  max_weekly_hours:        z.number().nullish(),
  balance_load:            z.boolean().optional(),
  avoid_multiple_labs:     z.boolean().optional(),
  avoid_multiple_projects: z.boolean().optional(),
  preferred_categories:    z.array(z.string()).optional(),
  wanted_course_ids:       z.array(z.string()).optional(),
  unwanted_course_ids:     z.array(z.string()).optional(),
  // Hard exclusions (additive, optional — older clients omit these).
  disallowed_course_ids:        z.array(z.string()).optional(),
  strongly_avoided_course_ids:  z.array(z.string()).optional(),
  extra_request_he:        z.string().max(1000).optional(),
  action_type:             z.enum(['full_plan', 'balance_load', 'add_electives', 'fix_prerequisites', 'minimal_changes']).optional(),
  pinned_course_ids:       z.array(z.string()).optional(),
  overload_accepted:       z.boolean().optional(),
  overload_confirmed_at:   z.number().nullish(),
});

const requestSchema = z.object({
  program_id:    z.string().min(1, 'program_id is required'),
  plan_context:  z.any(),
  course_context: z.string().max(8000).optional(),
  preferences:   preferencesSchema,
  session_token: z.string().uuid('session_token must be a valid UUID'),
});

type Preferences = z.infer<typeof preferencesSchema>;

async function runQuotaCheck(session_token: string, dbUrl: string, res: VercelResponse): Promise<boolean> {
  let quota;
  try {
    quota = await checkAndEnsureSession(session_token, dbUrl);
  } catch (err) {
    console.error('[ai/generate-plan] quota DB error:', err instanceof Error ? err.message : String(err));
    sendError(res, 503, 'לא ניתן לבדוק מכסת AI — בעיה זמנית במסד הנתונים.', 'DB_ERROR', { phase: 'quota_check' });
    return false;
  }
  if (!quota.allowed) {
    if (isTestModeBypass()) { res.setHeader('X-AI-Quota-Bypass', 'true'); return true; }
    sendError(res, 429, 'מכסת שאלות ה-AI החינמית נוצלה.', 'QUOTA_EXCEEDED', {
      credits_used: quota.credits_used, free_limit: quota.free_limit, credits_paid: quota.credits_paid, remaining: 0,
    });
    return false;
  }
  return true;
}

export function priorHoursFromContext(ctx: any): number {
  const thp = ctx?.total_hours_progress ?? {};
  // currently_planned_hours is excluded: board-placed courses are already seeded
  // into initialState by planContextToState — counting them here too would
  // inflate degreeHours and make the planner stop early.
  return thp.manual_completed_degree_hours ?? (thp.known_completed_hours ?? 0);
}

/** Build the model from board_json (full universe). board is always non-null here. */
function buildModel(board: any, ctx: any, prefs: Preferences): ConstraintModel {
  return buildConstraintModel(board, {
    completedCourseIds: (ctx?.personal_status?.completed ?? []).map((c: any) => c.course_id),
    wantedCourseIds: prefs.wanted_course_ids,
    unwantedCourseIds: prefs.unwanted_course_ids,
    disallowedCourseIds: prefs.disallowed_course_ids ?? prefs.strongly_avoided_course_ids,
    pinnedCourseIds: ctx?.pinned_course_ids,
    maxHoursPerSemester: prefs.max_weekly_hours ?? undefined,
    priorHours: priorHoursFromContext(ctx),
  });
}

/** Same overload gate as before: block above the hard cap / absolute max. */
function overloadGate(
  semesters: Array<{ semester_id: string; course_ids: string[] }>,
  model: ConstraintModel,
  prefs: Preferences,
): string[] {
  const courseHours: Record<string, { hours?: number | null }> = {};
  for (const [id, p] of model.profiles) courseHours[id] = { hours: p.hours };
  const userConfirmed = prefs.overload_accepted === true && !!prefs.overload_confirmed_at;
  const errors: string[] = [];
  for (const sem of semesters) {
    const hrs = getSemesterLoad(sem, courseHours);
    if (hrs > ABSOLUTE_MAX_REASONABLE) {
      errors.push(`סמסטר ${sem.semester_id}: ${hrs} ש"ש — חריגה לא סבירה מעל ${ABSOLUTE_MAX_REASONABLE}. לא ניתן להחיל את התוכנית.`);
    } else if (hrs > HARD_LOAD_CAP && !userConfirmed) {
      errors.push(`סמסטר ${sem.semester_id}: ${hrs} ש"ש — חריגה מהמגבלה הקשיחה (${HARD_LOAD_CAP}). נדרש אישור חריגה מפורש לפני החלת התוכנית.`);
    }
  }
  return errors;
}

/** Convert the worker's final plan to the PlanProposal response shape. */
function toProposal(worker: PlannerWorker, model: ConstraintModel, initialState: PlanState) {
  const finalPlan = worker.getPlan();
  const semesters = model.knownSemesterIds
    .filter(id => (finalPlan.semesters[id] ?? []).length > 0)
    .map(id => ({ semester_id: id, course_ids: finalPlan.semesters[id] }));

  // moves: diff the seeded board against the final plan.
  const initialSemOf: Record<string, string> = {};
  for (const [sem, ids] of Object.entries(initialState.semesters)) for (const id of ids) initialSemOf[id] = sem;
  const moves: Array<{ course_id: string; from: string | null; to: string }> = [];
  for (const [sem, ids] of Object.entries(finalPlan.semesters)) {
    for (const id of ids) {
      const from = initialSemOf[id] ?? null;
      if (from !== sem) moves.push({ course_id: id, from, to: sem });
    }
  }

  const report = worker.validateCandidate();
  const st = worker.getState();
  const placed = new Set(Object.values(finalPlan.semesters).flat());

  const requirements_status: Array<{ name: string; required: number; placed: number; satisfied: boolean }> = [];
  requirements_status.push({
    name: 'קורסי חובה',
    required: model.requiredMandatoryCourseIds.length,
    placed: model.requiredMandatoryCourseIds.filter(id => placed.has(id)).length,
    satisfied: st.mandatoryPlaced === model.requiredMandatoryCourseIds.length,
  });
  for (const cat of model.categories) {
    const p = cat.candidateIds.filter(id => placed.has(id)).length;
    requirements_status.push({ name: cat.name, required: cat.required, placed: Math.min(p, cat.required), satisfied: p >= cat.required });
  }

  const warnings_he: string[] = [];
  if (!report.degreeMet) warnings_he.push(`התוכנית משלימה ${report.degreeHours}/${model.degreeRequiredHours} ש"ש.`);
  for (const id of report.missingMandatory) warnings_he.push(`חסר קורס חובה: ${model.profiles.get(id)?.name_he ?? id}.`);
  for (const cid of report.unsatisfiedCategories) {
    const c = model.categories.find(x => x.id === cid);
    warnings_he.push(`דרישת קטגוריה לא מולאה: ${c?.name ?? cid}.`);
  }
  warnings_he.push(...worker.validate().warnings);

  return { semesters, moves, warnings_he, rationale_he: worker.explain().summary_he, requirements_status };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { sendError(res, 405, 'Method not allowed'); return; }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Invalid request', 'INVALID_REQUEST', {
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const { program_id, plan_context, preferences, session_token } = parsed.data;

  const dbUrl = (process.env.DATABASE_URL ?? '').trim();

  // Quota gate — unchanged behavior: required unless an explicit dev bypass.
  if (!isBypassQuota()) {
    if (!dbUrl) { sendError(res, 503, 'Database not configured. Set DATABASE_URL or AI_DEV_BYPASS_QUOTA=true for local dev.', 'NO_DATABASE_URL'); return; }
    if (!(await runQuotaCheck(session_token, dbUrl, res))) return;
  }

  // Model — always plan over the full course universe.
  // 1. DB available: query board_json from database (production path).
  // 2. DB absent: load committed local snapshot from data/boards/{program_id}.json.
  // 3. Neither available: hard error — never fall back to client-subset planning.
  let board: any = null;
  if (dbUrl) {
    const pv = parseProgramVersionId(program_id);
    if (pv) {
      try { board = await queryBoardJson(dbUrl, pv.base, pv.year); } catch { board = null; }
    }
  }
  if (!board) {
    board = loadLocalBoardJson(program_id);
  }
  if (!board) {
    sendError(res, 503, 'תוכנית הלימודים המלאה אינה זמינה. נא לנסות שוב מאוחר יותר.', 'NO_UNIVERSE');
    return;
  }
  const model = buildModel(board, plan_context, preferences);
  const initialState = planContextToState(plan_context, model);

  const worker = new PlannerWorker(model, initialState, { topN: 6, rolloutSteps: 80 });
  const modelCfg = resolveModel();
  const useLlm = !isDevMode() && !!modelCfg;
  try {
    if (useLlm) await new LlmOrchestrator(modelCfg!.model, { maxSteps: 24 }).run(worker);
    else worker.run(500, 'greedy');
  } catch (err) {
    console.error('[ai/generate-plan] orchestrator error, finishing greedily:', err instanceof Error ? err.message : String(err));
    worker.run(500, 'greedy');
  }

  const proposal = toProposal(worker, model, initialState);
  const blockingErrors = overloadGate(proposal.semesters, model, preferences);

  // If the planner hit the step limit before reaching the goal, surface a warning and block.
  const hitMaxSteps = worker.getTrace().some(a => a.action === 'STOP' && a.reason?.includes('maxSteps'));
  if (hitMaxSteps) {
    proposal.warnings_he.push('המתכנן לא הסיים את החישוב בגלל מגבלת מספר הצעדים — התוכנית עשויה להיות חלקית.');
    blockingErrors.push('PLANNER_STEP_LIMIT');
  }

  if (!isBypassQuota() && dbUrl) {
    await Promise.allSettled([
      incrementCreditsUsed(session_token, dbUrl),
      logUsageEvent(session_token, useLlm ? (modelCfg?.name ?? 'llm') : 'greedy', dbUrl),
    ]);
  }

  res.status(200).json({
    ...proposal,
    errors: blockingErrors,
    blocked: blockingErrors.length > 0,
    trace: worker.getTrace(),
  });
}
