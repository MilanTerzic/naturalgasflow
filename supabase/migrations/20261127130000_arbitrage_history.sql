-- Arbitrage tab: long price history and forecast scoring.
--   hub_price_history     now also holds BGH / CEEGEX day-ahead prices and month-ahead (_MA)
--                         quotes, both as fetched and as imported from a user's file
--                         (source = 'import'). For _MA hubs delivery_date is the trading day.
--   arbitrage_forecasts   each day's forecast as shown, so later days can score it against
--                         what actually cleared (shadow validation, as in Power Pulse).
-- Written only by server functions with service_role; never exposed to browser roles.

ALTER TABLE public.hub_price_history DROP CONSTRAINT IF EXISTS hub_price_history_hub_check;
ALTER TABLE public.hub_price_history
  ADD CONSTRAINT hub_price_history_hub_check CHECK (
    hub IN ('TTF', 'CEGH', 'BGH', 'CEEGEX', 'TTF_MA', 'CEGH_MA', 'BGH_MA', 'CEEGEX_MA')
  );
ALTER TABLE public.hub_price_history
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'fetched'
  CHECK (source IN ('fetched', 'import'));

CREATE TABLE IF NOT EXISTS public.arbitrage_forecasts (
  made_on date NOT NULL,
  target_date date NOT NULL,
  series text NOT NULL CHECK (series IN ('spread', 'BGH', 'CEEGEX')),
  model text NOT NULL,
  p50 numeric(12,4) NOT NULL,
  lo numeric(12,4) NOT NULL,
  hi numeric(12,4) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (made_on, target_date, series, model)
);

ALTER TABLE public.arbitrage_forecasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arbitrage_forecasts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.arbitrage_forecasts TO service_role;

COMMENT ON TABLE public.arbitrage_forecasts IS
  'Arbitrage-tab forecasts as they stood on made_on (ensemble and each model), for scoring against realised BGH / CEEGEX prices.';
