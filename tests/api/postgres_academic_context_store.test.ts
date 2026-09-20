import {
  PostgresAcademicContextStore,
  type PlannerContextSql,
} from '../../api/ai/postgres/postgres_academic_context_store';
import type { PutAcademicContext } from '../../api/ai/academic_context_store';

type Row = Record<string, unknown>;

class ContextSqlDouble implements PlannerContextSql {
  readonly boundValues: unknown[] = [];
  private readonly rows = new Map<string, Row>();

  async unsafe(query: string, parameters: readonly unknown[] = []): Promise<Row[]> {
    this.boundValues.push(...parameters);
    if (query.includes('INSERT INTO planner_academic_contexts')) {
      const [ownerHash, programId, digest, personal, plan, preferences] = parameters;
      const row = {
        owner_hash: ownerHash,
        program_id: programId,
        digest,
        personal_status_json: JSON.parse(String(personal)),
        plan_context_json: JSON.parse(String(plan)),
        preferences_json: JSON.parse(String(preferences)),
        updated_at: new Date('2026-08-29T10:00:00.000Z'),
      };
      this.rows.set(`${ownerHash}::${programId}`, row);
      return [row];
    }
    if (query.includes('FROM planner_academic_contexts')) {
      return this.rows.has(`${parameters[0]}::${parameters[1]}`)
        ? [structuredClone(this.rows.get(`${parameters[0]}::${parameters[1]}`)!)]
        : [];
    }
    throw new Error(`Unexpected query: ${query}`);
  }
}

const input = (overrides: Partial<PutAcademicContext> = {}): PutAcademicContext => ({
  ownerId: 'A'.repeat(43),
  programId: 'mechanical_engineering_2027',
  digest: 'as_first',
  personalStatus: { completed: [{ course_id: '0368-1001' }] },
  planContext: { current_plan: [{ semester_id: 'A', course_ids: [] }] },
  preferences: { wanted: ['control'] },
  ...overrides,
});

describe('PostgresAcademicContextStore', () => {
  test('persists exact context across fresh adapter instances without binding raw owner id', async () => {
    const sql = new ContextSqlDouble();
    const first = new PostgresAcademicContextStore(sql);
    const second = new PostgresAcademicContextStore(sql);
    const context = input();

    await first.put(context);
    const loaded = await second.load(context.ownerId, context.programId);

    expect(loaded).toEqual({
      ...context,
      updatedAt: Date.parse('2026-08-29T10:00:00.000Z'),
    });
    expect(sql.boundValues).not.toContain(context.ownerId);
  });

  test('isolates owners and programs and replaces one exact owner-program record', async () => {
    const sql = new ContextSqlDouble();
    const store = new PostgresAcademicContextStore(sql);
    const original = input();

    await store.put(original);
    await store.put(input({ digest: 'as_replaced', personalStatus: { completed: [] } }));
    await store.put(input({ ownerId: 'B'.repeat(43), digest: 'as_other_owner' }));
    await store.put(input({ programId: 'electrical_engineering_2027', digest: 'as_other_program' }));

    expect((await store.load(original.ownerId, original.programId))?.digest).toBe('as_replaced');
    expect((await store.load('B'.repeat(43), original.programId))?.digest).toBe('as_other_owner');
    expect((await store.load(original.ownerId, 'electrical_engineering_2027'))?.digest)
      .toBe('as_other_program');
    expect(await store.load('C'.repeat(43), original.programId)).toBeNull();
  });

  test('returns clones rather than mutable stored JSON references', async () => {
    const sql = new ContextSqlDouble();
    const store = new PostgresAcademicContextStore(sql);
    const context = input();
    await store.put(context);

    const first = await store.load(context.ownerId, context.programId);
    (first!.personalStatus as { completed: unknown[] }).completed.length = 0;

    expect((await store.load(context.ownerId, context.programId))?.personalStatus)
      .toEqual(context.personalStatus);
  });
});
