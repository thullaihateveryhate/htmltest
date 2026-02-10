# Frontend Developer — Current Tasks

## Project Status (Updated Feb 8, 2026)

- **Module 0** (Repo + Setup): DONE
- **Module 1** (Supabase Schema): DONE — 9 tables, 2 enums live in cloud
- **Module 2** (Ingestion): Backend RPCs DONE — onboarding + daily ingest + bulk close all live
- **Module 3** (Consumption Engine): DONE — daily close, reverse, snapshot RPCs all live
- **Module 4** (Inventory Ops): Backend RPCs DONE — `receive_inventory` + `count_inventory` live
- **Module 6** (Forecasting v1): Backend RPCs DONE — `generate_forecast` + `get_forecast` live
- **BOM**: Fully seeded — 32 ingredients, 675 recipe links across all 95 menu items
- **Backend test suite**: 75/75 tests passing (includes register_order + forecasting end-to-end)
- **Live orders API**: `register_order` verified end-to-end (API call → sales_line_items → inventory consumption → forecast)
- **Production data**: 25,396 sales rows (2025-01-01 to 2026-02-08), 95 menu items, 32 ingredients, 675 BOM entries, ~24K consume txns, 2,525 item forecasts, 926 ingredient forecasts, 21,873 daily orders
- **Setup script**: `node scripts/setup-all.js` — single command runs the full pipeline

### All Backend Modules COMPLETE — Frontend is the bottleneck now.

---

## What You Need to Build

### 1. Landing Page / Onboarding Flow (PRIORITY)

The app uses `sales_line_items` as the **single source of truth**. On first launch, the user must upload their full sales history. After that, daily uploads are incremental.

**Routing logic (on every app load):**
```js
const { data } = await supabase.rpc('get_onboarding_status');
if (!data.setup_complete) {
  // Show LANDING PAGE (onboarding)
} else {
  // Show MAIN DASHBOARD
}
```

**Landing Page steps:**
1. Welcome message: "Upload your sales history to get started"
2. File input for the history CSV (Toast ItemSelectionDetails format)
3. Parse with PapaParse, show preview: date range found, row count, sample items
4. On confirm: call `ingest_daily_sales` RPC with aggregated rows
   - For large files (~48K rows), batch into chunks of ~500 aggregated rows per call
5. Call `complete_onboarding_ingest()` — records the date range in app_config
6. Call `run_bulk_close()` — processes all historical dates (consumption engine)
7. Show progress/success: "X dates processed, Y menu items created"
8. Redirect to main dashboard

**Done when:** first-time user uploads history CSV, system initializes, dashboard loads.

---

### 2. Daily Upload Page (Module 2 — Post-Setup)

- Upload page (shown after setup is complete): file input + "Upload Today's Report"
- Use PapaParse (CDN or npm) to parse CSV in the browser
- Supported formats:
  - Toast `ItemSelectionDetails.csv`
  - Simplified daily file: `business_date, menu_item, qty, net_sales`
- Filter out voided items (`Void? = True`)
- Group by `(business_date, Menu Item)`, sum qty + net_sales
- Call `ingest_daily_sales` RPC with aggregated rows
- After ingest, call `run_daily_close` for the uploaded date(s)
- Show success/error feedback after upload
- Show count of rows processed and new menu items created
- (Optional) After upload, call `generate_forecast()` to refresh forecasts alongside the daily close
- **Done when:** uploading 1 day of Toast CSV creates rows and updates inventory

---

### 3. Inventory Snapshot Dashboard (Module 5)

- Call `get_inventory_snapshot()` RPC on page load
- Render table with columns:
  - Ingredient name
  - Unit
  - On hand (qty)
  - Reorder point
  - Avg daily usage
  - Days of supply
  - Days to reorder
  - Status badge (OK / Reorder Soon / Critical)
- Color-coded status badges: green (ok), yellow (reorder_soon), red (critical)
- Sort by urgency (critical items at top — already sorted by RPC)
- Auto-refresh or manual refresh button
- **Done when:** dashboard renders current inventory and flags low items automatically

**Sample data you'll get back (real production data):**

| Ingredient | On Hand | Unit | Avg/Day | Supply | Status |
|---|---|---|---|---|---|
| Brie Cheese | 2.74 | oz | 3.39 | 0.8 days | critical |
| Alfredo Sauce | 16.01 | oz | 12.04 | 1.3 days | critical |
| Pizza Dough | 2,159.91 | oz | 1,710.86 | 1.3 days | reorder_soon |
| Mozzarella Cheese | 1,033.42 | oz | 855.43 | 1.2 days | critical |

---

### 4. Inventory Ops Pages (Module 4)

Backend RPCs are live and tested.

**Receive Inventory page:**
- Dropdown to select ingredient (fetch from `ingredients` table)
- Input: quantity received
- Input: optional note (e.g. "Sysco delivery")
- Submit calls `receive_inventory` RPC
- Show confirmation with updated qty on hand

**Count Inventory page:**
- Dropdown to select ingredient
- Shows current on-hand qty (fetch from `inventory_on_hand`)
- Input: actual counted qty
- Submit calls `count_inventory` RPC
- Show confirmation with delta and new qty

**Done when:** manager can receive a delivery and correct inventory via physical count.

### 4b. US Foods Invoice Matching (New helper available)

- Backend helper: `getInvoiceMatches(pdfBuffer, supabase)` in `scripts/usfoodsInvoiceMatch.mjs`
- What it does: parses a US Foods PDF, fuzzy-matches invoice lines to `ingredients`, and returns `{ matches, unmatched }` without mutating the DB.
- Match shape:
  - `matches`: [{ ingredientId, ingredientName, ingredientUnit, qtyOrdered, qtyShipped, salesUnit, productNumber, rawLine }]
  - `unmatched`: invoice lines not matched to any ingredient
- How to use (frontend flow):
  1) Upload PDF (File input → `ArrayBuffer`/`Uint8Array`)
  2) Call a tiny API that wraps `getInvoiceMatches(pdfBuffer, supabase)`
  3) Show a confirmation table (ingredient name, qtyShipped/qtyOrdered, unit, product number)
  4) On confirm, call `receive_inventory` per matched line using `ingredientId` and `qtyShipped` (or `qtyOrdered` fallback)
- Existing end-to-end script example: `node scripts/receive-usfoods-invoice.mjs` (does parse + match + receive). Use that as a reference but keep the UI flow “confirm before receive”.

---

### 5. Forecast Page (Module 6) — NEW

Backend RPCs are live and tested. 620 item forecasts + 224 ingredient forecasts already generated.

**Forecast Dashboard:**
- On page load, call `get_forecast()` (defaults to next 7 days from most recent data)
- If you want to re-generate fresh forecasts first: call `generate_forecast()` then `get_forecast()`
- Confirmed: forecasts already reflect API-registered orders (`register_order`) in tests and manual verification
- Render table with columns:
  - Forecast date
  - Ingredient name
  - Qty needed (forecasted)
  - Current on hand
  - Shortfall (negative = need to order)
  - Unit
- Color-code shortfall: red if positive (means we'll run out), green if negative (we have enough)
- Group by date, or group by ingredient — your call on best UX
- **Done when:** user can see "next 7 days ingredient needs" with shortfall alerts

---

### 6. Admin Pages (Module 7) — Lower Priority

CRUD pages for managing the restaurant setup:

**Menu Items page:** list, add, edit, deactivate menu items
**Ingredients page:** list, add, edit ingredients (name, unit, reorder_point, lead_time, cost)
**BOM Builder page:** select menu item, add/edit/remove ingredient rows with qty_per_item

**Done when:** non-technical person can set up a new restaurant's menu and recipes.

---

## Backend RPCs Available (call via `supabase.rpc()`)

### `get_onboarding_status()`

Check if the app has been set up. Call on every app load to decide routing.

```js
const { data, error } = await supabase.rpc('get_onboarding_status');
// Returns: { setup_complete: false, history_uploaded: false,
//            history_start_date: null, history_end_date: null,
//            history_rows_ingested: 0, bulk_close_complete: false }
```

### `ingest_daily_sales(p_rows)`

Batch upserts sales data. Auto-creates missing menu items. Re-uploading the same date+item replaces the values (safe to re-run).

```js
const { data, error } = await supabase.rpc('ingest_daily_sales', {
  p_rows: [
    {
      business_date: '2025-01-01',
      menu_item_name: 'The Hawaiian Pizza (M)',
      category: 'Classic',
      qty: 10,
      net_sales: 132.50,
      source: 'toast'
    }
    // ... more rows
  ]
});
// Returns: { status: 'success', rows_processed: N, menu_items_created: N }
```

### `complete_onboarding_ingest()`

Call after the historical CSV has been fully ingested. Records the date range.

```js
const { data, error } = await supabase.rpc('complete_onboarding_ingest');
// Returns: { status: 'success', start_date: '2025-01-01', end_date: '2025-12-31', rows: 22964 }
```

### `run_bulk_close()`

Processes all historical dates that haven't been consumed yet. Call after `complete_onboarding_ingest`.

```js
const { data, error } = await supabase.rpc('run_bulk_close');
// Returns: { status: 'success', dates_processed: 358, total_consume_txns: 11280 }
```

### `run_daily_close(p_business_date)`

Runs the consumption engine for a single date (post-setup daily use). Idempotent (skips if already run).

```js
const { data, error } = await supabase.rpc('run_daily_close', {
  p_business_date: '2025-12-31'
});
// Returns: { status: 'success', consume_txns_created: N, ingredients_updated: N }
// Or:      { status: 'skipped', reason: 'already_processed' }
// Or:      { status: 'no_data' }
```

### `reverse_daily_close(p_business_date)`

Reverses a daily close (deletes CONSUME txns, restores inventory). For corrections.

```js
const { data, error } = await supabase.rpc('reverse_daily_close', {
  p_business_date: '2025-12-31'
});
// Returns: { status: 'success', txns_reversed: N }
```

### `get_inventory_snapshot()`

Returns all ingredients with current stock, avg daily usage, days of supply, days to reorder, and status. Auto-detects the data window (works with both historical and real-time data). Already sorted by urgency.

```js
const { data, error } = await supabase.rpc('get_inventory_snapshot');
// Returns array:
// [
//   {
//     ingredient_id: 'uuid',
//     name: 'Mozzarella Cheese',
//     unit: 'oz',
//     reorder_point: 150,
//     lead_time_days: 2,
//     unit_cost: 0.22,
//     qty_on_hand: 1033.42,
//     avg_daily_usage: 855.43,
//     days_of_supply: 1.2,
//     days_to_reorder: 1.0,
//     status: 'critical'       // 'ok' | 'reorder_soon' | 'critical' | 'unknown'
//   },
//   ...
// ]
```

### `receive_inventory(p_ingredient_id, p_qty, p_note)`

Receives a delivery. Adds qty to inventory, creates a RECEIVE audit txn. Validates qty > 0. Auto-creates inventory row if none exists.

```js
const { data, error } = await supabase.rpc('receive_inventory', {
  p_ingredient_id: 'uuid-here',
  p_qty: 25,
  p_note: 'Weekly delivery from Sysco'  // optional, can be null
});
// Returns: { status: 'success', ingredient_id: '...', qty_received: 25, new_qty_on_hand: 75 }
// Error:   { status: 'error', message: 'qty must be greater than 0' }
```

### `count_inventory(p_ingredient_id, p_actual_qty)`

Physical count correction. Sets inventory to actual counted qty, computes and records the delta. Validates actual_qty >= 0.

```js
const { data, error } = await supabase.rpc('count_inventory', {
  p_ingredient_id: 'uuid-here',
  p_actual_qty: 85
});
// Returns: { status: 'success', ingredient_id: '...', previous_qty: 100,
//            actual_qty: 85, delta: -15, new_qty_on_hand: 85 }
// Error:   { status: 'error', message: 'actual_qty must be >= 0' }
```

### `generate_forecast(p_days_ahead, p_reference_date)`

Generates item-level and ingredient-level forecasts using rolling day-of-week averages from the last 6 weeks. Idempotent (re-running replaces previous forecast). Converts item forecasts to ingredient needs via BOM.

```js
const { data, error } = await supabase.rpc('generate_forecast', {
  p_days_ahead: 7,                 // default 7
  p_reference_date: '2026-02-08'   // default CURRENT_DATE (uses today's date dynamically in scripts)
});
// Returns: { status: 'success', item_forecasts: 2525, ingredient_forecasts: 926 }
```

### `get_forecast(p_reference_date)`

Returns 7-day ingredient forecast with current stock and shortfall. Call after `generate_forecast`.

```js
const { data, error } = await supabase.rpc('get_forecast', {
  p_reference_date: '2026-02-08'   // default CURRENT_DATE
});
// Returns array:
// [
//   {
//     forecast_date: '2026-02-08',
//     ingredient_id: 'uuid',
//     name: 'Mozzarella Cheese',
//     unit: 'oz',
//     qty_needed: 855.43,
//     qty_on_hand: 1033.42,
//     shortfall: -178.0         // positive = we'll run out, negative = we have enough
//   },
//   ...
// ]
```

---

## Toast CSV Column Mapping

When parsing `Toast_ItemSelectionDetails.csv`, map these columns:

| Toast CSV Column | Maps To | Notes |
|---|---|---|
| `Order Date` | `business_date` | Extract date only from `MM/DD/YYYY HH:MM:SS` |
| `Menu Item` | `menu_item_name` | e.g. "The Hawaiian Pizza (M)" |
| `Sales Category` | `category` | e.g. "Classic", "Veggie", "Chicken" |
| `Net Price` | `net_sales` | Per-item net price |
| `Qty` | `qty` | Usually 1.0 per line |
| `Void?` | (filter) | Skip rows where `Void? = True` |
| (hardcode) | `source` | Use `"toast"` |

### Frontend CSV Processing Steps

1. Parse CSV with PapaParse
2. Filter out rows where `Void?` is `"True"`
3. Extract date from `Order Date` (take the date part: `MM/DD/YYYY`)
4. Group rows by `(business_date, Menu Item)`:
   - Sum `Qty` for total qty
   - Sum `Net Price` for total net_sales
   - Take first `Sales Category` as category
5. Call `supabase.rpc('ingest_daily_sales', { p_rows: aggregatedRows })`
6. Show success/error to user

---

## Database Tables (for reference)

| Table | Key Columns | Rows (current) |
|---|---|---|
| `menu_items` | id, name, category, active | 95 |
| `ingredients` | id, name, unit, reorder_point, lead_time_days, unit_cost | 32 |
| `bom` | menu_item_id, ingredient_id, qty_per_item | 675 |
| **`sales_line_items`** | **id, business_date, menu_item_id, qty, net_sales, source** | **25,396 (2025-01-01 to 2026-02-08)** |
| `inventory_on_hand` | ingredient_id, qty_on_hand, updated_at | 32 |
| `inventory_txns` | id, ingredient_id, txn_type, qty_delta, business_date, created_at, note | ~24,000 |
| `app_config` | key (PK), value (jsonb), updated_at | 1 |
| `forecast_items` | id, forecast_date, menu_item_id, qty | 2,525 |
| `forecast_ingredients` | id, forecast_date, ingredient_id, qty | 926 |
| `daily_orders` | id, business_date, order_id, subtotal, tip, total, ... | 21,873 (synthetic from sales) |

---

## Fetching Dropdown Data

For pages that need ingredient lists (Receive, Count, Admin):

```js
// Get all ingredients for dropdowns
const { data: ingredients } = await supabase
  .from('ingredients')
  .select('id, name, unit')
  .order('name');

// Get current on-hand for a specific ingredient
const { data: onHand } = await supabase
  .from('inventory_on_hand')
  .select('qty_on_hand')
  .eq('ingredient_id', selectedIngredientId)
  .single();

// Get all menu items for admin pages
const { data: menuItems } = await supabase
  .from('menu_items')
  .select('id, name, category, active')
  .order('name');
```

---

## NEW: Order Analytics RPCs (Module 8)

Handles Toast OrderDetails CSV (order-level, not item-level). Gives revenue analytics, service mix, peak hours, server performance.

### `ingest_daily_orders(p_rows)`

Batch upserts order-level data from Toast OrderDetails CSV. Safe to re-upload (upserts by order_id).

```js
const { data, error } = await supabase.rpc('ingest_daily_orders', {
  p_rows: [
    {
      business_date: '2025-12-31',
      order_id: '21278',
      opened_at: '2025-12-31T11:22:31',
      closed_at: '2025-12-31T11:32:31',
      num_guests: 3,
      server_name: 'Sofia',
      dining_area: 'Patio',
      service_period: 'Lunch',
      dining_option: 'Dine In',
      order_source: 'In store',
      discount_amount: 4.42,
      subtotal: 39.83,
      tax: 3.19,
      tip: 4.78,
      gratuity: 0,
      total: 47.80,
      voided: false
    }
  ]
});
// Returns: { status: 'success', rows_processed: 73 }
```

### Toast OrderDetails CSV Column Mapping

| Toast Column | Maps To | Notes |
|---|---|---|
| `Opened` | `business_date` + `opened_at` | Extract date for business_date, full timestamp for opened_at |
| `Closed` | `closed_at` | Full timestamp |
| `Order Id` | `order_id` | Unique per order |
| `# of Guests` | `num_guests` | |
| `Server` | `server_name` | |
| `Dining Area` | `dining_area` | Patio, Front, Bar, etc. |
| `Service` | `service_period` | Lunch, Dinner, Late Night |
| `Dining Options` | `dining_option` | Dine In, Takeout, Delivery |
| `Order Source` | `order_source` | In store, Online |
| `Discount Amount` | `discount_amount` | |
| `Amount` | `subtotal` | Pre-tax amount |
| `Tax` | `tax` | |
| `Tip` | `tip` | |
| `Gratuity` | `gratuity` | |
| `Total` | `total` | |
| `Voided` | `voided` | Skip if True |

### `get_daily_analytics(p_business_date)`

Returns full revenue breakdown for a date. If no date passed, uses most recent date with data.

```js
const { data } = await supabase.rpc('get_daily_analytics', {
  p_business_date: '2025-12-31'  // optional — auto-detects if omitted
});
// Returns:
// {
//   status: 'success',
//   business_date: '2025-12-31',
//   total_orders: 73,
//   total_revenue: 2872.75,
//   avg_order_value: 39.35,
//   total_guests: 124,
//   total_tips: 324.13,
//   total_discounts: 45.78,
//   grand_total: 3536.94,
//   by_service_period: [
//     { period: 'Dinner', orders: 48, revenue: 1849.10 },
//     { period: 'Lunch', orders: 23, revenue: 990.65 }
//   ],
//   by_dining_option: [
//     { option: 'Takeout', orders: 31, revenue: 1128.82 },
//     { option: 'Dine In', orders: 28, revenue: 1336.94 },
//     { option: 'Delivery', orders: 14, revenue: 406.99 }
//   ],
//   by_hour: [ { hour: 11, orders: 3, revenue: 76.58 }, ... ],
//   by_server: [
//     { server: 'Leo', orders: 12, revenue: 607.30, tips: 82.05 }, ...
//   ]
// }
```

### `get_revenue_trend(p_days)`

Returns daily revenue trend for the last N days of data. Auto-detects window.

```js
const { data } = await supabase.rpc('get_revenue_trend', { p_days: 30 });
// Returns array:
// [
//   { business_date: '2025-12-31', orders: 73, revenue: 2872.75,
//     avg_order_value: 39.35, guests: 124, tips: 324.13, discounts: 45.78 }
// ]
```

---

## NEW: ElevenLabs Text-to-Speech Module (Module 9)

**Status**: COMPLETE — Module ready to use

A simple Node.js module for text-to-speech using ElevenLabs API. No server required.

### Module Location
- `Elevenlabs/elevenlabs.js` — Main module
- `Elevenlabs/example.js` — Usage examples
- `Elevenlabs/README.md` — Documentation

### API

```javascript
const elevenlabs = require('./Elevenlabs/elevenlabs');

// Get audio as Buffer
const audioBuffer = await elevenlabs.textToSpeech("Hello world!");

// Save to file
await elevenlabs.textToSpeechFile("Hello world!", "speech.mp3");

// Custom voice
const audio = await elevenlabs.textToSpeech("Hello", {
    voiceId: "21m00Tcm4TlvDq8ikWAM"  // Rachel (default)
});
```

### Configuration
- API key in `.env`: `ELEVENLABS_API_KEY=sk_your_key_here`
- Get API key from https://elevenlabs.io

### Test
```bash
node Elevenlabs/example.js
```

### Available Functions
- `textToSpeech(text, options)` → `Promise<Buffer>`
- `textToSpeechFile(text, outputPath, options)` → `Promise<void>`

### Exports
- `DEFAULT_VOICE_ID` — "21m00Tcm4TlvDq8ikWAM" (Rachel)
- `DEFAULT_MODEL_ID` — "eleven_monolingual_v1"

---

## NEW: Admin CRUD RPCs (Module 7)

Backend RPCs with full validation for managing menu items, ingredients, and BOM recipes.

### `upsert_menu_item(p_id, p_name, p_category, p_active)`

Create or update a menu item. Checks for duplicate names.

```js
// Create new
const { data } = await supabase.rpc('upsert_menu_item', {
  p_name: 'New Special Pizza', p_category: 'Special', p_active: true
});
// Returns: { status: 'success', action: 'created', id: 'uuid', name: '...' }

// Update existing
const { data } = await supabase.rpc('upsert_menu_item', {
  p_id: 'existing-uuid', p_name: 'Renamed Pizza', p_category: 'Classic'
});
// Returns: { status: 'success', action: 'updated', id: 'uuid', name: '...' }
// Errors: { status: 'error', message: 'name is required' | 'already exists' | 'not found' }
```

### `deactivate_menu_item(p_id)`

Soft-deletes a menu item (sets `active = false`).

```js
const { data } = await supabase.rpc('deactivate_menu_item', { p_id: 'uuid' });
// Returns: { status: 'success', id: '...', name: '...', active: false }
```

### `upsert_ingredient(p_id, p_name, p_unit, p_reorder_point, p_lead_time_days, p_unit_cost)`

Create or update an ingredient. Validates all numeric fields >= 0.

```js
const { data } = await supabase.rpc('upsert_ingredient', {
  p_name: 'Goat Cheese', p_unit: 'oz',
  p_reorder_point: 20, p_lead_time_days: 2, p_unit_cost: 0.55
});
// Returns: { status: 'success', action: 'created', id: 'uuid', name: '...' }
```

### `upsert_bom_entry(p_menu_item_id, p_ingredient_id, p_qty_per_item)`

Add or update a recipe ingredient link. Validates both FKs exist and qty > 0.

```js
const { data } = await supabase.rpc('upsert_bom_entry', {
  p_menu_item_id: 'pizza-uuid',
  p_ingredient_id: 'cheese-uuid',
  p_qty_per_item: 4.5
});
// Returns: { status: 'success', menu_item: '...', ingredient: '...', qty_per_item: 4.5 }
```

### `delete_bom_entry(p_menu_item_id, p_ingredient_id)`

Remove an ingredient from a recipe.

```js
const { data } = await supabase.rpc('delete_bom_entry', {
  p_menu_item_id: 'pizza-uuid', p_ingredient_id: 'cheese-uuid'
});
// Returns: { status: 'success', deleted: true }
```

### `get_bom_for_item(p_menu_item_id)`

Returns all ingredients for a menu item, including costs.

```js
const { data } = await supabase.rpc('get_bom_for_item', {
  p_menu_item_id: 'pizza-uuid'
});
// Returns:
// {
//   status: 'success',
//   menu_item_id: '...',
//   menu_item_name: 'The Pepperoni Pizza (S)',
//   total_cost: 2.49,
//   ingredients: [
//     { ingredient_id: '...', ingredient_name: 'Pepperoni', unit: 'oz',
//       qty_per_item: 3, unit_cost: 0.35, cost_per_item: 1.05 },
//     ...
//   ]
// }
```

---

## Auth — Login

A demo user has been created. Use this to sign in:

```js
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'demo@tonys.pizza',
  password: 'TonysPizza2026!'
});
// After this, all RPC calls will work (authenticated session)
```

---

## Supabase Client Setup

```js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'YOUR_SUPABASE_URL',       // from .env or config
  'YOUR_SUPABASE_ANON_KEY'   // from .env or config — use ANON key, not service key
);
```

**Important:** The frontend uses the **anon key** (not the service key). All tables have RLS — the user must be logged in. The RPC functions use `SECURITY DEFINER` so they bypass RLS internally; the frontend just needs a valid auth session.

---

## Priority Order

1. **Login page** (use demo credentials above)
2. **Landing page / onboarding flow** (first-time setup experience)
3. **Dashboard** (call `get_inventory_snapshot()` — all data is live)
4. **Daily upload page** (post-setup incremental uploads — both CSV formats)
5. **Inventory ops pages**: Receive + Count
6. **Forecast page** (call `generate_forecast()` then `get_forecast()`)
7. **Order analytics page** (call `get_daily_analytics()` — revenue breakdowns)
8. Admin pages: Menu + Ingredients + BOM editor (all CRUD RPCs ready)

---

## Notes

- All tables have RLS enabled — requests must use an authenticated Supabase session
- Use vanilla JS and CSS only (no React/Vue/etc.)
- Supabase JS client handles auth tokens automatically after login
- The RPC functions use `SECURITY DEFINER` so they bypass RLS internally
- `sales_line_items` is the single source of truth — everything else derives from it
- `daily_orders` is synthetically generated from `sales_line_items` by `scripts/generate-daily-orders.js`
- All credentials go in `.env` (gitignored) — see `.envexample` for template
- The snapshot RPC auto-detects the data window, so it works with both our historical 2025 data and future real-time data
- **Two CSV formats**: `ItemSelectionDetails` (item-level, feeds consumption engine) and `OrderDetails` (order-level, feeds analytics)
- **Data range**: 2025-01-01 to 2026-02-08 (Jan–Dec 2025 from CSV, Jan–Feb 7 2026 copied from 2025)
- **Forecast scripts now use today's date dynamically** — no more hardcoded reference dates
- Demo auth: `demo@tonys.pizza` / `TonysPizza2026!`

---

## Full Setup (one command)

```bash
node scripts/setup-all.js
```

Runs in order:
1. `ingest-test-data.js` → sales_line_items + menu_items
2. `seed-bom.js` → ingredients + BOM recipes
3. `run-bulk-close.js` → inventory_txns (consumption)
4. `generate-daily-orders.js` → daily_orders (synthetic from sales)
5. `reset-inventory.js` → inventory_on_hand (realistic levels)
6. `generate-forecasts.js` → forecast_items + forecast_ingredients
7. `ingest-order-details.js` → latest-day order details
8. `analytics.js` → verification
