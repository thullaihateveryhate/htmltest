# Stockd Feature Map

## Status legend

- `Fully implemented`: end-to-end capability exists in the current repo and is backed by real code paths.
- `Partially implemented`: important backend or frontend pieces exist, but the feature is incomplete, demo-dependent, or missing a stable contract.
- `Stubbed / placeholder`: there is visible UI or helper logic, but it is mostly presentation/advisory and not a real end-to-end system.
- `Missing but implied`: product copy or schema hints suggest the feature should exist, but it does not currently exist as a first-class implementation.

## Current feature inventory

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Landing / marketing site | Fully implemented | `Frontend/landing.html`, `Frontend/css/landing.css` | Static but polished. |
| Auth / login | Partially implemented | `Frontend/login.html`, `Frontend/js/supabase-client.js` | Sign-in works, but there is no real role/org model and demo credentials are inconsistent. |
| Session gating and onboarding routing | Fully implemented | `Frontend/index.html`, `Frontend/js/supabase-client.js`, `get_onboarding_status` RPC | Clean entry flow. |
| Historical sales onboarding | Fully implemented | `Frontend/pages/onboarding.html`, `Frontend/js/csv-parser.js`, onboarding RPCs | Strongest operator workflow in the repo. |
| Daily sales upload | Partially implemented | `Frontend/pages/upload.html` | Works technically, but it is hidden from the main nav. |
| Inventory tracking | Partially implemented | `get_inventory_snapshot`, `inventory_on_hand`, `inventory_txns`, Dashboard | Core backend exists, but UI mixes real and demo views. |
| Receive stock | Partially implemented | `Frontend/pages/receive.html`, `receive_inventory` RPC | Manual receive is real. Invoice flow works as a browser-side helper, not a persisted purchasing system. |
| Physical counts | Partially implemented | `Frontend/pages/count.html`, `count_inventory` RPC | Backend is real; page history/metrics are demo-inflated. |
| Waste / spoilage tracking | Missing but implied | Marketing in `DEVPOST.md`; no waste table or RPCs | Could only be inferred indirectly from count deltas today. |
| Menu and ingredient master data | Partially implemented | Admin CRUD RPCs in `20260207000800_admin_crud_rpcs.sql` | Backend exists; no admin UI. |
| BOM / recipe management | Partially implemented | `bom` table, `get_bom_for_item`, `upsert_bom_entry`, `delete_bom_entry` | Backend exists; no UI workflow. |
| Sales ingestion from CSV | Fully implemented | `ingest_daily_sales`, onboarding/upload pages, `scripts/ingest-test-data.js` | Good core capability. |
| Live order registration | Partially implemented | `register_order`, `kiosk/kiosk.js` | Works for demo kiosk path, but pricing model and deployment scope are unclear. |
| Dashboard KPIs and charts | Partially implemented | `Frontend/pages/dashboard.html` | Good presentation, but some metrics/forecast visuals are synthetic or contract-mismatched. |
| Order-level analytics | Partially implemented | `daily_orders`, `get_daily_analytics`, `get_revenue_trend`, scripts/tests | Backend is useful; frontend only partially uses it correctly. |
| Traffic pattern analysis | Stubbed / placeholder | `Frontend/pages/sales-analysis.html` | Current page queries nonexistent fields and falls back to generated demo data. |
| Forecasting | Partially implemented | `generate_forecast`, `get_forecast`, forecast tables | Ingredient forecast backend is real. Main dashboard visualization is not aligned to it. |
| AI Copilot chat | Partially implemented | `Frontend/js/ai-copilot.js`, `supabase/functions/copilot/` | Real chat and data tools exist, but scope is read-heavy and operationally narrow. |
| Copilot inventory writes | Partially implemented | `receive_inventory` and `count_inventory` pending actions | Strong confirmation design; only two writes supported. |
| Dynamic pricing recommendations | Stubbed / placeholder | `Frontend/pages/sales-analysis.html`, `pricing_insights` mode | Advisory only. No persisted menu pricing model or price update flow. |
| Alerts and suggested actions | Partially implemented | Dashboard alert banner and suggested orders | Derived at render time; no persisted alert engine or notification system. |
| Reports / exports | Missing but implied | Product story in `DEVPOST.md`, data exists in tables/RPCs | No dedicated reporting UI or export mechanism. |
| Admin / settings | Missing but implied | No settings pages in `Frontend/pages/` | Only onboarding config exists via `app_config`. |
| Demo seed data and walkthrough support | Fully implemented | `scripts/setup-all.js`, `scripts/seed-bom.js`, `scripts/generate-daily-orders.js`, demo-date refresh migration | Repo is heavily optimized for demo setup. |
| Kiosk sidecar | Partially implemented | `kiosk/` | Functional demo app, but hardcoded credentials and deploy mismatch make it non-production. |
| ElevenLabs TTS utility | Stubbed / placeholder | `Elevenlabs/` | Exists as a standalone module, but is not integrated into Stockd flows. |

## Strongly implemented features worth reusing

- historical sales ingestion
- BOM-driven inventory consumption
- inventory receive/count RPCs
- inventory snapshot logic
- order analytics RPCs
- Copilot pending-action pattern
- test scaffolding around backend RPCs

## Features that look stronger in demos than in code

- dashboard forecasting
- traffic surge analysis
- dynamic pricing
- "live" analytics when the data source is missing or stale

## Recommended next steps

1. Treat the "Partially implemented" rows as the core backlog, because many already have reusable backend pieces.
2. Avoid building on top of the "Stubbed / placeholder" features until their real data model is decided.
3. Use the "Missing but implied" rows to scope future requirements carefully instead of assuming they already exist.

