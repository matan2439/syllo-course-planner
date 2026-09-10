import { render, waitFor } from '@testing-library/react';
import NativePlannerJourney from './NativePlannerJourney';
import { catalogRevision, type BoardModel } from '../../../shared/planner/model';

const CATALOG: BoardModel = {
  catalogRevision: catalogRevision('test-1'),
  courseCatalog: {},
  semesters: [
    {
      semesterId: 'year_3_semester_a',
      courses: [
        {
          courseId: '0542-2400', nameHe: 'תכן מכני', halfHours: 8,
          courseType: 'mandatory', isMandatory: true,
        },
      ],
    },
    { semesterId: 'year_3_semester_b', courses: [] },
  ],
};

test('onSemestersChange receives semesterId + courseIds for every board semester', async () => {
  const onSemestersChange = jest.fn();
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={jest.fn().mockResolvedValue(CATALOG)}
      committedBoardFn={jest.fn().mockResolvedValue(null)}
      serverApply={false}
      onSemestersChange={onSemestersChange}
    />,
  );

  await waitFor(() => expect(onSemestersChange).toHaveBeenCalled());
  const lastCall = onSemestersChange.mock.calls.at(-1)?.[0];
  expect(lastCall).toEqual([
    { semesterId: 'year_3_semester_a', courseIds: ['0542-2400'] },
    { semesterId: 'year_3_semester_b', courseIds: [] },
  ]);
});
