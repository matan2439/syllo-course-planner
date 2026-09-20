import { DeterministicProposalExplanationCapability } from '../../api/ai/proposal_explanation';
import type { CandidateReport } from '../../api/ai/planner_validate';

test('projects checked constraints and degree hours from validation evidence', () => {
  const explanation = new DeterministicProposalExplanationCapability().explain({
    validation: {
      valid: true,
      constraintsChecked: ['degree_hours', 'mandatory', 'offering'],
      degreeHours: 185,
    } as CandidateReport,
  });

  expect(explanation.factsHe).toEqual([
    'מגבלות שנבדקו: שעות תואר, קורסי חובה, היצע בסמסטר.',
    'שעות תואר בתוכנית: 185 ש״ש.',
  ]);
})

test('projects validator errors and warnings as risks without re-diagnosing the plan', () => {
  const explanation = new DeterministicProposalExplanationCapability().explain({
    validation: {
      valid: false,
      errors: ['תנאי קדם לא מולא.'],
      warnings: ['העומס בסמסטר ב׳ גבוה.'],
    } as CandidateReport,
  });

  expect(explanation.risksHe).toEqual([
    'תנאי קדם לא מולא.',
    'העומס בסמסטר ב׳ גבוה.',
  ]);
  expect(explanation.nextActionsHe).toEqual([
    'יש לתקן את בעיות האימות לפני ההחלה.',
  ]);
})
