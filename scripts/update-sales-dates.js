require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function updateBatch() {
  // Get 1000 records with 2015 dates
  const { data: sales } = await supabase
    .from('sales_line_items')
    .select('id, business_date')
    .gte('business_date', '2015-01-01')
    .lt('business_date', '2016-01-01')
    .limit(1000);

  if (!sales || sales.length === 0) {
    return 0;
  }

  // Update each record
  for (const record of sales) {
    const oldDate = new Date(record.business_date);
    const newDate = new Date(oldDate);
    newDate.setFullYear(2025);

    await supabase
      .from('sales_line_items')
      .update({ business_date: newDate.toISOString().split('T')[0] })
      .eq('id', record.id);
  }

  return sales.length;
}

async function main() {
  console.log('Updating sales_line_items dates from 2015 to 2025...\n');

  let totalUpdated = 0;
  let batchNum = 1;

  while (true) {
    const updated = await updateBatch();
    if (updated === 0) break;

    totalUpdated += updated;
    console.log(`Batch ${batchNum}: Updated ${updated} records (Total: ${totalUpdated})`);
    batchNum++;
  }

  console.log(`\n✓ Done! Updated ${totalUpdated} total records from 2015 to 2025`);
}

main();
