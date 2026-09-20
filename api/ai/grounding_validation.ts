/**
 * grounding_validation.ts — deterministic validation over the Ground stage's
 * PlanGrounding, a first-class stage of AcademicDecisionAgent.run() (Slice 6).
 *
 * It consumes grounded facts + unresolved conflicts and turns each unresolved
 * AUTHORITATIVE contradiction into a typed, provenance-carrying finding that
 * makes Apply unavailable. What it deliberately does NOT do:
 *   - re-plan or read the planner input;
 *   - silently pick a winner between two conflicting sources (both survive in
 *     the finding's `detail` + `provenance`);
 *   - downgrade a 'known' fact because some optional source is missing;
 *   - block a valid plan on a non-critical 'unknown'/'inferred' fact — only
 *     `conflicts` (genuine contradictions) produce findings.
 *
 * No LLM, no I/O, no paid provider.
 */
import type { PlanGrounding, GroundingConflictKind } from './plan_grounding';

export type GroundingValidationCode =
  | 'GROUNDING_AVAILABILITY_CONFLICT'
  | 'GROUNDING_COMPLETION_CONFLICT';

export interface GroundingValidationFinding {
  code: GroundingValidationCode;
  courseId: string;
  message_he: string;
  /** Preserves BOTH conflicting facts verbatim — neither source is chosen. */
  detail: string;
  provenance: { source: string | null; dataQuality: string | null; confidence: number } | null;
  severity: 'error';
}

export interface AgentValidation {
  valid: boolean;
  /** True when an unresolved authoritative conflict makes the draft unfit to Apply. */
  applyBlocked: boolean;
  findings: GroundingValidationFinding[];
}

export interface GroundingValidationCapability {
  validate(input: { grounding: PlanGrounding }): AgentValidation;
}

const CODE_BY_KIND: Record<GroundingConflictKind, GroundingValidationCode> = {
  catalog_vs_normalized_availability: 'GROUNDING_AVAILABILITY_CONFLICT',
  user_assertion_vs_plan: 'GROUNDING_COMPLETION_CONFLICT',
};

const MESSAGE_HE: Record<GroundingValidationCode, string> = {
  GROUNDING_AVAILABILITY_CONFLICT:
    'מקורות הנתונים חלוקים לגבי הסמסטרים שבהם הקורס מוצע — נדרשת הכרעה סמכותית לפני החלה.',
  GROUNDING_COMPLETION_CONFLICT:
    'הקורס סומן כהושלם אך שובץ בתוכנית — יש לוודא את סטטוס ההשלמה לפני החלה.',
};

export class DeterministicGroundingValidation implements GroundingValidationCapability {
  validate({ grounding }: { grounding: PlanGrounding }): AgentValidation {
    const provByCourse = new Map(grounding.facts.map((f) => [f.courseId, f.provenance]));
    const findings: GroundingValidationFinding[] = grounding.conflicts.map((c) => {
      const code = CODE_BY_KIND[c.kind];
      return {
        code,
        courseId: c.courseId,
        message_he: MESSAGE_HE[code],
        detail: c.detail,
        provenance: provByCourse.get(c.courseId) ?? null,
        severity: 'error' as const,
      };
    });
    const applyBlocked = findings.length > 0;
    return { valid: !applyBlocked, applyBlocked, findings };
  }
}
