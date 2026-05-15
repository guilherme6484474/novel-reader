DROP POLICY IF EXISTS "Anyone can view verified reports" ON public.nav_community_reports;

CREATE OR REPLACE VIEW public.nav_public_community_reports AS
SELECT
  id,
  alert_id,
  latitude,
  longitude,
  report_type,
  title,
  description,
  is_anonymous,
  status,
  created_at
FROM public.nav_community_reports
WHERE status = 'verified';

GRANT SELECT ON public.nav_public_community_reports TO anon, authenticated;