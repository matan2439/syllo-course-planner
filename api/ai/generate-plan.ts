/**
 * POST /api/ai/generate-plan
 *
 * Generates a personalized semester-plan proposal. Supports two code paths:
 *
 * DEFAULT (AI_USE_AGENTIC_PLANNER unset):
 *   PlannerWorker + GreedyOrchestrator / LlmOrchestrator (unchanged).
 *
 * AGENTIC (AI_USE_AGENTIC_PLANNER=true):
 *   PlannerAgent + BeamSearchStrategy. LlmExplainer is injected as an
 *   ExplanationCapability in production; omitted in dev mode so no LLM
 *   step-selection or explanation calls happen.
 *
 * Both paths produce the SAME PlanProposal response contract (semesters, moves,
 * warnings_he, rationale_he, requirements_status, errors, blocked) plus the
 * additive optional `trace`. The apply/reject UI flow is unaffected.
 *
 * CLARIFICATION PREFLIGHT (AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT=true, default disabled):
 *   Opt-in only — when unset/false, behavior is identical to the above (any
 *   clarification_answers in the request body are ignored). When enabled,
 *   runs the deterministic clarification check (resumeClarificationPreflight,
 *   academic_clarification_preflight.ts) before either planner path, applying
 *   any optional clarification_answers first. If a critical input is still
 *   missing, returns { needsClarification: true, clarification, viewModel }
 *   instead of a PlanProposal — neither planner path runs, no board/model is
 *   loaded. Once all critical inputs are present (whether from the original
 *   request or from clarification_answers), execution falls through to the
 *   existing planning path below unchanged.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { parseProgramVersionId, queryBoardJson } from '../board';
import { buildConstraintModel, planContextToState } from './planner_model';
import { loadLocalBoardJson } from './board_loader';
import { PlannerWorker } from './planner_worker';
import { LlmOrchestrator } from './planner_orchestrator';
import { PlannerAgent } from './planner_agent';
import { BeamSearchStrategy } from './planner_search_beam';
import { LlmExplainer } from './llm_explainer';
import { validateCandidate } from './planner_validate';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';
import { resolveModel, isDevMode, isBypassQuota, isTestModeBypass, sendError } from './course-planner';
import { getSemesterLoad } from './completion_analysis';
import { HARD_LOAD_CAP, ABSOLUTE_MAX_REASONABLE } from './load_constants';
import type { SearchCapability } from './planner_capabilities';
import type { ConstraintModel, PlanState, PlannerMutation } from './planner_types';
import { resumeClarificationPreflight } from './academic_clarification_preflight';
import { mergeClarificationAnswersIntoGeneratePlanInputs } from './academic_clarification_plan_inputs';

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

const clarificationAnswerSchema = z.object({
  questionId: z.string(),
  value: z.union([z.array(z.string()), z.string(), z.number()]),
});

const requestSchema = z.object({
  program_id:    z.string().min(1, 'program_id is required'),
  plan_context:  z.any(),
  course_context: z.string().max(8000).optional(),
  preferences:   preferencesSchema,
  session_token: z.string().uuid('session_token must be a valid UUID'),
  // Additive, optional — only consumed when AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT is enabled.
  clarification_answers: z.array(clarificationAnswerSchema).optional(),
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
export function buildModel(board: any, ctx: any, prefs: Preferences, program_id?: string, currentlyPlannedCourseIds?: string[]): ConstraintModel {
  // Phase 0 — identity metadata only; parseProgramVersionId is the same parser
  // already used above to route the board_json lookup, reused here for the
  // model's programId/catalogYear. No institutionId source exists yet.
  const pv = program_id ? parseProgramVersionId(program_id) : null;
  return buildConstraintModel(board, {
    completedCourseIds: (ctx?.personal_status?.completed ?? []).map((c: any) => c.course_id),
    currentlyPlannedCourseIds,
    wantedCourseIds: prefs.wanted_course_ids,
    unwantedCourseIds: prefs.unwanted_course_ids,
    disallowedCourseIds: prefs.disallowed_course_ids ?? prefs.strongly_avoided_course_ids,
    pinnedCourseIds: ctx?.pinned_course_ids,
    maxHoursPerSemester: prefs.max_weekly_hours ?? undefined,
    priorHours: priorHoursFromContext(ctx),
    overloadAccepted: prefs.overload_accepted,
    overloadConfirmedAt: prefs.overload_confirmed_at,
    programId: pv?.base,
    catalogYear: pv?.year,
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

/**
 * Deterministic Hebrew rationale — used when ExplanationCapability is absent or
 * throws (dev mode / LLM failure fallback).
 */
function deterministicRationale(finalState: PlanState, model: ConstraintModel): string {
  const placed = Object.values(finalState.semesters).flat();
  const totalHours = model.priorHours + placed.reduce((s, id) => s + (model.profiles.get(id)?.hours ?? 0), 0);
  return placed.length === 0
    ? 'תוכנית אוטומטית — לא שובצו קורסים חדשים.'
    : `תוכנית אוטומטית — ${placed.length} קורסים, ${totalHours} ש"ש לקראת השלמת התואר.`;
}

/**
 * Option B toProposal — pure function of (finalState, model, initialState, pinnedHome, rationale_he).
 * No PlannerWorker dependency; shared by both the worker and agentic paths.
 */
function toProposal(
  finalState: PlanState,
  model: ConstraintModel,
  initialState: PlanState,
  pinnedHome: Record<string, string>,
  rationale_he: string,
) {
  const semesters = model.knownSemesterIds
    .filter(id => (finalState.semesters[id] ?? []).length > 0)
    .map(id => ({ semester_id: id, course_ids: finalState.semesters[id] }));

  // moves: diff initial board against final plan
  const initialSemOf: Record<string, string> = {};
  for (const [sem, ids] of Object.entries(initialState.semesters)) for (const id of ids) initialSemOf[id] = sem;
  const moves: Array<{ course_id: string; from: string | null; to: string }> = [];
  for (const [sem, ids] of Object.entries(finalState.semesters)) {
    for (const id of ids) {
      const from = initialSemOf[id] ?? null;
      if (from !== sem) moves.push({ course_id: id, from, to: sem });
    }
  }

  const report = validateCandidate(finalState, model, pinnedHome);
  const placed = new Set(Object.values(finalState.semesters).flat());

  const requirements_status: Array<{ name: string; required: number; placed: number; satisfied: boolean }> = [];
  requirements_status.push({
    name: 'קורסי חובה',
    required: model.requiredMandatoryCourseIds.length,
    placed: model.requiredMandatoryCourseIds.filter(id => placed.has(id)).length,
    satisfied: model.requiredMandatoryCourseIds.every(id => placed.has(id)),
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
  // report.warnings === validatePlanState(finalState, model, pinnedHome).warnings
  warnings_he.push(...report.warnings);

  return { semesters, moves, warnings_he, rationale_he, requirements_status };
}

/** Build pinnedHome map from model.pinnedCourseIds + initialState positions. */
function buildPinnedHome(model: ConstraintModel, initialState: PlanState): Record<string, string> {
  const pinnedHome: Record<string, string> = {};
  for (const cid of model.pinnedCourseIds) {
    for (const [sem, ids] of Object.entries(initialState.semesters)) {
      if (ids.includes(cid)) { pinnedHome[cid] = sem; break; }
    }
  }
  return pinnedHome;
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
  const { program_id, plan_context, preferences, session_token, clarification_answers } = parsed.data;

  const dbUrl = (process.env.DATABASE_URL ?? '').trim();

  // Quota gate — unchanged behavior: required unless an explicit dev bypass.
  if (!isBypassQuota()) {
    if (!dbUrl) { sendError(res, 503, 'Database not configured. Set DATABASE_URL or AI_DEV_BYPASS_QUOTA=true for local dev.', 'NO_DATABASE_URL'); return; }
    if (!(await runQuotaCheck(session_token, dbUrl, res))) return;
  }

  // Clarification preflight — additive, opt-in only (default disabled, behavior
  // otherwise unchanged). When a critical input is still missing after any
  // supplied clarification_answers are applied, returns a structured
  // clarification response instead of delegating to either planner path
  // below. See academic_clarification_preflight.ts. Once unblocked, any valid
  // clarification_answers are also merged into the actual planning inputs
  // (plan_context/preferences) below — not just used to satisfy the gate. See
  // academic_clarification_plan_inputs.ts.
  let effectivePlanContext = plan_context;
  let effectivePreferences = preferences;
  if (process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT === 'true') {
    const resumed = await resumeClarificationPreflight(
      {
        programId: program_id,
        dbUrl,
        buildModelOptions: {
          completedCourseIds: (plan_context?.personal_status?.completed ?? []).map((c: any) => c.course_id),
          disallowedCourseIds: preferences.disallowed_course_ids ?? preferences.strongly_avoided_course_ids,
          maxHoursPerSemester: preferences.max_weekly_hours ?? undefined,
        },
      },
      clarification_answers ?? [],
    );
    if (resumed.blocked) {
      res.status(200).json({
        needsClarification: true,
        clarification: resumed.clarification,
        viewModel: resumed.viewModel,
      });
      return;
    }
    const merged = mergeClarificationAnswersIntoGeneratePlanInputs(plan_context, preferences, clarification_answers ?? []);
    effectivePlanContext = merged.planContext;
    effectivePreferences = merged.preferences;
  }
  // Unconditional (explicitly approved default-behavior change): the live
  // frontend already sends personal_status.currently_taking on every request,
  // and ignoring it let a currently-taken course be re-proposed by the planner.
  const currentlyPlannedCourseIds: string[] =
    (effectivePlanContext?.personal_status?.currently_taking ?? []).map((c: any) => c.course_id);

  // Board — always plan over the full course universe.
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

  const model = buildModel(board, effectivePlanContext, effectivePreferences, program_id, currentlyPlannedCourseIds);
  const initialState = planContextToState(effectivePlanContext, model);
  const pinnedHome = buildPinnedHome(model, initialState);
  const modelCfg = resolveModel();

  let proposal: ReturnType<typeof toProposal>;
  let traceForResponse: unknown[];
  let hitMaxSteps = false;
  let useLlm = false;

  if (process.env.AI_USE_AGENTIC_PLANNER === 'true') {
    // ── PlannerAgent path (Phase 5+) ─────────────────────────────────────────
    const useLlmExplain = !isDevMode() && !!modelCfg;
    const explanation = useLlmExplain ? new LlmExplainer(modelCfg!.model) : undefined;
    useLlm = useLlmExplain;

    const searchCap: SearchCapability<PlanState, PlannerMutation> = {
      search: (s, deps, opts) => new BeamSearchStrategy<PlanState, PlannerMutation>().explore(s, deps, opts),
    };
    const agent = new PlannerAgent({
      model, initialState, pinnedHome, search: searchCap, explanation, maxSteps: 150, beamWidth: 6,
    });

    let agentResult;
    try {
      agentResult = await agent.run();
    } catch (err) {
      console.error('[ai/generate-plan] PlannerAgent error, falling back to greedy:', err instanceof Error ? err.message : String(err));
      const fallback = new PlannerWorker(model, initialState, { topN: 6, rolloutSteps: 80 });
      fallback.run(500, 'greedy');
      agentResult = { finalState: fallback.getPlan(), trace: fallback.getTrace(), gaps: [], meta: undefined, rationale_he: fallback.explain().summary_he };
    }

    const rationale_he = agentResult.rationale_he ?? deterministicRationale(agentResult.finalState, model);
    proposal = toProposal(agentResult.finalState, model, initialState, pinnedHome, rationale_he);
    traceForResponse = agentResult.trace;
    hitMaxSteps = agentResult.meta != null && agentResult.meta.terminationReason === 'max_steps';

  } else {
    // ── PlannerWorker path (default) ─────────────────────────────────────────
    const worker = new PlannerWorker(model, initialState, { topN: 6, rolloutSteps: 80 });
    useLlm = !isDevMode() && !!modelCfg;
    try {
      if (useLlm) await new LlmOrchestrator(modelCfg!.model, { maxSteps: 24 }).run(worker);
      else worker.run(500, 'greedy');
    } catch (err) {
      console.error('[ai/generate-plan] orchestrator error, finishing greedily:', err instanceof Error ? err.message : String(err));
      worker.run(500, 'greedy');
    }

    proposal = toProposal(worker.getPlan(), model, initialState, pinnedHome, worker.explain().summary_he);
    traceForResponse = worker.getTrace();
    hitMaxSteps = worker.getTrace().some(a => a.action === 'STOP' && a.reason?.includes('maxSteps'));
  }

  const blockingErrors = overloadGate(proposal.semesters, model, effectivePreferences);

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
    trace: traceForResponse,
  });
}
