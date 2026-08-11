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
