-- Shared, manually entered MET Hungary-to-Serbia nominations.
-- All access is via an approved server-side app session using service_role.
CREATE TABLE public.met_hu_nominations (
  gas_day date PRIMARY KEY,
  nominated_mwh numeric(18,3) NOT NULL
    CHECK (nominated_mwh >= 0 AND nominated_mwh <= 1000000),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.met_hu_nominations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.met_hu_nominations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.met_hu_nominations TO service_role;

COMMENT ON TABLE public.met_hu_nominations IS
  'MET nominations, not measured HU physical flows or ENTSOG allocations. Values stored in MWh per gas day.';
