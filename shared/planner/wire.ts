/**
 * WIRE schemas — runtime validation (zod) of raw network payloads and persisted
 * local workspace state, shared by api/ and web/. These validate the ACTUAL
 * existing responses (documented, captured this session). They do NOT require
 * fields the server does not return today (runId, contractVersion,
 * X-Planner-Contract, a server-returned proposal base revision).
 *
 * Objects use .passthrough() so legitimate extra fields in the real payloads
 * survive, while required IDENTIFIERS (course_id / semester_id / board_data_version)
 * and structural shape are still enforced.
 */
import { z } from 'zod';
import { CONTRACT_VERSION } from './model';

// ── GET /api/board/:programId (board_json, returned as-is) ───────────────────
const boardCourseSchema = z
  .object({
    course_id: z.string().min(1),
    // Present in the real catalog as a decimal half-hour (e.g. 3.5) or null.
    weekly_hours: z.number().nullable().optional(),
    // The real program_repository_courses carry name_he: null for some courses
    // (no known Hebrew name). nullish() accepts string | null | absent; the
    // adapter coalesces null → '' (never fabricates a name). course_type is
    // never null in the real payload (absent on repo entries), so it stays optional.
    name_he: z.string().nullish(),
    course_type: z.string().optional(),
    is_mandatory: z.boolean().optional(),
  })
  .passthrough();

const boardSemesterSchema = z
  .object({
    semester_id: z.string().min(1),
    courses: z.array(boardCourseSchema),
    display_name: z.string().optional(),
    total_weekly_hours: z.number().nullable().optional(),
    average_difficulty: z.number().nullable().optional(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();

export const boardResponseSchema = z
  .object({
    metadata: z
      .object({
        board_data_version: z.string().min(1),
        // The elective universe the planner draws from, alongside placed courses.
        // Optional: some program payloads may omit it (catalog is then placed-only).
        program_repository_courses: z.array(boardCourseSchema).optional(),
      })
      .passthrough(),
    semesters: z.array(boardSemesterSchema),
    summary: z.object({ total_courses: z.number().optional() }).passthrough().optional(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();
export type BoardResponse = z.infer<typeof boardResponseSchema>;

// ── POST /api/ai/generate-plan (response) ────────────────────────────────────
const planSemesterSchema = z.object({
  semester_id: z.string().min(1),
  course_ids: z.array(z.string()),
});
const planMoveSchema = z.object({
  course_id: z.string().min(1),
  from: z.string().nullable(),
  to: z.string().min(1),
});

export const generatePlanResponseSchema = z
  .object({
    semesters: z.array(planSemesterSchema),
    moves: z.array(planMoveSchema),
    warnings_he: z.array(z.string()),
    errors: z.array(z.string()),
    blocked: z.boolean(),
    // Present today but not structurally required to consume the plan:
    rationale_he: z.string().optional(),
    requirements_status: z.unknown().optional(),
    trace: z.unknown().optional(),
    interestEvaluation: z.unknown().optional(),
    // Opt-in AcademicDecisionAgent path only (default-off). Only the two fields
    // the native contract consumes are typed; everything else (grounding,
    // clarification, explanation, …) rides through untouched via passthrough.
    academicDecision: z
      .object({
        outcome: z
          .enum(['proposal', 'clarification_required', 'validation_failed', 'blocked', 'error'])
          .optional(),
        applyEligible: z.boolean().optional(),
        profileVersion: z.number().optional(),
        /**
         * S1 — the AUTHORITATIVE proposal receipt. Ids and versions only: the
         * client holds no plan the server would have to trust back, and Apply
         * names a candidate rather than sending one.
         */
        proposal: z
          .object({
            proposalId: z.string().min(1),
            candidateIds: z.array(z.string()),
            recommendedCandidateId: z.string().nullable(),
            baseBoardVersion: z.string().nullable(),
            profileVersion: z.number(),
            academicStatusDigest: z.string().min(1),
            expiresAt: z.number(),
          })
          .optional(),
        candidates: z
          .object({
            hasMeaningfulAlternatives: z.boolean().optional(),
            // K9C — the grounded explanation + the question-impact probe the
            // conversation gates on. All optional: absent on every legacy
            // response and whenever no evidence was prepared.
            groundedExplanationHe: z.string().nullable().optional(),
            groundedSources: z
              .array(z.object({
                courseId: z.string(),
                sourceRef: z.string(),
                academicYear: z.union([z.number(), z.string()]),
              }))
              .optional(),
            // C1 — the exposed alternative set. Declared explicitly so a
            // malformed alternative is rejected rather than reaching the UI.
            alternatives: z
              .array(z.object({
                candidateId: z.string(),
                normalizedIdentity: z.string(),
                recommended: z.boolean(),
                applyable: z.boolean(),
                semesters: z.array(z.object({ semesterId: z.string(), courseIds: z.array(z.string()) })),
                constraintFingerprint: z.string(),
                profileVersion: z.number(),
                snapshotId: z.string(),
                nonDominated: z.boolean(),
                composedUtility: z.number(),
                objectiveScores: z.array(z.object({ objectiveId: z.string(), normalized: z.number() })),
                labelHe: z.string(),
                differencesHe: z.array(z.string()),
                workload: z.object({ peakHours: z.number(), totalHours: z.number(), activePeriods: z.number() }),
              }))
              .optional(),
            // M7 — composition metadata. Declared explicitly so a malformed
            // payload is rejected rather than reaching the UI.
            groundedComposition: z
              .object({
                objectiveIds: z.array(z.string()),
                reason: z.string(),
                nonDominatedCount: z.number(),
                dominatedCount: z.number(),
                unresolvedTradeoff: z.boolean(),
                prioritySource: z.string().optional(),
              })
              .nullable()
              .optional(),
            evidence: z
              .object({
                // W3 — which grounded objective actually applied, so the UI can
                // describe the RIGHT missing fact rather than guessing.
                groundedObjective: z.string().nullable().optional(),
                coveredCourseCount: z.number().optional(),
                requestedCourseCount: z.number().optional(),
                unknownFeatureCourseIds: z.array(z.string()).optional(),
                groundedQuestionImpact: z
                  .object({
                    feature: z.string(),
                    distinguishesCandidates: z.boolean(),
                    coverageSufficient: z.boolean(),
                    hasConflicts: z.boolean(),
                  })
                  .optional(),
                /**
                 * C5 — the priority-clarification impact contract. Declared
                 * explicitly (never via passthrough) so a malformed contract is
                 * rejected instead of gating a real question in the browser.
                 */
                priorityQuestionImpact: z
                  .object({
                    category: z.literal('objective_priority'),
                    impactedObjectiveIds: z.array(z.string()),
                    objectiveLabels: z.record(z.string()),
                    currentRecommendedCandidateId: z.string(),
                    options: z.array(z.object({
                      value: z.string(),
                      labelHe: z.string(),
                      recommendedCandidateId: z.string(),
                    })),
                    changesRecommendation: z.boolean(),
                    alreadyAnswered: z.boolean(),
                    eligible: z.boolean(),
                    profileVersion: z.number(),
                    snapshotId: z.string(),
                    tradeoffExplanationHe: z.string(),
                    equalImportanceLabelHe: z.string(),
                  })
                  .optional(),
                // W1 — the course CONTENT/TOPIC impact probe. Declared
                // explicitly rather than relying on `.passthrough()`, so a
                // malformed probe is rejected instead of reaching the UI.
                topicQuestionImpact: z
                  .object({
                    category: z.string(),
                    distinguishesCandidates: z.boolean(),
                    distinguishingTopics: z.array(z.string()),
                    topicLabels: z.record(z.string()),
                    coverageSufficient: z.boolean(),
                    hasConflicts: z.boolean(),
                    unknownTopicCourseCount: z.number(),
                    snapshotId: z.string(),
                    profileVersion: z.number(),
                  })
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
        structuredClarification: z
          .object({
            items: z.array(z.record(z.unknown())),
            applyBlocked: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        validationFindings: z.array(z.record(z.unknown())).optional(),
      })
      .passthrough()
      .optional(),
    // Additive — present only when free-text interpretation ran. Honored /
    // partially-honored / unmet lines DERIVED from the actual plan (never prose).
    intentOutcome: z
      .object({
        honored: z.array(z.string()),
        partiallyHonored: z.array(z.string()),
        unmet: z.array(z.string()),
        notesHe: z.array(z.string()),
      })
      .optional(),
  })
  .passthrough();
export type GeneratePlanResponse = z.infer<typeof generatePlanResponseSchema>;


// ── POST /api/ai/apply-plan + GET (the session's committed board) ────────────
export const applyPlanResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    replayed: z.boolean(),
    board: z.object({
      programId: z.string(),
      version: z.string().min(1),
      semesters: z.array(z.object({ semesterId: z.string(), courseIds: z.array(z.string()) })),
    }),
    appliedCandidateId: z.string(),
    appliedProposalId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    message_he: z.string(),
    currentBoardVersion: z.string().nullable().optional(),
  }),
]);
export type ApplyPlanResponse = z.infer<typeof applyPlanResponseSchema>;

export const committedBoardResponseSchema = z
  .object({
    ok: z.literal(true),
    board: z
      .object({
        programId: z.string(),
        version: z.string().min(1),
        semesters: z.array(z.object({ semesterId: z.string(), courseIds: z.array(z.string()) })),
      })
      .nullable(),
    /** Truthful disclosure of what this deployment can actually promise. */
    storage: z.string().optional(),
  })
  .passthrough();
export type CommittedBoardResponse = z.infer<typeof committedBoardResponseSchema>;

// The browser sends a manual edit intent, never a replacement plan or owner id.
const manualBoardEditBaseSchema = z.object({
  program_id: z.string().min(1),
  expected_board_version: z.string().regex(/^bv_\d+$/).nullable(),
  operation_id: z.string().min(16).max(128),
  course_id: z.string().min(1),
  academic_status_digest: z.string().min(1),
});
export const manualBoardEditRequestSchema = z.discriminatedUnion('operation', [
  manualBoardEditBaseSchema.extend({
    operation: z.literal('add_course'),
    semester_id: z.string().min(1),
  }).strict(),
  manualBoardEditBaseSchema.extend({
    operation: z.literal('remove_course'),
  }).strict(),
  manualBoardEditBaseSchema.extend({
    operation: z.literal('move_course'),
    semester_id: z.string().min(1),
  }).strict(),
]);
export type ManualBoardEditRequest = z.infer<typeof manualBoardEditRequestSchema>;

export const manualBoardEditResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    replayed: z.boolean(),
    operation_id: z.string().min(1),
    board: z.object({
      programId: z.string().min(1),
      version: z.string().regex(/^bv_\d+$/),
      semesters: z.array(z.object({ semesterId: z.string(), courseIds: z.array(z.string()) })),
    }),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: z.string().min(1),
    message_he: z.string().min(1),
    currentBoardVersion: z.string().regex(/^bv_\d+$/).nullable().optional(),
  }).strict(),
]);
export type ManualBoardEditResponse = z.infer<typeof manualBoardEditResponseSchema>;

// Establishes the server-owned academic context used by manual validation.
// Academic facts are user claims, but their digest and session owner are
// minted by the server; this route never accepts a replacement board.
export const planningContextRequestSchema = z.object({
  program_id: z.string().min(1),
  plan_context: z.object({
    personal_status: z.unknown(),
    semesters: z.array(z.unknown()),
  }).passthrough(),
  preferences: z.record(z.unknown()),
}).strict();
export type PlanningContextRequest = z.infer<typeof planningContextRequestSchema>;

export const planningContextResponseSchema = z.object({
  ok: z.literal(true),
  academic_status_digest: z.string().regex(/^as_[a-f0-9]{16}$/),
}).strict();
export type PlanningContextResponse = z.infer<typeof planningContextResponseSchema>;

export const loadedPlanningContextResponseSchema = z.object({
  ok: z.literal(true),
  context: z.object({
    academic_status_digest: z.string().regex(/^as_[a-f0-9]{16}$/),
    personal_status: z.unknown(),
    preferences: z.record(z.unknown()),
  }).strict().nullable(),
}).strict();
export type LoadedPlanningContextResponse = z.infer<typeof loadedPlanningContextResponseSchema>;

// ── Local workspace (persisted client-side; versioned, program-scoped) ───────
export const workspaceSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    programId: z.string().min(1),
    /** catalog revision captured at save time (for staleness detection). */
    catalogRevisionAtSave: z.string().min(1),
    /** client-generated local workspace revision. */
    localRevision: z.string().min(1),
    applied: z.object({ semesters: z.array(planSemesterSchema) }).nullable(),
    draft: z.object({ semesters: z.array(planSemesterSchema) }).passthrough().nullable(),
    preferences: z.record(z.unknown()),
  })
  .passthrough();
export type Workspace = z.infer<typeof workspaceSchema>;

// ── PENDING (Slice 3): POST /api/ai/validate-plan — NOT IMPLEMENTED ──────────
// Defined here as the FUTURE contract only. There is no such route today; do not
// treat these as an implemented endpoint. The route + server module land in
// Slice 3, reusing api/ai/plan_validation.ts (validatePlanProposal) /
// planner_validate.ts (validatePlanState) — never porting rules into React.
export const validatePlanRequestSchema = z
  .object({
    program_id: z.string().min(1),
    session_token: z.string().uuid(),
    semesters: z.array(planSemesterSchema),
    catalogRevision: z.string().min(1),
  })
  .passthrough();
export type ValidatePlanRequest = z.infer<typeof validatePlanRequestSchema>;

const violationSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  courseId: z.string().optional(),
  semesterId: z.string().optional(),
  message_he: z.string().optional(),
});
export const validatePlanResponseSchema = z
  .object({
    applicable: z.boolean(),
    blocked: z.boolean(),
    violations: z.array(violationSchema),
    warnings: z.array(z.string()),
    totals: z.object({
      perSemesterHalfHours: z.record(z.number()),
      degreeHalfHours: z.number(),
    }),
  })
  .passthrough();
export type ValidatePlanResponse = z.infer<typeof validatePlanResponseSchema>;
