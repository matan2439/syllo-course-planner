/**
 * Current server-owned academic context for one anonymous owner and program.
 * Manual board edits resolve completed/prerequisite facts from this record;
 * the browser-provided digest is only an expected-value check, never the facts.
 */
export interface AcademicContextRecord {
  ownerId: string;
  programId: string;
  digest: string;
  personalStatus: unknown;
  /** Exact effective inputs used to build the last successful proposal. */
  planContext: unknown;
  preferences: unknown;
  updatedAt: number;
}

export interface PutAcademicContext {
  ownerId: string;
  programId: string;
  digest: string;
  personalStatus: unknown;
  planContext: unknown;
  preferences: unknown;
}

export interface AcademicContextStore {
  load(ownerId: string, programId: string): Promise<AcademicContextRecord | null>;
  put(input: PutAcademicContext): Promise<AcademicContextRecord>;
}

const keyOf = (ownerId: string, programId: string) => `${ownerId}::${programId}`;
const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryAcademicContextStore implements AcademicContextStore {
  private readonly records = new Map<string, AcademicContextRecord>();
  private readonly clock: () => number;

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  async load(ownerId: string, programId: string): Promise<AcademicContextRecord | null> {
    const found = this.records.get(keyOf(ownerId, programId));
    return found ? clone(found) : null;
  }

  async put(input: PutAcademicContext): Promise<AcademicContextRecord> {
    const record: AcademicContextRecord = { ...clone(input), updatedAt: this.clock() };
    this.records.set(keyOf(input.ownerId, input.programId), record);
    return clone(record);
  }

  /** Test-only; deliberately absent from the interface. */
  reset(): void {
    this.records.clear();
  }
}
