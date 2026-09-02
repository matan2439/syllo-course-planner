import type { VercelRequest, VercelResponse } from '@vercel/node';
import { conversationRequestSchema, type ConversationTurn } from '../../shared/planner/conversation-wire';
import { resolveModel as defaultResolveModel, type ModelConfig } from './course-planner';
import { buildModel } from './generate-plan';
import { planContextToState } from './planner_model';
import { PlannerWorker } from './planner_worker';
import { runConversationalAgent, type ConversationalAgentResult } from './conversational_agent';
import { PROPOSAL_TTL_MS, newProposalId, type ProposalRecord, type ProposalStore } from './proposal_store';
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

type ConversationEndpointDeps = {
  resolveModel?: () => ModelConfig | null;
  loadBoard?: (ownerId: string, programId: string) => Promise<CommittedBoard | null>;
  loadAcademicContext?: (ownerId: string, programId: string) => Promise<AcademicContextRecord | null>;
  loadProgramBoard?: (programId: string) => unknown | null;
  runAgent?: (
    input: { transcript: readonly ConversationTurn[]; createWorker: () => PlannerWorker },
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
        { transcript: parsed.data.transcript, createWorker },
        { model: modelConfig.model },
      );

      if (agent.outcome === 'assistant_unavailable') {
        res.status(503).json(unavailable());
        return;
      }

      const messageHe = agent.messageHe.trim().slice(0, 4_000);
      if (agent.outcome !== 'proposal' || !agent.validation.valid) {
        res.status(200).json({ outcome: 'conversation', message_he: messageHe, events: agent.events });
        return;
      }

      const proposalId = newProposalId();
      const candidateId = `${proposalId}_candidate_1`;
      const semesters = Object.entries(agent.draftPlan.semesters)
        .filter(([, courseIds]) => courseIds.length > 0)
        .map(([semesterId, courseIds]) => ({ semesterId, courseIds: [...courseIds] }));
      const now = Date.now();
      const record: ProposalRecord = {
        proposalId,
        ownerId: owner.ownerId,
        programId: parsed.data.program_id,
        createdAt: now,
        expiresAt: now + PROPOSAL_TTL_MS,
        baseBoardVersion: currentBoardVersion,
        profileVersion: Number(preferences.profile_version ?? preferences.version ?? 0),
        academicStatusDigest: parsed.data.academic_status_digest,
        constraintFingerprint: `conversation_${parsed.data.program_id}`,
        snapshotId: `conversation_${currentBoardVersion ?? 'empty'}`,
        candidates: [{
          candidateId,
          semesters,
          normalizedIdentity: JSON.stringify(semesters),
          valid: true,
          applyable: true,
          recommended: true,
        }],
        recommendedCandidateId: candidateId,
        outcome: 'proposal',
        applyEligible: true,
      };
      await putProposal(record);
      const events = [
        ...agent.events,
        { type: 'alternatives_ready' as const, proposal_id: proposalId, candidate_ids: [candidateId] },
      ];
      res.status(200).json({ outcome: 'proposal', message_he: messageHe, events, proposal_id: proposalId });
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
