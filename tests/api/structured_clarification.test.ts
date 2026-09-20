/**
 * Slice 7 — structured clarification contract.
 *
 * Unifies two already-distinct signals into one list a consumer can act on,
 * WITHOUT collapsing the crucial distinction:
 *   - answerable preference gaps (missing user inputs) → answerable items the
 *     user can resolve (answerType + inputKey);
 *   - authoritative academic conflicts (grounding-validation findings) →
 *     NON-answerable items that block Apply and identify the missing authoritative
 *     resolution + provenance — never presented as a user preference to invent.
 */
import { buildStructuredClarification } from '../../api/ai/structured_clarification';
import type { ClarificationResult } from '../../api/ai/academic_decision_types';
import type { AgentValidation } from '../../api/ai/grounding_validation';

const NO_CLARIFY: ClarificationResult = { needsClarification: false, missingInputs: [], questions: [] };
const NO_VALIDATION: AgentValidation = { valid: true, applyBlocked: false, findings: [] };

const CRITICAL_GAP: ClarificationResult = {
  needsClarification: true,
  missingInputs: [{ field: 'completedCourses', critical: true, message: 'x' }],
  questions: [{ id: 'completed_courses', inputKey: 'completedCourseIds', required: true, critical: true, answerType: 'course_ids', question: 'אילו קורסים השלמת?' }],
};

const CONFLICT: AgentValidation = {
  valid: false, applyBlocked: true,
  findings: [{ code: 'GROUNDING_AVAILABILITY_CONFLICT', courseId: 'C', message_he: 'סתירה', detail: 'catalog [a] vs [b]',
    provenance: { source: 'catalog', dataQuality: 'normalized', confidence: 0.8 }, severity: 'error' }],
};

describe('buildStructuredClarification', () => {
  test('nothing missing, no conflict → empty, apply not blocked', () => {
    const s = buildStructuredClarification({ clarification: NO_CLARIFY, validation: NO_VALIDATION });
    expect(s.items).toEqual([]);
    expect(s.applyBlocked).toBe(false);
  });

  test('a critical preference gap → an ANSWERABLE item (answerType + inputKey), Apply blocked until answered', () => {
    const s = buildStructuredClarification({ clarification: CRITICAL_GAP, validation: NO_VALIDATION });
    const item = s.items.find((i) => i.reasonCode === 'completed_courses')!;
    expect(item.kind).toBe('answerable_preference');
    expect(item.answerable).toBe(true);
    expect(item.inputKey).toBe('completedCourseIds');
    expect(item.answerType).toBe('course_ids');
    expect(item.message_he).toContain('קורסים');
    expect(item.applyBlocked).toBe(true); // critical
    expect(s.applyBlocked).toBe(true);
  });

  test('an authoritative conflict → a NON-answerable item with provenance; never a user preference', () => {
    const s = buildStructuredClarification({ clarification: NO_CLARIFY, validation: CONFLICT });
    const item = s.items.find((i) => i.reasonCode === 'GROUNDING_AVAILABILITY_CONFLICT')!;
    expect(item.kind).toBe('authoritative_conflict');
    expect(item.answerable).toBe(false); // must NOT ask the user to invent academic truth
    expect(item.inputKey).toBeUndefined();
    expect(item.answerType).toBeUndefined();
    expect(item.courseIds).toEqual(['C']);
    expect(item.provenance).toEqual({ source: 'catalog', dataQuality: 'normalized', confidence: 0.8 });
    expect(item.applyBlocked).toBe(true);
    expect(s.applyBlocked).toBe(true);
  });

  test('a non-critical preference gap is answerable but does NOT block Apply', () => {
    const clar: ClarificationResult = {
      needsClarification: true,
      missingInputs: [{ field: 'maxWeeklyHours', critical: false, message: 'x' }],
      questions: [{ id: 'max_weekly_hours', inputKey: 'maxWeeklyHours', required: false, critical: false, answerType: 'number', question: 'כמה שעות?' }],
    };
    const s = buildStructuredClarification({ clarification: clar, validation: NO_VALIDATION });
    expect(s.items[0].answerable).toBe(true);
    expect(s.items[0].applyBlocked).toBe(false);
    expect(s.applyBlocked).toBe(false);
  });
});
