# Stockd Runbook

## Current state

This repo runs most naturally as a static frontend backed by a Supabase project. The SQL migrations and scripts are source-of-truth operational assets; the root README is effectively empty (`Readme.md` contains only `.`), so the steps below are reconstructed from `package.json`, `.envexample`, `vercel.json`, `supabase/config.toml`, and the scripts/tests.

## Prerequisites

Required:

- Node.js and npm
- access to a Supabase project
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Required for scripts/tests:

- `SUPABASE_SERVICE_KEY`

Required for Copilot:

- `OPENAI_API_KEY`
- optional `OPENAI_MODEL` (defaults to `gpt-4o-mini`)
- recommended `COPILOT_ACTION_SECRET`

Optional:

- Supabase CLI for local database / migration work
- `ELEVENLABS_API_KEY` only if you intend to use the standalone `Elevenlabs/` module

## Environment variables

The repo ships `.envexample` with the expected variables:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
COPILOT_ACTION_SECRET=
ELEVENLABS_API_KEY=
```

Practical meaning:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are used to generate `Frontend/js/env.js`
- `SUPABASE_SERVICE_KEY` is used by scripts and tests
- OpenAI vars are used by `supabase/functions/copilot/`

## Install

```bash
npm install
```

This installs browser/runtime dependencies plus the script/test tooling declared in `package.json`.

## Generate frontend runtime config

Before running the main frontend locally, generate `Frontend/js/env.js`:

```bash
npm run config:public
```

or:

```bash
npm run build
```

What this does:

- reads `.env` or process env
- writes `Frontend/js/env.js`
- injects only public browser-safe Supabase values

If this step is skipped, the frontend can load with missing Supabase runtime config.

## Run the main frontend locally

```bash
npm start
```

This serves `Frontend/` as a static site.

Expected local entrypoint:

- open `http://localhost:3000` if `serve` uses its default port

The app flow is:

- `Frontend/index.html` -> auth/session check -> `landing.html` or app pages

## Run the kiosk locally

```bash
npm run start:kiosk
```

Notes:

- this serves `kiosk/` on port `3000`
- it conflicts with the main frontend if both are started with default commands
- `kiosk/kiosk.js` does not use `Frontend/js/env.js`; it hardcodes its own Supabase URL, anon key, and kiosk credentials

If you need both main app and kiosk at once, the kiosk should be served manually on a different port.

## Database setup options

### Option A: Hosted Supabase project (most likely path)

This appears to be the intended day-to-day mode for the current repo because:

- scripts require `SUPABASE_SERVICE_KEY`
- tests use a live service-key client in `tests/helpers/supabase.js`
- kiosk hardcodes a hosted Supabase project

Suggested hosted-project flow:

1. Fill `.env` from `.envexample`.
2. Ensure the target Supabase project has the migrations applied.
3. Run frontend/scripts/tests against that project.

What is missing from the repo:

- exact project-linking instructions
- an authoritative migration/deploy command sequence for a hosted project

### Option B: Local Supabase CLI project (possible but incomplete)

Evidence:

- `supabase/config.toml` exists
- `supabase/seed.sql` is configured as the local seed file

Likely local flow:

```bash
supabase start
supabase db reset
```

What this should do:

- start local Supabase services
- apply migrations in `supabase/migrations/`
- load `supabase/seed.sql`

Important limitation:

- `supabase/seed.sql` only seeds a tiny Cheeseburger example
- it does not create the full Tony's Pizza demo dataset

Also unclear from current repo:

- the intended local values for anon/service keys in `.env`
- the exact local Edge Function serve flow for `copilot`

## Create or refresh demo data

### Create demo auth user

```bash
node scripts/setup-auth-user.js
```

This creates:

- `demo@tonys.pizza`
- password `TonysPizza2026!`

Note:

- this does not match the credentials displayed in `Frontend/login.html`

### Full demo bootstrap

```bash
node scripts/setup-all.js
```

What it runs:

1. `scripts/ingest-test-data.js`
2. `scripts/seed-bom.js`
3. `scripts/run-bulk-close.js`
4. `scripts/generate-daily-orders.js`
5. `scripts/reset-inventory.js`
6. `scripts/generate-forecasts.js`
7. `scripts/ingest-order-details.js`
8. `scripts/analytics.js`

This is the fastest way to make the repo look demo-ready.

### Important warning

Some scripts are destructive or demo-oriented:

- `scripts/generate-daily-orders.js` deletes all current `daily_orders` before inserting synthetic data
- several manual scripts modify inventory or order data directly
- the demo-date refresh migration `20260318192000_refresh_demo_dates_for_demo_day.sql` exists specifically to keep demo data looking current

Use caution if you are pointing scripts at a shared or important Supabase project.

## Useful individual scripts

```bash
node scripts/ingest-test-data.js
node scripts/seed-bom.js
node scripts/run-bulk-close.js
node scripts/generate-forecasts.js
node scripts/ingest-order-details.js
node scripts/reset-inventory.js
node scripts/analytics.js
```

Invoice helpers and experiments:

```bash
node scripts/test-usfoods-lines.mjs
node scripts/test-usfoods-pdf.mjs
node scripts/receive-usfoods-invoice.mjs
```

## Run tests

```bash
npm test
```

Test behavior:

- runs Jest in-band
- uses a live Supabase client from `tests/helpers/supabase.js`
- isolates test rows using `__test__` prefixes and `9999-*` dates

Practical implications:

- you need valid `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- tests are not fully hermetic; they rely on convention-based cleanup inside a shared database

## Build and deploy

### Build

```bash
npm run build
```

This currently just generates the public frontend runtime config file.

### Deploy

The main frontend deployment target is defined by `vercel.json`:

- output directory: `Frontend`
- build command: `npm run build`

There is no checked-in CI/CD workflow and no `Dockerfile`.

## Common failure points

### Missing generated env file

Symptom:

- frontend loads but cannot talk to Supabase

Fix:

- run `npm run config:public` or `npm run build`

### Demo login does not work

Cause:

- login page shows `demo@user.pizza` / `admin`
- setup script creates `demo@tonys.pizza` / `TonysPizza2026!`

### `npm run start:backend` fails

Cause:

- `Backend/server.js` does not exist in the repo root

### Kiosk and main app disagree on environment

Cause:

- kiosk uses hardcoded Supabase values in `kiosk/kiosk.js`
- main app uses generated `Frontend/js/env.js`

### Forecast or analytics pages "look fine" but are not showing real backend output

Cause:

- several frontend pages fall back to mock/demo data when contracts drift or data is missing

### Local Supabase has too little data

Cause:

- `supabase/seed.sql` only seeds a minimal sample dataset
- full demo data requires the custom scripts

## Missing or stale documentation

Known gaps in repo documentation:

- `Readme.md` is effectively empty
- `KIOSK_DEPLOYMENT.md` does not match the current root `vercel.json`
- there is no authoritative local Copilot serve guide
- there is no documented hosted migration/deployment flow
- there is no CI/CD guide

## Recommended next steps

1. Replace the current README with a condensed version of this runbook.
2. Decide on one official local-dev path: hosted Supabase or local Supabase CLI.
3. Remove or fix stale commands and docs before more engineers join the repo.

