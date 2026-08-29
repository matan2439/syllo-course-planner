import type { AuthoritativeApplyStore } from '../authoritative_apply_store';
import type { AcademicContextStore } from '../academic_context_store';
import type { BoardRepository } from '../board_repository';
import type { ProposalStore } from '../proposal_store';
import { PostgresAcademicContextStore } from './postgres_academic_context_store';
import { PostgresAuthoritativeApplyStore } from './postgres_authoritative_apply_store';
import { PostgresBoardRepository } from './postgres_board_repository';
import { PostgresProposalStore } from './postgres_proposal_store';
import { checkPlannerSchema } from './planner_schema';

type PlannerRow = Record<string, unknown>;

export interface PlannerPostgresTransaction {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<PlannerRow[]>;
}

export interface PlannerPostgresSql extends PlannerPostgresTransaction {
  begin<T>(fn: (tx: PlannerPostgresTransaction) => Promise<T>): Promise<T>;
}

export interface PostgresPlannerState {
  boardRepository: BoardRepository;
  academicContextStore: AcademicContextStore;
  proposalStore: ProposalStore;
  authoritativeApplyStore: AuthoritativeApplyStore;
  ensureSchemaCurrent(): Promise<void>;
}

export class PlannerSchemaMismatchError extends Error {
  readonly code = 'PLANNER_SCHEMA_MISMATCH' as const;

  constructor() {
    super('PLANNER_SCHEMA_MISMATCH');
    this.name = 'PlannerSchemaMismatchError';
  }
}

export function createPostgresPlannerState(sql: PlannerPostgresSql): PostgresPlannerState {
  let schemaCheck: Promise<void> | undefined;
  return {
    boardRepository: new PostgresBoardRepository(sql),
    academicContextStore: new PostgresAcademicContextStore(sql),
    proposalStore: new PostgresProposalStore(sql),
    authoritativeApplyStore: new PostgresAuthoritativeApplyStore(sql),
    ensureSchemaCurrent(): Promise<void> {
      schemaCheck ??= checkPlannerSchema(sql).then((status) => {
        if (status !== 'current') throw new PlannerSchemaMismatchError();
      });
      return schemaCheck;
    },
  };
}
