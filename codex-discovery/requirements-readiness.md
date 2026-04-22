# Stockd Requirements Readiness

## How to use this file

This matrix is meant to answer one question: if we start implementing new requirements one by one, what can we safely reuse, what is missing, and what order reduces risk?

Difficulty and risk assume the current architecture remains "static frontend + Supabase + one Edge Function".

## Readiness matrix

| Area | What already exists | What can be reused | What is missing | Difficulty | Technical risk | Recommended order |
| --- | --- | --- | --- | --- | --- | --- |
| Repo hygiene and environment | Vercel config, Supabase config, scripts, tests, generated frontend env flow | `vercel.json`, `scripts/generate-config.js`, `supabase/config.toml` | Real README, fixed/stale scripts, CI/CD, backend command cleanup | Low | Medium | 1 |
| Auth and tenant model | Supabase Auth, session gating, RLS enabled | `Frontend/js/supabase-client.js`, `Frontend/index.html` | org/restaurant model, roles, tenant-scoped RLS, user provisioning flow | High | High | 2 |
| Frontend/backend contract cleanup | Core RPCs exist and pages already call them | `get_inventory_snapshot`, `get_daily_analytics`, `receive_inventory`, `count_inventory` | typed contracts, removal of schema drift and forced demo fallbacks | Medium | High | 3 |
| Master data and BOM management | Admin CRUD RPCs are implemented | `upsert_menu_item`, `upsert_ingredient`, `upsert_bom_entry`, `get_bom_for_item` | admin UI, uniqueness/validation policy decisions, workflow design | Medium | Medium | 4 |
| Historical and daily sales ingestion | onboarding page, daily upload page, ingest RPCs, demo scripts | `Frontend/js/csv-parser.js`, `ingest_daily_sales`, `run_bulk_close`, `run_daily_close` | reliable production ingest path, better error surfacing, non-demo operator flow | Medium | Medium | 5 |
| Inventory operations | receive/count RPCs, receive/count UI, inventory snapshot | `receive_inventory`, `count_inventory`, `get_inventory_snapshot`, Copilot pending writes | vendor/invoice persistence, waste classification, removal of fake history rows | Medium | Medium | 6 |
| Dashboard and operational analytics | dashboard UI, daily analytics/revenue trend RPCs | `get_inventory_snapshot`, `get_daily_analytics`, `get_revenue_trend`, chart shells | trustworthy contracts, report surfaces, better use of order-level data | Medium | Medium-High | 7 |
| Forecasting | forecast tables and generation RPCs exist | `generate_forecast`, `get_forecast`, `forecast_*` schema | frontend alignment, forecast evaluation, more robust modeling if needed | Medium | Medium | 8 |
| AI / Copilot | Edge Function, tool framework, pending-action confirmation | `supabase/functions/copilot/`, prompt/tool structure | broader tool surface, stronger auth context, clearer product scope for AI | Medium | Medium | 9 |
| Pricing optimization | advisory pricing insights UI and AI mode | `pricing_insights` mode, sales-analysis presentation shell | menu price schema, pricing rules/history, approval/apply flow | High | High | 10 |
| Waste / spoilage tracking | indirect count deltas and inventory ledger exist | `inventory_txns`, `inventory_on_hand`, receive/count patterns | dedicated event type/table, workflows, analytics, reporting | Medium | Medium | 11 |
| Reporting and exports | analytics data exists in tables and RPCs | `daily_orders`, `sales_line_items`, analytics RPCs | report UI, export jobs, saved views, PDFs/CSV export design | Medium | Medium | 12 |
| Kiosk / live order path | kiosk app and `register_order` exist | `register_order`, `kiosk/` demo | real pricing, cleanup of hardcoded creds, deployment decision | Medium | Medium | 13 if in scope |

## Suggested order of attack

1. Clean up repo/runtime basics so everyone is working from a stable environment.
2. Lock down auth and tenancy assumptions before requirements create more data exposure.
3. Fix frontend/backend drift so the current app shows real system behavior.
4. Add missing admin/master-data workflows so future requirements have something to operate on.
5. Then build outward into ingestion hardening, inventory workflows, analytics, forecasting, and AI.
6. Leave pricing, waste, reporting, and kiosk expansion until the operational core is trustworthy.

## Areas with the best reuse potential

Highest reuse, lowest reinvention:

- SQL RPC layer for core inventory operations
- onboarding and CSV parsing pipeline
- analytics tables and core aggregation RPCs
- Copilot pending-action pattern
- backend test harness and isolated test-data conventions

## Areas with the highest hidden risk

Hidden-risk areas to de-risk early:

- multi-tenant security, because the current schema suggests it but does not enforce it
- dashboard/forecast contracts, because the UI currently hides mismatches with mock data
- pricing, because there is no underlying price model to support the marketed feature
- any requirement that assumes vendor, invoice, waste, or reporting entities already exist

## Recommended implementation posture

- Reuse the SQL core aggressively.
- Be skeptical of the current frontend surface when it appears "done"; several views are demo-enhanced.
- Add requirements behind stable backend contracts rather than more direct browser table queries.

