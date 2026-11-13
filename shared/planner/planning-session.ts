/**
 * The planning-session contract: everything the co-pilot must remember between turns, as
 * STRUCTURED state — never the raw chat. The conversation itself is kept only as a short
 * rolling window plus a running summary, so a session has a hard size ceiling however long
 * the student talks.
 *
 * Pure contract + helpers; no storage. Where it is persisted is a separate, approved decision.
 */
import { z } from 'zod'

export const SESSION_LIMITS = {
  recentTurns: 12,
  turnChars: 2_000,
  summaryChars: 2_000,
  decisions: 40,
  draftChanges: 80,
  toolDigests: 16,
  directions: 5,
} as const

const id = z.string().trim().min(1).max(128)
const shortHe = z.string().trim().min(1).max(300)
/** Who established a fact: the student said it, the co-pilot inferred it, or it is a default. */
const source = z.enum(['stated', 'inferred', 'default'])

/** What the student is optimizing for. Hard academic rules are NOT here — they are never weighed. */
export const OBJECTIVE_IDS = ['specialization', 'degree_progress', 'load_balance', 'campus_days', 'free_days'] as const
export type ObjectiveId = (typeof OBJECTIVE_IDS)[number]

export const planningProfileSchema = z.object({
  objectives: z.array(z.object({
    id: z.enum(OBJECTIVE_IDS),
    weight: z.number().min(0).max(1),
    source,
    /** An inferred priority shapes the plan only after the student confirmed it. */
    confirmed: z.boolean(),
  }).strict()).max(OBJECTIVE_IDS.length),
  /** Specialization directions under discussion ("computational mechanics"), most important first. */
  directions: z.array(z.object({
    label_he: z.string().trim().min(1).max(80),
    anchor_course_ids: z.array(id).max(8),
    source,
    confirmed: z.boolean(),
  }).strict()).max(SESSION_LIMITS.directions),
  free_days: z.array(z.enum(['א', 'ב', 'ג', 'ד', 'ה', 'ו'])).max(5),
  max_weekly_hours: z.number().min(6).max(30).nullable(),
  /** The student accepted a heavier semester than their own cap in exchange for specialization. */
  specialization_may_exceed_preferred_load: z.boolean(),
}).strict()
export type PlanningProfile = z.infer<typeof planningProfileSchema>

/** One change the draft makes to the committed board. The board itself is never copied here. */
export const draftChangeSchema = z.object({
  kind: z.enum(['add', 'move', 'remove']),
  course_id: id,
  /** Target semester for add/move. */
  semester_id: id.nullable(),
  reason_he: z.string().trim().min(1).max(160).optional(),
  /** The student has already said yes to this specific change. */
  accepted: z.boolean(),
}).strict()
export type DraftChange = z.infer<typeof draftChangeSchema>

export const planningSessionSchema = z.object({
  schema_version: z.literal(1),
  program_id: id,
  /** The committed board version the draft was built on; a different live version means rebase. */
  base_board_version: z.string().max(256).nullable(),
  profile: planningProfileSchema,
  draft_changes: z.array(draftChangeSchema).max(SESSION_LIMITS.draftChanges),
  /** Committed courses the student released for change in this session. */
  unlocked_course_ids: z.array(id).max(40),
  /** Decisions the student made, newest last ("prefers FE over design", "rejected the 26h semester"). */
  decisions: z.array(z.object({ at: z.string().max(40), summary_he: shortHe }).strict()).max(SESSION_LIMITS.decisions),
  pending_question: z.object({ question_he: z.string().trim().min(1).max(400), question_id: id.optional() }).strict().nullable(),
  /** Compact results of expensive lookups, so they are not repeated every turn. */
  tool_digests: z.array(z.object({ tool: id, key: z.string().max(200), digest: z.string().max(600) }).strict()).max(SESSION_LIMITS.toolDigests),
  /** Everything older than `recent_turns`, summarized. */
  summary_he: z.string().max(SESSION_LIMITS.summaryChars),
  recent_turns: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(SESSION_LIMITS.turnChars) }).strict())
    .max(SESSION_LIMITS.recentTurns),
  updated_at: z.string().max(40),
}).strict()
export type PlanningSessionState = z.infer<typeof planningSessionSchema>

export const DEFAULT_PROFILE: PlanningProfile = {
  // Specialization outranks load balance unless the student says otherwise.
  objectives: [
    { id: 'specialization', weight: 0.8, source: 'default', confirmed: true },
    { id: 'degree_progress', weight: 0.6, source: 'default', confirmed: true },
    { id: 'load_balance', weight: 0.3, source: 'default', confirmed: true },
  ],
  directions: [], free_days: [], max_weekly_hours: null, specialization_may_exceed_preferred_load: false,
}

export function emptyPlanningSession(programId: string, baseBoardVersion: string | null, now: string): PlanningSessionState {
  return {
    schema_version: 1, program_id: programId, base_board_version: baseBoardVersion, profile: DEFAULT_PROFILE,
    draft_changes: [], unlocked_course_ids: [], decisions: [], pending_question: null, tool_digests: [],
    summary_he: '', recent_turns: [], updated_at: now,
  }
}

/**
 * The order the planner weighs objectives in: confirmed ones by weight, strongest first.
 * An unconfirmed inferred priority is ignored — the co-pilot must ask before it counts.
 */
export function objectiveOrder(profile: PlanningProfile): ObjectiveId[] {
  return profile.objectives
    .filter((objective) => objective.confirmed && objective.weight > 0)
    .sort((a, b) => b.weight - a.weight || OBJECTIVE_IDS.indexOf(a.id) - OBJECTIVE_IDS.indexOf(b.id))
    .map((objective) => objective.id)
}

/** The student stated or confirmed a priority: it replaces whatever was there for that objective. */
export function setObjective(profile: PlanningProfile, objectiveId: ObjectiveId, weight: number, from: 'stated' | 'inferred'): PlanningProfile {
  const next = { id: objectiveId, weight: Math.min(1, Math.max(0, weight)), source: from, confirmed: from === 'stated' }
  return { ...profile, objectives: [...profile.objectives.filter((objective) => objective.id !== objectiveId), next] }
}

export interface CompactionResult {
  session: PlanningSessionState
  /** Turns that left the window and must be folded into the summary by the caller. */
  overflow: PlanningSessionState['recent_turns']
}

/**
 * Add turns and keep the session inside its limits. Overflowing turns are returned so the caller
 * can summarize them (one cheap call, only when there is overflow); until it does, a plain
 * truncated note keeps the summary honest. Decisions and digests keep the newest entries.
 */
export function appendTurns(
  session: PlanningSessionState, turns: PlanningSessionState['recent_turns'], now: string,
): CompactionResult {
  const all = [...session.recent_turns, ...turns.map((turn) => ({ ...turn, text: turn.text.slice(0, SESSION_LIMITS.turnChars) }))]
  const overflow = all.slice(0, Math.max(0, all.length - SESSION_LIMITS.recentTurns))
  return {
    overflow,
    session: {
      ...session,
      recent_turns: all.slice(-SESSION_LIMITS.recentTurns),
      decisions: session.decisions.slice(-SESSION_LIMITS.decisions),
      tool_digests: session.tool_digests.slice(-SESSION_LIMITS.toolDigests),
      updated_at: now,
    },
  }
}

export function withSummary(session: PlanningSessionState, summaryHe: string): PlanningSessionState {
  return { ...session, summary_he: summaryHe.slice(0, SESSION_LIMITS.summaryChars) }
}

export interface RebaseResult {
  session: PlanningSessionState
  /** Draft changes dropped because the student's board moved underneath them. */
  dropped: DraftChange[]
}

/**
 * The committed board changed since the draft was built (the student edited it, or applied a
 * proposal). The board always wins: a draft change that no longer makes sense is dropped and
 * reported, never forced.
 */
export function rebaseDraft(
  session: PlanningSessionState,
  board: { version: string | null; semesters: ReadonlyArray<{ semesterId: string; courseIds: readonly string[] }> },
): RebaseResult {
  if (session.base_board_version === board.version) return { session, dropped: [] }
  const placedIn = new Map<string, string>()
  for (const semester of board.semesters) for (const courseId of semester.courseIds) placedIn.set(courseId, semester.semesterId)
  const semesterIds = new Set(board.semesters.map((semester) => semester.semesterId))
  const keep = (change: DraftChange) => {
    if (change.semester_id && !semesterIds.has(change.semester_id)) return false
    if (change.kind === 'add') return !placedIn.has(change.course_id)
    return placedIn.has(change.course_id) && (change.kind !== 'move' || placedIn.get(change.course_id) !== change.semester_id)
  }
  return {
    dropped: session.draft_changes.filter((change) => !keep(change)),
    session: {
      ...session,
      base_board_version: board.version,
      draft_changes: session.draft_changes.filter(keep),
      // A released course that is no longer on the board has nothing left to release.
      unlocked_course_ids: session.unlocked_course_ids.filter((courseId) => placedIn.has(courseId)),
    },
  }
}

/** Serialized size in bytes — the number storage planning and tests hold to. */
export const sessionBytes = (session: PlanningSessionState) => Buffer.byteLength(JSON.stringify(session), 'utf8')
