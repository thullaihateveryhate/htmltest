# Stockd Executive Summary

Stockd is currently a Supabase-backed restaurant operations demo centered on one pizza restaurant dataset. The repo already supports historical sales ingestion, BOM-driven ingredient consumption, on-hand inventory tracking, manual receive/count workflows, order-level analytics, a SQL-based ingredient forecast, and an AI copilot. The working product is split between a static multi-page frontend in `Frontend/`, SQL/RPC backend logic in `supabase/migrations/`, and one Supabase Edge Function in `supabase/functions/copilot/`.

The strongest part of the repo is the data backbone. The Postgres RPC layer covers the core operational loop well: ingest sales, translate sales into ingredient consumption, maintain current stock, adjust stock with receives and counts, and expose analytics and forecast data. The test suite in `tests/` exercises most of that backend surface area. The frontend is also visually polished and demo-friendly.

The biggest weakness is that the product story is ahead of the implementation. Marketing docs in `DEVPOST.md` and `PITCH.md` claim ML forecasting, dynamic pricing, multi-tenant security, and broader operations support than the code actually delivers. Several UI screens mix live data with forced demo/mock data, and some frontend queries no longer match the current schema. The clearest examples are `Frontend/pages/dashboard.html` expecting forecast fields that `get_forecast()` does not return, and `Frontend/pages/sales-analysis.html` querying `daily_orders.order_time` / `order_hour`, which do not exist in the schema.

Overall maturity looks like "strong hackathon prototype / demo app" rather than "production-ready SaaS". The backend logic is reusable, but the frontend-backend contracts, security model, deployment documentation, and day-to-day operator workflows need hardening before requirements implementation can proceed safely.

The first next steps should be:

1. Align the frontend with the actual backend contracts and remove forced demo fallbacks where they hide real behavior.
2. Decide the real product scope: single-restaurant demo, multi-tenant SaaS, or hybrid.
3. Add missing operational foundations: tenant isolation, admin/BOM management UI, and a reliable local/dev runbook.
4. Only after that, layer in new requirements such as better forecasting, true pricing logic, waste tracking, and reporting.

