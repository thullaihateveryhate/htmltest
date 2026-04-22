# Stockd

Stockd is a Supabase-backed restaurant inventory and sales prototype with a static frontend in `Frontend/`, a demo kiosk in `kiosk/`, and a Copilot Edge Function in `supabase/functions/copilot/`.

## Discovery and Security Docs

- Repo discovery handoff: `codex-discovery/`
- Requirement 1 security write-up: `codex-security/requirement-1-sqli-xss.md`
- Requirement 1 report summary: `codex-security/requirement-1-report-summary.md`
- Requirement 2 security write-up: `codex-security/requirement-2-bruteforce.md`
- Requirement 2 report summary: `codex-security/requirement-2-report-summary.md`
- Requirement 3 monitoring write-up: `codex-monitoring/requirement-3-monitoring-analysis.md`
- Requirement 3 report summary: `codex-monitoring/requirement-3-report-summary.md`

## Security Verification

Run the targeted Requirement 1 security checks with:

```bash
npm run test:security
```

This verifies:

- XSS sanitization helpers
- CSV import normalization
- Copilot DB proxy allowlists
- request validation hardening

Run the targeted Requirement 2 brute-force protection checks with:

```bash
npm run test:bruteforce
```

This verifies:

- repeated failed logins escalate to challenge then lockout
- lockout expiry behavior
- successful login resets counters
- kiosk throttling
- kiosk server-side credential isolation

Run the targeted Requirement 3 monitoring checks with:

```bash
npm run test:monitoring
```

This verifies:

- structured log formatting
- suspicious-pattern detection logic
- summary/report generation
- secret redaction and safe JSONL output

## Requirement 2 Setup

Requirement 2 adds a protected auth Edge Function and a Postgres-backed guard table. To enable the full brute-force protection path in a live/local Supabase project:

1. Apply `supabase/migrations/20260422000100_requirement2_bruteforce_guard.sql`
2. Deploy `supabase/functions/auth-login/`
3. Set these server-side env vars:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AUTH_BRUTE_FORCE_SECRET`
   - `KIOSK_DEMO_EMAIL`
   - `KIOSK_DEMO_PASSWORD`
4. Regenerate public frontend config with:

```bash
npm run config:public
```

This writes both `Frontend/js/env.js` and `kiosk/env.js`.

## Requirement 3 Monitoring

Requirement 3 adds a Supabase-backed structured event log, an authenticated monitoring ingestion function, and an analysis/export script.

### Setup

To enable live monitoring in a real/local Supabase project:

1. Apply `supabase/migrations/20260422000200_requirement3_monitoring.sql`
2. Deploy `supabase/functions/security-monitor/`
3. Ensure the existing `auth-login` and `copilot` functions have access to:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Generate a sample artifact bundle locally with:

```bash
npm run monitoring:sample
```

5. Generate artifacts from live Supabase monitoring data with:

```bash
npm run monitoring:analyze
```

6. Optionally add an AI-assisted narrative on top of the deterministic summary with:

```bash
npm run monitoring:analyze:ai
```

Generated artifacts:

- `logs/security-events.jsonl`
- `logs/traffic_summary.json`
- `logs/security_analysis_sample.md`
- `Frontend/data/security-summary.json`
- `Frontend/data/security-events-preview.json`

Screenshot/demo page:

- `Frontend/pages/security-monitoring.html`
