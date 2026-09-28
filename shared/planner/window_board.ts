/**
 * Id convention for a program's two-year window boards — the boards
 * scripts/build_early_years_board.py publishes next to the program's own board:
 *   mechanical_engineering_2027 + Years 1–2  →  mechanical_engineering_years_1_2_2027
 * Each window board is its own planning universe (own committed board and context).
 */
export function windowBoardId(programId: string, firstYear: number): string {
  return programId.replace(/_(\d{4})$/, `_years_${firstYear}_${firstYear + 1}_$1`)
}

/** The program a (window) board belongs to; a program's own board id maps to itself. */
export function programIdOfBoard(boardId: string): string {
  return boardId.replace(/_years_\d+_\d+(_\d{4})$/, '$1')
}
