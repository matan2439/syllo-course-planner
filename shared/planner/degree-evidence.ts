import { z } from 'zod';

const courseId = z.string().regex(/^\d{4}-\d{4}$/);
const decision = z.object({
  approved: z.boolean(),
  reference: z.string().trim().max(500),
}).strict();
const semesterDecision = z.object({
  approved: z.boolean().optional(),
  approvedThroughSemester: z.number().int().min(1).max(40).optional(),
  reference: z.string().trim().max(500),
}).strict();

/** Student-reported academic facts, never a claim that Syllo issued an approval. */
export const degreeEvidenceSchema = z.object({
  intake: z.enum(['autumn', 'spring']).optional(),
  average: z.number().finite().min(0).max(100).optional(),
  higherEducationStartYear: z.number().int().min(1950).max(2200).optional(),
  recognizedEnglishCourseIds: z.array(courseId).max(100).optional(),
  graduateCourseIds: z.array(courseId).max(100).optional(),
  fullTimeLoadBySemester: z.record(z.string().regex(/^year_[1-9]\d*_semester_[ab]$/),
    z.object({ hours: z.number().finite().positive().max(100), reference: z.string().trim().max(500) }).strict()).optional(),
  courseStudySemesters: z.record(courseId, z.number().int().min(1).max(40)).optional(),
  decisions: z.record(z.string().min(1).max(128), decision).optional(),
  durationExtensions: z.record(z.string().min(1).max(128), z.object({
    ordinary: semesterDecision.optional(),
    exceptional: semesterDecision.optional(),
    eligibleStudent: z.object({
      eligible: z.boolean().optional(),
      reference: z.string().trim().max(500),
      decision: semesterDecision.optional(),
    }).strict().optional(),
  }).strict()).optional(),
  graduateEligibility: z.record(z.string().min(1).max(128), z.object({
    committeeMinimumAverage: z.number().finite().min(0).max(100).optional(),
    committeeReference: z.string().trim().max(500).optional(),
    trackHeadApproval: z.object({
      approved: z.boolean().optional(),
      reference: z.string().trim().max(500),
    }).strict().optional(),
  }).strict()).optional(),
  prerequisiteEligibility: z.record(courseId, z.object({
    attended: z.boolean(),
    examEligible: z.boolean(),
    reference: z.string().trim().max(500),
  }).strict()).optional(),
  optionalGoals: z.array(z.string().min(1).max(128)).max(20).optional(),
  technicianExemptions: z.record(z.string().min(1).max(128), z.object({
    credential: z.string().min(1).max(128).optional(),
    governmentExamAverage: z.number().finite().min(0).max(100).optional(),
    excludesProject: z.boolean().optional(),
    awards: z.record(courseId, z.object({ approved: z.boolean(), degreeCreditHours: z.number().finite().min(0).max(30).optional(),
      reference: z.string().trim().max(500) }).strict()).optional(),
  }).strict()).optional(),
  additionalCourseRecognition: z.record(z.string().min(1).max(128), z.record(courseId, z.object({
    nameHe: z.string().max(200).optional(),
    useForDegreeCredit: z.boolean(), scope: z.enum(['supplementary', 'out_of_catalog']), completed: z.boolean(), priorApproval: z.boolean(),
    approvalReference: z.string().trim().max(500), syllabusReference: z.string().trim().max(500),
    instructorConsentReference: z.string().trim().max(500), officialCourseReference: z.string().trim().max(500),
    recognizedDegreeHours: z.number().finite().min(0).max(30).optional(), creditAwardReference: z.string().trim().max(500).optional(),
    averageAtApproval: z.number().finite().min(0).max(100).optional(), exceptionalLimitReference: z.string().trim().max(500).optional(),
  }).strict()).refine(records => Object.keys(records).length <= 100)).optional(),
  labCreditAllocations: z.record(z.string().min(1).max(128), z.object({
    creditedLabCourseIds: z.array(courseId).max(20),
    nonTheoryLabCourseIds: z.array(courseId).max(20),
    reference: z.string().trim().max(500),
    otherRecognizedDegreeHours: z.number().finite().min(0).max(400).optional(),
    otherCreditReference: z.string().trim().max(500).optional(),
  }).strict()).optional(),
  projectDomains: z.record(courseId, z.object({
    domain: z.string().min(1).max(128), reference: z.string().trim().max(500),
  }).strict()).optional(),
}).strict();

export type DegreeEvidence = z.infer<typeof degreeEvidenceSchema>;
export type SemesterDecisionEvidence = z.infer<typeof semesterDecision>;
export type DurationExtensionEvidence = NonNullable<DegreeEvidence['durationExtensions']>[string];
export type GraduateEligibilityEvidence = NonNullable<DegreeEvidence['graduateEligibility']>[string];

export function readDegreeEvidence(value: unknown): DegreeEvidence | undefined {
  const parsed = degreeEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
