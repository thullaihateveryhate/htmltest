# Stockd Frontend Analysis

## Frontend summary

The Stockd frontend is a static multi-page HTML/CSS/JavaScript application in `Frontend/`. There is no SPA router, no framework component model, and no centralized state store. Each screen owns most of its own logic inline, while a few shared helpers in `Frontend/js/` provide Supabase access, CSV parsing, Copilot transport, and invoice parsing/matching.

This frontend is visually polished and demo-friendly, but it is also where the biggest backend-contract drift currently shows up.

## Route and page inventory

| Page | Purpose | Main data dependencies | Assessment |
| --- | --- | --- | --- |
| `Frontend/index.html` | Session gate and initial router | `sb.auth.getSession()`, `get_onboarding_status()` | Simple and effective entrypoint. |
| `Frontend/landing.html` | Marketing page | None | Purely static marketing/demo surface. |
| `Frontend/login.html` | Email/password login | `sb.auth.signInWithPassword()` | Works as a basic auth screen, but demo credentials shown in UI do not match `scripts/setup-auth-user.js`. |
| `Frontend/pages/onboarding.html` | First-time historical sales upload | `ingest_daily_sales`, `complete_onboarding_ingest`, `run_bulk_close`, `get_onboarding_status` | Strongest end-to-end workflow in the UI. |
| `Frontend/pages/upload.html` | Daily sales upload | `ingest_daily_sales`, `run_daily_close`, direct `sales_line_items` reads | Operationally useful, but it is not linked from the main app nav. |
| `Frontend/pages/dashboard.html` | Main KPI, charts, alerts, forecast/inventory view | `get_inventory_snapshot`, `get_forecast`, direct `sales_line_items` and `menu_items` reads | Visually polished, but forecast contract mismatch forces mock data fallback. |
| `Frontend/pages/sales-analysis.html` | Pricing recs, top sellers, recent sales, traffic patterns | direct `sales_line_items` reads, direct `daily_orders` reads, Copilot pricing endpoint | Mixed maturity: some real data, some heuristic AI, some demo-only fallbacks. |
| `Frontend/pages/receive.html` | Receive stock by manual entry or invoice | `ingredients`, `inventory_on_hand`, `inventory_txns`, `receive_inventory` | Core workflow exists, but recent receipts panel falls back to hardcoded demo data when empty. |
| `Frontend/pages/count.html` | Physical counts and history | `ingredients`, `inventory_on_hand`, `inventory_txns`, `count_inventory` | Core workflow exists, but the page intentionally mixes demo rows into count history and metrics. |

Separate but related:

- `kiosk/index.html` and `kiosk/kiosk.js` form a standalone kiosk app, not part of the main `Frontend/` flow.

## Navigation and routing behavior

The app uses file-based navigation with hardcoded `window.location.href` changes. There is no client-side router.

Current route flow:

1. `Frontend/index.html` checks session state.
2. If no session, user is redirected to `Frontend/landing.html`.
3. From `landing.html`, the CTA sends users to `Frontend/login.html`.
4. After login, `routeByOnboarding()` in `Frontend/js/supabase-client.js` chooses:
   - `Frontend/pages/onboarding.html` when setup is incomplete
   - `Frontend/pages/dashboard.html` when setup is complete

Operational nav gaps:

- Main top nav only exposes Dashboard, Sales Analysis, Receive, and Count.
- `Frontend/pages/upload.html` exists but is not reachable from the main app nav.
- There is no admin/settings/BOM management screen despite backend admin RPCs existing.

## Reusable frontend building blocks

### Shared JS

| File | Role | Notes |
| --- | --- | --- |
| `Frontend/js/supabase-client.js` | Initializes `sb`, auth helpers, simple toast helper | Core shared runtime. |
| `Frontend/js/csv-parser.js` | Parses Toast CSV and batches RPC ingestion | Used by onboarding and daily upload. |
| `Frontend/js/ai-client.js` | Browser transport for the Copilot Edge Function | Supports `chat`, `pricing_insights`, and confirmation of pending actions. |
| `Frontend/js/ai-copilot.js` | Floating Copilot panel UI | Trigger button is only shown automatically on dashboard, but pages with a Copilot button can still open the panel. |
| `Frontend/js/animated-counter.js` | KPI animation helpers | Presentation-focused utility. |
| `Frontend/js/invoice-matcher.js` | Client-side ingredient lookup and invoice matching | Uses browser-side PDF parsing and fuzzy name matching. |
| `Frontend/js/usfoodsPdfParser.js` | Browser ES module PDF parsing | Used from `receive.html`. |
| `Frontend/js/usfoodsPdfParser.mjs` | Near-duplicate module variant | Looks like a second version kept around; likely cleanup candidate. |

### Shared CSS

| File | Role |
| --- | --- |
| `Frontend/css/app-light.css` | Main app design system and page styling |
| `Frontend/css/app.css` | Entry/loading page styling |
| `Frontend/css/landing.css` | Marketing page styling |

## State management

State is page-local and imperative. Common patterns:

- top-level `let` variables inside page `<script>` tags
- DOM-first rendering, usually by setting `innerHTML`
- global `sb` and `window.stockdAIClient`
- no caching layer, query library, or shared store

Examples:

- `Frontend/pages/dashboard.html` stores no shared state beyond local arrays returned by fetch helpers.
- `Frontend/pages/sales-analysis.html` keeps `salesData`, `orderData`, and `selectedDay` as page globals.
- `Frontend/pages/count.html` keeps global `ingredients`, `allCountData`, `currentSystemQty`, `currentUnit`, and filter state.

This keeps the app simple, but it also means:

- repeated query logic across pages
- no contract enforcement between frontend and backend
- no type checking across the page scripts

## Data fetching and backend boundaries

The frontend talks directly to Supabase from the browser using both RPCs and raw table reads.

### RPC-heavy flows

- Onboarding: `ingest_daily_sales`, `complete_onboarding_ingest`, `run_bulk_close`
- Daily upload: `ingest_daily_sales`, `run_daily_close`
- Dashboard: `get_inventory_snapshot`, `get_forecast`
- Receive: `receive_inventory`
- Count: `count_inventory`

### Direct table-select flows

- `menu_items`
- `ingredients`
- `inventory_on_hand`
- `inventory_txns`
- `sales_line_items`
- `daily_orders`

This is the main frontend/backend boundary issue in the repo:

- some screens use the backend's RPC layer
- other screens reach directly into raw tables
- several screens synthesize fallback data when the raw data shape or contents do not match expectations

## Charts, tables, and forms

### Dashboard

- Revenue trend line chart: Chart.js
- Sales by category doughnut: Chart.js
- Forecast/inventory tabular views: custom table rendering
- Inventory health chart: custom Chart.js doughnut
- Suggested restocks / alerts: custom DOM rendering

### Sales Analysis

- Traffic patterns: custom DOM bar chart
- Popular items, pricing recommendations, recent sales: custom card/list rendering

### Receive

- Manual receive form with current on-hand lookup
- Invoice upload form with match-review table and checkbox confirmation
- Recent receipts table

### Count

- Physical count form with live delta preview
- Count history table with filter buttons
- Summary metric cards

## Current UX flow

### Best-supported path

The cleanest current user story is:

1. Log in.
2. Upload historical Toast data during onboarding.
3. Reach the dashboard and see generated inventory/alert state.
4. Use Receive and Count to keep inventory current.
5. Ask Copilot read questions or prepare inventory changes.

This path lines up well with the backend RPCs and demo scripts.

### Less-supported path

The weaker path is the "advanced analytics / dynamic pricing / traffic intelligence" story:

- Sales Analysis mixes live queries, heuristic rules, and demo-generated data.
- Dashboard forecast visualization is not aligned with the actual forecast RPC output.
- Daily upload exists but is not part of the main app journey.

## Frontend pages in detail

### `Frontend/login.html`

Strengths:

- straightforward email/password auth
- good presentation for a demo login screen

Gaps:

- contains a `doSignUp()` function but the page currently behaves like sign-in only
- demo credentials shown in the UI are `demo@user.pizza` / `admin`
- setup script creates `demo@tonys.pizza` / `TonysPizza2026!` instead

### `Frontend/pages/onboarding.html`

Strengths:

- strongest complete flow in the frontend
- good separation between parse preview, upload progress, and finalization
- correctly chains ingest -> onboarding state -> bulk close

Gaps:

- assumes only one global onboarding state in `app_config`
- no organization, restaurant, or menu/BOM setup steps in the UI

### `Frontend/pages/dashboard.html`

Strengths:

- most polished screen visually
- inventory snapshot RPC is used correctly
- data loading is parallelized

Critical gap:

- `fetchForecast()` calls `get_forecast()`, but the page expects `forecastData.menu_items` and `forecastData.daily_revenue`
- the backend `get_forecast()` only returns ingredient-level rows
- result: the page falls back to `generateMockForecast()` and shows synthetic menu/revenue forecast content

This makes the screen look complete, but part of the forecast story is currently presentation-only.

### `Frontend/pages/sales-analysis.html`

Strengths:

- good visual presentation
- pricing insights do attempt to use the Copilot endpoint first
- recent daily sales display intentionally works around polluted demo/test dates

Critical gaps:

- traffic-pattern loader queries `daily_orders.order_time` and `daily_orders.order_hour`, but the schema defines `opened_at` and `closed_at` instead
- if no data or query failure occurs, the page silently generates its own demo traffic data
- top sellers also fall back to hardcoded demo pizza items
- pricing recommendations are advisory only; no persisted pricing model exists

### `Frontend/pages/receive.html`

Strengths:

- invoice review flow is conceptually strong
- manual receive path is solid and uses the backend RPC correctly
- good operator-friendly UX

Gaps:

- invoice parsing and matching happen entirely in the browser
- no persisted invoice/vendor entity exists
- "Recent Receipts" falls back to hardcoded demo rows when there are no real rows

### `Frontend/pages/count.html`

Strengths:

- `count_inventory()` integration is correct
- live delta preview is useful
- count form is operator-friendly

Critical gaps:

- the page always appends demo count rows to real history
- summary metrics also combine real rows with demo rows
- displayed accuracy is hardcoded to `97.3%` for presentation

This means the page is not a reliable operator view yet, even if the underlying count RPC is real.

### `Frontend/pages/upload.html`

Strengths:

- operationally useful daily upload flow
- reuses shared CSV parsing and batching
- correctly runs `run_daily_close()` per date after ingest

Gaps:

- hidden from the main product navigation
- feels like an internal/demo utility rather than a finished primary workflow

## Dead code, placeholder behavior, and unfinished UI

Evidence-backed problem areas:

- Forecast placeholder path in dashboard: `generateMockForecast()` in `Frontend/pages/dashboard.html`
- Traffic demo generator in Sales Analysis: `generateDemoData()` in `Frontend/pages/sales-analysis.html`
- Hardcoded demo top sellers in Sales Analysis: `demoItems` in `Frontend/pages/sales-analysis.html`
- Forced demo receipt history in Receive: `getDemoReceiptsData()` and the empty-state fallback in `Frontend/pages/receive.html`
- Forced demo count history and metrics in Count: `getDemoCountData()` and combination logic in `Frontend/pages/count.html`
- Duplicate parser artifact: `Frontend/js/usfoodsPdfParser.js` and `Frontend/js/usfoodsPdfParser.mjs`
- Unused signup path in Login: `doSignUp()` in `Frontend/login.html`

## What looks polished vs incomplete

### Polished

- general visual design system
- landing page and login page
- onboarding import experience
- dashboard layout and visual hierarchy
- receive/count forms
- Copilot chat panel UX

### Incomplete or risky

- dashboard forecast contract
- sales-analysis traffic and pricing maturity
- hidden daily-upload workflow
- no admin/master-data UI for ingredients, menu items, or BOM
- no explicit reports/export UI
- no settings/org management UI
- no reliable distinction between demo state and real state in operator screens

## Frontend strengths

- Fast to inspect and easy to run because it is plain static HTML/JS.
- Most core screens are understandable without a build pipeline.
- Shared Copilot and CSV utilities are lightweight and reusable.
- The visual design is good enough for demos and stakeholder walkthroughs.

## Frontend risks

- Inline scripts make reuse and correctness harder as requirements grow.
- No type safety between browser code and RPC response shapes.
- Demo fallbacks can hide real regressions.
- Direct browser reads from raw tables make future permission/tenant changes harder.

## Recommended next steps

1. Remove or clearly label forced demo data in Dashboard, Sales Analysis, Receive, and Count.
2. Replace direct raw-table reads with stable RPCs or a thin typed API layer where possible.
3. Fix the forecast and traffic contracts before adding new frontend requirements.
4. Decide whether `upload.html` should be promoted into the main nav or folded into another workflow.
5. Add admin screens only after the data contracts are stabilized.

