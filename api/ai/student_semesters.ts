/**
 * Semesters a student added past their program's own columns (degrees that run long, or a 3-year
 * degree taken over 4), kept as an account preference per program in the student workspace store.
 * The preference is the authority: every board load gets these columns back even after a board was
 * replaced (Apply, restore of a saved plan), and a guest's list moves to the account at sign-in with
 * the rest of the workspace. Server-only scope, so it never races the browser's workspace document.
 */
import type { CommittedBoard } from './board_repository';
import { loadLocalBoardJson } from './board_loader';
import { addedSemesterIds } from './planner_model';
import { getStudentWorkspaceStore } from './student_workspace_store';

const scope = (programId: string) => `added_semesters:${programId}`;

/** The owner's added semester ids for `programId`, in order. Storage trouble → none (the board still works). */
export async function loadAddedSemesters(ownerId: string, programId: string): Promise<string[]> {
  try {
    const record = await getStudentWorkspaceStore().load(ownerId, scope(programId));
    const ids = (record?.data as { semesterIds?: unknown } | undefined)?.semesterIds;
    return Array.isArray(ids) ? addedSemesterIds(loadLocalBoardJson(programId), ids) : [];
  } catch {
    return [];
  }
}

/** Replace the owner's added semesters for `programId`. Retries a concurrent write; throws when storage fails. */
export async function saveAddedSemesters(ownerId: string, programId: string, ids: readonly string[]): Promise<void> {
  const store = getStudentWorkspaceStore();
  const semesterIds = addedSemesterIds(loadLocalBoardJson(programId), ids);
  for (let attempt = 0; attempt < 3; attempt++) {
    const revision = (await store.load(ownerId, scope(programId)))?.revision ?? 0;
    if ((await store.save(ownerId, scope(programId), revision, { semesterIds })).ok) return;
  }
  throw new Error('ADDED_SEMESTERS_CONFLICT');
}

/** `board` with the owner's added semesters it lacks appended as empty columns. */
export function withAddedColumns(board: CommittedBoard | null, added: readonly string[]): CommittedBoard | null {
  if (!board) return board;
  const missing = added.filter((id) => !board.semesters.some((s) => s.semesterId === id));
  return missing.length
    ? { ...board, semesters: [...board.semesters, ...missing.map((semesterId) => ({ semesterId, courseIds: [] }))] }
    : board;
}

/** The owner's committed board with their added semesters — the one way planner endpoints load a board. */
export async function loadBoardWithAddedSemesters(
  repo: { load(ownerId: string, programId: string): Promise<CommittedBoard | null> }, ownerId: string, programId: string,
): Promise<CommittedBoard | null> {
  const [board, added] = await Promise.all([repo.load(ownerId, programId), loadAddedSemesters(ownerId, programId)]);
  return withAddedColumns(board, added);
}
