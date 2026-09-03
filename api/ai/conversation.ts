import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  conversationRequestSchema,
  type ConversationProposal,
  type ConversationTurn,
} from '../../shared/planner/conversation-wire';
import { resolveModel as defaultResolveModel, type ModelConfig } from './course-planner';
import { buildModel } from './generate-plan';
import { planContextToState } from './planner_model';
import { PlannerWorker } from './planner_worker';
import { runConversationalAgent, type ConversationalAgentResult } from './conversational_agent';
import { generateCandidateSet, selectCandidate } from './candidate_set';
import { buildPlanAlternatives, constraintFingerprint as planConstraintFingerprint, type PlanAlternative } from './plan_alternatives';
import { PROPOSAL_TTL_MS, newProposalId, toReceipt, type ProposalRecord, type ProposalStore } from './proposal_store';
import {
  getAcademicContextStore,
  getBoardRepository,
  getProposalStore,
  plannerStorageErrorCode,
  preferenceDigest,
} from './apply_runtime';
import { resolveOwner } from './session_owner';
import type { CommittedBoard } from './board_repository';
import type { AcademicContextRecord } from './academic_context_store';
import { loadLocalBoardJson } from './board_loader';
import type { PreferenceProfile } from './preference_model';

type ConversationEndpointDeps = {
  resolveModel?: () => ModelConfig | null;
  loadBoard?: (ownerId: string, programId: string) => Promise<CommittedBoard | null>;
  loadAcademicContext?: (ownerId: string, programId: string) => Promise<AcademicContextRecord | null>;
  loadProgramBoard?: (programId: string) => unknown | null;
  runAgent?: (
    input: { transcript: readonly ConversationTurn[]; createWorker: () => PlannerWorker; preferenceProfile?: PreferenceProfile },
    deps: { model: ModelConfig['model'] },
  ) => Promise<ConversationalAgentResult>;
  putProposal?: ProposalStore['put'];
};

const unavailable = () => ({
  outcome: 'assistant_unavailable' as const,
  message_he: 'העוזר האקדמי אינו זמין כרגע.',
  events: [{ type: 'assistant_unavailable' as const, message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
  code: 'ASSISTANT_UNAVAILABLE' as const,
});

export function createConversationHandler(deps: ConversationEndpointDeps = {}) {
  const resolveModel = deps.resolveModel ?? defaultResolveModel;
  const loadBoard = deps.loadBoard ?? ((ownerId, programId) => getBoardRepository().load(ownerId, programId));
  const loadAcademicContext = deps.loadAcademicContext
    ?? ((ownerId, programId) => getAcademicContextStore().load(ownerId, programId));
  const loadProgramBoard = deps.loadProgramBoard ?? loadLocalBoardJson;
  const runAgent = deps.runAgent ?? runConversationalAgent;
  const putProposal = deps.putProposal ?? ((record: ProposalRecord) => getProposalStore().put(record));
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

      const context = (academicContext.planContext ?? {}) as Record<string, unknown>;
      const preferences = (academicContext.preferences ?? {}) as Record<string, unknown>;
      const committedContext = board
        ? {
            ...context,
            semesters: board.semesters.map((semester) => ({
              id: semester.semesterId,
              courses: semester.courseIds.map((course_id) => ({ course_id })),
            })),
          }
        : context;
      const model = buildModel(programBoard, context, preferences as any, parsed.data.program_id);
      const createWorker = () => new PlannerWorker(
        model,
        planContextToState(committedContext, model),
        { topN: 6, rolloutSteps: 80 },
      );
      const agent = await runAgent(
        {
          transcript: parsed.data.transcript,
          createWorker,
          // The HTTP schema has already validated this exact shape. Keep the
          // domain boundary explicit because the remote Zod version infers
          // `z.any()` object properties more narrowly than the local build.
          preferenceProfile: parsed.data.preference_profile as PreferenceProfile | undefined,
        },
        { model: modelConfig.model },
      );

      if (agent.outcome === 'assistant_unavailable') {
        res.status(503).json(unavailable());
        return;
      }

      const messageHe = agent.messageHe.trim().slice(0, 4_000);
      if (agent.outcome !== 'proposal' || !agent.validation.valid) {
        res.status(200).json({
          outcome: 'conversation',
          message_he: messageHe,
          events: agent.events,
          next_action: agent.outcome === 'conversation' ? agent.nextAction : undefined,
        });
        return;
      }

      const proposalId = newProposalId();
      const profileVersion = parsed.data.preference_profile?.version
        ?? Number(preferences.profile_version ?? preferences.version ?? 0);
      const snapshotId = `conversation_${currentBoardVersion ?? 'empty'}`;
      const conversationConstraintFingerprint = `conversation_${parsed.data.program_id}`;
      const fallbackSemesters = Object.entries(agent.draftPlan.semesters)
        .map(([semesterId, courseIds]) => ({ semesterId, courseIds: [...courseIds] }));
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
      const fallbackAlternative: ConversationProposal['alternatives'][number] = {
        candidate_id: `${proposalId}_candidate_1`,
        normalized_identity: JSON.stringify(fallbackSemesters),
        recommended: true,
        applyable: true,
        semesters: fallbackSemesters.map((semester) => ({
          semester_id: semester.semesterId,
          course_ids: [...semester.courseIds],
        })),
        constraint_fingerprint: conversationConstraintFingerprint,
        profile_version: profileVersion,
        snapshot_id: snapshotId,
        non_dominated: true,
        composed_utility: 0,
        objective_scores: [],
        label_he: 'הצעת העוזר',
        differences_he: [],
        workload: workloadFor(fallbackSemesters),
      };
      let wireAlternatives: ConversationProposal['alternatives'] = [fallbackAlternative];
      try {
        const pinnedHome: Record<string, string> = {};
        for (const courseId of model.pinnedCourseIds) {
          const semester = Object.entries(agent.draftPlan.semesters)
            .find(([, courseIds]) => courseIds.includes(courseId));
          if (semester) pinnedHome[courseId] = semester[0];
        }
        const candidateSet = generateCandidateSet({
          buildModel: () => model,
          policy: 'neutral',
          initialState: agent.draftPlan,
          profileVersion,
          pinnedHome,
        });
        const selected = selectCandidate(candidateSet);
        if (selected) {
          const exposed = buildPlanAlternatives({
            candidates: candidateSet.candidates,
            selectedId: selected.id,
            model,
            constraintFingerprint: planConstraintFingerprint({
              model,
              completedCourseIds: [...model.completedCourseIds],
              profileVersion,
            }),
            snapshotId,
            profileVersion,
            objectiveIds: [],
          });
          if (exposed.length) {
            wireAlternatives = exposed.map((alternative: PlanAlternative) => ({
              candidate_id: alternative.candidateId,
              normalized_identity: alternative.normalizedIdentity,
              recommended: alternative.recommended,
              applyable: alternative.applyable,
              semesters: alternative.semesters.map((semester) => ({
                semester_id: semester.semesterId,
                course_ids: [...semester.courseIds],
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
            }));
          }
        }
      } catch {
        // Keep the LLM's validated draft usable as one server-owned proposal
        // when an injected or partial model cannot produce comparisons.
      }
      const recommended = wireAlternatives.find((alternative) => alternative.recommended) ?? wireAlternatives[0];
      const candidateId = recommended.candidate_id;
      const now = Date.now();
      const record: ProposalRecord = {
        proposalId,
        ownerId: owner.ownerId,
        programId: parsed.data.program_id,
        createdAt: now,
        expiresAt: now + PROPOSAL_TTL_MS,
        baseBoardVersion: currentBoardVersion,
        profileVersion,
        academicStatusDigest: parsed.data.academic_status_digest,
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
      const receipt = toReceipt(record);
      const events = [
        ...agent.events,
        { type: 'alternatives_ready' as const, proposal_id: proposalId, candidate_ids: [candidateId] },
      ];
      res.status(200).json({
        outcome: 'proposal',
        message_he: messageHe,
        events,
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
        res.status(503).json({
          ok: false,
          code,
          message_he: 'אחסון התכנון אינו זמין כרגע. נא לנסות שוב מאוחר יותר.',
        });
        return;
      }
      console.error('[ai/conversation] unexpected error');
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message_he: 'אירעה שגיאה פנימית.' });
    }
  };
}

export default createConversationHandler();
