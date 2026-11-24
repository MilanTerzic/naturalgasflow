CREATE TABLE public.entsog_daily_cache (
  series_key text NOT NULL,
  gas_day date NOT NULL,
  records jsonb NOT NULL CHECK (jsonb_typeof(records) = 'array' AND jsonb_array_length(records) > 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_key, gas_day)
);
GRANT SELECT ON public.entsog_daily_cache TO anon, authenticated;
GRANT ALL ON public.entsog_daily_cache TO service_role;
ALTER TABLE public.entsog_daily_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public ENTSOG observations are readable" ON public.entsog_daily_cache FOR SELECT TO anon, authenticated USING (true);
COMMENT ON TABLE public.entsog_daily_cache IS 'Persistent public ENTSOG observations, insert-only by trusted upstream fetch code; missing and invalid observations are never cached.';
CREATE TABLE public.entsog_reference_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.entsog_reference_cache TO anon, authenticated;
GRANT ALL ON public.entsog_reference_cache TO service_role;
ALTER TABLE public.entsog_reference_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public ENTSOG references are readable" ON public.entsog_reference_cache FOR SELECT TO anon, authenticated USING (true);