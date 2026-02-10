---
name: supabase-schema-plan
overview: Create the initial Supabase schema and baseline RLS for core inventory, sales, and BOM tables (Module 1).
todos:
  - id: init-supabase
    content: Set up cloud Supabase project access
    status: completed
  - id: create-schema
    content: Add core tables, enums, constraints, indexes
    status: completed
  - id: rls-v1
    content: Enable RLS + basic authenticated policies
    status: completed
  - id: seed-and-validate
    content: Add minimal seed + local validation steps
    status: completed
isProject: false
---

# Module 1 — Supabase Schema Plan

## Context

- Repo has only a minimal `Readme.md` and empty `.envexample`, no existing Supabase setup.
- Supabase will be cloud-hosted (no local Supabase required).
- Backend scope: schema + initial RLS and seed-ready structure.

## Approach

- Use Supabase SQL editor or CLI connected to the cloud project to apply the initial schema.
- Keep RLS simple (single-tenant) but enabled with policies that allow authenticated access; leave room for multi-tenant later by reserving `org_id` columns.
- Add indexes and constraints for expected query patterns (daily sales, ingredient lookups, BOM joins).

## Key Files to Add

- `[supabase/migrations/<timestamp>_init_schema.sql](supabase/migrations/<timestamp>_init_schema.sql)` for tables, enums, indexes, constraints (source of truth for schema).
- `[supabase/seed.sql](supabase/seed.sql)` optional minimal seed for dev.
- `[.envexample](.envexample)` populated with `SUPABASE_URL` and `SUPABASE_ANON_KEY` placeholders.

## Schema Outline (initial)

- `menu_items` (id, name, category, active, created_at)
- `ingredients` (id, name, unit, reorder_point, lead_time_days, unit_cost, created_at)
- `bom` (menu_item_id, ingredient_id, qty_per_item, primary key menu_item_id+ingredient_id)
- `sales_line_items` (id, business_date, menu_item_id, qty, net_sales, source, created_at)
- `inventory_on_hand` (ingredient_id, qty_on_hand, updated_at)
- `inventory_txns` (id, ingredient_id, txn_type, qty_delta, created_at, note)

## RLS v1

- Enable RLS on all tables.
- Policy: allow `select/insert/update` for authenticated users; leave `delete` disabled initially.
- Note: store `org_id` columns nullable, add no policies yet (future multi-tenant).

## Constraints & Indexes

- Unique constraints for `(business_date, menu_item_id)` if aggregating daily.
- Index on `sales_line_items(business_date)` and `inventory_txns(ingredient_id, created_at)`.
- FK constraints for BOM and sales to `menu_items`, inventory to `ingredients`.

## Deliverables

- Cloud Supabase project with the core schema applied.
- Migrations in git and a minimal seed (optional) to validate inserts.
- Updated `.envexample` with required keys.

## Validation Steps

- Apply migration SQL to the cloud project, insert one menu item + ingredient + BOM row, then insert a sales row and an inventory_txn row; confirm queries return expected joins.

