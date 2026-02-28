
-- Fix: restrict INSERT to service_role only (not anon/authenticated)
DROP POLICY IF EXISTS "Service role can insert usage" ON public.tts_usage;

CREATE POLICY "Service role can insert usage"
ON public.tts_usage
FOR INSERT
TO service_role
WITH CHECK (true);
