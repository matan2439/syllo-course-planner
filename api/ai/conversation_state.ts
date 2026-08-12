/**
 * conversation_state.ts — a typed, bounded conversation state machine (Slice 12).
 *
 * The SOURCE OF TRUTH is this typed state, not a free-form chat transcript: a
 * status, the structured (draft) preference profile, the current question, any
 * pending interpretation awaiting confirmation, surfaced conflicts, and the
 * profile version a proposal was built from. Every transition is a pure function.
 *
 * Hard invariants encoded here:
 *   - answering only updates DRAFT preference state — never a board;
 *   - answering never auto-generates (no transition to `planning`/`proposal_ready`
 *     from an answer — only the explicit markPlanning/markProposalReady do that);
 *   - a proposal records the profile version it used; any later profile change
 *     makes it stale (isProposalStale) and requires a rebuild;
 *   - revising an answer invalidates dependent draft assumptions (bumps version).
 */
import {
  emptyProfile,
  removePreference,
  type PreferenceProfile,
  type PreferenceClassification,
} from './preference_model';
import {
  DeterministicPreferenceElicitation,
  type ElicitationQuestionDef,
  type ElicitationAnswer,
  type ElicitationContext,
  type PreferenceContradiction,
} from './preference_elicitation';

export type ConversationStatus =
  | 'ready_to_plan'
  | 'question_pending'
  | 'confirmation_required'
  | 'preference_conflict'
  | 'authoritative_validation_failure'
  | 'planning'
  | 'proposal_ready';

export interface ConversationState {
  status: ConversationStatus;
  profile: PreferenceProfile;
  currentQuestion: ElicitationQuestionDef | null;
  pendingInterpretation?: { id: string; originalWording: string };
  conflicts: PreferenceContradiction[];
  /** The profile version a proposal was built from (set by markProposalReady). */
  proposalProfileVersion?: number;
  /** True when the profile changed since the last proposal (a rebuild is needed). */
  rebuildRequired: boolean;
}

function advance(
  state: ConversationState,
  elicit: DeterministicPreferenceElicitation,
  ctx: ElicitationContext,
): ConversationState {
  const conflicts = elicit.detectContradictions(state.profile);
  if (conflicts.length > 0) {
    return { ...state, status: 'preference_conflict', conflicts, currentQuestion: null };
  }
  const next = elicit.selectNextQuestion(state.profile, ctx);
  return {
    ...state,
    conflicts: [],
    currentQuestion: next,
    status: next ? 'question_pending' : 'ready_to_plan',
  };
}

export function initConversation(
  elicit: DeterministicPreferenceElicitation,
  ctx: ElicitationContext,
): ConversationState {
  const base: ConversationState = {
    status: 'ready_to_plan',
    profile: emptyProfile(),
    currentQuestion: null,
    conflicts: [],
    rebuildRequired: false,
  };
  return advance(base, elicit, ctx);
}

export function answerQuestion(
  state: ConversationState,
  answer: ElicitationAnswer,
  elicit: DeterministicPreferenceElicitation,
  ctx: ElicitationContext,
): ConversationState {
  if (!state.currentQuestion) return state; // nothing to answer
  const q = state.currentQuestion;
  const { profile, requiresConfirmation } = elicit.applyAnswer(state.profile, q, answer, ctx);

  // A proposal (if any) built from an older profile is now potentially stale; a
  // rebuild is required. Answering NEVER auto-generates.
  const withProfile: ConversationState = { ...state, profile, rebuildRequired: true };

  if (requiresConfirmation) {
    return {
      ...withProfile,
      status: 'confirmation_required',
      pendingInterpretation: { id: q.id, originalWording: answer.kind === 'free_text' ? answer.text : '' },
      currentQuestion: q,
    };
  }
  return advance({ ...withProfile, pendingInterpretation: undefined }, elicit, ctx);
}

export function confirmPending(
  state: ConversationState,
  elicit: DeterministicPreferenceElicitation,
  ctx: ElicitationContext,
  opts: { as?: PreferenceClassification } = {},
): ConversationState {
  if (!state.pendingInterpretation) return state;
  const profile = elicit.confirmInterpretation(state.profile, state.pendingInterpretation.id, opts);
  return advance({ ...state, profile, pendingInterpretation: undefined, rebuildRequired: true }, elicit, ctx);
}

/** Revise an earlier answer — re-applies it, bumps the profile version, invalidates any proposal. */
export function reviseAnswer(
  state: ConversationState,
  id: string,
  answer: ElicitationAnswer,
  elicit: DeterministicPreferenceElicitation,
  ctx: ElicitationContext,
): ConversationState {
  // Remove the prior capture, then re-apply against a synthetic question carrying
  // the same id/affects (revision must not depend on it still being "current").
  const prior = state.profile.preferences.find((p) => p.id === id);
  const q: ElicitationQuestionDef = state.currentQuestion?.id === id
    ? state.currentQuestion
    : {
        id, category: prior?.category ?? 'unknown', affects: prior?.affects ?? 'unknown',
        impact: 0.9, answerType: 'single_choice', question_he: '', rationale_he: '',
        allowIndifferent: true, allowFreeText: true,
      };
  const cleared = removePreference(state.profile, id);
  const { profile, requiresConfirmation } = elicit.applyAnswer(cleared, q, answer, ctx);
  const next: ConversationState = { ...state, profile, rebuildRequired: true, conflicts: [] };
  if (requiresConfirmation) {
    return { ...next, status: 'confirmation_required', pendingInterpretation: { id, originalWording: answer.kind === 'free_text' ? answer.text : '' } };
  }
  return advance({ ...next, pendingInterpretation: undefined }, elicit, ctx);
}

export function markPlanning(state: ConversationState): ConversationState {
  return { ...state, status: 'planning' };
}

export function markProposalReady(state: ConversationState): ConversationState {
  return {
    ...state,
    status: 'proposal_ready',
    proposalProfileVersion: state.profile.version,
    rebuildRequired: false,
  };
}

export function markAuthoritativeValidationFailure(state: ConversationState): ConversationState {
  return { ...state, status: 'authoritative_validation_failure' };
}

/** A proposal is stale when the profile advanced past the version it was built from. */
export function isProposalStale(state: ConversationState): boolean {
  if (state.proposalProfileVersion === undefined) return false;
  return state.profile.version !== state.proposalProfileVersion;
}
