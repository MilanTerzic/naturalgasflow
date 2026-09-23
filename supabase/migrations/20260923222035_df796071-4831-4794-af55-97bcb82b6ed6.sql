CREATE TABLE public.app_user_access (
  user_id uuid PRIMARY KEY,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  role text NOT NULL DEFAULT 'user',
  reviewed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_access_status_chk CHECK (status IN ('pending','approved','rejected','disabled')),
  CONSTRAINT app_user_access_role_chk CHECK (role IN ('user','admin'))
);
GRANT ALL ON public.app_user_access TO service_role;
ALTER TABLE public.app_user_access ENABLE ROW LEVEL SECURITY;