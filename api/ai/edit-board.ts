/** POST /api/ai/edit-board — authoritative manual board mutation. */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { manualBoardEditRequestSchema, type ManualBoardEditResponse } from '../../shared/planner/wire';
import { getAcademicContextStore, getBoardRepository } from './apply_runtime';
import { loadLocalBoardJson } from './board_loader';
import type { CommittedBoard } from './board_repository';
import {
  prepareManualCourseAdd, prepareManualCourseMove, prepareManualCourseRemove,
  type ManualAddFailureCode, type ManualRemoveFailureCode,
} from './manual_board_edit_service';
import { resolveOwner } from './session_owner';

type FailureCode = ManualAddFailureCode | ManualRemoveFailureCode
  | 'INVALID_REQUEST' | 'METHOD_NOT_ALLOWED' | 'ACADEMIC_CONTEXT_NOT_FOUND'
  | 'PROGRAM_NOT_FOUND' | 'BOARD_VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'INTERNAL_ERROR';

const MESSAGE_HE: Record<FailureCode, string> = {
  INVALID_REQUEST: 'בקשת העריכה אינה תקינה.',
  METHOD_NOT_ALLOWED: 'שיטה לא נתמכת.',
  ACADEMIC_CONTEXT_NOT_FOUND: 'יש לבנות תוכנית מחדש לפני עריכה ידנית.',
  PROGRAM_NOT_FOUND: 'לא נמצאו נתוני תוכנית סמכותיים.',
  ACADEMIC_STATUS_MISMATCH: 'המצב האקדמי השתנה. יש לבנות מחדש.',
  UNKNOWN_COURSE: 'הקורס אינו מוכר בקטלוג התוכנית.',
  UNKNOWN_SEMESTER: 'הסמסטר אינו מוכר בתוכנית.',
  COURSE_ALREADY_PRESENT: 'הקורס כבר נמצא בלוח.',
  COURSE_NOT_PRESENT: 'הקורס אינו נמצא בלוח.',
  COURSE_REQUIRED: 'לא ניתן להסיר קורס חובה.',
  COURSE_COMPLETED: 'קורס שהושלם אינו ניתן להוספה מחדש.',
  COURSE_CURRENTLY_TAKING: 'הקורס כבר נלמד כעת.',
  COURSE_HARD_EXCLUDED: 'הקורס מוחרג לפי אילוץ מאושר.',
  PLAN_INVALID: 'ההוספה אינה חוקית לפי דרישות התוכנית.',
  BOARD_VERSION_CONFLICT: 'הלוח השתנה. יש לרענן ולנסות שוב.',
  IDEMPOTENCY_CONFLICT: 'מזהה העריכה כבר שימש לפעולה אחרת.',
  INTERNAL_ERROR: 'אירעה שגיאה פנימית.',
};

const boardView = (board: CommittedBoard) => ({
  programId: board.programId,
  version: board.version,
  semesters: board.semesters.map((semester) => ({
    semesterId: semester.semesterId, courseIds: [...semester.courseIds],
  })),
});

function reject(res: VercelResponse, code: FailureCode, currentBoardVersion?: string | null): void {
  const body: ManualBoardEditResponse = {
    ok: false, code, message_he: MESSAGE_HE[code],
    ...(currentBoardVersion !== undefined ? { currentBoardVersion } : {}),
  };
  const status = code === 'METHOD_NOT_ALLOWED' ? 405
    : code === 'INVALID_REQUEST' ? 400
      : code === 'ACADEMIC_CONTEXT_NOT_FOUND' || code === 'PROGRAM_NOT_FOUND' ? 404
        : code === 'BOARD_VERSION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT' ? 409
          : code === 'INTERNAL_ERROR' ? 500 : 422;
  res.status(status).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== 'POST') { reject(res, 'METHOD_NOT_ALLOWED'); return; }
    const parsed = manualBoardEditRequestSchema.safeParse(req.body);
    if (!parsed.success) { reject(res, 'INVALID_REQUEST'); return; }
    const request = parsed.data;
    const owner = resolveOwner(req as any, res);
    const repo = getBoardRepository();
    const currentBoard = await repo.load(owner.ownerId, request.program_id);
    const candidateId = request.operation === 'add_course'
      ? `add:${request.course_id}:${request.semester_id}:${request.academic_status_digest}`
      : request.operation === 'move_course'
        ? `move:${request.course_id}:${request.semester_id}:${request.academic_status_digest}`
        : `remove:${request.course_id}:${request.academic_status_digest}`;

    // A retry legitimately carries the old version. Ask the repository first;
    // only its history can distinguish that replay from a stale new mutation.
    if ((currentBoard?.version ?? null) !== (request.expected_board_version ?? null) && currentBoard) {
      const replay = await repo.commit({
        ownerId: owner.ownerId, programId: request.program_id,
        expectedVersion: request.expected_board_version,
        semesters: currentBoard.semesters,
        proposalId: 'manual-board-edit', candidateId, idempotencyKey: request.operation_id,
      });
      if (replay.ok && replay.replayed) {
        res.status(200).json({ ok: true, replayed: true, operation_id: request.operation_id, board: boardView(replay.board) });
        return;
      }
      if (!replay.ok) { reject(res, replay.reason, replay.board?.version ?? null); return; }
    }

    const context = await getAcademicContextStore().load(owner.ownerId, request.program_id);
    if (!context) { reject(res, 'ACADEMIC_CONTEXT_NOT_FOUND'); return; }
    const boardJson = loadLocalBoardJson(request.program_id);
    if (!boardJson) { reject(res, 'PROGRAM_NOT_FOUND'); return; }
    const prepared = request.operation === 'add_course'
      ? prepareManualCourseAdd({ boardJson, context, currentBoard, request })
      : !currentBoard
        ? { ok: false as const, code: 'COURSE_NOT_PRESENT' as const }
        : request.operation === 'move_course'
          ? prepareManualCourseMove({ boardJson, context, currentBoard, request })
          : prepareManualCourseRemove({ boardJson, context, currentBoard, request });
    if (!prepared.ok) { reject(res, prepared.code); return; }

    const commit = await repo.commit({
      ownerId: owner.ownerId, programId: request.program_id,
      expectedVersion: request.expected_board_version,
      semesters: prepared.semesters,
      proposalId: 'manual-board-edit', candidateId, idempotencyKey: request.operation_id,
    });
    if (!commit.ok) { reject(res, commit.reason, commit.board?.version ?? null); return; }
    res.status(200).json({
      ok: true, replayed: commit.replayed, operation_id: request.operation_id,
      board: boardView(commit.board),
    });
  } catch (error) {
    console.error('[ai/edit-board] unexpected error:', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) reject(res, 'INTERNAL_ERROR');
  }
}
