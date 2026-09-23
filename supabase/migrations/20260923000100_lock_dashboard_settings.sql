-- Dashboard scenario changes are now browser-local.
-- Keep the legacy global row readable for compatibility, but prevent public mutation.
REVOKE INSERT, UPDATE ON public.dashboard_settings FROM anon;
REVOKE INSERT, UPDATE ON public.dashboard_settings FROM authenticated;

DROP POLICY IF EXISTS "Anyone can create dashboard settings" ON public.dashboard_settings;
DROP POLICY IF EXISTS "Anyone can update dashboard settings" ON public.dashboard_settings;
