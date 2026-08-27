import { editBoard } from '../../shared/planner/api-client';

const request = {
  operation: 'add_course' as const,
  program_id: 'mechanical_engineering_2027', expected_board_version: null,
  operation_id: 'edit_0123456789abcdef', course_id: '0542-4241',
  semester_id: 'year_3_semester_a', academic_status_digest: 'as_1234567890abcdef',
};

describe('R2 — manual edit API client', () => {
  test('sends one minimal same-origin intent and parses the authoritative board', async () => {
    const fetchImpl = jest.fn(async (_url, _init) => ({ ok: true, status: 200, json: async () => ({
      ok: true, replayed: false, operation_id: request.operation_id,
      board: { programId: request.program_id, version: 'bv_1', semesters: [] },
    }) }));
    const result = await editBoard({ fetchImpl, baseUrl: '' }, request);
    expect(result).toEqual(expect.objectContaining({ ok: true, board: expect.objectContaining({ version: 'bv_1' }) }));
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe('/api/ai/edit-board');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.body).not.toMatch(/semesters|owner_id|new_board_version/);
  });

  test('returns a typed rejection without turning it into a transport error', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 409, json: async () => ({
      ok: false, code: 'BOARD_VERSION_CONFLICT', message_he: 'הלוח השתנה.', currentBoardVersion: 'bv_2',
    }) }));
    await expect(editBoard({ fetchImpl, baseUrl: '' }, request)).resolves.toEqual({
      ok: false, code: 'BOARD_VERSION_CONFLICT', messageHe: 'הלוח השתנה.', currentBoardVersion: 'bv_2',
    });
  });
});
