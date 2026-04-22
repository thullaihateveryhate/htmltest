# Stockd Backend Analysis

## Backend summary

The Stockd backend is effectively a Supabase application, not a traditional server application. Its real entrypoints are:

- schema and RPC migrations in `supabase/migrations/`
- the `copilot` Supabase Edge Function in `supabase/functions/copilot/`
- service-key powered scripts in `scripts/`

There is no active root `Backend/server.js`, even though `package.json` still references one. `express` and `cors` are present as dependencies but are not part of the current working backend architecture.

## Backend entrypoints

| Entrypoint | Role | Notes |
| --- | --- | --- |
| `supabase/migrations/*.sql` | Source of truth for schema and business logic | Main backend surface. |
| `supabase/functions/copilot/index.ts` | AI Copilot HTTP handler | Only explicit custom endpoint in repo. |
| `scripts/*.js` / `scripts/*.mjs` | Operational setup, seed, test-data ingest, verification | Useful for demo/bootstrap; some are destructive. |
| `tests/*.js` | Integration tests against Supabase | Cover most major RPCs. |
| `package.json:start:backend` | Stale backend command | Broken; `Backend/server.js` does not exist. |

## Backend domains and modules

### 1. Core schema and RLS

Base schema is created in `supabase/migrations/20260207000100_init_schema.sql`.

It defines:

- enums: `unit_type`, `inventory_txn_type`
- core tables: `menu_items`, `ingredients`, `bom`, `sales_line_items`, `inventory_on_hand`, `inventory_txns`
- broad authenticated-user RLS policies

Important architectural observation:

- `org_id` exists on several core tables but is not enforced in policies
- `daily_orders`, `forecast_items`, `forecast_ingredients`, and `app_config` are not modeled as tenant-aware tables

### 2. Sales ingestion and consumption engine

Files:

- `supabase/migrations/20260207000200_consumption_engine.sql`
- `supabase/migrations/20260207000300_onboarding_and_bulk_close.sql`
- `supabase/migrations/20260207000600_smart_snapshot_window.sql`

Main behaviors:

- `ingest_daily_sales(p_rows)` auto-creates missing `menu_items`, then upserts daily aggregated sales
- `run_daily_close(p_business_date)` converts sales into BOM-based ingredient consumption and decrements on-hand
- `reverse_daily_close(p_business_date)` restores inventory and removes matching consume txns
- `run_bulk_close()` consumes every sales date not yet closed
- `get_inventory_snapshot()` computes average usage, days of supply, reorder window, and status

Notable implementation detail:

- `ingest_daily_sales()` replaces daily totals on re-upload
- `register_order()` later adds to daily totals
- this means the codebase supports both batch replacement semantics and live additive semantics, which is correct conceptually but easy to misuse

### 3. Inventory operations

File:

- `supabase/migrations/20260207000400_inventory_ops.sql`

Main behaviors:

- `receive_inventory()` validates quantity > 0, inserts a `RECEIVE` transaction, and upserts `inventory_on_hand`
- `count_inventory()` validates quantity >= 0, computes delta, inserts a `COUNT` transaction, and overwrites `inventory_on_hand` to the actual amount

These are compact, readable, and directly reusable RPCs.

### 4. Forecasting

File:

- `supabase/migrations/20260207000500_forecasting_v1.sql`

Main behaviors:

- stores generated forecasts in `forecast_items` and `forecast_ingredients`
- `generate_forecast()` uses day-of-week rolling averages from the prior 42 days of `sales_line_items`
- `get_forecast()` returns ingredient-level rows for the next 7 days, with on-hand and shortfall

Important reality check:

- this is a deterministic SQL forecast, not an AI or ML forecast
- the frontend marketing copy overstates its sophistication

### 5. Order-level analytics

Files:

- `supabase/migrations/20260207000700_daily_orders_and_analytics.sql`
- `supabase/migrations/20260207000710_fix_analytics_no_data.sql`

Main behaviors:

- `ingest_daily_orders()` upserts order-level records
- `get_daily_analytics()` returns daily summary metrics plus service period, dining option, source, hour, and server breakdowns
- `get_revenue_trend()` returns recent daily revenue trend rows

Important modeling choice:

- `daily_orders` is explicitly supplementary to `sales_line_items`
- this gives the app two different sales grains:
  - aggregated item-level demand in `sales_line_items`
  - order-level operational analytics in `daily_orders`

### 6. Admin/master-data RPCs

File:

- `supabase/migrations/20260207000800_admin_crud_rpcs.sql`

Main behaviors:

- `upsert_menu_item`
- `deactivate_menu_item`
- `upsert_ingredient`
- `upsert_bom_entry`
- `delete_bom_entry`
- `get_bom_for_item`

These are production-useful backend primitives, but there is no first-class UI for them in `Frontend/`.

### 7. Live order registration

File:

- `supabase/migrations/20260207000900_register_order_rpc.sql`

Main behavior:

- accepts an order payload as text JSON
- inserts or updates `daily_orders`
- auto-creates unknown menu items
- increments `sales_line_items`
- consumes BOM ingredients and decrements `inventory_on_hand`
- protects idempotency by `order_id`

This is the backend foundation for the kiosk and any future live order ingestion path.

## Edge Function and AI backend

### Request handling

File:

- `supabase/functions/copilot/index.ts`

The Edge Function accepts POST requests and dispatches by mode:

- `chat`
- `pricing_insights`
- pending-action confirmation path when `confirm` is true

### Runtime dependencies

Files:

- `supabase/functions/copilot/env.ts`
- `supabase/functions/copilot/openai.ts`
- `supabase/functions/copilot/prompts.ts`

Behavior:

- requires `OPENAI_API_KEY`
- defaults to model `gpt-4o-mini`
- calls OpenAI's Responses API
- uses JSON-schema structured output for pricing recommendations

### Tooling layer

Files:

- `supabase/functions/copilot/tool-registry.ts`
- `supabase/functions/copilot/tool-dispatch.ts`
- `supabase/functions/copilot/tools/*.ts`

Read tools include:

- inventory snapshot
- ingredient forecast
- daily analytics
- revenue trend
- top-selling items
- simple revenue prediction
- BOM lookup
- ingredient search
- menu item search

Write tools include:

- receive inventory
- count inventory

Write-path strength:

- writes are wrapped as signed pending actions and require explicit confirmation
- audit events are logged in `supabase/functions/copilot/audit.ts`

## Validation and error handling

### SQL RPC layer

Most SQL RPCs return JSON status objects rather than raising hard exceptions for user errors. Common patterns:

- `"status": "success"`
- `"status": "error"`
- `"status": "duplicate"`
- `"status": "no_data"`
- `"status": "skipped"`

Pros:

- simple to consume from browser code
- user-facing validation messages are easy to render

Cons:

- frontend code has to remember to check both transport errors and RPC payload status
- no strong shared response typing

### Edge Function layer

The Copilot backend is more structured:

- request parsing and validation in `validation.ts`
- typed `AppError` handling in `types.ts` and `responses.ts`
- upstream error mapping for both OpenAI and Supabase

This is cleaner than the SQL/browser interface.

## Security controls

### What exists

- Supabase Auth for all main app flows
- RLS enabled on major tables
- SECURITY DEFINER RPCs
- signed pending actions for Copilot writes
- kiosk uses authenticated sign-in, not a service key

### Main weaknesses

- RLS does not isolate data by restaurant or organization
- several tables and almost all policies effectively allow any authenticated user
- browser pages query raw tables directly
- kiosk credentials are hardcoded in `kiosk/kiosk.js`
- kiosk also hardcodes the Supabase URL and anon key

This is acceptable for a demo but not for multi-tenant production.

## Logging and observability

Current observability is minimal.

What exists:

- `console.log`, `console.warn`, `console.error` in frontend pages and scripts
- Edge Function logs for request failures and tool execution
- Copilot write-audit log lines in `audit.ts`

What is missing:

- structured application logs beyond Copilot audit output
- centralized tracing or metrics
- deployment-time log configuration
- background-job monitoring

## Background jobs and cron

There is no recurring scheduler or background-job system in the repo.

Forecast generation, analytics verification, and demo data creation happen manually through scripts such as:

- `scripts/generate-forecasts.js`
- `scripts/generate-daily-orders.js`
- `scripts/setup-all.js`

This means current "refresh" behavior is operator- or demo-script-driven, not automated.

## Test coverage

Backend coverage is stronger than frontend coverage.

Key tests:

- `tests/rpc.test.js` for onboarding, ingestion, daily close, inventory snapshot
- `tests/m4-inventory-ops.test.js` for receive/count
- `tests/m6-forecast.test.js` for forecast generation and retrieval
- `tests/orders-analytics.test.js` for order analytics
- `tests/m7-admin-crud.test.js` for admin RPCs
- `tests/register-order.test.js` for live order registration
- `tests/copilot/*.test.js` for request validation, tool dispatch, handler behavior, and pending actions

Important run assumption:

- tests use live Supabase credentials via `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- test isolation relies on prefixed names and `9999-*` dates, not a disposable test database

## Backend strengths

- Business logic is centralized in the database and is relatively readable.
- Core inventory workflows are implemented end to end.
- Copilot write protection via pending actions is a thoughtful safeguard.
- Test coverage is broad for a prototype of this size.

## Backend weak points and technical debt

- No real tenant isolation despite `org_id` hints.
- No dedicated waste, pricing, vendor, invoice, purchase-order, or alert entities.
- Some scripts are destructive by design. Example: `scripts/generate-daily-orders.js` deletes all `daily_orders` before reinserting synthetic data.
- Demo-date maintenance migration `20260318192000_refresh_demo_dates_for_demo_day.sql` indicates data freshness is being managed for demos rather than through durable product flows.
- Package metadata is stale (`ugahacks11` naming, missing backend file, unused server dependencies).
- The backend surface is large enough to be useful, but there is no stable typed contract layer between SQL JSON responses and browser callers.

## Recommended next steps

1. Harden security and tenancy before expanding features.
2. Standardize API contracts and stop relying on raw-table browser reads for operational pages.
3. Decide which scripts are bootstrapping helpers and which are part of a real data pipeline.
4. Preserve the strong SQL core, but add a clearer service boundary for new requirement work.

