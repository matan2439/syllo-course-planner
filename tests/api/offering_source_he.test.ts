import { offeringSourceHe } from '../../api/ai/agent/tools';

test('names the source allowed_semesters came from', () => {
  expect(offeringSourceHe('https://www.tau.ac.il/study-program?safa=1&shana=2026&tab=schedule&tcid=8715')).toBe('מערכת השעות הרשמית של התוכנית');
  expect(offeringSourceHe('https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05423792&year=2026')).toBe('חיפוש הקורסים של אוניברסיטת תל אביב');
  expect(offeringSourceHe(null)).toBeNull();
  expect(offeringSourceHe('board.offered_semesters')).toBeNull();
});
