# Course placement repair — 2026-10-30

The real mechanical engineering catalog allows 0542-4422 (Engineering Design)
in year 3 A. Adding it to the initial board yields 30 weekly hours, but manual
edits incorrectly inherited the automatic planner's 26-hour blocking cap.
Current enrollment was also rejected as if it were a duplicate AI suggestion.

Manual add, move, remove and saved-plan restore now use a dedicated validation
context: workload remains a warning and current enrollment can be displayed.
Completed-course reuse, duplicate placement, offering, prerequisite order,
annual-course completeness and pins remain enforced. Generated plans retain
their existing workload caps and enrollment-deduplication rules.

Incremental edits compare academic errors against the previous draft so an
unrelated existing issue cannot lock the board. A moved course is excluded
from the comparison baseline, ensuring its new placement is fully checked.
The endpoint returns the actual academic rejection reason with course names.

The completion editor now preserves saved currently_taking and planned claims
during context synchronization and Apply, instead of silently erasing them.

Regression coverage includes the real 0542-4422 catalog and initial board,
with and without current enrollment, existing draft errors, prerequisite
removal/moves, pins, endpoint rejection messages and saved-plan restore.

Validation: 85 API tests across four suites (including the final 22-test
manual-service run), 39 focused frontend tests, root/web TypeScript checks and
the Next production build passed. Local browser placement survived reload.
The initial parallel build/test attempt exhausted Windows memory; sequential
testing and a single build worker completed successfully.

Published to syllo.cc as deployment dpl_81VbqZcPo882tXe2ks2zix57Nagr.
Two independent fresh guest sessions on production verified the real 30-hour
placement, including current enrollment, idempotent retries, rejection of a
semester-B move with an offering explanation, and persisted board reads.
