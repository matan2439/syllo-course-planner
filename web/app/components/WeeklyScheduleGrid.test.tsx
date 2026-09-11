import { render, screen } from '@testing-library/react';
import WeeklyScheduleGrid, { type GridBlock } from './WeeklyScheduleGrid';

const BLOCKS: GridBlock[] = [
  {
    key: '0542-2400:01:0',
    courseId: '0542-2400',
    courseName: 'תכן מכני (1)',
    groupId: '01',
    kind: 'ראשית',
    slot: { day: 'א', start: '10:00', end: '12:00' },
  },
];

test('renders a day header per day and a labeled block per slot', () => {
  render(<WeeklyScheduleGrid blocks={BLOCKS} />);
  expect(screen.getByRole('grid', { name: 'מערכת שעות שבועית' })).toBeInTheDocument();
  ['א', 'ב', 'ג', 'ד', 'ה', 'ו'].forEach((day) => {
    expect(screen.getByText(day)).toBeInTheDocument();
  });
  expect(
    screen.getByRole('gridcell', { name: 'תכן מכני (1), ראשית, יום א, 10:00-12:00' }),
  ).toBeInTheDocument();
});

test('a block for a day outside א-ו is skipped rather than crashing', () => {
  const bad: GridBlock[] = [{ ...BLOCKS[0], key: 'bad', slot: { day: 'שבת', start: '10:00', end: '12:00' } }];
  render(<WeeklyScheduleGrid blocks={bad} />);
  expect(screen.queryByRole('gridcell')).toBeNull();
});

test('renders nothing extra with an empty block list', () => {
  render(<WeeklyScheduleGrid blocks={[]} />);
  expect(screen.queryByRole('gridcell')).toBeNull();
});
