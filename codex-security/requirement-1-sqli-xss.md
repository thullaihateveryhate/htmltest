# Requirement 1: SQL Injection and XSS Hardening

## 1. Why this requirement applies

Stockd is not a traditional Express + ORM app. The main data path is:

- Static frontend pages in `Frontend/`
- Supabase PostgREST queries from the browser
- Supabase RPC functions in `supabase/migrations/*.sql`
- A Copilot Edge Function in `supabase/functions/copilot/`
- A separate kiosk surface in `kiosk/`

That architecture reduces classic string-built SQL risk, but it does **not** remove it:

- The Copilot Edge Function is effectively a database proxy and needed explicit allowlists.
- Multiple write RPCs accepted raw `text` / `jsonb` payloads and cast untrusted fields directly.
- Many frontend pages rendered database-controlled or user-controlled text into `innerHTML`.
- CSV imports and kiosk/order flows allowed untrusted text to move from input to persistence to rendering.

This requirement therefore applies to both the client-side rendering layer and the Supabase/RPC boundary.

## 2. Threat model for this repo

Relevant attacker-controlled inputs in the current repo:

- Login/sign-up email input in `Frontend/login.html`
- Manual receive notes in `Frontend/pages/receive.html`
- Physical count flow in `Frontend/pages/count.html`
- Toast CSV import data in `Frontend/js/csv-parser.js`, `Frontend/pages/onboarding.html`, and `Frontend/pages/upload.html`
- Invoice/PDF-derived content displayed in `Frontend/pages/receive.html`
- Menu/category/order metadata rendered in `Frontend/pages/dashboard.html`, `Frontend/pages/sales-analysis.html`, and `kiosk/kiosk.js`
- Copilot request bodies handled in `supabase/functions/copilot/validation.ts`
- Copilot database calls built in `supabase/functions/copilot/supabase.ts`
- Write RPC payloads for `receive_inventory`, `ingest_daily_sales`, `ingest_daily_orders`, `upsert_menu_item`, `upsert_ingredient`, and `register_order`

Primary risks:

- Stored XSS by persisting HTML/script payloads in menu item names, categories, notes, or order metadata and later rendering them into cards/tables/modals.
- Reflected XSS by echoing raw error messages or user inputs into `innerHTML`.
- Database abuse through over-permissive DB proxy behavior if arbitrary RPC/table/filter/order inputs were ever passed through Copilot.
- Malformed JSON/CSV payloads causing unsafe direct casts or unexpectedly broad queries.

## 3. Where SQLi risk existed or could have existed

### Low-risk by architecture, but still security-relevant

The repo did **not** contain classic dynamic SQL such as `EXECUTE`, `format(...)`, or raw string-concatenated SQL statements in the migrations that were audited. Most DB access already used:

- Supabase query builder calls from the frontend
- Static RPC names from the frontend
- Static SQL in Supabase migrations

### Real SQLi/DB-abuse-adjacent risk areas

1. `supabase/functions/copilot/supabase.ts`

- Before hardening, the Copilot gateway would call any RPC name and any table name passed to it by internal tool code.
- Filter keys and order fields were not allowlisted.
- This was the closest thing in the repo to a database proxy and needed explicit constraints.

2. `supabase/migrations/20260207000200_consumption_engine.sql`
3. `supabase/migrations/20260207000400_inventory_ops.sql`
4. `supabase/migrations/20260207000700_daily_orders_and_analytics.sql`
5. `supabase/migrations/20260207000800_admin_crud_rpcs.sql`
6. `supabase/migrations/20260207000900_register_order_rpc.sql`

- These existing write RPCs accepted raw JSON/text input and cast values directly.
- That was not dynamic-SQL injection, but it was still an unsafe trust boundary.
- Invalid or hostile payloads could be persisted or trigger cast failures.

### Mitigation summary for SQLi / DB hardening

- Added explicit RPC/table/filter/order allowlists in `supabase/functions/copilot/supabase.ts`
- Tightened search input normalization in `supabase/functions/copilot/tools/common.ts`
- Normalized request text in `supabase/functions/copilot/validation.ts`
- Added a new Supabase migration `supabase/migrations/20260421000100_requirement1_security_hardening.sql`
  - `stockd_sanitize_text(...)`
  - `stockd_safe_enum(...)`
  - hardened versions of `receive_inventory`, `ingest_daily_sales`, `ingest_daily_orders`, `upsert_menu_item`, `upsert_ingredient`, and `register_order`

## 4. Where XSS risk existed or could have existed

### High-risk stored/reflected XSS sinks that were patched

1. `Frontend/login.html`

- Sign-up success state wrote the submitted email into `innerHTML`.

2. `Frontend/pages/receive.html`

- Invoice matches table rendered PDF/database fields into `innerHTML`
- Recent receipts table rendered ingredient names, units, and notes into `innerHTML`
- Inline `onclick` attribute used dynamic receipt IDs
- Manual note input flowed directly to `receive_inventory`

3. `Frontend/pages/count.html`

- Ingredient dropdown, recent counts table, quick stats, and insights injected database text into `innerHTML`

4. `Frontend/pages/dashboard.html`

- Alert banner, inventory table, forecast table, alert cards, and suggested order text rendered database values into `innerHTML`

5. `Frontend/pages/sales-analysis.html`

- Error states and top-seller rendering inserted dynamic text into HTML templates

6. `Frontend/js/csv-parser.js`

- Imported CSV menu/category text was not normalized before being sent toward persistence

7. `Frontend/pages/onboarding.html`
8. `Frontend/pages/upload.html`

- CSV-derived preview values were rendered through `innerHTML`

9. `kiosk/kiosk.js`

- Cart items and order confirmation modal used dynamic HTML built from menu/order text

### Existing safe area kept as-is

`Frontend/js/ai-copilot.js` already escaped message content before rendering, so it was not refactored as part of this requirement.

## 5. Exact files changed

### Frontend and kiosk

- `Frontend/js/security.js`
- `Frontend/js/csv-parser.js`
- `Frontend/login.html`
- `Frontend/pages/onboarding.html`
- `Frontend/pages/upload.html`
- `Frontend/pages/receive.html`
- `Frontend/pages/count.html`
- `Frontend/pages/dashboard.html`
- `Frontend/pages/sales-analysis.html`
- `kiosk/security.js`
- `kiosk/index.html`
- `kiosk/kiosk.js`

### Backend / Supabase boundary

- `supabase/functions/copilot/supabase.ts`
- `supabase/functions/copilot/tools/common.ts`
- `supabase/functions/copilot/validation.ts`
- `supabase/migrations/20260421000100_requirement1_security_hardening.sql`

### Testing and discoverability

- `tests/security-utils.test.js`
- `tests/csv-parser-security.test.js`
- `tests/copilot/supabase-gateway.test.js`
- `scripts/run-security-tests.js`
- `package.json`
- `Readme.md`

## 6. Exact mitigations implemented

### A. Shared sanitization helpers

Added `Frontend/js/security.js` and `kiosk/security.js` with:

- `sanitizeTextInput(...)`
- `escapeHtml(...)`
- `safeAttribute(...)`
- `sanitizeEmailInput(...)`
- `parseFiniteNumber(...)`
- `safeEnum(...)`

These are now reused across the highest-risk user-visible flows.

### B. Frontend XSS mitigation

Applied the following patterns:

- Escaped database/user-controlled values before interpolating into HTML templates
- Normalized free-text inputs before submission
- Replaced dynamic inline `onclick` usage in `Frontend/pages/receive.html` with `data-*` + delegated event handling
- Added bounded input attributes such as `maxlength`, `max`, and explicit client-side validation
- Sanitized CSV-imported text before it becomes RPC payload data
- Sanitized kiosk cart/order text before confirmation modal rendering

### C. Copilot / DB boundary hardening

In `supabase/functions/copilot/supabase.ts`:

- allowlisted approved RPC names
- allowlisted approved select tables
- allowlisted approved filter keys per table
- allowlisted approved order fields per table
- validated select limits

In `supabase/functions/copilot/tools/common.ts`:

- normalized short string tool args
- stripped wildcard/control characters from search terms
- rejected search strings that collapse to wildcard-only input

In `supabase/functions/copilot/validation.ts`:

- removed control characters from request message / short metadata strings
- normalized request text before length checks

### D. SQL/RPC hardening

In `supabase/migrations/20260421000100_requirement1_security_hardening.sql`:

- added `stockd_sanitize_text(...)` for plain-text normalization and markup stripping
- added `stockd_safe_enum(...)` for enum-like allowlist coercion
- hardened `receive_inventory`
  - sanitized note text
  - bounded quantity
- hardened `ingest_daily_sales`
  - required `p_rows` to be a JSON array
  - validated row shape
  - sanitized menu item/category/source text
  - validated date and numeric fields
- hardened `ingest_daily_orders`
  - required `p_rows` to be a JSON array
  - validated per-row dates/timestamps/numerics/booleans
  - sanitized order metadata text
- hardened `upsert_menu_item` and `upsert_ingredient`
  - sanitized names/categories before persistence
- hardened `register_order`
  - validated JSON payload
  - validated `items` array shape
  - sanitized order metadata and item text
  - bounded guest count and numeric fields
  - sanitized inventory transaction note content

## 7. Remaining limitations / out-of-scope areas

1. The SQL hardening for RPCs is implemented as a migration file.

- `supabase/migrations/20260421000100_requirement1_security_hardening.sql` must be applied to the target Supabase project for live runtime enforcement.
- This repo change is ready, but migration deployment is still a separate operational step.

2. This pass did not add CSP or HTTP security headers.

- The frontend is static HTML and the assignment asked specifically for SQLi/XSS protections.
- Output escaping and input normalization were prioritized first.

3. The kiosk still contains hardcoded public demo credentials in `kiosk/kiosk.js`.

- That is a separate security issue, but it is not SQLi/XSS-specific.

4. The default Jest TypeScript test setup in this repo is still unreliable in the current environment.

- To keep verification real, a dedicated runnable harness was added at `scripts/run-security-tests.js`.
- Use `npm run test:security`.

5. Static `innerHTML` usage still exists in the UI for layout/skeleton states.

- That is intentional.
- The hardening pass focused on removing or escaping **dynamic** user/database content, not banning `innerHTML` universally.

## 8. How to demo the protection to a grader

### Demo A: Stored XSS defense in the UI

1. Open `Frontend/pages/receive.html`
2. Enter a note such as:
   - `<script>alert(1)</script> Sysco`
3. Submit the receive action
4. Show that:
   - the page does not execute script
   - the rendered note is normalized plain text
   - no raw script tag is rendered in Recent Receipts

### Demo B: CSV import normalization

1. Use a Toast CSV row whose `Menu Item` or `Sales Category` includes:
   - `<img src=x onerror=alert(1)>`
2. Upload through `Frontend/pages/onboarding.html` or `Frontend/pages/upload.html`
3. Show that the preview and the parsed payload are normalized to plain text

### Demo C: Kiosk rendering protection

1. Use or seed a menu item containing HTML-like text
2. Add it to the cart in `kiosk/`
3. Show that the cart and order confirmation modal render escaped text rather than executable HTML

### Demo D: DB proxy / query restriction

1. Open `supabase/functions/copilot/supabase.ts`
2. Show the allowlists for RPCs, tables, filters, and order fields
3. Run:
   - `npm run test:security`
4. Point out the gateway tests that reject disallowed RPC/table/filter/order access

## 9. Verification performed

Executed:

```bash
npm run test:security
```

Observed result:

- 7 targeted security checks passed
- verified XSS sanitization helpers
- verified CSV normalization
- verified Copilot DB access allowlists
- verified request text normalization

## 10. Bottom line

This requirement is now addressed in a way that fits the real Stockd architecture:

- frontend inputs are normalized
- dangerous text rendering paths are escaped
- the Copilot database proxy is constrained with allowlists
- write RPCs are hardened through a migration-based validation/sanitization layer

That gives a defensible answer to the grading questions:

- where input enters
- where it is validated/sanitized
- where database access is constrained
- where raw rendering was removed or escaped
- how the protections can be demonstrated
