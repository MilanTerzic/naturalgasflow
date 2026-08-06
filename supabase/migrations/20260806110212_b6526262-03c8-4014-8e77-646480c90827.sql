CREATE TABLE public.dashboard_settings (
  id text PRIMARY KEY DEFAULT 'global',
  use_polynomial boolean NOT NULL DEFAULT true,
  curve_shift numeric NOT NULL DEFAULT 1,
  curve_distortion numeric NOT NULL DEFAULT 1,
  domestic_production numeric NOT NULL DEFAULT 0.5,
  bih_share numeric NOT NULL DEFAULT 0.07,
  range_past_days integer NOT NULL DEFAULT 10,
  range_future_days integer NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.dashboard_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.dashboard_settings TO authenticated;
GRANT ALL ON public.dashboard_settings TO service_role;

ALTER TABLE public.dashboard_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view dashboard settings"
  ON public.dashboard_settings FOR SELECT USING (true);

CREATE POLICY "Anyone can create dashboard settings"
  ON public.dashboard_settings FOR INSERT WITH CHECK (id = 'global');

CREATE POLICY "Anyone can update dashboard settings"
  ON public.dashboard_settings FOR UPDATE USING (id = 'global') WITH CHECK (id = 'global');

INSERT INTO public.dashboard_settings (id) VALUES ('global');