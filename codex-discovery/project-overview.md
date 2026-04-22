# Stockd Project Overview

## What Stockd currently is

Stockd is a restaurant inventory and operations web app that turns sales history into ingredient usage, inventory positions, reorder alerts, and lightweight forecasting. The business pitch is described in `DEVPOST.md` and `PITCH.md`, while the actual working product lives in `Frontend/`, `supabase/migrations/`, `supabase/functions/copilot/`, and the demo/setup scripts under `scripts/`.

In code terms, the repo already supports:

- ingesting Toast-style sales CSVs into `sales_line_items`
- linking menu items to ingredients through a BOM in `bom`
- generating inventory consumption from sales via `run_daily_close()` / `run_bulk_close()`
- maintaining current on-hand inventory in `inventory_on_hand`
- recording operational adjustments through `receive_inventory()` and `count_inventory()`
- generating simple ingredient forecasts through `generate_forecast()` and `get_forecast()`
- exposing analytics and Copilot answers from `daily_orders`, `sales_line_items`, and inventory data

The current repo is best understood as a polished demo/prototype for restaurant operators, not a fully hardened production SaaS platform.

## Who the product appears to serve

Primary users suggested by the codebase:

- Restaurant owner or manager: dashboard, alerts, sales analysis, AI copilot. Evidence: `Frontend/pages/dashboard.html`, `Frontend/pages/sales-analysis.html`, `supabase/functions/copilot/`.
- Back-of-house or inventory staff: receiving deliveries and doing physical counts. Evidence: `Frontend/pages/receive.html`, `Frontend/pages/count.html`.
- Initial setup/admin user: historical sales upload and onboarding. Evidence: `Frontend/pages/onboarding.html`, `supabase/migrations/20260207000300_onboarding_and_bulk_close.sql`.
- Demo customer / kiosk flow: a separate self-order kiosk for Tony's Pizza. Evidence: `kiosk/kiosk.js`, `supabase/migrations/20260207000900_register_order_rpc.sql`.

Unclear from the current repo:

- whether there is meant to be role separation between manager, staff, and admin
- whether the kiosk is part of Stockd's core product or a demo sidecar
- whether the product is intended to support multiple restaurants in production

## Business problem the repo is trying to solve

The repo is built around a specific operational loop: restaurants know what sold, but they often do not know what those sales imply for ingredient consumption, what they truly have on hand, or what they should order next. Stockd tries to solve that by joining three things:

1. Sales demand from CSV uploads or order registration.
2. Recipe structure from the BOM.
3. Inventory movement from automated consumption plus manual receive/count corrections.

That lets the app answer practical questions such as:

- What ingredients are low right now?
- How many days of supply are left?
- What should be reordered?
- How did a recent day or week perform?
- What is the next 7-day ingredient need based on historical sales?

The code supports those questions directly through `get_inventory_snapshot()`, `get_forecast()`, `get_daily_analytics()`, `get_revenue_trend()`, and the Copilot tool layer in `supabase/functions/copilot/tools/`.

## Major workflows in the current repo

| Workflow | What happens today | Main evidence |
| --- | --- | --- |
| Auth and entry routing | `Frontend/index.html` checks Supabase auth. Unauthenticated users are sent to `landing.html`; authenticated users are routed to onboarding or dashboard based on `get_onboarding_status()`. | `Frontend/index.html`, `Frontend/js/supabase-client.js` |
| First-time setup | User uploads a Toast `ItemSelectionDetails` CSV. The frontend parses and batches rows into `ingest_daily_sales()`, marks onboarding complete, then runs `run_bulk_close()`. | `Frontend/pages/onboarding.html`, `Frontend/js/csv-parser.js`, `supabase/migrations/20260207000200_consumption_engine.sql`, `supabase/migrations/20260207000300_onboarding_and_bulk_close.sql` |
| Daily sales upload | A separate daily upload screen parses a CSV, ingests rows, then runs `run_daily_close()` for each date found. | `Frontend/pages/upload.html` |
| Dashboard review | Dashboard loads revenue trend, top sellers, categories, inventory snapshot, and forecast data; it also renders alerts and suggested restocks. | `Frontend/pages/dashboard.html` |
| Sales analysis | Sales Analysis shows top sellers, recent daily sales, traffic patterns, and pricing recommendations. Some of this is live, some falls back to demo or heuristic logic. | `Frontend/pages/sales-analysis.html`, `Frontend/js/ai-client.js` |
| Receiving stock | Staff can manually receive inventory or upload a US Foods PDF invoice, match items client-side, then call `receive_inventory()` per selected line item. | `Frontend/pages/receive.html`, `Frontend/js/invoice-matcher.js`, `Frontend/js/usfoodsPdfParser.js`, `supabase/migrations/20260207000400_inventory_ops.sql` |
| Physical counts | Staff choose an ingredient, submit actual quantity, and call `count_inventory()`. | `Frontend/pages/count.html`, `supabase/migrations/20260207000400_inventory_ops.sql` |
| Copilot | User sends chat or pricing-insight requests to the `copilot` Edge Function, which can read live data and prepare confirmation-required inventory writes. | `Frontend/js/ai-client.js`, `Frontend/js/ai-copilot.js`, `supabase/functions/copilot/` |
| Kiosk order capture | Separate kiosk signs into Supabase, reads active menu items, builds a cart, and calls `register_order()`, which inserts `daily_orders`, increments `sales_line_items`, and consumes inventory through the BOM. | `kiosk/kiosk.js`, `supabase/migrations/20260207000900_register_order_rpc.sql` |

## Likely demo story based on the repo

The most likely live demo path is:

1. Show the landing page and log in as a demo user.
   Evidence: `Frontend/landing.html`, `Frontend/login.html`.
2. If demonstrating first-time setup, upload historical Toast sales via onboarding.
   Evidence: `Frontend/pages/onboarding.html`.
3. Land on the main dashboard and show revenue, inventory alerts, forecast/inventory table, and restock suggestions.
   Evidence: `Frontend/pages/dashboard.html`.
4. Open Sales Analysis to show pricing recommendations, top sellers, and traffic pattern visuals.
   Evidence: `Frontend/pages/sales-analysis.html`.
5. Show Receive and Count workflows to prove the product updates operational inventory.
   Evidence: `Frontend/pages/receive.html`, `Frontend/pages/count.html`.
6. Ask Copilot a question about inventory, analytics, or forecast.
   Evidence: `Frontend/js/ai-copilot.js`, `supabase/functions/copilot/prompts.ts`.
7. Optionally show the kiosk placing an order that feeds back into Stockd's data model.
   Evidence: `kiosk/kiosk.js`, `tests/register-order.test.js`.

The repo also includes extensive demo setup automation under `scripts/setup-all.js`, `scripts/seed-bom.js`, `scripts/generate-daily-orders.js`, `scripts/reset-inventory.js`, and `supabase/migrations/20260318192000_refresh_demo_dates_for_demo_day.sql`, which reinforces that the current product is optimized for demoability.

## Repo reality check

The repo's implemented product is narrower than the marketing claims in `DEVPOST.md` and `PITCH.md`.

What is real and grounded in code:

- Supabase Auth-based sign-in
- CSV sales ingestion
- BOM-driven inventory consumption
- on-hand inventory tracking
- receive/count adjustments
- order-level analytics over `daily_orders`
- simple ingredient forecasting
- OpenAI-backed Copilot with confirmation-required inventory writes

What is overstated, partial, or not actually delivered end to end:

- "AI-powered forecasting" is currently SQL day-of-week averaging in `generate_forecast()`, not advanced ML
- "Dynamic pricing" exists as recommendation UI, not as a real pricing system with persisted prices or price updates
- "Multi-tenant security" is implied by `org_id` columns, but current RLS mostly checks only `auth.role() = 'authenticated'`
- waste tracking, spoilage tracking, purchase orders, vendor management, and explicit reporting modules are not implemented as first-class backend entities

## Recommended next steps

1. Treat the repo as a backend-strong demo prototype, not as a finished restaurant platform.
2. Reconcile the marketed feature set with the actual code paths before implementing new requirements.
3. Stabilize the core operator journey first: auth, onboarding, dashboard contracts, receive/count, and analytics correctness.

