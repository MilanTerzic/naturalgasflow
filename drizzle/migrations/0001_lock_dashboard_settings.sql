DROP POLICY IF EXISTS "Anyone can view dashboard settings" ON public.dashboard_settings;
DROP POLICY IF EXISTS "Anyone can create dashboard settings" ON public.dashboard_settings;
DROP POLICY IF EXISTS "Anyone can update dashboard settings" ON public.dashboard_settings;
REVOKE ALL ON public.dashboard_settings FROM anon, authenticated;
GRANT ALL ON public.dashboard_settings TO service_role;
COMMENT ON TABLE public.dashboard_settings IS 'DEPRECATED: scenario settings are stored client-side; server-only access.';