# Requirement 3: Traffic Monitoring & Security Analysis

## 1. Why this requirement applies

Stockd now includes explicit preventive controls for:

- SQL injection / XSS hardening
- brute-force login protection

Requirement 3 adds the missing visibility layer on top of those protections:

- collect structured security-relevant events
- export the events into report-friendly artifacts
- analyze them for suspicious patterns
- optionally summarize the findings with AI after deterministic detection has already happened

This matters for Stockd because the repo is not a traditional full-stack app with centralized middleware logs. It is a mix of:

- static frontend pages in `Frontend/`
- a kiosk sidecar in `kiosk/`
- Supabase Auth and PostgREST/RPC
- Supabase Edge Functions (`auth-login`, `copilot`, `security-monitor`)

Without a dedicated monitoring layer, security events in that architecture would stay scattered across:

- browser state
- one-off `console.*` statements
- Supabase history
- ad hoc scripts

Requirement 3 makes those events structured, exportable, and analyzable.

## 2. Monitoring architecture chosen

The implemented monitoring design uses three layers:

### A. Persistent event log in Supabase

Added `public.monitoring_events` in:

- `supabase/migrations/20260422000200_requirement3_monitoring.sql`

This table stores structured JSON-safe events with:

- `event_at`
- `event_type`
- `severity`
- `source`
- `route`
- `flow`
- `request_id`
- `actor_user_id`
- hashed `ip`, `identifier`, and `client_token` fields
- safe `metadata`

### B. Server-side logging for authoritative security events

Server-side events are written directly by Edge Functions through:

- `supabase/functions/_shared/monitoring.ts`

This is used by:

- `supabase/functions/auth-login/index.ts`
- `supabase/functions/copilot/supabase.ts`
- `supabase/functions/security-monitor/index.ts`

This is the strongest signal path because it does not depend on the browser deciding to cooperate after the fact.

### C. Authenticated client event reporting for UI-driven actions

Client-only operational/security events are reported through:

- `supabase/functions/security-monitor/`
- `Frontend/js/monitoring-client.js`

The browser-side flows in these files were instrumented:

- `Frontend/pages/upload.html`
- `Frontend/pages/onboarding.html`
- `Frontend/pages/receive.html`
- `Frontend/pages/count.html`

This lets Stockd log events that happen before or alongside DB writes, such as:

- CSV upload attempts
- CSV validation problems
- suspicious sanitized input in user-entered note fields
- receive/count submission outcomes

## 3. What is logged

### Server-side / authoritative events

#### Auth flow (`supabase/functions/auth-login/index.ts`)

- `login_success`
- `login_failure`
- `kiosk_login_attempt`
- `bruteforce_challenge_triggered`
- `bruteforce_lockout_triggered`
- `auth_request_rejected`
- `auth_login_error`

Safe metadata includes:

- login flow (`web_login`, `kiosk_login`)
- failed-attempt counts
- retry-after duration
- challenge/lockout state

It does **not** store:

- plaintext email
- password
- raw device token
- raw IP

Those are hashed before persistence.

#### Copilot / sensitive data-access rejections (`supabase/functions/copilot/supabase.ts`)

- `copilot_security_rejection`
- `copilot_data_access_denied`

These fire when:

- a disallowed RPC is requested
- a disallowed table/filter/order/limit is requested
- live data access is denied by auth/access rules

### Client-reported / authenticated UI events

#### CSV flows

Logged from:

- `Frontend/pages/upload.html`
- `Frontend/pages/onboarding.html`
- `Frontend/js/csv-parser.js`

Events:

- `csv_upload_attempted`
- `csv_upload_completed`
- `csv_validation_failure`
- `suspicious_input_detected` (for suspicious CSV row content that was sanitized/flagged)

#### Inventory flows

Logged from:

- `Frontend/pages/receive.html`
- `Frontend/pages/count.html`

Events:

- `inventory_receive_action`
- `inventory_receive_rejected`
- `inventory_count_submission`
- `inventory_count_rejected`
- `suspicious_input_detected` (for suspicious note input in receive flow)

## 4. Structured log format

All persistent events use the same JSON shape in `monitoring_events`:

- `event_at`
- `event_type`
- `severity`
- `source`
- `route`
- `flow`
- `request_id`
- `actor_user_id`
- `ip_hash`
- `identifier_hash`
- `client_token_hash`
- `metadata`

Formatting and redaction are centralized in:

- `supabase/functions/_shared/monitoring.ts`

Important safeguards:

- secret-like metadata keys are redacted (`password`, `token`, `authorization`, `api_key`, etc.)
- strings are normalized and length-bounded
- only JSON-safe metadata is persisted
- correlation/request IDs are included where practical

## 5. Deterministic analysis pipeline

The deterministic analysis logic lives in:

- `monitoring/analyze.js`
- `scripts/export-monitoring-analysis.js`

### Input

The analysis script can run in two modes:

1. Live Supabase export

- command: `npm run monitoring:analyze`
- reads from `public.monitoring_events` using `SUPABASE_SERVICE_ROLE_KEY`

2. Fixture/sample mode

- command: `npm run monitoring:sample`
- reads from `monitoring/fixtures/security-events.sample.jsonl`

Fixture mode is useful for demo screenshots and report artifacts even before a live environment has accumulated events.

### Output artifacts

The script generates:

- `logs/security-events.jsonl`
- `logs/traffic_summary.json`
- `logs/security_analysis_sample.md`
- `Frontend/data/security-summary.json`
- `Frontend/data/security-events-preview.json`

### Deterministic suspicious-pattern detection

The analysis currently detects:

- repeated failed logins
- lockout bursts
- suspicious input / rejected input activity
- unusually high event volume from one hashed source/device/user scope
- malformed CSV upload spikes
- top security-relevant event categories
- simple last-hour / last-24-hours / last-7-days summaries

This logic is threshold-based and fully traceable in code.

## 6. AI-assisted monitoring layer

AI assistance is implemented as an **optional** second step, not the primary detector.

Command:

- `npm run monitoring:analyze:ai`

Implementation:

- `scripts/export-monitoring-analysis.js`

How it works:

1. deterministic summary is built first
2. only the summarized findings/counters are sent to the model
3. if `OPENAI_API_KEY` is set and `--ai` is used, the script requests a concise plain-English explanation
4. if AI is unavailable or not configured, the script falls back to a deterministic narrative

This means the project can honestly claim:

- anomaly detection is deterministic and reproducible
- AI is used only to explain the findings in a report-friendly way

It does **not** pretend that the model is the source of truth.

## 7. Visibility / demo surface

### Generated artifacts

The easiest screenshot/report artifacts are:

- `logs/traffic_summary.json`
- `logs/security_analysis_sample.md`

### Monitoring page

Added:

- `Frontend/pages/security-monitoring.html`

This page renders the generated summary JSON from:

- `Frontend/data/security-summary.json`

It shows:

- traffic/security KPI cards
- suspicious findings
- top event categories
- recent event preview

Dashboard access was also made more discoverable by adding a `Security` topnav link in:

- `Frontend/pages/dashboard.html`

## 8. Tests added

Added:

- `scripts/run-monitoring-tests.js`

Command:

- `npm run test:monitoring`

Covered behaviors:

- event formatting and hashing/redaction
- suspicious-pattern detection
- summary generation
- markdown report generation
- no-secret JSONL output

## 9. Exact files changed

### DB / Edge Functions

- `supabase/migrations/20260422000200_requirement3_monitoring.sql`
- `supabase/functions/_shared/monitoring.ts`
- `supabase/functions/security-monitor/index.ts`
- `supabase/functions/security-monitor/auth.ts`
- `supabase/functions/security-monitor/cors.ts`
- `supabase/functions/security-monitor/env.ts`
- `supabase/functions/security-monitor/responses.ts`
- `supabase/functions/security-monitor/types.ts`
- `supabase/functions/security-monitor/validation.ts`
- `supabase/functions/auth-login/index.ts`
- `supabase/functions/copilot/env.ts`
- `supabase/functions/copilot/supabase.ts`
- `supabase/functions/copilot/types.ts`

### Frontend logging / visibility

- `Frontend/js/monitoring-client.js`
- `Frontend/js/security.js`
- `kiosk/security.js`
- `Frontend/js/csv-parser.js`
- `Frontend/pages/upload.html`
- `Frontend/pages/onboarding.html`
- `Frontend/pages/receive.html`
- `Frontend/pages/count.html`
- `Frontend/pages/dashboard.html`
- `Frontend/pages/security-monitoring.html`

### Analysis / artifacts / tests / docs

- `monitoring/analyze.js`
- `monitoring/fixtures/security-events.sample.jsonl`
- `scripts/export-monitoring-analysis.js`
- `scripts/run-monitoring-tests.js`
- `logs/security-events.jsonl`
- `logs/traffic_summary.json`
- `logs/security_analysis_sample.md`
- `Frontend/data/security-summary.json`
- `Frontend/data/security-events-preview.json`
- `package.json`
- `Readme.md`
- `codex-monitoring/requirement-3-monitoring-analysis.md`
- `codex-monitoring/requirement-3-report-summary.md`

## 10. How to demo this to a grader

### Demo A: Show the architecture

Point to:

- `supabase/migrations/20260422000200_requirement3_monitoring.sql`
- `supabase/functions/_shared/monitoring.ts`
- `supabase/functions/security-monitor/`

Explain:

- auth/Copilot log server-side directly
- frontend flows send validated events through `security-monitor`
- all events land in one table with one schema

### Demo B: Show the artifacts

Run:

```bash
npm run monitoring:sample
```

Then open:

- `logs/traffic_summary.json`
- `logs/security_analysis_sample.md`
- `Frontend/pages/security-monitoring.html`

This is the quickest screenshot path.

### Demo C: Show live export mode

If a live/local Supabase project is configured and the new migration/functions are deployed:

```bash
npm run monitoring:analyze
```

This pulls the real `monitoring_events` table and rebuilds the artifacts from live data.

### Demo D: Optional AI narrative

If `OPENAI_API_KEY` is configured:

```bash
npm run monitoring:analyze:ai
```

Then show that:

- the same deterministic summary still exists
- the report now also contains an AI-assisted explanation
- AI is layered on top of deterministic findings, not replacing them

## 11. Remaining limitations / follow-up

1. Client-originated monitoring events are best-effort.

- The browser tries to report them through `security-monitor`.
- If the page is closed or the network drops at the wrong moment, those specific client events may be missed.
- Server-side auth/Copilot events are more authoritative.

2. The monitoring page renders generated artifacts, not live database queries.

- That was intentional to keep the UI static, screenshotable, and easy to demo.
- The summary is refreshed by running the analysis script.

3. AI monitoring is optional.

- It only runs when the operator explicitly uses `--ai` and provides `OPENAI_API_KEY`.
- No fake AI summaries are generated when the model is unavailable.

4. The monitoring table/function still need deployment for live use.

- The repo changes are complete.
- The migration must be applied and the `security-monitor` Edge Function deployed to the target Supabase project.
