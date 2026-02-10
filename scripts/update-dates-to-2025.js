require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('=== Updating All Dates from 2015 to 2025 ===\n');

  // 1. Update sales_line_items
  console.log('1. Updating sales_line_items...');

  // Get all sales records from 2015
  const { data: sales } = await supabase
    .from('sales_line_items')
    .select('id, business_date')
    .gte('business_date', '2015-01-01')
    .lt('business_date', '2016-01-01');

  console.log(`   Found ${sales?.length || 0} records to update`);

  // Update in batches
  if (sales && sales.length > 0) {
    for (let i = 0; i < sales.length; i += 100) {
      const batch = sales.slice(i, i + 100);
      for (const record of batch) {
        const oldDate = new Date(record.business_date);
        const newDate = new Date(oldDate);
        newDate.setFullYear(2025);

        await supabase
          .from('sales_line_items')
          .update({ business_date: newDate.toISOString().split('T')[0] })
          .eq('id', record.id);
      }
      console.log(`   Updated ${Math.min(i + 100, sales.length)}/${sales.length} sales records`);
    }
  }
  console.log('   ✓ Sales line items updated\n');

  // 2. Update inventory_txns
  console.log('2. Updating inventory_txns...');
  const { data: txns } = await supabase
    .from('inventory_txns')
    .select('id, business_date')
    .not('business_date', 'is', null)
    .gte('business_date', '2015-01-01')
    .lt('business_date', '2016-01-01');

  if (txns && txns.length > 0) {
    console.log(`   Found ${txns.length} transaction records to update`);
    for (let i = 0; i < txns.length; i += 100) {
      const batch = txns.slice(i, i + 100);
      for (const record of batch) {
        const oldDate = new Date(record.business_date);
        const newDate = new Date(oldDate);
        newDate.setFullYear(2025);

        await supabase
          .from('inventory_txns')
          .update({ business_date: newDate.toISOString().split('T')[0] })
          .eq('id', record.id);
      }
      console.log(`   Updated ${Math.min(i + 100, txns.length)}/${txns.length} transaction records`);
    }
  }
  console.log('   ✓ Inventory transactions updated\n');

  // 3. Update daily_orders
  console.log('3. Updating daily_orders...');
  const { data: orders } = await supabase
    .from('daily_orders')
    .select('id, business_date, opened_at, closed_at')
    .gte('business_date', '2015-01-01')
    .lt('business_date', '2016-01-01');

  if (orders && orders.length > 0) {
    console.log(`   Found ${orders.length} order records to update`);
    for (const record of orders) {
      const oldDate = new Date(record.business_date);
      const newDate = new Date(oldDate);
      newDate.setFullYear(2025);

      // Update timestamps too
      let newOpened = null;
      let newClosed = null;

      if (record.opened_at) {
        newOpened = new Date(record.opened_at);
        newOpened.setFullYear(2025);
      }

      if (record.closed_at) {
        newClosed = new Date(record.closed_at);
        newClosed.setFullYear(2025);
      }

      await supabase
        .from('daily_orders')
        .update({
          business_date: newDate.toISOString().split('T')[0],
          opened_at: newOpened?.toISOString(),
          closed_at: newClosed?.toISOString()
        })
        .eq('id', record.id);
    }
    console.log(`   Updated ${orders.length} order records`);
  }
  console.log('   ✓ Daily orders updated\n');

  // 4. Update app_config
  console.log('4. Updating app_config...');
  const { data: config } = await supabase
    .from('app_config')
    .select('*')
    .eq('key', 'onboarding');

  if (config && config.length > 0) {
    const value = config[0].value;
    if (value.history_start_date?.includes('2015')) {
      value.history_start_date = '2025-01-01';
    }
    if (value.history_end_date?.includes('2015')) {
      value.history_end_date = '2025-12-31';
    }

    await supabase
      .from('app_config')
      .update({ value })
      .eq('key', 'onboarding');

    console.log('   ✓ App config updated\n');
  }

  // 5. Regenerate forecasts with new reference date
  console.log('5. Regenerating forecasts for 2026...');
  const { data: forecast, error: forecastError } = await supabase.rpc('generate_forecast', {
    p_days_ahead: 7,
    p_reference_date: '2026-01-01'
  });

  if (forecastError) {
    console.error('   Error generating forecast:', forecastError);
  } else {
    console.log(`   ✓ Generated ${forecast.item_forecasts} item forecasts, ${forecast.ingredient_forecasts} ingredient forecasts\n`);
  }

  // 6. Verify updates
  console.log('6. Verifying updates...');
  const { data: sampleSales } = await supabase
    .from('sales_line_items')
    .select('business_date')
    .order('business_date', { ascending: false })
    .limit(1);

  const { data: sampleTxn } = await supabase
    .from('inventory_txns')
    .select('business_date')
    .not('business_date', 'is', null)
    .order('business_date', { ascending: false })
    .limit(1);

  console.log(`   Latest sales date: ${sampleSales?.[0]?.business_date || 'none'}`);
  console.log(`   Latest transaction date: ${sampleTxn?.[0]?.business_date || 'none'}`);

  console.log('\n=== Done! All dates updated to 2025 ===');
  console.log('Note: Forecasts are now set for early 2026 (next 7 days from 2026-01-01)');
}

main().catch(console.error);
