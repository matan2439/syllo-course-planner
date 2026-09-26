/**
 * The JSON view of a committed board that apply-plan and edit-board return.
 *
 * Besides the placements it carries `requirements_validation`, the degree-requirements snapshot
 * recomputed for THIS plan (see requirements_recompute.ts). Without it the client can only show the
 * base board's precomputed numbers. It is omitted when the board ships no base snapshot to refresh.
 */
import { loadLocalBoardJson } from './board_loader';
import type { CommittedBoard } from './board_repository';
import { completedCategoryCountsFromContext, recomputeRequirements } from './requirements_recompute';

/** `planContext` is the owner's stored planning context; its unnamed completions count toward categories. */
export function committedBoardView(board: CommittedBoard, planContext?: unknown) {
  const view = {
    programId: board.programId,
    version: board.version,
    semesters: board.semesters.map((semester) => ({
      semesterId: semester.semesterId, courseIds: [...semester.courseIds],
    })),
  };
  const requirements = recomputeRequirements(
    loadLocalBoardJson(board.programId), view.semesters, completedCategoryCountsFromContext(planContext),
  );
  return requirements ? { ...view, requirements_validation: requirements } : view;
}
