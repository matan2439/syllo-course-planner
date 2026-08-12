/**
 * Slice 12 — typed, bounded conversation state machine.
 *
 * The source of truth is a typed state (status + structured profile + current
 * question + pending interpretation + conflicts + proposal profile-version), NOT
 * a free-form chat transcript. Answers only ever update DRAFT preference state;
 * they never mutate a board and never auto-generate.
 */
import {
  initConversation,
  answerQuestion,
  confirmPending,
  reviseAnswer,
  markPlanning,
  markProposalReady,
  isProposalStale,
} from '../../api/ai/conversation_state';
import { DeterministicPreferenceElicitation } from '../../api/ai/preference_elicitation';

const CATALOG = [
  { id: 'workload_target', category: 'workload', affects: 'max_weekly_hours', impact: 0.9, answerType: 'single_choice' as const,
    question_he: 'q1', rationale_he: 'r1', allowIndifferent: true, allowFreeText: true,
    options: [{ value: 'lighter_week', label_he: 'קל' }, { value: 'finish_sooner', label_he: 'מוקדם' }] },
  { id: 'semester_balance', category: 'semester_balance', affects: 'balance_score', impact: 0.6, answerType: 'single_choice' as const,
    question_he: 'q2', rationale_he: 'r2', allowIndifferent: true, allowFreeText: true,
    options: [{ value: 'balanced', label_he: 'מאוזן' }, { value: 'compact', label_he: 'מרוכז' }] },
];
const elicit = new DeterministicPreferenceElicitation(CATALOG);

describe('conversation state machine', () => {
  test('init asks the highest-impact question', () => {
    const s = initConversation(elicit, {});
    expect(s.status).toBe('question_pending');
    expect(s.currentQuestion?.id).toBe('workload_target');
    expect(s.profile.preferences).toEqual([]);
  });

  test('a concrete answer updates DRAFT profile only, advances the question, and never auto-generates', () => {
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'lighter_week' }, elicit, {});
    // profile updated (draft), status advanced to the next question — NOT planning
    expect(s.profile.preferences.find((p) => p.id === 'workload_target')?.value).toBe('lighter_week');
    expect(s.status).toBe('question_pending');
    expect(s.currentQuestion?.id).toBe('semester_balance');
    expect(s.rebuildRequired).toBe(true);
  });

  test('answering the last impactful question reaches ready_to_plan (user may build)', () => {
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'lighter_week' }, elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'balanced' }, elicit, {});
    expect(s.status).toBe('ready_to_plan');
    expect(s.currentQuestion).toBeNull();
  });

  test('a vague answer on a consequential topic → confirmation_required (not applied as constraint yet)', () => {
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'free_text', text: 'לא עמוס' }, elicit, {});
    expect(s.status).toBe('confirmation_required');
    expect(s.pendingInterpretation?.id).toBe('workload_target');
    const p = s.profile.preferences.find((x) => x.id === 'workload_target')!;
    expect(p.classification).toBe('uncertain');
    expect(p.mayAffectPlanningBeforeConfirmation).toBe(false);
  });

  test('confirming the pending interpretation activates it and advances', () => {
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'free_text', text: 'לא עמוס' }, elicit, {});
    s = confirmPending(s, elicit, {});
    expect(s.status).toBe('question_pending');
    expect(s.pendingInterpretation).toBeUndefined();
    expect(s.profile.preferences.find((x) => x.id === 'workload_target')?.confirmationStatus).toBe('confirmed');
  });

  test('markPlanning then markProposalReady records the profile version; not stale while unchanged', () => {
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'lighter_week' }, elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'balanced' }, elicit, {});
    s = markPlanning(s);
    expect(s.status).toBe('planning');
    s = markProposalReady(s);
    expect(s.status).toBe('proposal_ready');
    expect(s.proposalProfileVersion).toBe(s.profile.version);
    expect(s.rebuildRequired).toBe(false);
    expect(isProposalStale(s)).toBe(false);
  });

  test('revising an answer after a proposal makes the proposal stale and requires rebuild', () => {
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'lighter_week' }, elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'balanced' }, elicit, {});
    s = markPlanning(s);
    s = markProposalReady(s);
    const versionAtProposal = s.proposalProfileVersion!;
    s = reviseAnswer(s, 'workload_target', { kind: 'choice', value: 'finish_sooner' }, elicit, {});
    expect(s.profile.version).toBeGreaterThan(versionAtProposal);
    expect(isProposalStale(s)).toBe(true);
    expect(s.rebuildRequired).toBe(true);
  });

  test('a contradiction routes to preference_conflict for correction', () => {
    // Two catalog-independent preferences on the same knob → force a conflict via revise.
    let s = initConversation(elicit, {});
    s = answerQuestion(s, { kind: 'choice', value: 'lighter_week' }, elicit, {});
    // Inject a second same-knob preference by answering a synthetic same-affects question.
    const conflicting = { id: 'load_feel', category: 'workload', affects: 'max_weekly_hours', impact: 0.9, answerType: 'single_choice' as const,
      question_he: 'q', rationale_he: 'r', allowIndifferent: true, allowFreeText: true, options: [{ value: 'finish_sooner', label_he: 'x' }] };
    s = { ...s, currentQuestion: conflicting };
    s = answerQuestion(s, { kind: 'choice', value: 'finish_sooner' }, elicit, {});
    expect(s.status).toBe('preference_conflict');
    expect(s.conflicts.length).toBeGreaterThan(0);
  });
});
