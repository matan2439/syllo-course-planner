/**
 * Deterministic, user-visible explanation for a candidate that has already
 * been validated. This capability only projects supplied evidence; it never
 * re-plans, re-validates, or infers academic facts from free text.
 */

import type { CandidateReport } from './planner_validate';

export interface ProposalExplanationInput {
  validation: Pick<CandidateReport, 'valid' | 'constraintsChecked' | 'degreeHours' | 'errors' | 'warnings'>;
}

export interface ProposalExplanationResult {
  summaryHe: string;
  factsHe: string[];
  risksHe: string[];
  nextActionsHe: string[];
}

export interface ProposalExplanationCapability {
  explain(input: ProposalExplanationInput): ProposalExplanationResult;
}

const CONSTRAINT_LABELS_HE: Record<string, string> = {
  degree_hours: 'שעות תואר',
  mandatory: 'קורסי חובה',
  category: 'דרישות קטגוריה',
  prerequisites: 'תנאי קדם',
  semester_load: 'עומס בסמסטר',
  offering: 'היצע בסמסטר',
  disallowed: 'קורסים שהוחרגו',
  must_include: 'קורסים שביקשת לכלול',
  duplicates: 'שיבוץ כפול',
};

export class DeterministicProposalExplanationCapability implements ProposalExplanationCapability {
  explain({ validation }: ProposalExplanationInput): ProposalExplanationResult {
    const checkedConstraints = [...new Set(validation.constraintsChecked ?? [])]
      .map((constraint) => CONSTRAINT_LABELS_HE[constraint])
      .filter((label): label is string => Boolean(label));
    const factsHe = [
      ...(checkedConstraints.length > 0
        ? [`מגבלות שנבדקו: ${checkedConstraints.join(', ')}.`]
        : []),
      ...(Number.isFinite(validation.degreeHours)
        ? [`שעות תואר בתוכנית: ${validation.degreeHours} ש״ש.`]
        : []),
    ];
    const risksHe = [...new Set([
      ...(validation.errors ?? []),
      ...(validation.warnings ?? []),
    ].map((message) => message.trim()).filter(Boolean))].slice(0, 16);

    if (validation.valid) {
      return {
        summaryHe: 'הטיוטה עברה אימות חוקיות והשלמת דרישות.',
        factsHe,
        risksHe,
        nextActionsHe: ['אפשר לעבור על החלופה בלוח לפני ההחלה.'],
      };
    }

    return {
      summaryHe: 'הטיוטה אינה מוכנה להחלה כי האימות מצא בעיות.',
      factsHe,
      risksHe,
      nextActionsHe: ['יש לתקן את בעיות האימות לפני ההחלה.'],
    };
  }
}
