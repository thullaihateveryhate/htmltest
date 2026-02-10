# Restaurant Inventory & Forecasting System — Master Plan

> **Project**: UGAHacks 11 — Restaurant Inventory Management + Demand Forecasting
> **Stack**: Supabase (cloud), Vanilla JS + CSS (frontend), PostgreSQL RPCs + Edge Functions (backend)
> **Last Updated**: 2026-02-08

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Module Tracker](#module-tracker)
4. [Module 0 — Repo + Local Setup](#module-0--repo--local-setup)
5. [Module 1 — Supabase Schema](#module-1--supabase-schema)
6. [Module 2 — Ingestion (CSV Upload)](#module-2--ingestion-csv-upload)
7. [Module 3 — Consumption Engine](#module-3--consumption-engine)
8. [Module 4 — Inventory Ops (Receive + Count)](#module-4--inventory-ops-receive--count)
9. [Module 5 — Inventory Snapshot Dashboard](#module-5--inventory-snapshot-dashboard)
10. [Module 6 — Forecasting v1](#module-6--forecasting-v1)
11. [Module 7 — Admin (Menu + BOM Editor)](#module-7--admin-menu--bom-editor)
12. [Module 8 — Order Analytics](#module-8--order-analytics-new)
13. [Module 9 — ElevenLabs Text-to-Speech Integration](#module-9--elevenlabs-text-to-speech-integration)
14. [Team Roles](#team-roles)
13. [Data Model Reference](#data-model-reference)
14. [RPC Reference](#rpc-reference)
15. [Test Data](#test-data)

---

## Project Overview

A web app that lets restaurant managers:
- On first setup, upload full POS sales history to establish the **single source of truth**
- After setup, upload daily POS reports that incrementally update the source of truth
- Automatically compute ingredient consumption from sales via recipes (BOM)
- Track real-time inventory (receive deliveries, count stock)
- Forecast ingredient needs for the next 7 days
- See a dashboard flagging low stock and reorder alerts

### Core Principle: Single Source of Truth

`sales_line_items` is the **single source of truth** for all system behavior.

```
FIRST LAUNCH (Onboarding):
  Landing Page -> Upload Full History CSV -> ingest_daily_sales (bulk)
       -> complete_onboarding_ingest -> run_bulk_close
       -> All historical consumption computed
       -> Inventory baseline established
       -> setup_complete = true -> Redirect to Dashboard

DAILY OPERATION (after setup):
  Dashboard -> Upload Today's Report -> ingest_daily_sales
       -> run_daily_close -> Inventory updated
       -> Dashboard refreshes with new snapshot
       -> Forecast recalculates

EVERYTHING DERIVES FROM sales_line_items:
  sales_line_items  --(BOM join)--> consumption (inventory_txns)
  sales_line_items  --(BOM join)--> inventory_on_hand
  sales_line_items  --(DOW avg)---> forecasting
  sales_line_items  --(aggregation)--> dashboard metrics
```

### Key Requirements

| ID | Requirement | Module | Priority |
|----|-------------|--------|----------|
| R0 | Landing page: first-time setup with historical CSV upload | M2 | Must |
| R1 | Upload Toast CSV and store itemized daily sales | M2 | Must |
| R2 | Define menu items, ingredients, and recipes (BOM) | M1, M7 | Must |
| R3 | Compute daily ingredient usage from sales + BOM | M3 | Must |
| R4 | Receive inventory deliveries and adjust stock | M4 | Must |
| R5 | Physical count corrections to inventory | M4 | Must |
| R6 | Dashboard: on-hand, avg usage, days of supply, alerts | M5 | Must |
| R7 | 7-day ingredient demand forecast (rolling avg by DOW) | M6 | Should |
| R8 | Admin UI to manage menu items, ingredients, recipes | M7 | Should |
| R9 | Auth: login required for all operations | M0 | Must |
| R10 | Idempotent daily close (safe to re-run) | M3 | Must |
| R11 | Reverse daily close for corrections | M3 | Should |
| R12 | Onboarding state tracking (setup_complete, history dates) | M2 | Must |
| R13 | Bulk close: process all historical dates in one call | M3 | Must |
| R14 | Multi-tenant support (future) | -- | Won't (v1) |

---

## Architecture

```
                        +-------------------------------+
                        |     FIRST LAUNCH?             |
                        |  get_onboarding_status()      |
                        +------+----------+-------------+
                               |          |
                          setup_complete   setup_complete
                          = false          = true
                               |          |
                               v          v
                        +-----------+  +------------------+
                        | LANDING   |  | MAIN DASHBOARD   |
                        | PAGE      |  |                  |
                        | Upload    |  | Inventory snap   |
                        | history   |  | Daily upload     |
                        | CSV       |  | Forecast         |
                        +-----------+  +------------------+
                               |          |
                               v          v
                        +-------------------------------+
                        |   Frontend: Vanilla JS + CSS  |
                        |   PapaParse, Supabase Auth    |
                        +-------------------------------+
                                       |
                            supabase-js client
                                       |
                                       v
                        +-------------------------------+
                        |      Supabase Cloud           |
                        |-------------------------------|
                        | PostgreSQL                    |
                        |   SINGLE SOURCE OF TRUTH:     |
                        |   sales_line_items            |
                        |      |                        |
                        |      +--> bom join --> consumption (inventory_txns)
                        |      +--> bom join --> inventory_on_hand
                        |      +--> DOW avg --> forecast
                        |      +--> agg    --> dashboard metrics
                        |                               |
                        |   Config: app_config          |
                        |   Auth: email/password        |
                        +-------------------------------+
```

---

## Module Tracker

| Module | Name | Owner | Backend | Frontend | Notes |
|--------|------|-------|---------|----------|-------|
| **M0** | Repo + Local Setup | DevOps/Lead | DONE | DONE | Supabase linked, CLI working, auth user created |
| **M1** | Supabase Schema | Backend | DONE | n/a | 9 tables, 2 enums, RLS, indexes |
| **M2** | Ingestion (CSV + Orders) | Frontend + Backend | DONE | PENDING | Item-level + order-level RPCs, register_order live orders API validated, onboarding flow |
| **M3** | Consumption Engine | Backend | DONE | n/a | daily close, reverse, bulk close, smart snapshot |
| **M4** | Inventory Ops | Frontend + Backend | DONE | PENDING | receive_inventory + count_inventory RPCs |
| **M5** | Inventory Dashboard | Frontend | DONE | PENDING | get_inventory_snapshot with auto-window detection |
| **M6** | Forecasting v1 | Data/Backend | DONE | PENDING | generate_forecast + get_forecast, DOW rolling avg |
| **M7** | Admin (Menu + BOM) | Frontend + Backend | DONE | PENDING | CRUD RPCs with validation, get_bom_for_item |
| **M8** | Order Analytics | Backend | DONE | PENDING | daily_orders table (21,873 synthetic orders), get_daily_analytics, get_revenue_trend |
| **M9** | ElevenLabs TTS | Integration | DONE | n/a | Simple text-to-speech module using ElevenLabs API |

### Current Focus

```
ALL BACKEND COMPLETE — FRONTEND IS THE BOTTLENECK

 M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8 -> M9
Setup Schema Ingest Consume InvOps Dash Forecast Admin Analytics TTS
DONE  DONE   DONE   DONE    DONE   DONE  DONE    DONE   DONE    DONE
             ^fend  ^fend   ^fend  ^fend ^fend   ^fend  ^fend
```

---

## Module 0 — Repo + Local Setup

**Owner**: DevOps/Lead
**Status**: DONE

### Requirements
- [x] Supabase cloud project created and linked via CLI
- [x] `.envexample` with `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- [x] `.gitignore` with `supabase/.temp`
- [x] Migration workflow: write SQL in `supabase/migrations/`, push with `supabase db push`
- [ ] Frontend served locally (Vite or live-server) — frontend dev
- [ ] Login page visible on clone+run — frontend dev

### Deliverables
- `supabase/` directory with config and migrations
- `.envexample`, `.gitignore`

### Done When
Teammate can clone, install, run, and see a login page.

---

## Module 1 — Supabase Schema

**Owner**: Backend
**Status**: DONE
**Migration**: `20260207000100_init_schema.sql`

### Requirements
- [x] `menu_items` table (id, name, category, active, created_at)
- [x] `ingredients` table (id, name, unit enum, reorder_point, lead_time_days, unit_cost)
- [x] `bom` table (menu_item_id, ingredient_id, qty_per_item; composite PK)
- [x] `sales_line_items` table (id, business_date, menu_item_id, qty, net_sales, source)
- [x] `inventory_on_hand` table (ingredient_id PK, qty_on_hand, updated_at)
- [x] `inventory_txns` table (id, ingredient_id, txn_type enum, qty_delta, created_at, note)
- [x] Enums: `unit_type` (g/oz/lb/each), `inventory_txn_type` (RECEIVE/COUNT/CONSUME)
- [x] RLS enabled on all tables, authenticated select/insert/update
- [x] FK constraints: bom->menu_items, bom->ingredients, sales->menu_items, inv->ingredients
- [x] Unique index on `(business_date, menu_item_id)` for daily aggregation
- [x] Indexes on `sales_line_items(business_date)`, `inventory_txns(ingredient_id, created_at)`
- [x] Nullable `org_id` columns reserved for future multi-tenant

### Done When
Can insert menu items, BOM, sales, inventory rows and query joins.

---

## Module 2 — Ingestion (CSV Upload) + Onboarding

**Owner**: Frontend (UI) + Backend (RPC)
**Status**: IN PROGRESS — backend RPCs done, frontend UI pending
**Migration**: `20260207000200_consumption_engine.sql` + `20260207000300_onboarding_and_bulk_close.sql`

### Requirements — Backend (DONE)
- [x] `ingest_daily_sales(p_rows jsonb)` RPC
- [x] Auto-creates missing menu_items from CSV data
- [x] Upserts by `(business_date, menu_item_id)` — safe to re-upload
- [x] Returns `{ status, rows_processed, menu_items_created }`
- [x] `register_order(p_order_raw)` RPC for live API orders (idempotent by `order_id`, consumes inventory via BOM, feeds forecasts)
- [x] `app_config` table with onboarding state tracking
- [x] `get_onboarding_status()` RPC — frontend calls on load to route user
- [x] `complete_onboarding_ingest()` RPC — records history date range after bulk upload
- [x] `run_bulk_close()` RPC — processes all un-consumed dates at once (for setup)

### Requirements — Frontend: Landing Page / Onboarding (PENDING)
- [ ] On app load, call `get_onboarding_status()`
- [ ] If `setup_complete = false`, show **Landing Page** (onboarding flow)
- [ ] If `setup_complete = true`, show **Main Dashboard**
- [ ] Landing page steps:
  1. Welcome message + explanation
  2. File input: "Upload your sales history CSV"
  3. Parse with PapaParse, show preview (date range, row count)
  4. On confirm: call `ingest_daily_sales` (may need to batch for large files)
  5. Call `complete_onboarding_ingest()` to record date range
  6. Call `run_bulk_close()` to compute all historical consumption
  7. Show progress/success: "X dates processed, Y items created"
  8. Redirect to main dashboard

### Requirements — Frontend: Daily Upload (PENDING)
- [ ] Upload page (post-setup): file input + "Upload" button
- [ ] Parse CSV with PapaParse in the browser
- [ ] Support Toast `ItemSelectionDetails.csv` format
- [ ] Support simplified format: `business_date, menu_item, qty, net_sales`
- [ ] Filter out voided items (`Void? = True`)
- [ ] Group by `(business_date, Menu Item)`, sum qty + net_sales
- [ ] Call `ingest_daily_sales` RPC with aggregated rows
- [ ] Optionally call `run_daily_close` for the uploaded date(s)
- [ ] Show success/error feedback after upload
- [ ] Show count of rows processed and new menu items created

### Toast CSV Column Mapping

| Toast Column | Target Field | Transform |
|---|---|---|
| `Order Date` | `business_date` | Extract date from `MM/DD/YYYY HH:MM:SS` |
| `Menu Item` | `menu_item_name` | Direct |
| `Sales Category` | `category` | Direct |
| `Net Price` | `net_sales` | Sum per group |
| `Qty` | `qty` | Sum per group |
| `Void?` | (filter) | Skip if `True` |
| (hardcode) | `source` | `"toast"` |

### Done When
Uploading 1 day of Toast CSV creates correct rows in `sales_line_items`.

---

## Module 3 — Consumption Engine

**Owner**: Backend
**Status**: DONE
**Migration**: `20260207000200_consumption_engine.sql`

### Requirements
- [x] `run_daily_close(p_business_date)` RPC
- [x] Joins `sales_line_items` with `bom` for given date
- [x] Computes `ingredient_usage = SUM(qty_sold * qty_per_item)`
- [x] Writes `CONSUME` txns to `inventory_txns` (negative qty_delta)
- [x] Decrements `inventory_on_hand`
- [x] Idempotent: skips if already run for that date
- [x] Returns no_data status if no sales for the date
- [x] `reverse_daily_close(p_business_date)` RPC for corrections
- [x] `business_date` column added to `inventory_txns` for tracking
- [x] `get_inventory_snapshot()` RPC for dashboard
  - [x] Avg daily usage from last 14 days of CONSUME txns
  - [x] Days of supply = on_hand / avg_daily_usage
  - [x] Days to reorder = (on_hand - reorder_point) / avg_daily_usage
  - [x] Status badges: ok / reorder_soon / critical
  - [x] Sorted by urgency (critical first)

### Done When
Click "Run Daily Close" for a date with sales -> inventory decrements correctly.

---

## Module 4 — Inventory Ops (Receive + Count)

**Owner**: Frontend + Backend
**Status**: BACKEND DONE — frontend pending
**Migration**: `20260207000400_inventory_ops.sql`

### Requirements — Backend (DONE)
- [x] `receive_inventory(p_ingredient_id, p_qty, p_note)` RPC — validates qty > 0, creates RECEIVE txn, auto-creates IOH row
- [x] `count_inventory(p_ingredient_id, p_actual_qty)` RPC — validates qty >= 0, computes delta, creates COUNT txn
- [x] 12 integration tests passing

### Requirements — Frontend (PENDING)
- [ ] **Receive Inventory page**: select ingredient, enter qty, optional note, submit
- [ ] **Count Inventory page**: select ingredient, enter actual count, submit
- [ ] Confirmation feedback after each operation
- [ ] Show updated on-hand after submit

### NEW: US Foods Invoice Matching (read-only confirm flow)
- Helper module: `scripts/usfoodsInvoiceMatch.mjs`
- Export: `getInvoiceMatches(pdfBuffer, supabase)` → `{ matches, unmatched }`
  - `matches`: [{ ingredientId, ingredientName, ingredientUnit, qtyOrdered, qtyShipped, salesUnit, productNumber, rawLine }]
  - `unmatched`: invoice lines not matched to any ingredient
- Frontend flow to implement:
  1) User uploads US Foods PDF
  2) Frontend sends PDF (ArrayBuffer) to a tiny API route that calls `getInvoiceMatches`
  3) Show confirmation table in UI (name, qtyShipped/qtyOrdered, unit, product number)
  4) On confirm, call `receive_inventory` per matched line using `ingredientId` and `qtyShipped` (fallback to `qtyOrdered`)
- Reference script (end-to-end parse+receive): `scripts/receive-usfoods-invoice.mjs` — keep UI confirm step before writing.

### Done When
Manager can receive a delivery and correct inventory; snapshot reflects changes.

---

## Module 5 — Inventory Snapshot Dashboard

**Owner**: Frontend
**Status**: BACKEND DONE — frontend pending
**Migration**: `20260207000600_smart_snapshot_window.sql`

### Requirements — Backend (DONE)
- [x] `get_inventory_snapshot()` RPC — auto-detects data window (works with historical + real-time data)
- [x] Returns: ingredient info, qty_on_hand, avg_daily_usage, days_of_supply, days_to_reorder, status
- [x] Sorted by urgency (critical first)
- [x] All 32 ingredients returning real data

### Requirements — Frontend (PENDING)
- [ ] Call `get_inventory_snapshot()` RPC on page load
- [ ] Render table with all fields
- [ ] Color-coded status badges: green (ok), yellow (reorder_soon), red (critical)
- [ ] Auto-refresh or manual refresh button

### Done When
Dashboard renders current inventory and flags low items automatically.

---

## Module 6 — Forecasting v1

**Owner**: Data/Backend
**Status**: BACKEND DONE — frontend pending
**Migration**: `20260207000500_forecasting_v1.sql`

### Requirements — Backend (DONE)
- [x] `forecast_items` table (id, forecast_date, menu_item_id, qty)
- [x] `forecast_ingredients` table (id, forecast_date, ingredient_id, qty)
- [x] `generate_forecast(p_days_ahead, p_reference_date)` RPC — rolling DOW avg from last 6 weeks, converts to ingredients via BOM, idempotent
- [x] `get_forecast(p_reference_date)` RPC — returns 7-day ingredient forecast with on_hand and shortfall
- [x] 620 item forecasts + 224 ingredient forecasts generated from real data
- [x] 8 integration tests passing

### Requirements — Frontend (PENDING)
- [ ] Forecast page showing next 7 days of ingredient needs
- [ ] Table: date, ingredient, forecasted qty, current on_hand, shortfall
- [ ] Color-code shortfall: red if positive (need to order), green if sufficient

### Done When
Can show "next 7 days ingredient needs" based on historical sales patterns.

---

## Module 7 — Admin (Menu + BOM Editor)

**Owner**: Frontend + Backend
**Status**: BACKEND DONE — frontend pending
**Migration**: `20260207000800_admin_crud_rpcs.sql`

### Requirements — Backend (DONE)
- [x] `upsert_menu_item(p_id, p_name, p_category, p_active)` — create/update with duplicate name check
- [x] `deactivate_menu_item(p_id)` — soft delete
- [x] `upsert_ingredient(p_id, p_name, p_unit, p_reorder_point, p_lead_time_days, p_unit_cost)` — full validation
- [x] `upsert_bom_entry(p_menu_item_id, p_ingredient_id, p_qty_per_item)` — validates FKs + qty > 0
- [x] `delete_bom_entry(p_menu_item_id, p_ingredient_id)`
- [x] `get_bom_for_item(p_menu_item_id)` — returns ingredients with costs and total recipe cost
- [x] 20 integration tests passing

### Requirements — Frontend (PENDING)
- [ ] **Menu Items page**: list, add, edit, deactivate
- [ ] **Ingredients page**: list, add, edit
- [ ] **BOM Builder page**: select menu item, add/edit/remove ingredient rows
- [ ] Confirmation dialogs for destructive actions

### Done When
Non-technical person can set up a new restaurant's menu, ingredients, and recipes.

---

## Module 8 — Order Analytics (NEW)

**Owner**: Backend
**Status**: BACKEND DONE — frontend pending
**Migration**: `20260207000700_daily_orders_and_analytics.sql`

### What It Does
Stores order-level data from Toast OrderDetails CSV (different from item-level sales).
Provides revenue analytics, service mix, guest counts, peak hours, server performance.

### Requirements — Backend (DONE)
- [x] `daily_orders` table with full Toast OrderDetails schema
- [x] `ingest_daily_orders(p_rows)` — batch upserts order data, safe to re-upload
- [x] `get_daily_analytics(p_business_date)` — revenue summary, service period/dining option/hour/server breakdowns
- [x] `get_revenue_trend(p_days)` — daily revenue trend for last N days
- [x] 10 integration tests passing
- [x] 21,873 synthetic orders generated from sales_line_items (2025-01-01 to 2026-02-08)
- [x] `generate-daily-orders.js` script auto-generates daily_orders from sales data

### Requirements — Frontend (PENDING)
- [ ] Revenue dashboard cards: total revenue, orders, avg order value, guests
- [ ] Charts: revenue by hour, by service period, by dining option
- [ ] Server leaderboard

### Done When
Manager can see daily revenue breakdown and trends.

---

## Module 9 — ElevenLabs Text-to-Speech Integration

**Owner**: Integration
**Status**: COMPLETE
**Dependencies**: `@elevenlabs/elevenlabs-js`, `dotenv`

### Overview
Simple Node.js module for converting text to speech using the ElevenLabs API. No server infrastructure required - just a lightweight module that can be imported and used anywhere.

### What Was Built
- **Module**: `Elevenlabs/elevenlabs.js` — Core TTS functionality
- **Examples**: `Elevenlabs/example.js` — Usage demonstrations
- **Documentation**: `Elevenlabs/README.md` — Complete API reference and examples
- **Configuration**: `.env` updated with `ELEVENLABS_API_KEY`

### API Reference

#### `textToSpeech(text, options)`
Converts text to speech and returns audio as a Buffer.

**Parameters:**
- `text` (string, required): Text to convert
- `options` (object, optional):
  - `voiceId` (string): ElevenLabs voice ID. Default: `21m00Tcm4TlvDq8ikWAM` (Rachel)
  - `modelId` (string): Model ID. Default: `eleven_monolingual_v1`

**Returns:** `Promise<Buffer>` - Audio data

**Example:**
```javascript
const elevenlabs = require('./Elevenlabs/elevenlabs');
const audioBuffer = await elevenlabs.textToSpeech("Hello world!");
```

#### `textToSpeechFile(text, outputPath, options)`
Converts text to speech and saves directly to file.

**Parameters:**
- `text` (string, required): Text to convert
- `outputPath` (string, required): Where to save MP3
- `options` (object, optional): Same as `textToSpeech()`

**Returns:** `Promise<void>`

**Example:**
```javascript
await elevenlabs.textToSpeechFile("Hello!", "speech.mp3");
```

### Configuration
Set your API key in `.env`:
```env
ELEVENLABS_API_KEY=sk_your_actual_key_here
```

Get your API key from https://elevenlabs.io

### Testing
```bash
node Elevenlabs/example.js
```

**Test Results:**
- ✅ Generated audio: ~25KB per request
- ✅ Output format: MP3, 44.1 kHz, 128 kbps
- ✅ Successfully integrated with project

### Available Voices
- `21m00Tcm4TlvDq8ikWAM` - Rachel (default)
- `AZnzlk1XvdvUeBnXmlld` - Domi
- `EXAVITQu4vr4xnSDxMaL` - Bella
- `ErXwobaYiN019PkySvjV` - Antoni
- `MF3mGyEYCl7XYWbV9V6O` - Elli
- `TxGEqnHWrfWFTfGW9XjX` - Josh

Visit https://elevenlabs.io/voice-library for more.

### Error Handling
```javascript
try {
    const audio = await elevenlabs.textToSpeech("Hello!");
} catch (error) {
    console.error('TTS Error:', error.message);
    // Common errors:
    // - "Text is required"
    // - "Failed to generate speech: ..." (API error)
}
```

### Module Exports
```javascript
{
    textToSpeech,           // Main function to get audio buffer
    textToSpeechFile,       // Helper to save directly to file
    DEFAULT_VOICE_ID,       // "21m00Tcm4TlvDq8ikWAM"
    DEFAULT_MODEL_ID        // "eleven_monolingual_v1"
}
```

### Use Cases
- Generate audio announcements for kiosk
- Text-to-speech for accessibility features
- Audio feedback for order confirmations
- Voice prompts for inventory alerts

### Done When
✅ Module tested and working - ready to use in any part of the application.

---

## Team Roles

| Role | Modules | Status |
|------|---------|--------|
| **Backend** | M0-M8 (all RPCs) | ALL DONE — 66 tests passing |
| **Frontend Dev** | M2 UI, M4 UI, M5, M6 UI, M7 UI, M8 UI | ALL PENDING — this is the bottleneck |
| **DevOps/Lead** | M0, code review, merge | Ongoing |

---

## Data Model Reference

### Tables

| Table | PK | Key Columns | Rows | Notes |
|-------|-----|-------------|------|-------|
| `menu_items` | `id` (uuid) | name, category, active | 91 | Auto-created by ingest RPC |
| `ingredients` | `id` (uuid) | name, unit, reorder_point, lead_time_days, unit_cost | 32 | |
| `bom` | `(menu_item_id, ingredient_id)` | qty_per_item | 674 | Size-scaled recipes |
| **`sales_line_items`** | **`id` (uuid)** | **business_date, menu_item_id, qty, net_sales** | **25,396** | **SINGLE SOURCE OF TRUTH** (2025-01-01 to 2026-02-08) |
| `inventory_on_hand` | `ingredient_id` | qty_on_hand, updated_at | 32 | |
| `inventory_txns` | `id` (uuid) | ingredient_id, txn_type, qty_delta, business_date | ~24,000 | Audit trail |
| `app_config` | `key` (text) | value (jsonb), updated_at | 1 | Onboarding state |
| `forecast_items` | `id` (uuid) | forecast_date, menu_item_id, qty | 2,525 | Item-level forecasts |
| `forecast_ingredients` | `id` (uuid) | forecast_date, ingredient_id, qty | 926 | Ingredient-level forecasts |
| `daily_orders` | `id` (uuid) | business_date, order_id, subtotal, tip, total, ... | 21,873 | Synthetic from sales_line_items |

### Enums

| Enum | Values |
|------|--------|
| `unit_type` | g, oz, lb, each |
| `inventory_txn_type` | RECEIVE, COUNT, CONSUME |

---

## RPC Reference

| Function | Input | Returns | Module | Status |
|----------|-------|---------|--------|--------|
| `get_onboarding_status()` | (none) | `{ setup_complete, history_uploaded, ... }` | M2 | LIVE |
| `ingest_daily_sales(p_rows)` | jsonb array of sales rows | `{ status, rows_processed, menu_items_created }` | M2 | LIVE |
| `complete_onboarding_ingest()` | (none) | `{ status, start_date, end_date, rows }` | M2 | LIVE |
| `run_daily_close(p_business_date)` | date | `{ status, consume_txns_created, ingredients_updated }` | M3 | LIVE |
| `run_bulk_close()` | (none) | `{ status, dates_processed, total_consume_txns }` | M3 | LIVE |
| `reverse_daily_close(p_business_date)` | date | `{ status, txns_reversed }` | M3 | LIVE |
| `get_inventory_snapshot()` | (none) | jsonb array of ingredient snapshots (auto-window) | M5 | LIVE |
| `receive_inventory(p_ingredient_id, p_qty, p_note)` | uuid, numeric, text | `{ status, qty_received, new_qty_on_hand }` | M4 | LIVE |
| `count_inventory(p_ingredient_id, p_actual_qty)` | uuid, numeric | `{ status, previous_qty, delta, new_qty_on_hand }` | M4 | LIVE |
| `generate_forecast(p_days_ahead, p_reference_date)` | int, date | `{ status, item_forecasts, ingredient_forecasts }` | M6 | LIVE |
| `get_forecast(p_reference_date)` | date | jsonb array of ingredient forecasts with shortfall | M6 | LIVE |
| `upsert_menu_item(p_id, p_name, p_category, p_active)` | uuid, text, text, bool | `{ status, action, id, name }` | M7 | LIVE |
| `deactivate_menu_item(p_id)` | uuid | `{ status, id, name, active }` | M7 | LIVE |
| `upsert_ingredient(p_id, p_name, p_unit, ...)` | uuid, text, unit_type, ... | `{ status, action, id, name }` | M7 | LIVE |
| `upsert_bom_entry(p_menu_item_id, p_ingredient_id, p_qty)` | uuid, uuid, numeric | `{ status, menu_item, ingredient, qty }` | M7 | LIVE |
| `delete_bom_entry(p_menu_item_id, p_ingredient_id)` | uuid, uuid | `{ status, deleted }` | M7 | LIVE |
| `get_bom_for_item(p_menu_item_id)` | uuid | `{ status, ingredients[], total_cost }` | M7 | LIVE |
| `ingest_daily_orders(p_rows)` | jsonb array of order rows | `{ status, rows_processed }` | M8 | LIVE |
| `get_daily_analytics(p_business_date)` | date (optional) | `{ status, revenue, orders, by_server, ... }` | M8 | LIVE |
| `get_revenue_trend(p_days)` | int | jsonb array of daily revenue data | M8 | LIVE |

### JavaScript Module Functions (Module 9)

| Function | Input | Returns | Module | Status |
|----------|-------|---------|--------|--------|
| `textToSpeech(text, options)` | string, object | `Promise<Buffer>` (MP3 audio) | M9 | READY |
| `textToSpeechFile(text, path, options)` | string, string, object | `Promise<void>` (saves MP3) | M9 | READY |

---

## Test Data

| File | Description | Rows | Date Range |
|------|-------------|------|------------|
| `Test data/Toast_ItemSelectionDetails_from_Pizza.csv` | Item-level sales (Tony's Pizza Atlanta) | ~48K | 01/01/2025 - 12/31/2025 |
| `Test data/Toast_OrderDetails_DAILY_INJECT_latestDay.csv` | Order-level summary (last day) | 74 | 12/31/2025 |

### Setup Scripts

| Script | Purpose | Run Order |
|--------|---------|----------|
| `scripts/setup-all.js` | **Master setup — runs everything below in order** | -- |
| `scripts/ingest-test-data.js` | Ingest sales CSV → sales_line_items + menu_items | 1 |
| `scripts/seed-bom.js` | Seed ingredients + BOM recipes | 2 |
| `scripts/run-bulk-close.js` | Process all dates → inventory_txns (consumption) | 3 |
| `scripts/generate-daily-orders.js` | Generate synthetic daily_orders from sales data | 4 |
| `scripts/reset-inventory.js` | Set realistic inventory levels | 5 |
| `scripts/generate-forecasts.js` | Generate 7-day forecasts (uses today's date) | 6 |
| `scripts/ingest-order-details.js` | Ingest latest-day order details CSV | 7 |
| `scripts/analytics.js` | Verify all tables — print analytics | 8 |

---

## Migrations Applied

| Timestamp | File | Contents |
|-----------|------|----------|
| `20260207000100` | `init_schema.sql` | Tables, enums, indexes, RLS policies |
| `20260207000200` | `consumption_engine.sql` | business_date column, ingest/close/reverse/snapshot RPCs |
| `20260207000300` | `onboarding_and_bulk_close.sql` | app_config table, onboarding RPCs, bulk close |
| `20260207000400` | `inventory_ops.sql` | receive_inventory, count_inventory RPCs |
| `20260207000500` | `forecasting_v1.sql` | forecast tables, generate_forecast, get_forecast RPCs |
| `20260207000600` | `smart_snapshot_window.sql` | Auto-detect data window for snapshot |
| `20260207000700` | `daily_orders_and_analytics.sql` | daily_orders table, analytics RPCs |
| `20260207000710` | `fix_analytics_no_data.sql` | Fix no_data handling in get_daily_analytics |
| `20260207000800` | `admin_crud_rpcs.sql` | Module 7 admin CRUD RPCs with validation |

## Auth

| User | Email | Password | Notes |
|------|-------|----------|-------|
| Demo | `demo@tonys.pizza` | `TonysPizza2026!` | Pre-confirmed, ready for frontend |

## Test Suite

| File | Tests | Module |
|------|-------|--------|
| `tests/rpc.test.js` | 16 | M2, M3, M5 (core RPCs) |
| `tests/m4-inventory-ops.test.js` | 12 | M4 (receive, count) |
| `tests/m6-forecast.test.js` | 8 | M6 (generate, get forecast) |
| `tests/m7-admin-crud.test.js` | 20 | M7 (CRUD RPCs) |
| `tests/orders-analytics.test.js` | 10 | M8 (orders, analytics) |
| **Total** | **66** | **All passing** |

## Package Dependencies

| Package | Purpose | Module |
|---------|---------|--------|
| `@supabase/supabase-js` | Database client | All modules |
| `@elevenlabs/elevenlabs-js` | Text-to-speech API client | M9 |
| `dotenv` | Environment variable management | All modules |
| `papaparse` | CSV parsing | M2 (frontend) |
| `pdfjs-dist` | PDF parsing (US Foods invoices) | M4 |
| `express` | API server (optional) | -- |
| `cors` | CORS middleware (optional) | -- |
| `jest` | Testing framework | All tests |
