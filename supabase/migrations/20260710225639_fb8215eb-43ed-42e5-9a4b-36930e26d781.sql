
CREATE TABLE IF NOT EXISTS public.reading_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  novel_url TEXT NOT NULL,
  novel_title TEXT NOT NULL,
  chapter_url TEXT NOT NULL,
  chapter_title TEXT,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  scroll_position INTEGER NOT NULL DEFAULT 0,
  scroll_percent REAL NOT NULL DEFAULT 0,
  tts_char_index INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT reading_history_user_novel_unique UNIQUE (user_id, novel_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_history TO authenticated;
GRANT ALL ON public.reading_history TO service_role;

ALTER TABLE public.reading_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reading history" ON public.reading_history;
DROP POLICY IF EXISTS "Users can insert own reading history" ON public.reading_history;
DROP POLICY IF EXISTS "Users can update own reading history" ON public.reading_history;
DROP POLICY IF EXISTS "Users can delete own reading history" ON public.reading_history;

CREATE POLICY "Users can view own reading history" ON public.reading_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reading history" ON public.reading_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reading history" ON public.reading_history
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reading history" ON public.reading_history
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS reading_history_user_deleted_idx
  ON public.reading_history (user_id, deleted_at);
