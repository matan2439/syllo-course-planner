-- Degrees that run long: allow a current degree year up to 6 (was 1–4), matching
-- MAX_DEGREE_YEAR in shared/planner/window_board.ts and the planner's added semesters.
-- Apply manually (Supabase SQL editor) — NOT applied by the app. Until applied, a
-- year 5–6 choice stays on the device only (updateProfile failures are tolerated).

BEGIN;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_current_degree_year_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_current_degree_year_check CHECK (current_degree_year BETWEEN 1 AND 6);

COMMIT;
