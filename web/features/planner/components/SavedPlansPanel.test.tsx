import { fireEvent, render, screen } from '@testing-library/react';
import SavedPlansPanel from './SavedPlansPanel';
const plans = [{ id: 'plan_11111111', name: 'A', notes: '', createdAt: 1, updatedAt: 1, catalogVersion: 'old', semesters: [{ semesterId: 'A', courseIds: ['C1'] }], weeklySchedule: { termMapping: {}, selections: {}, freeDays: [] } }];

test('numbered slots add and rename the active combination inline with quiet advanced actions', () => {
  const onCreate = jest.fn(), onRestore = jest.fn(), onChange = jest.fn();
  render(<SavedPlansPanel plans={plans} activePlanId={plans[0].id} ready busy={false} courseNames={{ C1: 'Course' }} courseHours={{ C1: 3 }} onCreate={onCreate} onChange={onChange} onRestore={onRestore} onDelete={jest.fn()} onDuplicate={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'תוכנית 1: A' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('שם התוכנית הפעילה'), { target: { value: 'גיבוי' } });
  fireEvent.blur(screen.getByLabelText('שם התוכנית הפעילה'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'גיבוי' }));
  fireEvent.click(screen.getByRole('button', { name: 'הוסף תוכנית' }));
  expect(onCreate).toHaveBeenCalledWith('תוכנית 2');
  expect(screen.queryByText('אמת וטען')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'פעולות לתוכנית' })).toBeInTheDocument();
  expect(screen.queryByLabelText('הערות לתוכנית')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'הערות' }));
  expect(screen.getByLabelText('הערות לתוכנית')).toBeInTheDocument();
});
