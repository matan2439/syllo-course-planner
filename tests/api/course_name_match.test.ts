import {
  normalizeCourseName,
  boundedLevenshtein,
  scoreCourseMatch,
  rankCourseMatches,
} from '../../shared/search/course-name-match';

describe('normalizeCourseName', () => {
  it('strips parentheses, nikkud and punctuation and collapses spacing', () => {
    expect(normalizeCourseName('תרמודינמיקה (2)')).toBe('תרמודינמיקה 2');
    expect(normalizeCourseName('  מכניקת   הזורמים (1) ')).toBe('מכניקת הזורמים 1');
  });
});

describe('boundedLevenshtein', () => {
  it('counts edits and early-outs past the budget', () => {
    expect(boundedLevenshtein('תנודות', 'תנודות', 2)).toBe(0);
    expect(boundedLevenshtein('תנודות', 'תנודת', 2)).toBe(1);
    expect(boundedLevenshtein('abc', 'xyz', 1)).toBe(2); // > max → max+1
  });
});

describe('scoreCourseMatch', () => {
  it('ranks exact > prefix > substring > token-subset > typo > none', () => {
    const name = 'תורת התנודות';
    const exact = scoreCourseMatch('תורת התנודות', name);
    const prefix = scoreCourseMatch('תורת', name);
    const substring = scoreCourseMatch('התנודות', name);
    const tokenSubset = scoreCourseMatch('תנודות תורת', name); // reordered tokens
    const typo = scoreCourseMatch('תורת התנודת', name);        // one missing letter
    const none = scoreCourseMatch('אלקטרוניקה', name);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(tokenSubset);
    expect(tokenSubset).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
    expect(none).toBe(0);
  });

  it('matches "תרמודינמיקה 2" (typed) to "תרמודינמיקה (2)" (catalog)', () => {
    expect(scoreCourseMatch('תרמודינמיקה 2', 'תרמודינמיקה (2)')).toBe(100);
  });

  it('matches on course id substring', () => {
    expect(scoreCourseMatch('4220', 'תורת התנודות', '0542-4220')).toBeGreaterThan(0);
  });

  it('empty query matches everything neutrally', () => {
    expect(scoreCourseMatch('', 'anything')).toBe(1);
  });
});

describe('rankCourseMatches', () => {
  const courses = [
    { id: '0542-4120', name: 'תרמודינמיקה (2)' },
    { id: '0542-4220', name: 'תורת התנודות' },
    { id: '0542-2500', name: 'מכניקת הזורמים (1)' },
    { id: '0542-4123', name: 'תהליכי מעבר חום וחומר' },
  ];
  const rank = (q: string) =>
    rankCourseMatches(q, courses, (c) => c.name, (c) => c.id).map((m) => m.item.id);

  it('returns the closest course first and drops non-matches', () => {
    const r = rank('תרמודינמיקה 2');
    expect(r[0]).toBe('0542-4120');
    expect(r).not.toContain('0542-4220');
  });

  it('tolerates a typo in the query', () => {
    expect(rank('תורת התנודת')).toContain('0542-4220'); // missing final letter
  });

  it('empty query keeps all items in original order', () => {
    expect(rank('')).toEqual(['0542-4120', '0542-4220', '0542-2500', '0542-4123']);
  });
});
