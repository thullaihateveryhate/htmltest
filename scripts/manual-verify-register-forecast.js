// Manual verification: register_order via API path updates DB and feeds forecast
require('dotenv').config();
const {
  supabase,
  TEST_PREFIX,
  cleanTestData,
  insertMenuItem,
  insertIngredient,
  insertBom,
  setInventory,
} = require('../tests/helpers/supabase');

async function main() {
  const orderPrefix = '__test_verify_' + Date.now();
  const dates = ['9999-08-01', '9999-08-02', '9999-08-03', '9999-08-04', '9999-08-05', '9999-08-06', '9999-08-07'];

  await cleanTestData();

  const menuItemId = await insertMenuItem('VerifyPizza', 'Verify');
  const flourId = await insertIngredient('VerifyFlour', 'lb', 10, 2, 0.50);
  await insertBom(menuItemId, flourId, 0.5);
  await setInventory(flourId, 100);

  // Register one order per day via register_order RPC
  for (const date of dates) {
    const orderId = `${orderPrefix}${date.replace(/-/g, '')}`;
    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: orderId,
        business_date: date,
        opened_at: `${date}T12:00:00Z`,
        closed_at: `${date}T12:05:00Z`,
        num_guests: 2,
        subtotal: 20.0,
        total: 20.0,
        items: [
          { menu_item_name: `${TEST_PREFIX}VerifyPizza`, qty: 2, price: 10.0 },
        ],
      },
    });
    if (error || data?.status !== 'success') {
      throw new Error(`register_order failed for ${date}: ${error?.message || data?.message}`);
    }
  }

  const { data: forecastRes, error: forecastErr } = await supabase.rpc('generate_forecast', {
    p_days_ahead: 7,
    p_reference_date: '9999-08-08',
  });
  if (forecastErr) throw forecastErr;

  const { data: itemRows, error: itemsErr } = await supabase
    .from('forecast_items')
    .select('forecast_date, qty')
    .eq('menu_item_id', menuItemId)
    .gte('forecast_date', '9999-08-08')
    .lte('forecast_date', '9999-08-14')
    .order('forecast_date', { ascending: true });
  if (itemsErr) throw itemsErr;

  const { data: ingRows, error: ingErr } = await supabase
    .from('forecast_ingredients')
    .select('forecast_date, qty')
    .eq('ingredient_id', flourId)
    .gte('forecast_date', '9999-08-08')
    .lte('forecast_date', '9999-08-14')
    .order('forecast_date', { ascending: true });
  if (ingErr) throw ingErr;

  console.log('\nregister_order → daily_orders/sales_line_items inserted for', dates.length, 'days');
  console.log('generate_forecast result:', forecastRes);
  console.log('forecast_items sample (menu item):', itemRows);
  console.log('forecast_ingredients sample (flour):', ingRows);

  await cleanTestData();
}

main().catch((err) => {
  console.error('Verification script error:', err);
  process.exit(1);
});
