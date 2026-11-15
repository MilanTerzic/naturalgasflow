-- Exchange gas price observations (BGH, CEEGEX, HEnEx, BRM) and per-market feed status.
-- Written only by server functions with service_role; never exposed to browser roles.
-- Prices are exactly as published (or FX-converted with the rate kept); missing prices are
-- not stored as rows, and no value is ever filled in.

CREATE TABLE IF NOT EXISTS public.gas_price_observations (
  market text NOT NULL CHECK (market IN ('BGH', 'CEEGEX', 'HENEX', 'BRM')),
  country text NOT NULL CHECK (country IN ('BG', 'HU', 'GR', 'RO')),
  trading_date date NOT NULL,
  delivery_date date NOT NULL,
  delivery_end_date date,
  product text NOT NULL,
  metric text NOT NULL,
  price_eur_mwh numeric(12,4) CHECK (price_eur_mwh IS NULL OR (price_eur_mwh > 0 AND price_eur_mwh < 1000)),
  original_price numeric(14,4),
  original_currency text,
  fx_rate numeric(12,6),
  fx_date date,
  volume_mwh numeric(16,3),
  trades integer,
  source_url text NOT NULL,
  source_version text,
  status text NOT NULL,
  fetched_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, product, metric, trading_date, delivery_date)
);

CREATE INDEX IF NOT EXISTS gas_price_observations_delivery_idx
  ON public.gas_price_observations (market, delivery_date DESC);

CREATE TABLE IF NOT EXISTS public.gas_price_feed_status (
  market text PRIMARY KEY CHECK (market IN ('BGH', 'CEEGEX', 'HENEX', 'BRM')),
  last_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,
  status text NOT NULL,
  message text,
  diagnostics jsonb
);

ALTER TABLE public.gas_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gas_price_feed_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gas_price_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gas_price_feed_status FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.gas_price_observations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.gas_price_feed_status TO service_role;

COMMENT ON TABLE public.gas_price_observations IS
  'Exchange day-ahead gas prices as published (EUR/MWh; RON converted with BNR fixing kept in fx_rate). One row per market/product/metric/trading day/delivery day.';
