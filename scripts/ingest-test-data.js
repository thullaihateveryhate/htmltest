/**
 * Backend integration test: ingest Toast CSV into Supabase
 *
 * Reads the test CSV, aggregates by (business_date, menu_item),
 * calls ingest_daily_sales in batches, then runs bulk close.
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CSV_PATH = path.join(__dirname, '..', 'Test data', 'Toast_ItemSelectionDetails_from_Pizza.csv');
const BATCH_SIZE = 300; // rows per RPC call

async function main() {
  console.log('=== Backend Integration Test: Ingest Toast CSV ===\n');

  // 1. Read and parse CSV
  console.log('1. Reading CSV...');
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const { data: rows, errors } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  console.log(`   Parsed ${rows.length} rows, ${errors.length} parse errors\n`);

  // 2. Filter out voided items
  const valid = rows.filter(r => r['Void?'] !== 'True');
  console.log(`2. After filtering voids: ${valid.length} rows\n`);

  // 3. Aggregate by (business_date, menu_item)
  console.log('3. Aggregating by (date, item)...');
  const agg = {};
  for (const row of valid) {
    // Parse date: "MM/DD/YYYY HH:MM:SS" -> "YYYY-MM-DD"
    const rawDate = (row['Order Date'] || '').split(' ')[0]; // "MM/DD/YYYY"
    const [mm, dd, yyyy] = rawDate.split('/');
    const bizDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

    const itemName = row['Menu Item'] || '';
    const key = `${bizDate}||${itemName}`;

    if (!agg[key]) {
      agg[key] = {
        business_date: bizDate,
        menu_item_name: itemName,
        category: row['Sales Category'] || '',
        qty: 0,
        net_sales: 0,
        source: 'toast'
      };
    }
    agg[key].qty += parseFloat(row['Qty'] || '0');
    agg[key].net_sales += parseFloat(row['Net Price'] || '0');
  }

  const aggregated = Object.values(agg);
  console.log(`   ${aggregated.length} unique (date, item) combinations\n`);

  // Show date range
  const dates = [...new Set(aggregated.map(r => r.business_date))].sort();
  console.log(`   Date range: ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)\n`);

  // 4. Ingest in batches
  console.log(`4. Ingesting in batches of ${BATCH_SIZE}...`);
  let totalProcessed = 0;
  let totalItemsCreated = 0;

  for (let i = 0; i < aggregated.length; i += BATCH_SIZE) {
    const batch = aggregated.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.rpc('ingest_daily_sales', { p_rows: batch });

    if (error) {
      console.error(`   BATCH ERROR at offset ${i}:`, error.message);
      continue;
    }

    totalProcessed += data.rows_processed;
    totalItemsCreated += data.menu_items_created;
    process.stdout.write(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(aggregated.length / BATCH_SIZE)} — ${totalProcessed} rows processed\r`);
  }
  console.log(`\n   Done: ${totalProcessed} rows ingested, ${totalItemsCreated} menu items created\n`);

  // 5. Complete onboarding ingest
  console.log('5. Completing onboarding ingest...');
  const { data: onboardData, error: onboardErr } = await supabase.rpc('complete_onboarding_ingest');
  if (onboardErr) {
    console.error('   ERROR:', onboardErr.message);
  } else {
    console.log(`   History recorded: ${onboardData.start_date} to ${onboardData.end_date} (${onboardData.rows} rows)\n`);
  }

  // 6. Run bulk close
  console.log('6. Running bulk close (this may take a moment)...');
  const { data: closeData, error: closeErr } = await supabase.rpc('run_bulk_close');
  if (closeErr) {
    console.error('   ERROR:', closeErr.message);
  } else {
    console.log(`   ${closeData.dates_processed} dates processed, ${closeData.total_consume_txns} consume txns created\n`);
  }

  // 7. Verify: check onboarding status
  console.log('7. Verifying onboarding status...');
  const { data: status } = await supabase.rpc('get_onboarding_status');
  console.log('  ', JSON.stringify(status, null, 2));

  // 8. Quick snapshot check
  console.log('\n8. Inventory snapshot (first 5 items):');
  const { data: snapshot } = await supabase.rpc('get_inventory_snapshot');
  if (snapshot && snapshot.length > 0) {
    snapshot.slice(0, 5).forEach(item => {
      console.log(`   ${item.name}: ${item.qty_on_hand} ${item.unit} on hand, ${item.avg_daily_usage} avg/day, status=${item.status}`);
    });
  } else {
    console.log('   (no inventory data — expected if no BOM entries exist yet)');
  }

  console.log('\n=== DONE ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
