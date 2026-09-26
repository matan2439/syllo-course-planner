import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  conversationRequestSchema,
  type ConversationProposal,
} from '../../shared/planner/conversation-wire';
import type { Model } from '@openai/agents';
import { isBypassQuota, isTestModeBypass } from './course-planner';
import { checkAndEnsureSession, incrementCreditsUsed, logUsageEvent } from './_quota';
import { PlanningSession } from './agent/session';
import {
  agentModelName,
  runPlannerAgent,
  type PlannerAgentDeps,
  type PlannerAgentInput,
  type PlannerAgentResult,
} from './agent/planner_agent';
import { candidateIdentity } from './postgres/postgres_authoritative_apply_store';
import { storedDistributionPolicy } from './planner_policy_context';
import { selectCandidate } from './candidate_set';
import { buildPlanAlternatives, constraintFingerprint as planConstraintFingerprint, type PlanAlternative } from './plan_alternatives';
import {
  clarifyForAcademicDecision,
  extractClarificationContext,
  hasCriticalMissingInput,
  resolveHardExcludedCourseIds,
} from './academic_decision_runtime';
import {
  runAcademicDecisionAgent as runAcademicDecisionAgentDefault,
  type AcademicDecisionAgentRun,
} from './academic_decision_integration';
import type { BuildModelOptions } from './planner_model';
import { PROPOSAL_TTL_MS, newProposalId, toReceipt, type ProposalRecord, type ProposalStore } from './proposal_store';
import {
  getAcademicContextStore,
  getBoardRepository,
  getProposalStore,
  plannerStorageErrorCode,
  preferenceDigest,
  academicStatusDigest,
} from './apply_runtime';
import { resolveOwner } from './session_owner';
import type { CommittedBoard } from './board_repository';
import type { AcademicContextRecord } from './academic_context_store';
import type { AcademicContextStore } from './academic_context_store';
import { loadLocalBoardJson } from './board_loader';
import { completedCategoryCountsFromContext, recomputeRequirements } from './requirements_recompute';
import type { PreferenceProfile } from './preference_model';
import { applyConversationClarificationAnswers, withCompletedCredit } from './conversation_clarification';
import { DeterministicProposalExplanationCapability } from './proposal_explanation';
import { DeterministicCandidateDecisionCapability } from './candidate_decision';

type AgentModelConfig = { model: string | Model; name: string };

/** The OpenAI Agents SDK co-pilot needs an OpenAI key; without one the assistant is unavailable. */
function defaultResolveModel(): AgentModelConfig | null {
  if (!(process.env.OPENAI_API_KEY ?? '').trim()) return null;
  const name = agentModelName();
  return { model: name, name };
}

/** Quota gate. ponytail: no DATABASE_URL (local/dev) means no quota tracking. */
async function defaultCheckQuota(sessionToken: string): Promise<{ allowed: boolean }> {
  const dbUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!dbUrl || isBypassQuota()) return { allowed: true };
  const quota = await checkAndEnsureSession(sessionToken, dbUrl);
  return { allowed: quota.allowed || isTestModeBypass() };
}

/** One credit per delivered proposal — a chat turn that only asks or answers is free. */
async function defaultRecordUsage(sessionToken: string, modelName: string): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!dbUrl || isBypassQuota()) return;
  await Promise.allSettled([
    incrementCreditsUsed(sessionToken, dbUrl),
    logUsageEvent(sessionToken, modelName, dbUrl),
  ]);
}

type ConversationEndpointDeps = {
  resolveModel?: () => AgentModelConfig | null;
  checkQuota?: (sessionToken: string) => Promise<{ allowed: boolean }>;
  recordUsage?: (sessionToken: string, modelName: string) => Promise<void>;
  loadBoard?: (ownerId: string, programId: string) => Promise<CommittedBoard | null>;
  loadAcademicContext?: (ownerId: string, programId: string) => Promise<AcademicContextRecord | null>;
  loadProgramBoard?: (programId: string) => unknown | null;
  runAgent?: (input: PlannerAgentInput, deps: PlannerAgentDeps) => Promise<PlannerAgentResult>;
  runAcademicDecisionAgent?: (
    input: Parameters<typeof runAcademicDecisionAgentDefault>[0],
  ) => Promise<AcademicDecisionAgentRun>;
  putProposal?: ProposalStore['put'];
  putAcademicContext?: AcademicContextStore['put'];
};

const unavailable = () => ({
  outcome: 'assistant_unavailable' as const,
  message_he: 'העוזר האקדמי אינו זמין כרגע.',
  events: [{ type: 'assistant_unavailable' as const, message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
  code: 'ASSISTANT_UNAVAILABLE' as const,
});

const CLARIFICATION_QUESTIONS_HE: Record<string, string> = {
  completed_courses: 'אילו קורסים כבר השלמת? אפשר לציין שמות או מספרי קורסים.',
  excluded_courses: 'האם יש קורסים שתרצה או תרצי להימנע מהם בתכנון?',
  current_courses: 'אילו קורסים את או אתה לומד/ת עכשיו?',
  max_weekly_hours: 'מהי מגבלת השעות השבועית שנוח לך ללמוד?',
  track_or_focus: 'באיזה מסלול או תחום מיקוד את או אתה מתכנן/ת להתמקד?',
};

/** The question for the first CRITICAL missing input (questions align 1:1 with missingInputs). */
function firstCriticalQuestion<Q>(clarification: { missingInputs: Array<{ critical: boolean }>; questions: Q[] }): Q | undefined {
  const index = clarification.missingInputs.findIndex((input) => input.critical);
  return index >= 0 ? clarification.questions[index] : clarification.questions[0];
}

function clarificationEvent(question: { id: string; question: string; options?: Array<{ label: string }> }) {
  return {
    type: 'clarification' as const,
    question_id: question.id as 'completed_courses' | 'current_courses' | 'excluded_courses' | 'max_weekly_hours' | 'track_or_focus',
    answer_type: question.id === 'max_weekly_hours' ? 'number' as const
      : question.id === 'track_or_focus' ? 'text' as const : 'course_id_list' as const,
    question_he: CLARIFICATION_QUESTIONS_HE[question.id] ?? question.question,
    ...(question.options?.length
      ? { options_he: question.options.map((option) => option.label) }
      : {}),
  };
}

function completedIdsOf(personalStatus: Record<string, unknown>): string[] {
  const completed = Array.isArray(personalStatus.completed) ? personalStatus.completed : [];
  return completed
    .map((course) => typeof course === 'string' ? course : (course as { course_id?: unknown })?.course_id)
    .filter((id): id is string => typeof id === 'string');
}

/** A status/json pair that writes the final NDJSON line of a streamed turn. */
function ndjsonResult(res: VercelResponse): Pick<VercelResponse, 'status' | 'json'> {
  let status = 200;
  const result = {
    status(code: number) { status = code; return result; },
    json(body: unknown) {
      res.write(`${JSON.stringify({ type: 'result', status, body })}\n`);
      res.end();
      return result;
    },
  };
  return result as unknown as Pick<VercelResponse, 'status' | 'json'>;
}

export function createConversationHandler(deps: ConversationEndpointDeps = {}) {
  const resolveModel = deps.resolveModel ?? defaultResolveModel;
  const loadBoard = deps.loadBoard ?? ((ownerId, programId) => getBoardRepository().load(ownerId, programId));
  const loadAcademicContext = deps.loadAcademicContext
    ?? ((ownerId, programId) => getAcademicContextStore().load(ownerId, programId));
  const loadProgramBoard = deps.loadProgramBoard ?? loadLocalBoardJson;
  const runAgent = deps.runAgent ?? runPlannerAgent;
  const checkQuota = deps.checkQuota ?? defaultCheckQuota;
  const recordUsage = deps.recordUsage ?? defaultRecordUsage;
  const runAcademicDecisionAgent = deps.runAcademicDecisionAgent ?? runAcademicDecisionAgentDefault;
  const putProposal = deps.putProposal ?? ((record: ProposalRecord) => getProposalStore().put(record));
  const putAcademicContext = deps.putAcademicContext ?? ((input: Parameters<AcademicContextStore['put']>[0]) => getAcademicContextStore().put(input));
  return async function conversationHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message_he: 'שיטה לא נתמכת.' });
      return;
    }

    const parsed = conversationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message_he: 'בקשת השיחה אינה תקינה.' });
      return;
    }

    const modelConfig = resolveModel();
    if (!modelConfig) {
      res.status(503).json(unavailable());
      return;
    }

    let quota: { allowed: boolean };
    try {
      quota = await checkQuota(parsed.data.session_token);
    } catch (error) {
      console.error('[ai/conversation] quota check failed:', (error as Error)?.constructor?.name);
      res.status(503).json({ ok: false, code: 'QUOTA_UNAVAILABLE', message_he: 'לא ניתן לבדוק מכסת AI כרגע. נא לנסות שוב.' });
      return;
    }
    if (!quota.allowed) {
      res.status(429).json({ ok: false, code: 'QUOTA_EXCEEDED', message_he: 'מכסת שאלות ה-AI החינמית נוצלה.' });
      return;
    }

    // NDJSON streaming (opt-in via Accept): once the agent starts, tool events and
    // reply text are written live, and the usual JSON body arrives as the final
    // {"type":"result","status","body"} line. Earlier errors stay plain JSON.
    const streaming = String(req.headers?.accept ?? '').includes('application/x-ndjson');
    const writeLine = (line: unknown) => res.write(`${JSON.stringify(line)}\n`);
    let out: Pick<VercelResponse, 'status' | 'json'> = res;
    try {
      const owner = resolveOwner(req as unknown as { headers?: Record<string, string | string[] | undefined> }, res);
      const board = await loadBoard(owner.ownerId, parsed.data.program_id);
      const currentBoardVersion = board?.version ?? null;
      if ((parsed.data.board_version ?? null) !== currentBoardVersion) {
        res.status(409).json({
          ok: false,
          code: 'BOARD_VERSION_CONFLICT',
          message_he: 'הלוח השתנה מאז תחילת השיחה.',
          currentBoardVersion,
        });
        return;
      }
      const academicContext = await loadAcademicContext(owner.ownerId, parsed.data.program_id);
      if (!academicContext || academicContext.digest !== parsed.data.academic_status_digest) {
        res.status(409).json({
          ok: false,
          code: academicContext ? 'ACADEMIC_CONTEXT_CONFLICT' : 'ACADEMIC_CONTEXT_MISSING',
          message_he: 'הסטטוס האקדמי השתנה או אינו זמין. יש לרענן אותו לפני המשך השיחה.',
        });
        return;
      }
      if (preferenceDigest(academicContext.preferences) !== parsed.data.preference_digest) {
        res.status(409).json({
          ok: false,
          code: 'PREFERENCE_CONTEXT_CONFLICT',
          message_he: 'העדפות התכנון השתנו. יש לרענן אותן לפני המשך השיחה.',
        });
        return;
      }
      const programBoard = loadProgramBoard(parsed.data.program_id);
      if (!programBoard) {
        res.status(503).json({
          ok: false,
          code: 'NO_PROGRAM_UNIVERSE',
          message_he: 'נתוני התוכנית הסמכותיים אינם זמינים כרגע.',
        });
        return;
      }

      let context = (academicContext.planContext ?? {}) as Record<string, unknown>;
      let preferences = (academicContext.preferences ?? {}) as Record<string, unknown>;
      let personalStatus = (context.personal_status ?? academicContext.personalStatus ?? {}) as Record<string, unknown>;
      let contextUpdate: {
        academic_status_digest: string;
        preference_digest: string;
      } | undefined;

      if (parsed.data.clarification_answers?.length) {
        const merged = applyConversationClarificationAnswers({
          programId: parsed.data.program_id,
          planContext: context,
          personalStatus,
          preferences,
          answers: parsed.data.clarification_answers.map((answer) => ({
            questionId: answer.question_id,
            value: answer.value,
          })),
        });
        if (merged.invalidAnswers.length > 0) {
          res.status(400).json({
            ok: false,
            code: 'INVALID_CLARIFICATION_ANSWER',
            message_he: 'תשובת ההבהרה אינה תואמת לשאלה שנשאלה.',
          });
          return;
        }
        if (merged.changed) {
          // Completed courses carry their degree credit (Years 1–2 are not on the board).
          const answeredCompleted = parsed.data.clarification_answers.some((answer) => answer.question_id === 'completed_courses');
          const mergedPlanContext = answeredCompleted
            ? withCompletedCredit(merged.planContext, parsed.data.program_id, programBoard, completedIdsOf(personalStatus))
            : merged.planContext;
          await putAcademicContext({
            ownerId: owner.ownerId,
            programId: parsed.data.program_id,
            digest: merged.academicStatusDigest,
            personalStatus: merged.personalStatus,
            planContext: mergedPlanContext,
            preferences: merged.preferences,
          });
          context = mergedPlanContext;
          personalStatus = merged.personalStatus;
          preferences = merged.preferences;
          contextUpdate = {
            academic_status_digest: merged.academicStatusDigest,
            preference_digest: merged.preferenceDigest,
          };
        }
      }

      let effectiveAcademicStatusDigest = contextUpdate?.academic_status_digest ?? academicContext.digest;
      const contextWithStatus = context.personal_status ? context : { ...context, personal_status: personalStatus };
      const completedCourseIds = Array.isArray(personalStatus.completed)
        ? personalStatus.completed
          .map((course) => typeof course === 'string' ? course : (course as { course_id?: unknown })?.course_id)
          .filter((courseId): courseId is string => typeof courseId === 'string' && courseId.trim().length > 0)
        : [];
      const currentCourseIds = Array.isArray(personalStatus.currently_taking)
        ? personalStatus.currently_taking
          .map((course) => typeof course === 'string' ? course : (course as { course_id?: unknown })?.course_id)
          .filter((courseId): courseId is string => typeof courseId === 'string' && courseId.trim().length > 0)
        : [];
      const clarificationContext = extractClarificationContext(contextWithStatus, preferences, undefined);
      let clarification = await clarifyForAcademicDecision(clarificationContext);
      const committedContext = board
        ? {
            ...context,
            semesters: board.semesters.map((semester) => ({
              id: semester.semesterId,
              courses: semester.courseIds.map((course_id) => ({ course_id })),
            })),
          }
        : context;
      const session = new PlanningSession({
        programId: parsed.data.program_id,
        programBoard,
        // The model must see the student's completed courses even when the stored
        // plan context keeps them only in personal status.
        planContext: contextWithStatus,
        committedContext,
        preferences,
        clarification,
      });
      if (streaming) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.status(200);
        out = ndjsonResult(res);
        session.onEvent = (event) => writeLine({ type: 'event', event });
      }
      const agent = await runAgent(
        {
          transcript: parsed.data.transcript,
          session,
          // The HTTP schema has already validated this exact shape. Keep the
          // domain boundary explicit because the remote Zod version infers
          // `z.any()` object properties more narrowly than the local build.
          preferenceProfile: parsed.data.preference_profile as PreferenceProfile | undefined,
        },
        {
          model: modelConfig.model,
          ...(streaming ? { onTextDelta: (text: string) => writeLine({ type: 'text_delta', text }) } : {}),
        },
      );

      if (agent.outcome === 'assistant_unavailable') {
        out.status(503).json(unavailable());
        return;
      }

      // Preferences the agent recorded are persisted, so apply-time validation
      // (and the next turn) builds the same constraint model.
      const persistSessionPreferences = async () => {
        preferences = session.preferences;
        if (session.academicStatusChanged) {
          context = session.input.planContext;
          personalStatus = (context.personal_status ?? {}) as Record<string, unknown>;
          effectiveAcademicStatusDigest = academicStatusDigest(personalStatus);
        }
        await putAcademicContext({
          ownerId: owner.ownerId,
          programId: parsed.data.program_id,
          digest: effectiveAcademicStatusDigest,
          personalStatus,
          planContext: context,
          preferences,
        });
        contextUpdate = {
          academic_status_digest: effectiveAcademicStatusDigest,
          preference_digest: preferenceDigest(preferences),
        };
      };
      // A fallback question asked by the gates below counts toward the
      // leave-out limit exactly like the agent's own ask_student.
      const askedByGate = async (question: { id: string } | undefined) => {
        if (question?.id !== 'excluded_courses') return;
        session.recordAsked('excluded_courses');
        await persistSessionPreferences();
      };
      if (session.preferencesChanged || session.academicStatusChanged) {
        await persistSessionPreferences();
        // Answers recorded this turn (e.g. no courses to leave out) count for the gate below.
        clarification = await clarifyForAcademicDecision(extractClarificationContext(
          session.input.planContext, preferences, undefined));
      }
      const model = session.model;
      const buildModelOptions: BuildModelOptions = {
        completedCourseIds,
        currentlyPlannedCourseIds: currentCourseIds,
        disallowedCourseIds: resolveHardExcludedCourseIds(preferences as { disallowed_course_ids?: string[]; strongly_avoided_course_ids?: string[] }),
        maxHoursPerSemester: typeof preferences.max_weekly_hours === 'number' ? preferences.max_weekly_hours : undefined,
      };
      if (agent.outcome === 'proposal' && hasCriticalMissingInput(clarification)) {
        const question = firstCriticalQuestion(clarification);
        await askedByGate(question);
        const events = question
          ? [...agent.events, clarificationEvent(question)]
          : agent.events;
        out.status(200).json({
          outcome: 'clarification_required',
          message_he: 'לפני בניית חלופות אני צריך להשלים כמה פרטים אקדמיים חשובים.',
          events,
          next_action: 'ask',
          ...(contextUpdate ? { context_update: contextUpdate } : {}),
          academic_decision: {
            engine: 'AcademicDecisionAgent',
            ready_to_plan: false,
            planned: false,
            clarification_required: true,
          },
        });
        return;
      }

      let academicDecision: AcademicDecisionAgentRun | null = null;
      if (agent.outcome === 'proposal') {
        academicDecision = await runAcademicDecisionAgent({
          programId: parsed.data.program_id,
          board: programBoard as Record<string, unknown>,
          model,
          finalState: agent.draftPlan,
          clarification,
          buildModelOptions,
          currentCourseIds,
        });
        const readyToPlan = academicDecision.orchestration.engine === 'AcademicDecisionAgent'
          && academicDecision.orchestration.planned
          && !academicDecision.structuredClarification.applyBlocked;
        if (!readyToPlan) {
          const question = firstCriticalQuestion(academicDecision.clarification);
          await askedByGate(question);
          const events = question
            ? [...agent.events, clarificationEvent(question)]
            : agent.events;
          out.status(200).json({
            outcome: 'clarification_required',
            message_he: 'הטיוטה מוכנה לבדיקה, אבל חסר עדיין מידע שמונע הצעה סופית.',
            events,
            next_action: 'ask',
            ...(contextUpdate ? { context_update: contextUpdate } : {}),
            academic_decision: {
              engine: academicDecision.orchestration.engine,
              ready_to_plan: false,
              planned: academicDecision.orchestration.planned,
              clarification_required: true,
            },
          });
          return;
        }
      }

      const messageHe = agent.messageHe.trim().slice(0, 4_000);
      if (agent.outcome !== 'proposal' || !agent.validation.valid) {
        out.status(200).json({
          outcome: 'conversation',
          message_he: messageHe,
          events: agent.events,
          next_action: agent.outcome === 'conversation' ? agent.nextAction : undefined,
          ...(contextUpdate ? { context_update: contextUpdate } : {}),
        });
        return;
      }

      const explanation = new DeterministicProposalExplanationCapability().explain({
        validation: agent.validation,
      });

      const proposalId = newProposalId();
      const profileVersion = parsed.data.preference_profile?.version
        ?? Number(preferences.profile_version ?? preferences.version ?? 0);
      const snapshotId = `conversation_${currentBoardVersion ?? 'empty'}`;
      // Same fingerprint the apply path recomputes (authoritative_candidate_validation.ts),
      // so a stored candidate passes the apply-time constraint check.
      const distributionPolicy = storedDistributionPolicy(preferences);
      const fingerprint = planConstraintFingerprint({
        model,
        completedCourseIds: [...model.completedCourseIds],
        ...(distributionPolicy ? { distributionPolicy } : {}),
        profileVersion,
      });
      const agentSemesters = Object.entries(agent.draftPlan.semesters)
        .map(([semesterId, courseIds]) => ({ semesterId, courseIds: [...courseIds] }));
      const agentIdentity = candidateIdentity(agentSemesters);
      const hoursFor = (courseId: string) => model.profiles.get(courseId)?.hours ?? 0;
      const workloadFor = (semesters: Array<{ semesterId: string; courseIds: string[] }>) => {
        const loads = semesters.map((semester) =>
          [...new Set(semester.courseIds)].reduce((sum, courseId) => sum + hoursFor(courseId), 0));
        return {
          peak_hours: loads.length ? Math.max(...loads) : 0,
          total_hours: loads.reduce((sum, value) => sum + value, 0),
          active_periods: loads.filter((value) => value > 0).length,
        };
      };
      // The plan the student discussed with the agent is the recommendation.
      const agentAlternative: ConversationProposal['alternatives'][number] = {
        candidate_id: `${proposalId}_candidate_1`,
        normalized_identity: agentIdentity,
        recommended: true,
        applyable: true,
        semesters: agentSemesters.map((semester) => ({
          semester_id: semester.semesterId,
          course_ids: [...semester.courseIds],
        })),
        constraint_fingerprint: fingerprint,
        profile_version: profileVersion,
        snapshot_id: snapshotId,
        non_dominated: true,
        composed_utility: 0,
        objective_scores: [],
        label_he: 'הצעת העוזר',
        differences_he: [],
        workload: workloadFor(agentSemesters),
      };
      let wireAlternatives: ConversationProposal['alternatives'] = [agentAlternative];
      try {
        // Planner alternatives from the agent's last build_plan search, offered
        // as extra (never recommended) options.
        const candidateSet = session.candidateSet;
        const selected = candidateSet && selectCandidate(candidateSet);
        if (candidateSet && selected) {
          const exposed = buildPlanAlternatives({
            candidates: candidateSet.candidates,
            selectedId: selected.id,
            model,
            constraintFingerprint: fingerprint,
            snapshotId,
            profileVersion,
            objectiveIds: [],
          });
          const extras = exposed
            .map((alternative: PlanAlternative) => {
              const semesters = alternative.semesters.map((semester) => ({
                semesterId: semester.semesterId, courseIds: [...semester.courseIds],
              }));
              return {
                candidate_id: alternative.candidateId,
                normalized_identity: candidateIdentity(semesters),
                recommended: false,
                applyable: alternative.applyable,
                semesters: semesters.map((semester) => ({
                  semester_id: semester.semesterId,
                  course_ids: semester.courseIds,
                })),
                constraint_fingerprint: alternative.constraintFingerprint,
                profile_version: alternative.profileVersion,
                snapshot_id: alternative.snapshotId,
                non_dominated: alternative.nonDominated,
                composed_utility: alternative.composedUtility,
                objective_scores: alternative.objectiveScores.map((score) => ({
                  objective_id: score.objectiveId,
                  normalized: score.normalized,
                })),
                label_he: alternative.labelHe,
                differences_he: [...alternative.differencesHe],
                workload: {
                  peak_hours: alternative.workload.peakHours,
                  total_hours: alternative.workload.totalHours,
                  active_periods: alternative.workload.activePeriods,
                },
              };
            })
            .filter((alternative) => alternative.normalized_identity !== agentIdentity)
            .slice(0, 2);
          wireAlternatives = [agentAlternative, ...extras];
        }
      } catch {
        // Planner alternatives are optional; the agent's validated draft stands alone.
      }
      // Each alternative carries the degree requirements it would leave the student with, so the board
      // preview shows real progress instead of the base board's numbers.
      wireAlternatives = wireAlternatives.map((alternative) => {
        const requirements = recomputeRequirements(programBoard, alternative.semesters.map((semester) => ({
          semesterId: semester.semester_id, courseIds: semester.course_ids,
        })), completedCategoryCountsFromContext(context));
        // Per-semester load and the server's cap verdicts (the student's own cap and the hard cap).
        const semesterLoads = alternative.semesters.map((semester) => {
          const hours = [...new Set(semester.course_ids)].reduce((sum, courseId) => sum + hoursFor(courseId), 0);
          return {
            semester_id: semester.semester_id, hours,
            over_user_cap: hours > model.maxHoursPerSemester, over_hard_cap: hours > model.hardCap,
          };
        });
        return { ...alternative, semester_loads: semesterLoads, ...(requirements ? { requirements_validation: requirements } : {}) };
      });
      const recommended = wireAlternatives.find((alternative) => alternative.recommended) ?? wireAlternatives[0];
      const decision = new DeterministicCandidateDecisionCapability().decide({
        candidates: wireAlternatives.map((alternative) => ({
          candidateId: alternative.candidate_id,
          recommended: alternative.recommended,
        })),
      });
      const candidateId = decision.outcome === 'selected'
        ? decision.selectedCandidateId
        : recommended.candidate_id;
      const now = Date.now();
      const record: ProposalRecord = {
        proposalId,
        ownerId: owner.ownerId,
        programId: parsed.data.program_id,
        createdAt: now,
        expiresAt: now + PROPOSAL_TTL_MS,
        baseBoardVersion: currentBoardVersion,
        profileVersion,
        academicStatusDigest: effectiveAcademicStatusDigest,
        constraintFingerprint: recommended.constraint_fingerprint,
        snapshotId,
        candidates: wireAlternatives.map((alternative) => ({
          candidateId: alternative.candidate_id,
          semesters: alternative.semesters.map((semester) => ({
            semesterId: semester.semester_id,
            courseIds: [...semester.course_ids],
          })),
          normalizedIdentity: alternative.normalized_identity,
          valid: true,
          applyable: alternative.applyable,
          recommended: alternative.recommended,
        })),
        recommendedCandidateId: candidateId,
        outcome: 'proposal',
        applyEligible: true,
      };
      await putProposal(record);
      await recordUsage(parsed.data.session_token, modelConfig.name);
      const receipt = toReceipt(record);
      const events = [
        ...agent.events,
        { type: 'alternatives_ready' as const, proposal_id: proposalId, candidate_ids: [candidateId] },
      ];
      out.status(200).json({
        outcome: 'proposal',
        message_he: messageHe,
        events,
        academic_decision: academicDecision ? {
          engine: academicDecision.orchestration.engine,
          ready_to_plan: true,
          planned: academicDecision.orchestration.planned,
          clarification_required: hasCriticalMissingInput(academicDecision.clarification),
          explanation: {
            summary_he: explanation.summaryHe,
            facts_he: explanation.factsHe,
            risks_he: explanation.risksHe,
            next_actions_he: explanation.nextActionsHe,
          },
          decision: decision.outcome === 'selected' ? {
            outcome: decision.outcome,
            selected_candidate_id: decision.selectedCandidateId,
            evaluated_candidate_ids: decision.evaluatedCandidateIds,
            alternatives_not_selected_ids: decision.alternativesNotSelectedIds,
            selection_basis: decision.selectionBasis,
          } : {
            outcome: decision.outcome,
            evaluated_candidate_ids: decision.evaluatedCandidateIds,
            selection_basis: decision.selectionBasis,
          },
        } : undefined,
        ...(contextUpdate ? { context_update: contextUpdate } : {}),
        proposal_id: proposalId,
        proposal: {
          proposal_id: receipt.proposalId,
          candidate_ids: receipt.candidateIds,
          recommended_candidate_id: receipt.recommendedCandidateId,
          base_board_version: receipt.baseBoardVersion,
          profile_version: receipt.profileVersion,
          academic_status_digest: receipt.academicStatusDigest,
          expires_at: receipt.expiresAt,
          alternatives: wireAlternatives,
        },
      });
    } catch (error) {
      const code = plannerStorageErrorCode(error);
      if (code) {
        out.status(503).json({
          ok: false,
          code,
          message_he: 'אחסון התכנון אינו זמין כרגע. נא לנסות שוב מאוחר יותר.',
        });
        return;
      }
      console.error('[ai/conversation] unexpected error');
      out.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message_he: 'אירעה שגיאה פנימית.' });
    }
  };
}

export default createConversationHandler();
