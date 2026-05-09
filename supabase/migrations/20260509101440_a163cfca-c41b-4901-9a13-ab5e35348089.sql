-- Deduplica reading_history: para cada (user_id, novel base), mantém o mais recente
WITH normalized AS (
  SELECT id, user_id,
         regexp_replace(novel_url, '/c?chapter-.*$', '', 'i') AS base_url,
         last_read_at
  FROM public.reading_history
),
ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, base_url ORDER BY last_read_at DESC) AS rn
  FROM normalized
)
DELETE FROM public.reading_history
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Normaliza novel_url das linhas restantes
UPDATE public.reading_history
SET novel_url = regexp_replace(novel_url, '/c?chapter-.*$', '', 'i')
WHERE novel_url ~* '/c?chapter-';

-- Garante a constraint de unicidade que o upsert (onConflict) precisa
ALTER TABLE public.reading_history
  DROP CONSTRAINT IF EXISTS reading_history_user_novel_unique;
ALTER TABLE public.reading_history
  ADD CONSTRAINT reading_history_user_novel_unique UNIQUE (user_id, novel_url);