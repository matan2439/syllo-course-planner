import { preferencesSchema } from '../../api/ai/generate-plan';

describe('generate-plan preferencesSchema', () => {
  it('accepts a valid action_type', () => {
    for (const action_type of ['full_plan', 'balance_load', 'add_electives', 'fix_prerequisites', 'minimal_changes']) {
      const result = preferencesSchema.safeParse({ action_type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid action_type', () => {
    const result = preferencesSchema.safeParse({ action_type: 'rebuild_everything' });
    expect(result.success).toBe(false);
  });

  it('accepts pinned_course_ids alongside other preferences', () => {
    const result = preferencesSchema.safeParse({
      balance_load: true,
      action_type: 'balance_load',
      pinned_course_ids: ['0542-4120', '0542-4221'],
    });
    expect(result.success).toBe(true);
    expect(result.data?.pinned_course_ids).toEqual(['0542-4120', '0542-4221']);
  });

  it('defaults to no action_type / pinned_course_ids', () => {
    const result = preferencesSchema.parse({});
    expect(result.action_type).toBeUndefined();
    expect(result.pinned_course_ids).toBeUndefined();
  });
});
