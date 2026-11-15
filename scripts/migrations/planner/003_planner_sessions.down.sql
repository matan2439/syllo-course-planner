-- Rollback of 003_planner_sessions.sql. Nothing references the table, so no other data is affected.
BEGIN;
DROP TABLE IF EXISTS public.planner_sessions;
COMMIT;
