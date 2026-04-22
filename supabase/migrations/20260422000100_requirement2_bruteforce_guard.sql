-- ============================================================
-- Requirement 2: Brute-force login protection
--
-- Stores server-side throttle state for protected login flows.
-- The auth-login Edge Function reads/writes these rows using the
-- service role key. No direct client access is granted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.auth_bruteforce_guards (
  scope_key          text PRIMARY KEY,
  flow               text NOT NULL CHECK (flow IN ('web_login', 'kiosk_login')),
  scope_type         text NOT NULL CHECK (scope_type IN ('identifier', 'device', 'identifier_device', 'ip')),
  failed_attempts    integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  challenge_required boolean NOT NULL DEFAULT false,
  lock_until         timestamptz,
  last_failed_at     timestamptz,
  last_success_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_bruteforce_guards_flow_idx
  ON public.auth_bruteforce_guards (flow, scope_type, updated_at DESC);

ALTER TABLE public.auth_bruteforce_guards ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.auth_bruteforce_guards IS
  'Server-side throttle state for the auth-login Edge Function. Tracks repeated login failures without exposing raw emails or IPs.';

NOTIFY pgrst, 'reload schema';
