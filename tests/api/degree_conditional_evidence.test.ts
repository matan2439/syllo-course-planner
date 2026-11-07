import {
  evaluateDurationExtension, evaluateGraduateCourseEligibility, type GraduateCourseEvidenceContext,
} from '../../shared/planner/degree-conditional-evidence';
import { readDegreeEvidence, type DurationExtensionEvidence } from '../../shared/planner/degree-evidence';

const duration = { standard_semesters: 8, extension_years: 1, eligible_student_extension_semesters: 2 };
const approved = { approved: true, approvedThroughSemester: 10, reference: 'Teaching committee decision through semester 10' };
const extensionStatus = (semester: number | undefined, evidence?: DurationExtensionEvidence) =>
  evaluateDurationExtension(duration, semester, evidence).status;
const graduate = { course_level: 'graduate (תואר שני)', max_per_semester: 2 };
const graduateContext: GraduateCourseEvidenceContext = {
  selectedCourseIds: ['0512-4100', '0512-4200'],
  graduateCourseIds: ['0512-4100', '0512-4200'],
  placements: [
    { courseId: '0512-4100', semesterId: 'year_3_semester_a' },
    { courseId: '0512-4200', semesterId: 5 },
  ],
  average: 90,
  eligibility: {
    committeeMinimumAverage: 85, committeeReference: 'Committee published threshold for this catalog',
    trackHeadApproval: { approved: true, reference: 'Track head registration decision' },
  },
};
const graduateStatus = (patch: Partial<GraduateCourseEvidenceContext> = {}) =>
  evaluateGraduateCourseEligibility(graduate, { ...graduateContext, ...patch }).status;

test('ordinary extension needs a cited decision covering the plan within the ordinary bound', () => {
  expect(extensionStatus(8)).toBe('pass');
  expect(extensionStatus(9)).toBe('needs_review');
  expect(extensionStatus(10, { ordinary: approved })).toBe('pass');
  expect(extensionStatus(10, { ordinary: { ...approved, approvedThroughSemester: 9 } })).toBe('fail');
  expect(extensionStatus(9, { ordinary: { ...approved, approved: false } })).toBe('fail');
  expect(extensionStatus(9, { ordinary: { ...approved, reference: ' ' } })).toBe('needs_review');
  expect(extensionStatus(9, { ordinary: { approved: true, reference: 'no end date' } })).toBe('needs_review');
  expect(extensionStatus(undefined, { ordinary: approved })).toBe('needs_review');
});

test('semester 20 requires a separately scoped exceptional decision through semester 20', () => {
  expect(extensionStatus(20, { ordinary: approved })).toBe('needs_review');
  expect(extensionStatus(20, { ordinary: { ...approved, approvedThroughSemester: 20 } })).toBe('needs_review');
  expect(extensionStatus(9, { ordinary: { ...approved, approvedThroughSemester: 20 } })).toBe('needs_review');
  expect(extensionStatus(20, { exceptional: approved })).toBe('fail');
  expect(extensionStatus(20, { exceptional: { ...approved, approvedThroughSemester: 20 } })).toBe('pass');
  expect(extensionStatus(20, { exceptional: { ...approved, approvedThroughSemester: 20, reference: '' } })).toBe('needs_review');
  const legacy = readDegreeEvidence({ decisions: { 'duration-extension': { approved: true, reference: 'ordinary approval' } } });
  expect(extensionStatus(20, legacy?.durationExtensions?.['duration-extension'])).toBe('needs_review');
});

test('eligible-student extension needs both explicit eligibility and the cited scoped decision', () => {
  const eligibleStudent = { eligible: true, reference: 'University eligibility record', decision: approved };
  expect(extensionStatus(10, { eligibleStudent })).toBe('pass');
  expect(extensionStatus(10, { eligibleStudent: { ...eligibleStudent, reference: '' } })).toBe('needs_review');
  expect(extensionStatus(10, { eligibleStudent: { ...eligibleStudent, eligible: undefined } })).toBe('needs_review');
  expect(extensionStatus(10, { eligibleStudent: { ...eligibleStudent, eligible: false } })).toBe('fail');
  expect(extensionStatus(10, { eligibleStudent: { ...eligibleStudent, decision: undefined } })).toBe('needs_review');
  expect(extensionStatus(10, { eligibleStudent: { ...eligibleStudent, decision: { ...approved, approved: false } } })).toBe('fail');
  expect(extensionStatus(11, { eligibleStudent })).toBe('needs_review');
  expect(extensionStatus(10, { ordinary: approved, eligibleStudent: { ...eligibleStudent, eligible: false } })).toBe('pass');
});

test('graduate registration needs the committee threshold, student average and separate track-head decision', () => {
  expect(graduateStatus()).toBe('pass');
  expect(graduateStatus({ average: 85 })).toBe('pass');
  expect(graduateStatus({ average: 0 })).toBe('fail');
  expect(graduateStatus({ average: undefined })).toBe('needs_review');
  expect(graduateStatus({ eligibility: undefined })).toBe('needs_review');
  expect(graduateStatus({ eligibility: { ...graduateContext.eligibility, committeeMinimumAverage: undefined } })).toBe('needs_review');
  expect(graduateStatus({ eligibility: { ...graduateContext.eligibility, committeeReference: '' } })).toBe('needs_review');
  expect(graduateStatus({ eligibility: { ...graduateContext.eligibility, trackHeadApproval: undefined } })).toBe('needs_review');
  expect(graduateStatus({ eligibility: { ...graduateContext.eligibility, trackHeadApproval: { approved: true, reference: ' ' } } })).toBe('needs_review');
  expect(graduateStatus({ eligibility: { ...graduateContext.eligibility, trackHeadApproval: { approved: false, reference: 'Decision refused' } } })).toBe('fail');
});

test('the graduate cap counts unique course identities and canonical semesters before approvals', () => {
  expect(graduateStatus({
    graduateCourseIds: [...graduateContext.graduateCourseIds!, '0512-4506'],
    placements: [...graduateContext.placements, { courseId: '0512-4506', semesterId: 'year_3_semester_a' }],
  })).toBe('fail');
  expect(graduateStatus({ placements: [...graduateContext.placements, ...graduateContext.placements] })).toBe('pass');
  expect(graduateStatus({
    graduateCourseIds: [...graduateContext.graduateCourseIds!, '0512-4506'],
    placements: [...graduateContext.placements, { courseId: '0512-4506', semesterId: 5 }],
    eligibility: undefined, average: undefined,
  })).toBe('fail');
  expect(graduateStatus({ graduateCourseIds: undefined })).toBe('needs_review');
  expect(graduateStatus({ graduateCourseIds: [] })).toBe('pass');
  expect(graduateStatus({ placements: [] })).toBe('needs_review');
  expect(graduateStatus({ placements: [], courseStudySemesters: { '0512-4100': 5, '0512-4200': 5 } })).toBe('pass');
  expect(graduateStatus({ placements: [{ courseId: '0512-4100', semesterId: 'A' }] })).toBe('needs_review');
});

test('new evidence fields validate drafts without manufacturing decisions or prerequisite eligibility', () => {
  const evidence = {
    durationExtensions: { extension: { ordinary: approved, eligibleStudent: { eligible: true, reference: 'Eligibility record', decision: approved } } },
    graduateEligibility: { graduate: graduateContext.eligibility },
    prerequisiteEligibility: { '0512-4100': { attended: true, examEligible: false, reference: 'Course record' } },
    decisions: { other: { approved: true, reference: 'Other condition' } },
  };
  expect(readDegreeEvidence(evidence)).toEqual(evidence);
  expect(readDegreeEvidence({ durationExtensions: { extension: { ordinary: { reference: '' } } } })).toBeDefined();
  expect(readDegreeEvidence({ prerequisiteEligibility: { '0512-4100': { attended: 'yes', examEligible: true, reference: '' } } })).toBeUndefined();
  expect(readDegreeEvidence({ prerequisiteEligibility: { '0512-4100': { attended: true, reference: '' } } })).toBeUndefined();
  expect(readDegreeEvidence({ durationExtensions: { extension: { ordinary: { ...approved, approvedThroughSemester: 0 } } } })).toBeUndefined();
  expect(readDegreeEvidence({ graduateEligibility: { graduate: { committeeMinimumAverage: 101 } } })).toBeUndefined();
  expect(readDegreeEvidence({ graduateEligibility: { graduate: { committeeMinimumAverage: '85' } } })).toBeUndefined();
});
