/** Shared types for the planner journey. */
/** WHY a proposal is stale — the note must name the real cause, never guess. */
export type StaleReason = 'catalog' | 'status' | 'preferences' | 'manual'
export type BoardPhase = 'loading' | 'ready' | 'error'
export type GenPhase = 'idle' | 'generating' | 'done' | 'error'
export type ChatMsg = { role: 'user' | 'system'; text: string }

export interface ManualAddIntent {
  courseId: string
  semesterIds: string[]
}
