-- History the newsletter needs to keep itself:
--   hub_price_history        TTF / CEGH day-ahead prices as fetched, so charts keep their
--                            history when a source only serves the last few days.
--   newsletter_d1_forecasts  the D+1 "net into Serbia" expectation as sent, so the next
--                            newsletter can compare it with the actual flow.
-- Written only by server functions with service_role; never exposed to browser roles.

CREATE TABLE IF NOT EXISTS public.hub_price_history (
  hub text NOT NULL CHECK (hub IN ('TTF', 'CEGH')),
  delivery_date date NOT NULL,
  price_eur_mwh numeric(12,4) NOT NULL CHECK (price_eur_mwh > 0 AND price_eur_mwh < 1000),
  final boolean NOT NULL,
  label text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub, delivery_date)
);

CREATE TABLE IF NOT EXISTS public.newsletter_d1_forecasts (
  made_on date NOT NULL,
  forecast_for date NOT NULL,
  net_mcm numeric(10,3) NOT NULL,
  demand_mcm numeric(10,3),
  temperature_c numeric(6,2),
  kkd_booked_mcm numeric(10,3),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (made_on, forecast_for)
);

ALTER TABLE public.hub_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_d1_forecasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_price_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.newsletter_d1_forecasts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.hub_price_history TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.newsletter_d1_forecasts TO service_role;

COMMENT ON TABLE public.hub_price_history IS
  'TTF (EEX NGP) and CEGH (CEGHIX) day-ahead prices as fetched; final = settled value. A provisional price never overwrites a final one.';
COMMENT ON TABLE public.newsletter_d1_forecasts IS
  'D+1 net-into-Serbia expectation (model demand at forecast temperature − domestic production) as it stood when the newsletter was rendered on made_on.';
