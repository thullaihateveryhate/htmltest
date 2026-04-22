# Stockd Open Questions

## Product scope

1. Is Stockd intended to be a single-restaurant demo, a multi-tenant SaaS product, or a platform template?
   Why this matters: core tables include `org_id`, but current policies do not enforce tenant isolation.

2. Is the kiosk part of the Stockd product, or a separate Tony's Pizza side demo?
   Evidence: `kiosk/` exists, but `vercel.json` deploys `Frontend/`, not `kiosk/`.

3. Should dynamic pricing remain advisory, or is the product meant to actually change menu prices?
   Evidence: there is recommendation logic in `Frontend/pages/sales-analysis.html`, but no price column/history table in the schema.

## Auth and security

4. What is the intended organization/user/role model?
   Evidence: the app uses Supabase Auth, but there are no org/user membership tables and most RLS policies just check `authenticated`.

5. Which demo credentials are correct?
   Evidence: `Frontend/login.html` advertises `demo@user.pizza` / `admin`, while `scripts/setup-auth-user.js` creates `demo@tonys.pizza` / `TonysPizza2026!`.

6. Is the kiosk supposed to ship with hardcoded credentials and project keys?
   Evidence: `kiosk/kiosk.js` hardcodes Supabase URL, anon key, and login credentials.

## Frontend/backend contract questions

7. Should dashboard forecast tabs show ingredient forecast only, or should the backend also provide menu-item and revenue forecast objects?
   Evidence: `Frontend/pages/dashboard.html` expects `menu_items` and `daily_revenue`, but `get_forecast()` returns ingredient rows only.

8. Is the Sales Analysis traffic chart intentionally demo-only right now, or should it be wired to real `daily_orders` data?
   Evidence: the page queries `order_time` / `order_hour`, which do not exist in `daily_orders`.

9. Should Receive and Count pages continue to mix real data with hardcoded demo history?
   Evidence: `Frontend/pages/receive.html` and `Frontend/pages/count.html` deliberately inject demo rows.

10. Is `Frontend/pages/upload.html` meant to be part of the main user journey?
    Evidence: it exists and works, but it is absent from the main top nav.

## Data-model questions

11. Is `org_id` future-facing scaffolding or partially abandoned work?
    Evidence: it exists on several core tables, but not on `daily_orders`, forecast tables, or `app_config`, and current RLS ignores it.

12. Should `daily_orders` remain supplementary analytics data, or become the primary source for live operational analytics?
    Evidence: some frontend views still bypass analytics RPCs and query raw tables directly.

13. How should waste/spoilage be represented?
    Evidence: there is no waste table or `inventory_txn_type = 'WASTE'`, but marketing materials describe waste tracking.

14. Do vendor and invoice records need to be first-class entities?
    Evidence: Receive supports invoice parsing/matching, but there are no vendor, invoice, or purchase-order tables.

15. Is a persisted price model required?
    Evidence: `menu_items` has no price field, kiosk uses a flat hardcoded item price, and pricing recommendations have nowhere to write.

## Backend / operations questions

16. Is `start:backend` supposed to be removed, or is there a missing server component that should still exist?
    Evidence: `package.json` references `Backend/server.js`, but the file is missing.

17. Are `express` and `cors` still intentional dependencies?
    Evidence: they are declared in `package.json`, but no active server uses them.

18. Should demo-date maintenance remain part of the repo?
    Evidence: `20260318192000_refresh_demo_dates_for_demo_day.sql` rewrites dates to keep demo data fresh.

19. Should scripts like `scripts/generate-daily-orders.js` be treated as official data-pipeline tooling?
    Evidence: it deletes all `daily_orders` and re-inserts synthetic records, which is useful for demos but risky for shared environments.

20. What is the official local-development path for Copilot?
    Evidence: the Edge Function code exists, but the repo does not document the intended local serve/setup flow.

## Repo hygiene questions

21. Should `Untitled/` remain in the repository workspace?
    Evidence: it appears to be a duplicate repo snapshot and is ignored in Jest config, but still sits next to the active code.

22. Should both `Frontend/js/usfoodsPdfParser.js` and `Frontend/js/usfoodsPdfParser.mjs` remain?
    Evidence: they are near-duplicate module variants.

23. Is `Elevenlabs/` in scope for Stockd, or is it leftover experimentation?
    Evidence: package dependency and helper module exist, but no current app flow calls it.

24. Are `DEVPOST.md` and `PITCH.md` meant to describe the current implementation, or just the product vision?
    Evidence: both claim Gemini/ML-style forecasting and broader features than the repo currently implements.

## Assumptions used in this discovery package

These docs assume:

- `supabase/migrations/` is the source of truth for backend behavior
- `Frontend/` and `kiosk/` are the current runnable UI surfaces
- `plans_dumpster/` is useful context but not authoritative implementation truth
- `DEVPOST.md` and `PITCH.md` reflect product intent more than exact implementation parity

