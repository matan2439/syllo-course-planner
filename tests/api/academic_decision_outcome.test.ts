/**
 * classifyAgentOutcome — pure discriminator for the flagged Generate path's
 * structured agent outcomes. Precedence: error > blocked > clarification_required
 * > proposal. Apply is eligible only for a clean 'proposal'.
 */

import { classifyAgentOutcome, isApplyEligible } from '../../api/ai/academic_decision_integration';

describe('classifyAgentOutcome', () => {
  test('engine failure wins over everything → error', () => {
    expect(classifyAgentOutcome({ engineFailed: true, blocked: true, hasCriticalMissingInput: true })).toBe('error');
  });

  test('a blocking error (not an engine failure) → blocked', () => {
    expect(classifyAgentOutcome({ engineFailed: false, blocked: true, hasCriticalMissingInput: true })).toBe('blocked');
  });

  test('a critical missing input on an otherwise-valid plan → clarification_required', () => {
    expect(classifyAgentOutcome({ engineFailed: false, blocked: false, hasCriticalMissingInput: true })).toBe('clarification_required');
  });

  test('valid, complete, no critical gaps → proposal', () => {
    expect(classifyAgentOutcome({ engineFailed: false, blocked: false, hasCriticalMissingInput: false })).toBe('proposal');
  });

  test('Apply is eligible only for a clean proposal', () => {
    expect(isApplyEligible('proposal')).toBe(true);
    expect(isApplyEligible('clarification_required')).toBe(false);
    expect(isApplyEligible('blocked')).toBe(false);
    expect(isApplyEligible('error')).toBe(false);
  });
});
