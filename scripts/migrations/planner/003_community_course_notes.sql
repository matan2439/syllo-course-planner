-- Anonymous course notes students choose to share. Additive; no existing table changes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.community_course_notes (
  public_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  course_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('experience','tip','update')),
  lecturer text CHECK (lecturer IS NULL OR char_length(lecturer) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  report_count integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  -- Set once enough distinct students report the note; cleared only by a developer's review.
  hidden_at timestamptz,
  UNIQUE (owner_hash, note_id)
);
CREATE INDEX IF NOT EXISTS community_course_notes_course_idx ON public.community_course_notes(course_id, updated_at DESC) WHERE hidden_at IS NULL;
CREATE TABLE IF NOT EXISTS public.community_course_note_reports (
  public_id uuid NOT NULL REFERENCES public.community_course_notes(public_id) ON DELETE CASCADE,
  reporter_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (public_id, reporter_hash)
);
ALTER TABLE public.community_course_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_course_note_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_course_notes FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.community_course_note_reports FROM PUBLIC,anon,authenticated;
-- No browser policies: the student-workspace endpoint owns all access; authors are never exposed.
COMMIT;
