/**
 * The conversation's memory, one turn at a time:
 *   startSessionTurn  → load the student's session and rebase its draft onto the live board;
 *   (the agent runs with the restored state, so it continues instead of restarting);
 *   finishSessionTurn → fold the new turns in, keep the window bounded, save with a revision check.
 *
 * Never fatal: if the store is unavailable (not migrated yet, a database hiccup) the turn runs as it
 * always did, from the transcript the client sent. A session can never make a reply fail.
 */
import type { ConversationTurn } from '../../shared/planner/conversation-wire';
import { appendTurns, rebaseDraft, SESSION_LIMITS, withSummary, type DraftChange, type PlanningSessionState } from '../../shared/planner/planning-session';
import type { PlannerSessionStore } from './planner_session_store';
import type { PlanningSession } from './agent/session';

export const plannerSessionsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.AI_PLANNER_SESSIONS === 'true';

export interface BoardSnapshot {
  version: string | null;
  semesters: ReadonlyArray<{ semesterId: string; courseIds: readonly string[] }>;
}

export interface TurnStart {
  /** The restored state, rebased onto the live board; null = a new conversation. */
  state: PlanningSessionState | null;
  /** The revision this turn read; the save must name it. */
  revision: number | null;
  /** Draft changes the committed board has overtaken since the last turn. */
  dropped: DraftChange[];
  /** The store could not be read: this turn runs without memory. */
  unavailable: boolean;
}

const fresh: TurnStart = { state: null, revision: null, dropped: [], unavailable: false };

export async function startSessionTurn(input: {
  store: PlannerSessionStore | null; ownerId: string; programId: string; board: BoardSnapshot; now?: number;
}): Promise<TurnStart> {
  if (!input.store) return fresh;
  try {
    const stored = await input.store.load(input.ownerId, input.programId, input.now);
    if (!stored) return fresh;
    const { session, dropped } = rebaseDraft(stored.state, input.board);
    return { state: session, revision: stored.revision, dropped, unavailable: false };
  } catch (error) {
    console.error('[planner-session] load failed; continuing without memory:', error instanceof Error ? error.message : String(error));
    return { ...fresh, unavailable: true };
  }
}

/**
 * What the agent reads as the conversation: the stored recent turns plus the student's new message.
 * The client's own transcript is only used when there is no stored session (the first turn, or a
 * session that expired) — the server's memory is the one that carries decisions across devices.
 */
export function agentTranscript(state: PlanningSessionState | null, requested: readonly ConversationTurn[]): ConversationTurn[] {
  const latest = [...requested].reverse().find((turn) => turn.role === 'user');
  if (!state || !state.recent_turns.length || !latest) return [...requested];
  const stored = state.recent_turns.map((turn) => ({ role: turn.role, text: turn.text }));
  // A resend of a message already stored is not added twice.
  const last = stored.at(-1);
  return last?.role === 'user' && last.text === latest.text ? stored : [...stored, { role: 'user', text: latest.text }];
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Fold turns that left the window into the running summary, newest kept, oldest dropped to fit. No model call. */
export function foldIntoSummary(summaryHe: string, overflow: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>): string {
  if (!overflow.length) return summaryHe;
  const lines = [...(summaryHe ? summaryHe.split('\n') : []),
    ...overflow.map((turn) => `${turn.role === 'user' ? 'תלמיד' : 'עוזר'}: ${oneLine(turn.text, turn.role === 'user' ? 160 : 100)}`)];
  let kept = lines;
  while (kept.join('\n').length > SESSION_LIMITS.summaryChars && kept.length > 1) kept = kept.slice(1);
  return kept.join('\n').slice(-SESSION_LIMITS.summaryChars);
}

export type FinishResult = 'saved' | 'conflict' | 'not_an_account' | 'error' | 'skipped';

export async function finishSessionTurn(input: {
  store: PlannerSessionStore | null; ownerId: string; programId: string; start: TurnStart;
  session: PlanningSession; userText: string; assistantText: string; board: BoardSnapshot; now?: number;
}): Promise<FinishResult> {
  if (!input.store || input.start.unavailable) return 'skipped';
  try {
    const nowIso = new Date(input.now ?? Date.now()).toISOString();
    const state = { ...input.session.planningState(nowIso), base_board_version: input.board.version };
    const { session: appended, overflow } = appendTurns(state, [
      { role: 'user', text: input.userText || '—' }, { role: 'assistant', text: input.assistantText || '—' }], nowIso);
    const next = withSummary(appended, foldIntoSummary(appended.summary_he, overflow));
    const result = await input.store.save({ ownerId: input.ownerId, programId: input.programId, state: next, expectedRevision: input.start.revision, now: input.now });
    return result.ok ? 'saved' : result.reason === 'NOT_AN_ACCOUNT' ? 'not_an_account' : 'conflict';
  } catch (error) {
    console.error('[planner-session] save failed; the reply is unaffected:', error instanceof Error ? error.message : String(error));
    return 'error';
  }
}

/** What the page needs to continue the conversation after a reload or on another device. */
export interface SessionView {
  turns: Array<{ role: 'user' | 'assistant'; text: string }>;
  pending_question_he: string | null;
  directions_he: string[];
  decisions_he: string[];
}

export function sessionView(state: PlanningSessionState): SessionView {
  return {
    turns: state.recent_turns.map((turn) => ({ role: turn.role, text: turn.text })),
    pending_question_he: state.pending_question?.question_he ?? null,
    directions_he: state.profile.directions.map((direction) => direction.label_he),
    decisions_he: state.decisions.slice(-8).map((decision) => decision.summary_he),
  };
}
