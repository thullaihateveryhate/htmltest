#!/usr/bin/env node
/**
 * === MASTER SETUP SCRIPT ===
 *
 * One command to set up the entire database from scratch:
 *   node scripts/setup-all.js
 *
 * Pipeline order:
 *   1. Ingest sales CSV       → sales_line_items, menu_items
 *   2. Seed BOM               → ingredients, bom
 *   3. Run bulk close          → inventory_txns (consumption)
 *   4. Generate daily orders   → daily_orders (synthetic from sales)
 *   5. Reset inventory levels  → inventory_on_hand
 *   6. Generate forecasts      → forecast_items, forecast_ingredients
 *   7. Verify everything
 *
 * Prerequisites:
 *   - .env with SUPABASE_URL and SUPABASE_SERVICE_KEY
 *   - Test data CSV at "Test data/Toast_ItemSelectionDetails_from_Pizza.csv"
 *   - npm install (papaparse, @supabase/supabase-js, dotenv)
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(label, script) {
  console.log('\n' + '='.repeat(60));
  console.log(`  STEP: ${label}`);
  console.log('='.repeat(60) + '\n');
  try {
    execSync(`node ${path.join('scripts', script)}`, {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 600000 // 10 min max per step
    });
    console.log(`\n  ✓ ${label} — COMPLETE\n`);
  } catch (err) {
    console.error(`\n  ✗ ${label} — FAILED (exit code ${err.status})\n`);
    if (process.env.SETUP_STRICT === '1') {
      process.exit(1);
    }
  }
}

async function main() {
  console.log('\n' + '█'.repeat(60));
  console.log('  TONY\'S PIZZA — FULL DATABASE SETUP');
  console.log('  ' + new Date().toISOString());
  console.log('█'.repeat(60));

  // Step 1: Ingest sales line items from CSV
  run('Ingest sales CSV → sales_line_items + menu_items', 'ingest-test-data.js');

  // Step 2: Seed ingredients & BOM
  run('Seed ingredients + BOM (recipes)', 'seed-bom.js');

  // Step 3: Bulk close (generate consumption from sales + BOM)
  // Uses an inline call since the existing script is inside ingest-test-data
  // but we want to ensure it runs again after BOM seeding
  run('Re-run bulk close after BOM seeding', 'run-bulk-close.js');

  // Step 4: Generate synthetic daily_orders from sales_line_items
  run('Generate daily_orders (synthetic from sales)', 'generate-daily-orders.js');

  // Step 5: Reset inventory levels
  run('Reset inventory to realistic levels', 'reset-inventory.js');

  // Step 6: Generate forecasts
  run('Generate 7-day forecasts', 'generate-forecasts.js');

  // Step 7: Ingest order details CSV (latest day)
  run('Ingest latest-day order details', 'ingest-order-details.js');

  // Step 8: Run analytics to verify
  run('Verify — run analytics', 'analytics.js');

  console.log('\n' + '█'.repeat(60));
  console.log('  SETUP COMPLETE');
  console.log('█'.repeat(60) + '\n');
}

main();
