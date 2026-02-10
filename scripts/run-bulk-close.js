/**
 * Standalone bulk-close runner.
 * Calls the run_bulk_close RPC to process all unclosed sales dates.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('Running bulk close...');
  const { data, error } = await supabase.rpc('run_bulk_close');
  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  console.log(`  ${data.dates_processed} dates processed`);
  console.log(`  ${data.total_consume_txns} consumption transactions created`);
  console.log('Done.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
