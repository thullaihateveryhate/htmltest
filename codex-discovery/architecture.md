# Stockd Architecture

## High-level shape

Stockd is a SQL-first Supabase application with a static browser frontend. There is no active custom Node backend in the root repo even though `package.json` still declares `start:backend` as `node Backend/server.js`. The actual backend logic lives in:

- SQL migrations and RPCs under `supabase/migrations/`
- one Supabase Edge Function under `supabase/functions/copilot/`
- utility and seed scripts under `scripts/`

The deployed UI is a static site in `Frontend/` according to `vercel.json`. A separate `kiosk/` app exists, but the root deployment config does not currently publish it.

## Repo map

```text
Frontend/                  Static multi-page Stockd web app
  index.html              Session gate/router
  landing.html            Marketing page
  login.html              Auth page
  pages/                  Main app screens
  js/                     Shared browser logic, Copilot client, CSV/PDF helpers
  css/                    Shared styles

kiosk/                     Separate Tony's Pizza order kiosk

supabase/
  migrations/             Source of truth for schema and RPC backend
  functions/copilot/      Edge Function for AI Copilot
  seed.sql                Minimal local seed only
  config.toml             Supabase CLI config

scripts/                   Demo setup, seeding, ingestion, verification
tests/                     RPC and Copilot test coverage
Test data/                 Sample Toast CSVs and invoice files
Elevenlabs/                Standalone TTS utility, currently not integrated
plans_dumpster/            Planning docs; useful context, not source of truth
Untitled/                  Duplicate repo snapshot / likely archival noise
```

## Architecture diagram

```mermaid
flowchart LR
    subgraph Browser["Browser clients"]
        Landing["Landing / Login"]
        App["Stockd pages in Frontend/pages/"]
        Kiosk["Tony's Pizza kiosk"]
    end

    subgraph Hosting["Hosting"]
        Vercel["Vercel static deployment"]
    end

    subgraph Supabase["Supabase project"]
        Auth["Auth"]
        DB["Postgres + RPCs + RLS"]
        Edge["Edge Function: copilot"]
    end

    subgraph External["External services"]
        OpenAI["OpenAI Responses API"]
        CDNs["Chart.js / PapaParse / pdfjs CDNs"]
    end

    Vercel --> Landing
    Vercel --> App

    Landing --> Auth
    App --> Auth

    App -->|supabase-js table reads + rpc| DB
    App -->|functions.invoke('copilot')| Edge
    App --> CDNs

    Kiosk -->|supabase-js auth| Auth
    Kiosk -->|rpc register_order| DB

    Edge -->|REST / RPC with anon key + user bearer token| DB
    Edge -->|LLM calls| OpenAI

    Scripts["Node scripts in scripts/"] -->|service key| DB
    Tests["Jest tests in tests/"] -->|service key| DB
```

## Frontend architecture

Current frontend characteristics:

- Static multi-page HTML/CSS/JS app, not React/Next/Vite. Evidence: `Frontend/index.html`, `Frontend/pages/*.html`.
- Shared browser state is minimal and global. `Frontend/js/supabase-client.js` defines the global `sb` client and helper functions.
- Per-page logic is inline inside each HTML file. There is no component or module framework beyond a few shared JS utilities.
- External browser dependencies are loaded from CDNs:
  - Supabase browser client
  - Chart.js
  - PapaParse
  - pdfjs-dist

Key browser-side service boundaries:

- Reads and writes go directly from the browser to Supabase tables and RPCs.
- Copilot requests go from the browser to the `copilot` Edge Function via `sb.functions.invoke()`.
- Runtime env injection happens through generated `Frontend/js/env.js`, produced by `scripts/generate-config.js`.

## Backend architecture

### 1. Postgres schema and RPC layer

The main application backend is a collection of SQL migrations that create:

- master data tables such as `menu_items`, `ingredients`, and `bom`
- transaction/event tables such as `sales_line_items`, `inventory_txns`, and `daily_orders`
- derived state tables such as `inventory_on_hand`, `forecast_items`, and `forecast_ingredients`
- RPCs for ingestion, consumption, inventory ops, analytics, forecasting, admin CRUD, and order registration

Source of truth files:

- `supabase/migrations/20260207000100_init_schema.sql`
- `supabase/migrations/20260207000200_consumption_engine.sql`
- `supabase/migrations/20260207000300_onboarding_and_bulk_close.sql`
- `supabase/migrations/20260207000400_inventory_ops.sql`
- `supabase/migrations/20260207000500_forecasting_v1.sql`
- `supabase/migrations/20260207000700_daily_orders_and_analytics.sql`
- `supabase/migrations/20260207000800_admin_crud_rpcs.sql`
- `supabase/migrations/20260207000900_register_order_rpc.sql`

### 2. Edge Function for AI

`supabase/functions/copilot/` is a Deno TypeScript Edge Function that:

- accepts `chat` and `pricing_insights` POST requests
- builds prompts from current request context
- calls the OpenAI Responses API in `openai.ts`
- can call read-only data tools against Supabase
- can prepare confirmation-required inventory writes (`receive_inventory`, `count_inventory`)

Important implementation detail:

- Marketing docs mention Gemini, but the current deployed Copilot code uses OpenAI. Evidence: `supabase/functions/copilot/openai.ts`, `supabase/functions/copilot/env.ts`, `supabase/functions/copilot/prompts.ts`.

### 3. No active custom server layer

Even though `package.json` depends on `express` and `cors`, there is no live Express app in the working repo. `package.json` still contains `start:backend`, but `Backend/server.js` does not exist in the repository root. This means the current architecture is effectively "static frontend + Supabase backend".

## Database and storage

### Postgres

The repo is built around Supabase Postgres and SECURITY DEFINER RPCs. This is the core persistence layer.

### Storage

Supabase Storage is enabled in `supabase/config.toml`, but the app does not currently use storage buckets or persisted file uploads. Invoice PDFs are parsed client-side in the browser; they are not uploaded to a backend bucket.

### Generated runtime config

`scripts/generate-config.js` writes only public browser-safe values into `Frontend/js/env.js`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

That file is git-ignored in `.gitignore` and treated as a generated artifact.

## Authentication flow

Main app auth:

1. Browser loads Supabase client in `Frontend/js/supabase-client.js`.
2. `Frontend/index.html` checks `sb.auth.getSession()`.
3. If no session exists, user is sent to `Frontend/landing.html` and then `Frontend/login.html`.
4. If a session exists, `routeByOnboarding()` checks `get_onboarding_status()` and routes to onboarding or dashboard.

Kiosk auth:

- `kiosk/kiosk.js` signs in automatically using hardcoded demo credentials and a hardcoded Supabase URL/anon key.

Security reality:

- The core tables have RLS enabled, but the policies mostly allow any authenticated user to read/write. There is no meaningful tenant scoping by `org_id` in the current schema.
- Many RPCs are `SECURITY DEFINER`, which is normal for app RPCs but increases the importance of correct input validation and tenant checks.

## AI and forecasting architecture

The repo contains two separate "intelligence" paths:

### Copilot / LLM path

- Edge Function request handling: `supabase/functions/copilot/index.ts`
- Prompt building: `supabase/functions/copilot/prompts.ts`
- OpenAI Responses API integration: `supabase/functions/copilot/openai.ts`
- Tool registry and execution: `supabase/functions/copilot/tool-registry.ts`, `tool-dispatch.ts`, `tools/*.ts`

This is real AI infrastructure, but it is focused on summarization, Q&A, pricing recommendations, and controlled inventory writes.

### Forecasting / analytics path

- Ingredient forecasting is SQL-based, not LLM-based. `generate_forecast()` computes day-of-week rolling averages over the last 42 days and stores results in `forecast_items` and `forecast_ingredients`.
- Revenue prediction in Copilot is explicitly lightweight linear-trend logic, not trained ML. Evidence: `supabase/functions/copilot/tools/predict-revenue.ts`.

## Hosting and deployment assumptions

### Frontend deployment

`vercel.json` configures the root deployment as:

- build command: `npm run build`
- output directory: `Frontend`

So the primary deployment target is the main Stockd UI, not the kiosk.

### Kiosk deployment mismatch

`KIOSK_DEPLOYMENT.md` says the kiosk is deployed via the root `vercel.json`, but that no longer matches the actual root config. `KIOSK_STANDALONE_SETUP.md` suggests moving the kiosk into its own repo, which is more consistent with the current architecture.

### CI/CD

There is no `.github/workflows/` directory and no checked-in CI pipeline. Build/test/deploy automation is therefore unclear from the current repo.

## Dev vs prod setup

### Development

Two development patterns appear in the repo:

- Hosted Supabase mode, using `.env` plus service key powered scripts. Evidence: `.envexample`, `scripts/*.js`, `tests/helpers/supabase.js`.
- Local Supabase CLI mode, using `supabase/config.toml` and `supabase/seed.sql`.

However, the repo is much more complete for hosted Supabase than for local-only development. Most setup scripts assume `SUPABASE_SERVICE_KEY`, which usually means a hosted project.

### Production

Production appears to assume:

- Vercel-hosted static frontend
- Supabase-hosted Postgres/Auth/Edge Functions
- OpenAI API key stored server-side for Copilot

Unclear from the current repo:

- whether Copilot is served locally during development
- what the intended production auth/user provisioning flow is
- whether the kiosk should share the main domain/project

## Architectural strengths

- Clear backend center of gravity: data logic is concentrated in SQL RPCs rather than scattered across the frontend.
- Good demo setup coverage: scripts can bootstrap a complete demo dataset.
- Reasonable AI boundary: the Edge Function separates Copilot from direct browser prompt construction.
- Broad backend test surface: `tests/` covers core RPCs and Copilot behaviors.

## Architectural risks and gaps

- Frontend and backend contracts are drifting.
- Multi-tenant isolation is not implemented even though `org_id` columns suggest it should exist.
- The browser directly queries operational tables, which makes schema drift and auth design harder to control.
- There is no real service layer for non-Copilot APIs.
- Deployment and local run instructions are incomplete or stale.
- The repo contains stale or duplicate artifacts (`Untitled/`, kiosk deployment docs, empty `Readme.md`, missing `Backend/server.js`).

## Recommended next steps

1. Decide whether the long-term architecture is still "static frontend + Supabase only" or whether a real app server is needed.
2. Introduce a stable API contract boundary so frontend pages stop depending on ad hoc table selects and mismatched RPC response shapes.
3. Implement real tenant scoping before adding more operator-facing requirements.

