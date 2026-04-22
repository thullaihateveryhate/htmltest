# Stockd API Inventory

## Summary

There is no traditional app-owned REST API layer in this repo beyond the Supabase Edge Function `copilot`. The main application API surface is:

- Supabase RPC functions exposed from `supabase/migrations/*.sql`
- direct browser reads against Supabase tables
- Supabase Auth client calls from the browser

That means the "API inventory" for Stockd is mostly an inventory of RPCs and direct data-access patterns.

## 1. Browser auth/platform calls

| Call | Method / transport | Purpose | Request / response shape | Auth | Implementation / callers | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| `sb.auth.getSession()` | Supabase Auth client | Determine whether a browser session exists | No app payload; returns session object or null | Public, session-aware | `Frontend/index.html`, `Frontend/js/supabase-client.js` | Ready |
| `sb.auth.signInWithPassword({ email, password })` | Supabase Auth client | Email/password login | `{ email, password }` -> session or auth error | Public | `Frontend/login.html`, `kiosk/kiosk.js` | Ready for demo scope |
| `sb.auth.signOut()` | Supabase Auth client | End current session | No app payload | Authenticated session | `Frontend/js/supabase-client.js`, `Frontend/pages/sales-analysis.html` | Ready |

## 2. Edge Function API

| Endpoint | Method | Purpose | Request shape | Response shape | Auth | Implementation / callers | Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `copilot` (`/functions/v1/copilot`) | `POST` | Copilot chat, pricing insights, and confirmation-required inventory writes | `{ mode: "chat" \| "pricing_insights", message, context?, confirm?, pending_action? }` | `{ ok, mode, reply, data?, meta? }` or structured error | Works best with signed-in bearer token; can distinguish anonymous vs authenticated | `supabase/functions/copilot/index.ts`; called by `Frontend/js/ai-client.js` | Partial. Strongest custom API in repo, but still scoped to Copilot use cases only. |

Notes:

- Write operations through Copilot are not immediate. `receive_inventory` and `count_inventory` first return a signed pending action. Evidence: `supabase/functions/copilot/tool-dispatch.ts`, `pending-actions.ts`.
- Pricing insights are advisory output only. No pricing write path exists.

## 3. Onboarding and sales-ingest RPCs

| RPC | Purpose | Request shape | Response shape | Auth | Implementation / callers | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| `get_onboarding_status` | Return current onboarding state from `app_config` | none | onboarding JSON such as `setup_complete`, `history_uploaded`, date range | Authenticated | `supabase/migrations/20260207000300_onboarding_and_bulk_close.sql`; called by `Frontend/index.html`, `Frontend/pages/onboarding.html`, `Frontend/js/supabase-client.js` | Partial. Works, but global rather than tenant-specific. |
| `complete_onboarding_ingest` | Mark historical ingest complete and persist date range / row count | none | `{ status, start_date, end_date, rows }` | Authenticated | Same migration; called by `Frontend/pages/onboarding.html` | Ready for demo scope |
| `run_bulk_close` | Consume all historical sales dates not yet closed | none | `{ status, dates_processed, total_consume_txns }` | Authenticated | Same migration; called by `Frontend/pages/onboarding.html`, `scripts/setup-all.js`, `scripts/seed-bom.js` | Ready for demo scope; expensive on large datasets |
| `ingest_daily_sales` | Batch ingest daily aggregated sales rows and auto-create menu items | `{ p_rows: [{ business_date, menu_item_name, category, qty, net_sales, source }] }` | `{ status, rows_processed, menu_items_created }` | Authenticated | `supabase/migrations/20260207000200_consumption_engine.sql`; called by `Frontend/js/csv-parser.js`, onboarding/daily upload, scripts | Ready |
| `run_daily_close` | Consume one business day of sales into ingredient usage | `{ p_business_date }` | `{ status, business_date, consume_txns_created, ingredients_updated }` or `skipped` / `no_data` | Authenticated | Same migration; called by `Frontend/pages/upload.html`, tests | Ready |
| `reverse_daily_close` | Undo one business day close | `{ p_business_date }` | `{ status, business_date, txns_reversed }` | Authenticated | Same migration; used in tests and maintenance workflows | Internal/admin utility |

## 4. Inventory and forecast RPCs

| RPC | Purpose | Request shape | Response shape | Auth | Implementation / callers | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| `get_inventory_snapshot` | Return current ingredient state with usage, days of supply, reorder signals | none | array of `{ ingredient_id, name, unit, reorder_point, lead_time_days, unit_cost, qty_on_hand, avg_daily_usage, days_of_supply, days_to_reorder, status }` | Authenticated | `supabase/migrations/20260207000600_smart_snapshot_window.sql`; called by dashboard and Copilot | Ready |
| `receive_inventory` | Increase on-hand and record `RECEIVE` txn | `{ p_ingredient_id, p_qty, p_note? }` | `{ status, ingredient_id, qty_received, new_qty_on_hand }` or `{ status: "error", message }` | Authenticated | `supabase/migrations/20260207000400_inventory_ops.sql`; called by Receive page and Copilot | Ready |
| `count_inventory` | Set on-hand to actual count and record `COUNT` delta | `{ p_ingredient_id, p_actual_qty }` | `{ status, ingredient_id, previous_qty, actual_qty, delta, new_qty_on_hand }` or error | Authenticated | Same migration; called by Count page and Copilot | Ready |
| `generate_forecast` | Generate forecast rows into `forecast_items` and `forecast_ingredients` | `{ p_days_ahead?, p_reference_date? }` | `{ status, reference_date, days_forecasted, item_forecasts, ingredient_forecasts }` | Authenticated | `supabase/migrations/20260207000500_forecasting_v1.sql`; called by scripts/tests | Internal/admin utility |
| `get_forecast` | Return next 7 days of ingredient forecast rows with shortfall | `{ p_reference_date? }` | array of `{ forecast_date, ingredient_id, name, unit, qty_needed, qty_on_hand, shortfall }` | Authenticated | Same migration; called by Dashboard and Copilot | Partial. Backend shape is sound, but main dashboard expects a different shape. |

## 5. Analytics and order-level RPCs

| RPC | Purpose | Request shape | Response shape | Auth | Implementation / callers | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| `ingest_daily_orders` | Upsert order-level rows into `daily_orders` | `{ p_rows: [{ business_date, order_id, opened_at?, closed_at?, num_guests?, server_name?, dining_area?, service_period?, dining_option?, order_source?, discount_amount?, subtotal?, tax?, tip?, gratuity?, total?, voided? }] }` | `{ status, rows_processed }` | Authenticated | `supabase/migrations/20260207000700_daily_orders_and_analytics.sql`; called by scripts/tests | Ready |
| `get_daily_analytics` | Return a full daily analytics bundle, optionally for latest date | `{ p_business_date? }` | object containing summary metrics plus `by_service_period`, `by_dining_option`, `by_order_source`, `by_hour`, `by_server` | Authenticated | `supabase/migrations/20260207000710_fix_analytics_no_data.sql`; called by Copilot/scripts/tests | Ready |
| `get_revenue_trend` | Return recent daily revenue trend rows | `{ p_days? }` | array of `{ business_date, orders, revenue, avg_order_value, guests, tips, discounts }` | Authenticated | `supabase/migrations/20260207000700_daily_orders_and_analytics.sql`; called by Copilot/scripts/tests; frontend currently uses direct table reads instead | Ready |
| `register_order` | Insert/update one order, increment sales aggregates, and consume inventory | `{ p_order_raw }` where `p_order_raw` is JSON text containing order metadata and `items[]` | `{ status, order_id, business_date, items_processed, menu_items_created, ingredients_consumed }` or `{ status: "duplicate" ... }` or `{ status: "error" ... }` | Authenticated | `supabase/migrations/20260207000900_register_order_rpc.sql`; called by `kiosk/kiosk.js`, tests, manual scripts | Partial. Strong demo/live-order primitive, but built around kiosk assumptions and no real menu pricing model. |

## 6. Admin/master-data RPCs

| RPC | Purpose | Request shape | Response shape | Auth | Implementation / callers | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| `upsert_menu_item` | Create or update a menu item | `{ p_id?, p_name, p_category?, p_active? }` | success/error JSON with item id/name | Authenticated | `supabase/migrations/20260207000800_admin_crud_rpcs.sql`; tests only in current repo | Backend-ready, frontend-missing |
| `deactivate_menu_item` | Soft deactivate menu item | `{ p_id }` | success/error JSON | Authenticated | Same file; tests only | Backend-ready, frontend-missing |
| `upsert_ingredient` | Create or update ingredient metadata | `{ p_id?, p_name, p_unit?, p_reorder_point?, p_lead_time_days?, p_unit_cost? }` | success/error JSON | Authenticated | Same file; tests only | Backend-ready, frontend-missing |
| `upsert_bom_entry` | Create/update one BOM row | `{ p_menu_item_id, p_ingredient_id, p_qty_per_item }` | success/error JSON | Authenticated | Same file; tests only | Backend-ready, frontend-missing |
| `delete_bom_entry` | Delete one BOM row | `{ p_menu_item_id, p_ingredient_id }` | success/error JSON | Authenticated | Same file; tests only | Backend-ready, frontend-missing |
| `get_bom_for_item` | Read BOM details and cost for one menu item | `{ p_menu_item_id }` | `{ status, menu_item_id, menu_item_name, ingredients[], total_cost }` | Authenticated | Same file; called by Copilot and tests | Ready |

## 7. Direct browser table access patterns

These are not app-owned API endpoints, but they are part of the current runtime contract because the browser calls them directly.

| Table access | Methods | Used by | Purpose | Readiness / risk |
| --- | --- | --- | --- | --- |
| `menu_items` | `select`, count | Dashboard, Receive, Kiosk | menu counts, ingredient linking, active menu load | Partial. Works, but there is no typed service layer and no price field. |
| `ingredients` | `select` | Receive, Count, invoice matching | dropdowns and ingredient metadata | Ready for demo scope |
| `inventory_on_hand` | `select`, `upsert` in scripts/tests | Receive, Count | current stock lookup | Partial. Raw browser reads will complicate future permission design. |
| `inventory_txns` | `select` | Receive, Count | recent receives / counts history | Partial. UI pages currently mix these reads with demo rows. |
| `sales_line_items` | `select` | Dashboard, Sales Analysis, Upload | trends, categories, top sellers, recent sales days | Partial. Some screens compensate for schema/data issues with their own frontend logic. |
| `daily_orders` | `select` | Sales Analysis, scripts/tests | recent daily sales, traffic pattern source | Partial to risky. `sales-analysis.html` queries columns that do not exist. |

## 8. Internal Copilot data tools

These are not user-facing endpoints, but they define what the AI layer can actually do:

- `get_inventory_snapshot`
- `get_forecast`
- `get_daily_analytics`
- `get_revenue_trend`
- `get_top_selling_items`
- `predict_revenue`
- `get_bom_for_item`
- `search_ingredient`
- `search_menu_item`
- `receive_inventory` (pending action)
- `count_inventory` (pending action)

Implementation: `supabase/functions/copilot/tool-registry.ts`, `supabase/functions/copilot/tools/*.ts`.

## API readiness assessment

Most reusable APIs today:

- `ingest_daily_sales`
- `run_daily_close`
- `get_inventory_snapshot`
- `receive_inventory`
- `count_inventory`
- `ingest_daily_orders`
- `get_daily_analytics`
- `get_revenue_trend`
- `get_bom_for_item`

Most misleading or unstable contracts:

- `get_forecast` as consumed by the dashboard
- direct `daily_orders` access in `Frontend/pages/sales-analysis.html`
- any UI behavior that silently falls back to mock/demo data

Biggest API gap:

- there is no stable service boundary between frontend screens and Supabase tables/RPCs; the frontend currently owns too much of the data-shaping logic.

