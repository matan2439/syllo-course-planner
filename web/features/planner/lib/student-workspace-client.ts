import { programWorkspaceSchema, weeklyScheduleSchema, type ProgramWorkspace } from '../../../../shared/planner/student-workspace';
import type { CommunityCourseNote, CourseNote, HiddenCommunityNote } from '../../../../shared/planner/course-notes';
import type { BiddingDraft, BiddingHistory } from '../../../../shared/planner/bidding';
import { createEmptyBiddingDraft } from '../../../../shared/planner/bidding';
import { biddingRoundSnapshotSchema } from '../../../../shared/planner/bidding-rounds';
import type { CommittedBoardState } from '../../../../shared/planner/api-client';
const URL = '/api/ai/student-workspace';
export class WorkspaceError extends Error { constructor(readonly code: string) { super(code); } }
async function request(url: string, body?: unknown) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new WorkspaceError(result.code ?? 'WORKSPACE_UNAVAILABLE');
  return result;
}
function workspace(result: any) {
  if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw new WorkspaceError('INVALID_RESPONSE');
  return { revision: result.revision as number, data: programWorkspaceSchema.parse(result.data) };
}
export const loadStudentWorkspace = async (programId: string) => workspace(await request(`${URL}?scope=program&program_id=${encodeURIComponent(programId)}`));
export const saveStudentWorkspace = async (programId: string, revision: number, data: ProgramWorkspace) => workspace(await request(URL, { scope: 'program', program_id: programId, expected_revision: revision, data }));
export async function restoreStudentPlan(programId: string, planId: string, boardVersion: string | null, key: string) {
  const result = await request(URL, { action: 'restore', program_id: programId, plan_id: planId, expected_board_version: boardVersion, idempotency_key: key });
  return { board: result.board as CommittedBoardState, weeklySchedule: weeklyScheduleSchema.parse(result.weeklySchedule), bidding: result.bidding as BiddingDraft | undefined,
    biddingRounds: result.biddingRounds === undefined ? undefined : biddingRoundSnapshotSchema.array().max(20).parse(result.biddingRounds) };
}
export async function fetchBiddingHistory(programId: string, draft: BiddingDraft): Promise<BiddingHistory> {
  return (await request(`${URL}?scope=history&program_id=${encodeURIComponent(programId)}&academic_year=${draft.academicYear}&semester=${draft.semester}&round=${draft.round}`)).history;
}
export async function shareBiddingResults(programId: string, draft: BiddingDraft, consent: boolean): Promise<void> {
  const payload = consent ? draft : createEmptyBiddingDraft();
  await request(URL, { action: 'share', program_id: programId, draft: payload, consent });
}
// Shared (anonymous) course notes.
export async function fetchCommunityNotes(courseId: string): Promise<CommunityCourseNote[]> {
  return (await request(`${URL}?scope=community_notes&course_id=${encodeURIComponent(courseId)}`)).notes;
}
export const publishCommunityNote = async (note: Pick<CourseNote, 'id' | 'courseId' | 'kind' | 'lecturer' | 'body'>) => {
  await request(URL, { action: 'publish_note', note: { id: note.id, courseId: note.courseId, kind: note.kind, body: note.body, ...(note.lecturer ? { lecturer: note.lecturer } : {}) } });
};
export const withdrawCommunityNote = async (noteId: string) => { await request(URL, { action: 'withdraw_note', note_id: noteId }); };
export const reportCommunityNote = async (publicId: string) => { await request(URL, { action: 'report_note', public_id: publicId }); };
export async function fetchHiddenNotes(): Promise<HiddenCommunityNote[]> { return (await request(`${URL}?scope=moderation`)).notes; }
export const moderateCommunityNote = async (publicId: string, decision: 'restore' | 'remove') => {
  await request(URL, { action: 'moderate_note', public_id: publicId, decision });
};
