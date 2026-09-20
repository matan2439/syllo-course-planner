/**
 * classifyAgentOutcome — pure discriminator for the flagged Generate path's
 * structured agent outcomes. Precedence (highest first):
 *   error > blocked > clarification_required > validation_failed > proposal.
 * Apply is eligible only for a clean 'proposal'.
 */

import { classifyAgentOutcome, isApplyEligible } from '../../api/ai/academic_decision_integration';

const base = { engineFailed: false, blocked: false, hasCriticalMissingInput: false, hasUnresolvedConflicts: false };

describe('classifyAgentOutcome', () => {
  test('engine failure wins over everything → error', () => {
    expect(classifyAgentOutcome({ engineFailed: true, blocked: true, hasCriticalMissingInput: true, hasUnresolvedConflicts: true })).toBe('error');
  });

  test('a blocking error (not an engine failure) → blocked', () => {
    expect(classifyAgentOutcome({ ...base, blocked: true, hasCriticalMissingInput: true, hasUnresolvedConflicts: true })).toBe('blocked');
  });

  test('a critical missing input outranks a data conflict → clarification_required', () => {
    expect(classifyAgentOutcome({ ...base, hasCriticalMissingInput: true, hasUnresolvedConflicts: true })).toBe('clarification_required');
  });

  test('an unresolved grounded conflict on an otherwise-valid, fully-specified plan → validation_failed', () => {
    expect(classifyAgentOutcome({ ...base, hasUnresolvedConflicts: true })).toBe('validation_failed');
  });

  test('valid, complete, no critical gaps, no conflicts → proposal', () => {
    expect(classifyAgentOutcome({ ...base })).toBe('proposal');
  });

  test('Apply is eligible only for a clean proposal', () => {
    expect(isApplyEligible('proposal')).toBe(true);
    expect(isApplyEligible('clarification_required')).toBe(false);
    expect(isApplyEligible('validation_failed')).toBe(false);
    expect(isApplyEligible('blocked')).toBe(false);
    expect(isApplyEligible('error')).toBe(false);
  });
});
