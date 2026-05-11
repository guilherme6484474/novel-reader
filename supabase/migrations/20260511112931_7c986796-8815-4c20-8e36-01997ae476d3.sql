ALTER TABLE public.reading_history
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS scroll_position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scroll_percent real NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS reading_history_user_deleted_idx
  ON public.reading_history (user_id, deleted_at);