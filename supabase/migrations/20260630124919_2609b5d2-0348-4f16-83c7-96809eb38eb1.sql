ALTER TABLE public.reading_history
  ADD COLUMN IF NOT EXISTS tts_char_index integer NOT NULL DEFAULT 0;