-- ============================================================================
-- Requirement 3: Monitoring + Security Analysis
-- Creates a persistent structured event log for application traffic and
-- security-relevant events emitted by Edge Functions and authenticated clients.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.monitoring_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  event_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  event_type        text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  source            text NOT NULL,
  route             text,
  flow              text,
  request_id        text,
  actor_user_id     text,
  ip_hash           text,
  identifier_hash   text,
  client_token_hash text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS monitoring_events_event_at_idx
  ON public.monitoring_events (event_at DESC);

CREATE INDEX IF NOT EXISTS monitoring_events_event_type_idx
  ON public.monitoring_events (event_type, event_at DESC);

CREATE INDEX IF NOT EXISTS monitoring_events_severity_idx
  ON public.monitoring_events (severity, event_at DESC);

CREATE INDEX IF NOT EXISTS monitoring_events_source_idx
  ON public.monitoring_events (source, event_at DESC);

CREATE INDEX IF NOT EXISTS monitoring_events_request_idx
  ON public.monitoring_events (request_id);

ALTER TABLE public.monitoring_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.monitoring_events IS
  'Structured Stockd monitoring events for traffic monitoring, auth protection analysis, suspicious-input detection, CSV validation issues, and Copilot security-relevant rejections.';

NOTIFY pgrst, 'reload schema';
