/**
 * S3/S4 — the ownership boundary and the board repository.
 *
 * These are the two primitives the authoritative Apply rests on, so they are
 * tested on their own terms: who owns a record, and whether a commit can be
 * lost, duplicated or overwritten. Both adapters run the SAME suite, because an
 * adapter that differs in semantics from the one the tests use is a trap.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  InMemoryBoardRepository,
  parseVersion,
  type BoardRepository,
  type CommitInput,
} from '../../api/ai/board_repository';
import { FileBoardRepository } from '../../api/ai/board_repository_file';
import {
  SESSION_COOKIE,
  generateOwnerId,
  isWellFormedOwnerId,
  readCookie,
  resolveOwner,
  serializeSessionCookie,
} from '../../api/ai/session_owner';

// ── ownership ───────────────────────────────────────────────────────────────

function resHarness() {
  const headers: Record<string, string | string[]> = {};
  return {
    headers,
    setHeader(name: string, value: string | string[]) { headers[name] = value; return this; },
    getHeader(name: string) { return headers[name]; },
  };
}

describe('S4 — session ownership', () => {
  test('a generated owner id is opaque, high-entropy and unique', () => {
    const a = generateOwnerId();
    const b = generateOwnerId();
    expect(a).not.toBe(b);
    expect(isWellFormedOwnerId(a)).toBe(true);
    // 256 bits, URL-safe base64 — no padding, no meaning, nothing derivable.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  test('an absent session is issued one, and the cookie is HttpOnly/SameSite', () => {
    const res = resHarness();
    const owner = resolveOwner({ headers: {} }, res, { generateId: () => 'x'.repeat(43), secure: true });
    expect(owner.issued).toBe(true);
    expect(owner.ownerId).toBe('x'.repeat(43));

    const cookie = String((res.headers['Set-Cookie'] as string[])[0]);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');       // script cannot read the ownership key
    expect(cookie).toContain('SameSite=Lax');   // a cross-site POST cannot carry it
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  test('an existing session is reused rather than rotated on every request', () => {
    const res = resHarness();
    const id = 'a'.repeat(50);
    const owner = resolveOwner({ headers: { cookie: `${SESSION_COOKIE}=${id}; other=1` } }, res);
    expect(owner).toEqual({ ownerId: id, issued: false });
    expect(res.headers['Set-Cookie']).toBeUndefined(); // nothing to re-issue
  });

  test('a malformed or empty cookie yields a NEW session rather than a bad owner', () => {
    for (const bad of ['', 'short', 'has spaces!!', 'x'.repeat(500)]) {
      const res = resHarness();
      const owner = resolveOwner({ headers: { cookie: `${SESSION_COOKIE}=${bad}` } }, res, {
        generateId: () => 'z'.repeat(43),
      });
      expect(owner.issued).toBe(true);
      expect(owner.ownerId).toBe('z'.repeat(43));
    }
  });

  test('issuing a session never clobbers a Set-Cookie another layer already set', () => {
    const res = resHarness();
    res.setHeader('Set-Cookie', 'other=1; Path=/');
    resolveOwner({ headers: {} }, res, { generateId: () => 'q'.repeat(43) });
    const cookies = res.headers['Set-Cookie'] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('other=1');
    expect(cookies[1]).toContain(SESSION_COOKIE);
  });

  test('the owner id is never placed in a response body by this module', () => {
    // serializeSessionCookie is the ONLY way out, and it is a cookie header.
    expect(serializeSessionCookie('abc', { secure: false })).toContain('HttpOnly');
    expect(readCookie('syllo_owner=abc', SESSION_COOKIE)).toBe('abc');
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });
});

// ── repository, run identically against both adapters ───────────────────────

const OWNER_A = 'a'.repeat(43);
const OWNER_B = 'b'.repeat(43);
const PROGRAM = 'test_program_2027';

const input = (over: Partial<CommitInput> = {}): CommitInput => ({
  ownerId: OWNER_A,
  programId: PROGRAM,
  expectedVersion: null,
  semesters: [{ semesterId: 's1', courseIds: ['C1'] }],
  proposalId: 'prop_1',
  candidateId: 'cand_1',
  idempotencyKey: 'key_1',
  ...over,
});

type Harness = { name: string; make: () => BoardRepository; cleanup?: () => void };

const harnesses: Harness[] = [
  { name: 'InMemoryBoardRepository', make: () => new InMemoryBoardRepository() },
  (() => {
    let dir = '';
    return {
      name: 'FileBoardRepository',
      make: () => {
        dir = mkdtempSync(join(tmpdir(), 'syllo-board-'));
        return new FileBoardRepository({ dir });
      },
      cleanup: () => { if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true }); },
    };
  })(),
];

describe.each(harnesses)('S3 — BoardRepository semantics ($name)', ({ make, cleanup }) => {
  let repo: BoardRepository;
  beforeEach(() => { repo = make(); });
  afterEach(() => cleanup?.());

  test('a session with no committed board has none — never a fabricated empty one', async () => {
    expect(await repo.load(OWNER_A, PROGRAM)).toBeNull();
  });

  test('the first commit mints v1 and the board reads back', async () => {
    const result = await repo.commit(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseVersion(result.board.version)).toBe(1);

    const loaded = await repo.load(OWNER_A, PROGRAM);
    expect(loaded?.version).toBe(result.board.version);
    expect(loaded?.semesters).toEqual([{ semesterId: 's1', courseIds: ['C1'] }]);
    expect(loaded?.lastApply?.proposalId).toBe('prop_1');
  });

  test('the version is minted by the repository — a client-chosen one is not honoured', async () => {
    const first = await repo.commit(input());
    expect(first.ok).toBe(true);
    // Ask to jump to a far-future version: the CAS compares against the STORED
    // version, so this is simply a conflict, never an accepted version.
    const forged = await repo.commit(input({ expectedVersion: 'bv_9999', idempotencyKey: 'key_2' }));
    expect(forged.ok).toBe(false);
    if (forged.ok) return;
    expect(forged.reason).toBe('BOARD_VERSION_CONFLICT');
    expect((await repo.load(OWNER_A, PROGRAM))?.version).toBe('bv_1');
  });

  test('a valid apply increments the version exactly once', async () => {
    await repo.commit(input());
    const second = await repo.commit(input({
      expectedVersion: 'bv_1', idempotencyKey: 'key_2',
      semesters: [{ semesterId: 's1', courseIds: ['C2'] }],
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.board.version).toBe('bv_2');
    expect(second.replayed).toBe(false);
  });

  test('a stale base version is rejected and changes nothing', async () => {
    await repo.commit(input());
    await repo.commit(input({ expectedVersion: 'bv_1', idempotencyKey: 'key_2' }));
    const stale = await repo.commit(input({
      expectedVersion: 'bv_1', idempotencyKey: 'key_3',
      semesters: [{ semesterId: 's1', courseIds: ['HOSTILE'] }],
    }));
    expect(stale.ok).toBe(false);
    const loaded = await repo.load(OWNER_A, PROGRAM);
    expect(loaded?.version).toBe('bv_2');
    expect(JSON.stringify(loaded?.semesters)).not.toContain('HOSTILE');
  });

  test('an identical retry is a replay: same result, no second mutation', async () => {
    const first = await repo.commit(input());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A retry legitimately still carries the PRE-apply version.
    const retry = await repo.commit(input({ expectedVersion: null }));
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.replayed).toBe(true);
    expect(retry.board.version).toBe(first.board.version);
    expect((await repo.load(OWNER_A, PROGRAM))?.version).toBe('bv_1');
  });

  test('the same idempotency key carrying DIFFERENT work fails deterministically', async () => {
    await repo.commit(input());
    const smuggled = await repo.commit(input({ candidateId: 'cand_OTHER', expectedVersion: null }));
    expect(smuggled.ok).toBe(false);
    if (smuggled.ok) return;
    expect(smuggled.reason).toBe('IDEMPOTENCY_CONFLICT');
    expect((await repo.load(OWNER_A, PROGRAM))?.version).toBe('bv_1');
  });

  test('two commits racing from the SAME base version: exactly one wins', async () => {
    const [a, b] = await Promise.all([
      repo.commit(input({ idempotencyKey: 'race_a', semesters: [{ semesterId: 's1', courseIds: ['A'] }] })),
      repo.commit(input({ idempotencyKey: 'race_b', semesters: [{ semesterId: 's1', courseIds: ['B'] }] })),
    ]);
    const wins = [a, b].filter((r) => r.ok);
    expect(wins).toHaveLength(1);

    // And the committed state is exactly one of the two candidates — not a merge.
    const loaded = await repo.load(OWNER_A, PROGRAM);
    expect(loaded?.version).toBe('bv_1');
    expect(loaded?.semesters[0].courseIds).toHaveLength(1);
    expect(['A', 'B']).toContain(loaded!.semesters[0].courseIds[0]);
  });

  test('sessions are isolated — one owner never sees or overwrites another', async () => {
    await repo.commit(input());
    expect(await repo.load(OWNER_B, PROGRAM)).toBeNull();

    // B's own first commit starts from its own empty state, at v1.
    const bCommit = await repo.commit(input({
      ownerId: OWNER_B, expectedVersion: null, idempotencyKey: 'b_key',
      semesters: [{ semesterId: 's1', courseIds: ['B_ONLY'] }],
    }));
    expect(bCommit.ok).toBe(true);
    if (!bCommit.ok) return;
    expect(bCommit.board.version).toBe('bv_1');

    const a = await repo.load(OWNER_A, PROGRAM);
    expect(a?.semesters[0].courseIds).toEqual(['C1']); // untouched by B
  });

  test('the same owner is isolated per program', async () => {
    await repo.commit(input());
    expect(await repo.load(OWNER_A, 'another_program_2027')).toBeNull();
  });

  test('stored content is normalized, so equal plans store identically', async () => {
    const r = await repo.commit(input({
      semesters: [
        { semesterId: 's2', courseIds: ['C2', 'C1', 'C1'] },
        { semesterId: 's1', courseIds: ['C3'] },
      ],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.board.semesters).toEqual([
      { semesterId: 's1', courseIds: ['C3'] },
      { semesterId: 's2', courseIds: ['C1', 'C2'] },
    ]);
  });
});

// ── file adapter specifics ──────────────────────────────────────────────────

describe('S3 — FileBoardRepository durability and safety', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'syllo-board-file-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a committed board survives a NEW repository instance (process restart)', async () => {
    const first = new FileBoardRepository({ dir });
    await first.commit(input());

    // A fresh instance models the API process having been restarted.
    const second = new FileBoardRepository({ dir });
    const loaded = await second.load(OWNER_A, PROGRAM);
    expect(loaded?.version).toBe('bv_1');
    expect(loaded?.semesters).toEqual([{ semesterId: 's1', courseIds: ['C1'] }]);
  });

  test('idempotency survives a restart too — a retry after restart does not double-apply', async () => {
    await new FileBoardRepository({ dir }).commit(input());
    const retry = await new FileBoardRepository({ dir }).commit(input({ expectedVersion: null }));
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.replayed).toBe(true);
    expect(retry.board.version).toBe('bv_1');
  });

  test('the owner id never appears in a filename', async () => {
    await new FileBoardRepository({ dir }).commit(input());
    const names = readdirSync(dir);
    expect(names).toHaveLength(1);
    expect(names[0]).not.toContain(OWNER_A);
    expect(names[0]).toMatch(/^[0-9a-f]{64}\.json$/); // sha256 hex
  });

  test('a corrupt file is quarantined, not trusted and not silently destroyed', async () => {
    const repo = new FileBoardRepository({ dir });
    await repo.commit(input());
    const file = join(dir, readdirSync(dir)[0]);
    writeFileSync(file, '{ this is not json', 'utf8');

    // Reads as "no board" rather than throwing or inventing one…
    expect(await repo.load(OWNER_A, PROGRAM)).toBeNull();
    // …and the damaged bytes are preserved for inspection.
    expect(readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(true);
  });

  test('a file that parses but is the wrong shape is not accepted as a board', async () => {
    const repo = new FileBoardRepository({ dir });
    await repo.commit(input());
    writeFileSync(join(dir, readdirSync(dir)[0]), JSON.stringify({ nonsense: true }), 'utf8');
    expect(await repo.load(OWNER_A, PROGRAM)).toBeNull();
  });

  test('a rejected commit leaves no temp files behind', async () => {
    const repo = new FileBoardRepository({ dir });
    await repo.commit(input());
    await repo.commit(input({ expectedVersion: 'bv_77', idempotencyKey: 'k2' }));
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
  });

  test('it writes only inside its configured runtime directory', async () => {
    // A hostile owner id cannot escape the directory, because the filename is a
    // hash of it rather than the value.
    const repo = new FileBoardRepository({ dir });
    await repo.commit(input({ ownerId: '../../../etc/passwd', idempotencyKey: 'k3' }));
    expect(readdirSync(dir).every((n) => /^[0-9a-f]{64}\.json$/.test(n))).toBe(true);
  });
});
