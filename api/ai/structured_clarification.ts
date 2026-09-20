/**
 * structured_clarification.ts — a single structured contract (Slice 7) unifying
 * the two distinct "the draft needs attention" signals the flagged agent path
 * produces, WITHOUT collapsing the distinction between them:
 *
 *   - answerable_preference — a missing user input (from the Clarify stage). The
 *     user CAN resolve it (answerType + inputKey). A critical one blocks Apply
 *     until answered; a non-critical one does not.
 *   - authoritative_conflict — an unresolved authoritative academic contradiction
 *     (from the grounding-validation stage). The user must NOT be asked to invent
 *     or choose the academic truth; it stays a blocking item that identifies the
 *     missing authoritative resolution + provenance.
 *
 * Pure projection over the agent's own clarification + validation results — no
 * new academic judgement, no I/O, no paid provider.
 */
import type { ClarificationResult, ClarificationAnswerType } from './academic_decision_types';
import type { AgentValidation } from './grounding_validation';

export interface StructuredClarificationItem {
  /** Stable machine code: the question id (answerable) or the finding code (conflict). */
  reasonCode: string;
  kind: 'answerable_preference' | 'authoritative_conflict';
  message_he: string;
  /** true = user can resolve via input; false = needs authoritative resolution. */
  answerable: boolean;
  /** Whether this item alone blocks Apply. */
  applyBlocked: boolean;
  /** Affected courses (conflicts). */
  courseIds?: string[];
  /** Answer target + shape (answerable items only). */
  inputKey?: string;
  answerType?: ClarificationAnswerType;
  /** Source metadata (conflict items only) — both conflicting facts are kept in `detail`. */
  provenance?: { source: string | null; dataQuality: string | null; confidence: number } | null;
  detail?: string;
}

export interface StructuredClarification {
  items: StructuredClarificationItem[];
  /** True when any item blocks Apply (critical gap or authoritative conflict). */
  applyBlocked: boolean;
}

export function buildStructuredClarification(input: {
  clarification: ClarificationResult;
  validation?: AgentValidation;
}): StructuredClarification {
  const answerable: StructuredClarificationItem[] = input.clarification.questions.map((q) => ({
    reasonCode: q.id,
    kind: 'answerable_preference',
    message_he: q.question,
    answerable: true,
    applyBlocked: q.critical, // a critical missing input blocks Apply until answered
    inputKey: q.inputKey,
    answerType: q.answerType,
  }));

  const conflicts: StructuredClarificationItem[] = (input.validation?.findings ?? []).map((f) => ({
    reasonCode: f.code,
    kind: 'authoritative_conflict',
    message_he: f.message_he,
    answerable: false, // never ask the user to invent/choose the academic truth
    applyBlocked: f.severity === 'error',
    courseIds: [f.courseId],
    provenance: f.provenance,
    detail: f.detail,
  }));

  const items = [...answerable, ...conflicts];
  return { items, applyBlocked: items.some((i) => i.applyBlocked) };
}
