import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import StudentWorkspaceTools from './StudentWorkspaceTools';
import { programWorkspaceSchema, EMPTY_WEEKLY_SCHEDULE } from '../../../../shared/planner/student-workspace';
import { createEmptyBiddingDraft } from '../../../../shared/planner/bidding';
import * as client from '../lib/student-workspace-client';
jest.mock('../lib/student-workspace-client', () => {
  const actual = jest.requireActual('../lib/student-workspace-client');
  return { ...actual, loadStudentWorkspace: jest.fn(), saveStudentWorkspace: jest.fn(), restoreStudentPlan: jest.fn() };
});
const snapshot = { version: 'bv_1', catalogVersion: 'catalog_1', semesters: [{ semesterId: 'A', courseIds: ['C1'] }], courseNames: { C1: 'קורס' }, courseHours: { C1: 3 } };
const plan = (id: string, course: string) => ({ id, name: course, notes: '', catalogVersion: 'catalog_1', createdAt: 1, updatedAt: 1, semesters: [{ semesterId: 'A', courseIds: [course] }], weeklySchedule: EMPTY_WEEKLY_SCHEDULE });
beforeEach(() => {
  jest.clearAllMocks();
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 0, data: programWorkspaceSchema.parse({}) });
  (client.saveStudentWorkspace as jest.Mock).mockImplementation(async (_program, revision, data) => ({ revision: revision + 1, data }));
});
const props = () => ({ programId: 'p_2027', snapshot, weeklySchedule: EMPTY_WEEKLY_SCHEDULE, onRestored: jest.fn() });

test('saved search bridge persists criteria through the workspace queue and rejects old owner callbacks', async () => {
  const onSearchLibrary = jest.fn();
  const view = render(<StudentWorkspaceTools {...props()} onSearchLibrary={onSearchLibrary} />);
  await waitFor(() => expect(onSearchLibrary.mock.calls.some(([value]) => value?.ready)).toBe(true));
  const library = onSearchLibrary.mock.calls.filter(([value]) => value?.ready).slice(-1)[0][0];
  const searches = [{ id: 'search_12345678', name: 'קורסי בחירה', query: '', filters: { minGrade: 80 } }];
  act(() => library.change(searches));
  await waitFor(() => expect((client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2].courseSearches).toEqual(searches));
  const saved = (client.saveStudentWorkspace as jest.Mock).mock.calls.length;
  view.unmount();
  act(() => library.change([]));
  await act(async () => {});
  expect(client.saveStudentWorkspace).toHaveBeenCalledTimes(saved);
});

test('autosave preserves round archives and timetable options on the active plan only', async () => {
  const biddingRounds = [{ id: 'round_12345678', savedAt: 123, draft: createEmptyBiddingDraft(2026) }];
  const first = { ...plan('plan_11111111', 'C1'), biddingRounds };
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 1, data: programWorkspaceSchema.parse({ plans: [first], activePlanId: first.id, biddingRounds }) });
  const p = props();
  const view = render(<StudentWorkspaceTools {...p} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'הוסף תוכנית' })).toBeEnabled());
  const weekly = { ...EMPTY_WEEKLY_SCHEDULE, busyTimes: [{ id: 'busy_12345678', day: 'א' as const, start: '09:00', end: '12:00', label: 'עבודה', semesterId: 'A' }] };
  view.rerender(<StudentWorkspaceTools {...p} weeklySchedule={weekly} />);
  await waitFor(() => expect((client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0]?.[2]?.plans[0].weeklySchedule).toEqual(weekly));
  expect((client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2].plans[0].biddingRounds).toEqual(biddingRounds);
});

test('starts with one slot, copies it into another and autosaves edits only into the active slot', async () => {
  const p = props();
  const view = render(<StudentWorkspaceTools {...p} />);
  await screen.findByRole('button', { name: 'תוכנית 1: תוכנית 1' });
  await waitFor(() => expect(client.saveStudentWorkspace).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'הוסף תוכנית' }));
  await waitFor(() => expect(client.saveStudentWorkspace).toHaveBeenCalledTimes(2));
  view.rerender(<StudentWorkspaceTools {...p} snapshot={{ ...snapshot, semesters: [{ semesterId: 'A', courseIds: ['C2'] }] }} weeklySchedule={{ ...EMPTY_WEEKLY_SCHEDULE, selections: { 'C2:2026:1': ['02'] } }} />);
  await waitFor(() => expect(client.saveStudentWorkspace).toHaveBeenCalledTimes(3));
  const data = (client.saveStudentWorkspace as jest.Mock).mock.calls[2][2];
  expect(data.plans.map((item: any) => item.semesters[0].courseIds)).toEqual([['C1'], ['C2']]);
  expect(data.plans[1].weeklySchedule.selections['C2:2026:1']).toEqual(['02']);
  expect(data.activePlanId).toBe(data.plans[1].id);
});

test('switching waits for both restored board and weekly state before enabling autosave', async () => {
  const p = props();
  const first = plan('plan_11111111', 'C1');
  const second = { ...plan('plan_22222222', 'C2'), weeklySchedule: { ...EMPTY_WEEKLY_SCHEDULE, selections: { 'C2:2026:1': ['02'] } } };
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 2, data: { ...programWorkspaceSchema.parse({ plans: [first, second] }), activePlanId: first.id } });
  (client.restoreStudentPlan as jest.Mock).mockResolvedValue({ weeklySchedule: second.weeklySchedule });
  const view = render(<StudentWorkspaceTools {...p} />);
  const secondSlot = await screen.findByRole('button', { name: 'תוכנית 2: C2' });
  await waitFor(() => expect(secondSlot).toBeEnabled());
  fireEvent.click(secondSlot);
  await waitFor(() => expect(p.onRestored).toHaveBeenCalledWith(second.weeklySchedule));
  view.rerender(<StudentWorkspaceTools {...p} snapshot={{ ...snapshot, version: 'bv_2', semesters: second.semesters }} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
  expect((client.saveStudentWorkspace as jest.Mock).mock.calls.every((call) => JSON.stringify(call[2].plans[1]) === JSON.stringify(second))).toBe(true);
  view.rerender(<StudentWorkspaceTools {...p} snapshot={{ ...snapshot, version: 'bv_2', semesters: second.semesters }} weeklySchedule={second.weeklySchedule} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'תוכנית 2: C2' })).toHaveAttribute('aria-pressed', 'true'));
  view.rerender(<StudentWorkspaceTools {...p} snapshot={{ ...snapshot, version: 'bv_3', semesters: [{ semesterId: 'A', courseIds: ['C2', 'C3'] }] }} weeklySchedule={second.weeklySchedule} />);
  await waitFor(() => expect((client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2].plans[1].semesters[0].courseIds).toEqual(['C2', 'C3']));
  expect((client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2].plans[0]).toEqual(first);
});

test('initial hydration preserves the authoritative live board and restores only the slot timetable', async () => {
  const p = { ...props(), onWeeklyHydrated: jest.fn() }, saved = { ...plan('plan_22222222', 'C2'), weeklySchedule: { ...EMPTY_WEEKLY_SCHEDULE, freeDays: ['ו' as const] } };
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 2, data: { ...programWorkspaceSchema.parse({ plans: [saved] }), activePlanId: saved.id } });
  const view = render(<StudentWorkspaceTools {...p} />);
  await waitFor(() => expect(p.onWeeklyHydrated).toHaveBeenCalledWith(saved.weeklySchedule));
  expect(client.restoreStudentPlan).not.toHaveBeenCalled();
  expect(client.saveStudentWorkspace).not.toHaveBeenCalled();
  view.rerender(<StudentWorkspaceTools {...p} weeklySchedule={saved.weeklySchedule} />);
  await waitFor(() => expect((client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2].plans[0].semesters).toEqual(snapshot.semesters));
});

test('a rejected restore preserves the active slot and visible board', async () => {
  const p = props(), first = plan('plan_11111111', 'C1'), second = plan('plan_22222222', 'C2');
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 1, data: { ...programWorkspaceSchema.parse({ plans: [first, second] }), activePlanId: first.id } });
  (client.restoreStudentPlan as jest.Mock).mockRejectedValue(new client.WorkspaceError('PLAN_INVALID'));
  render(<StudentWorkspaceTools {...p} />);
  const secondSlot = await screen.findByRole('button', { name: 'תוכנית 2: C2' });
  await waitFor(() => expect(secondSlot).toBeEnabled());
  fireEvent.click(secondSlot);
  await screen.findByText(/החלופה אינה עומדת בכללים העדכניים/);
  expect(p.onRestored).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'תוכנית 1: C1' })).toHaveAttribute('aria-pressed', 'true');
  expect(client.saveStudentWorkspace).not.toHaveBeenCalled();
});

test('an obsolete account load cannot populate the next account library', async () => {
  let finish: (value: unknown) => void = () => {};
  (client.loadStudentWorkspace as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<StudentWorkspaceTools key="account-a" {...props()} />);
  view.rerender(<StudentWorkspaceTools key="account-b" {...props()} />);
  await waitFor(() => expect(client.loadStudentWorkspace).toHaveBeenCalledTimes(2));
  finish({ revision: 1, data: { plans: [{ name: 'secret-other-account' }] } });
  await waitFor(() => expect(screen.queryByText('secret-other-account')).not.toBeInTheDocument());
});

test('migrating an unselected saved library preserves its alternatives and gives the live board its own slot', async () => {
  const saved = plan('plan_22222222', 'C2');
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 1, data: programWorkspaceSchema.parse({ plans: [saved] }) });
  render(<StudentWorkspaceTools {...props()} />);
  await waitFor(() => expect(client.saveStudentWorkspace).toHaveBeenCalled());
  const savedData = (client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2];
  expect(savedData.plans[0]).toEqual(saved);
  expect(savedData.plans[1].semesters).toEqual(snapshot.semesters);
  expect(savedData.activePlanId).toBe(savedData.plans[1].id);
});

test('an interrupted switch recognizes the committed target without replacing the prior slot', async () => {
  const first = plan('plan_11111111', 'C1'), second = plan('plan_22222222', 'C2');
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 1, data: { ...programWorkspaceSchema.parse({ plans: [first, second] }), activePlanId: first.id } });
  render(<StudentWorkspaceTools {...props()} snapshot={{ ...snapshot, semesters: second.semesters }} />);
  await waitFor(() => expect(client.saveStudentWorkspace).toHaveBeenCalled());
  const savedData = (client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2];
  expect(savedData.activePlanId).toBe(second.id);
  expect(savedData.plans).toEqual([first, second]);
  expect(client.restoreStudentPlan).not.toHaveBeenCalled();
});

test.each(['selected', 'recovered'])('hydrates the %s slot bidding when its weekly schedule already matches', async (selection) => {
  const originalBidding = { ...createEmptyBiddingDraft(2026), budget: 80 };
  const targetBidding = { ...createEmptyBiddingDraft(2026), budget: 150 };
  const first = { ...plan('plan_11111111', 'C1'), bidding: originalBidding };
  const second = { ...plan('plan_22222222', 'C2'), bidding: targetBidding };
  (client.loadStudentWorkspace as jest.Mock).mockResolvedValue({ revision: 1, data: programWorkspaceSchema.parse({ plans: [first, second], bidding: originalBidding, activePlanId: selection === 'selected' ? second.id : first.id }) });
  render(<StudentWorkspaceTools {...props()} snapshot={{ ...snapshot, semesters: second.semesters }} />);
  await waitFor(() => expect(client.saveStudentWorkspace).toHaveBeenCalled());
  const savedData = (client.saveStudentWorkspace as jest.Mock).mock.calls.slice(-1)[0][2];
  expect(savedData.activePlanId).toBe(second.id);
  expect(savedData.bidding).toEqual(targetBidding);
  expect(savedData.plans).toEqual([first, second]);
  expect(client.restoreStudentPlan).not.toHaveBeenCalled();
});
