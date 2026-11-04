/**
 * ProgramProvider — owns "how do I get a program's board_json and turn it into
 * a ConstraintModel" for the future AcademicDecisionAgent architecture. Pulled
 * out so that a different institution's data source can be swapped in without
 * touching planner-run.ts / generate-plan.ts / PlannerWorker, mirroring the
 * PolicyProvider extraction (planner_policy.ts).
 *
 * TauProgramProvider is TAU's current pipeline, relocated verbatim: DB
 * (queryBoardJson) first, local-file (loadLocalBoardJson) fallback — the same
 * order generate-plan.ts already uses inline. No behavior change, and not
 * wired into any production path yet.
 */

import { parseProgramVersionId, queryBoardJson, type ParsedProgramId } from '../board';
import { loadLocalBoardJson } from './board_loader';
import { buildConstraintModel, type BuildModelOptions } from './planner_model';
import type { ConstraintModel } from './planner_types';
import { isServableProgramId } from '../../shared/programs';
import { institutionForProgram, type Institution } from '../../shared/institutions';

export interface ProgramProvider {
  parseProgramId(programId: string): ParsedProgramId | null;
  /** DB first, local-file fallback. Returns null if neither has the program. */
  loadBoard(programId: string, dbUrl?: string): Promise<Record<string, unknown> | null>;
  buildModel(boardJson: any, opts?: BuildModelOptions): ConstraintModel;
}

export class TauProgramProvider implements ProgramProvider {
  parseProgramId(programId: string): ParsedProgramId | null {
    return parseProgramVersionId(programId);
  }

  async loadBoard(programId: string, dbUrl?: string): Promise<Record<string, unknown> | null> {
    if (!isServableProgramId(programId)) return null; // drafts are never served
    let board: Record<string, unknown> | null = null;
    if (dbUrl) {
      const pv = this.parseProgramId(programId);
      if (pv) {
        try { board = await queryBoardJson(dbUrl, pv.base, pv.year); } catch { board = null; }
      }
    }
    if (!board) {
      board = loadLocalBoardJson(programId);
    }
    return board;
  }

  buildModel(boardJson: any, opts: BuildModelOptions = {}): ConstraintModel {
    return buildConstraintModel(boardJson, opts);
  }
}

/** One provider per board format; an institution picks its format in data/config/institutions.json. */
const PROVIDERS: Record<Institution['boardFormat'], () => ProgramProvider> = {
  syllo_board_v1: () => new TauProgramProvider(),
};

/** The provider for a program's institution; unknown programs keep TAU's pipeline (today's behavior). */
export function programProviderFor(programId: string): ProgramProvider {
  const institution = institutionForProgram(programId);
  return (institution ? PROVIDERS[institution.boardFormat] : PROVIDERS.syllo_board_v1)();
}
