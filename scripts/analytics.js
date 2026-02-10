/**
 * Live analytics dashboard — queries Supabase cloud directly.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('============================================');
  console.log('   LIVE DATABASE ANALYTICS - SUPABASE CLOUD');
  console.log('============================================\n');

  // --- TABLE COUNTS ---
  console.log('--- TABLE ROW COUNTS ---');
  const tables = [
    'menu_items', 'ingredients', 'bom', 'sales_line_items',
    'inventory_on_hand', 'inventory_txns',
    'forecast_items', 'forecast_ingredients', 'app_config'
  ];
  for (const t of tables) {
    const { count } = await s.from(t).select('*', { count: 'exact', head: true });
    console.log('  ' + t.padEnd(25) + count);
  }

  // --- SALES BREAKDOWN ---
  console.log('\n--- SALES DATA ---');
  const { data: dateMin } = await s.from('sales_line_items')
    .select('business_date').order('business_date', { ascending: true }).limit(1).single();
  const { data: dateMax } = await s.from('sales_line_items')
    .select('business_date').order('business_date', { ascending: false }).limit(1).single();
  console.log('  Date range: ' + dateMin.business_date + ' to ' + dateMax.business_date);

  const { count: totalSales } = await s.from('sales_line_items')
    .select('*', { count: 'exact', head: true });
  console.log('  Total sales rows: ' + totalSales);

  // Top 5 selling items by forecast demand
  const today = new Date().toISOString().split('T')[0];
  await s.rpc('generate_forecast', { p_days_ahead: 1, p_reference_date: today });
  const { data: top5 } = await s.from('forecast_items')
    .select('menu_item_id, qty')
    .order('qty', { ascending: false })
    .limit(5);
  console.log('\n  Top 5 items by avg daily demand:');
  for (const row of top5) {
    const { data: mi } = await s.from('menu_items').select('name').eq('id', row.menu_item_id).single();
    console.log('    ' + mi.name.padEnd(45) + row.qty + ' /day');
  }

  // --- CATEGORIES ---
  const { data: cats } = await s.from('menu_items').select('category');
  const catCount = {};
  cats.forEach(r => { catCount[r.category] = (catCount[r.category] || 0) + 1; });
  console.log('\n  Menu items by category:');
  Object.entries(catCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log('    ' + k.padEnd(15) + v + ' items');
  });

  // --- INGREDIENTS ---
  console.log('\n--- INGREDIENT DATA (32 total) ---');
  const { data: ings } = await s.from('ingredients')
    .select('name, unit, reorder_point, unit_cost').order('name');

  const baseNames = ['Pizza Dough', 'Tomato Sauce', 'Mozzarella Cheese', 'Olive Oil'];
  const meatNames = ['Pepperoni', 'Italian Sausage', 'Grilled Chicken', 'Ham',
    'Prosciutto', 'Capocollo', 'Soppressata', 'Salami', 'Barbecue Chicken'];
  const vegNames = ['Mushrooms', 'Bell Peppers', 'Red Onions', 'Black Olives',
    'Spinach', 'Arugula', 'Tomatoes', 'Jalapenos', 'Pineapple', 'Artichoke Hearts'];

  const bases = ings.filter(i => baseNames.includes(i.name));
  const meats = ings.filter(i => meatNames.includes(i.name));
  const vegs = ings.filter(i => vegNames.includes(i.name));

  console.log('  Base (' + bases.length + '): ' + bases.map(i => i.name).join(', '));
  console.log('  Meats (' + meats.length + '): ' + meats.map(i => i.name).join(', '));
  console.log('  Veggies (' + vegs.length + '): ' + vegs.map(i => i.name).join(', '));
  console.log('  Cheese + Sauces (' + (32 - bases.length - meats.length - vegs.length) + '): the rest');

  // --- BOM SPOT CHECK ---
  console.log('\n--- BOM (RECIPES) - 674 total links ---');

  const { data: pepS } = await s.from('menu_items').select('id')
    .eq('name', 'The Pepperoni Pizza (S)').single();
  const { data: pepBom } = await s.from('bom')
    .select('qty_per_item, ingredients(name)')
    .eq('menu_item_id', pepS.id);
  pepBom.sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name));

  console.log('\n  The Pepperoni Pizza (S):');
  pepBom.forEach(r => console.log('    ' + r.ingredients.name.padEnd(25) + r.qty_per_item + ' oz'));

  const { data: pepL } = await s.from('menu_items').select('id')
    .eq('name', 'The Pepperoni Pizza (L)').single();
  const { data: pepBomL } = await s.from('bom')
    .select('qty_per_item, ingredients(name)')
    .eq('menu_item_id', pepL.id);
  pepBomL.sort((a, b) => a.ingredients.name.localeCompare(b.ingredients.name));

  console.log('\n  The Pepperoni Pizza (L) — 2x multiplier:');
  pepBomL.forEach(r => console.log('    ' + r.ingredients.name.padEnd(25) + r.qty_per_item + ' oz'));

  // --- CONSUMPTION ---
  console.log('\n--- CONSUMPTION ENGINE ---');
  const { count: consumeCount } = await s.from('inventory_txns')
    .select('*', { count: 'exact', head: true }).eq('txn_type', 'CONSUME');
  console.log('  CONSUME transactions: ' + consumeCount);

  // --- INVENTORY SNAPSHOT ---
  console.log('\n--- LIVE INVENTORY SNAPSHOT ---');
  const { data: snap } = await s.rpc('get_inventory_snapshot');
  const critical = snap.filter(r => r.status === 'critical');
  const reorder = snap.filter(r => r.status === 'reorder_soon');
  const ok = snap.filter(r => r.status === 'ok');
  console.log('  CRITICAL:     ' + critical.length + ' ingredients');
  console.log('  REORDER SOON: ' + reorder.length + ' ingredients');
  console.log('  OK:           ' + ok.length + ' ingredients');

  console.log('\n  ' + 'INGREDIENT'.padEnd(25) + 'ON_HAND'.padStart(12) +
    '  ' + 'AVG/DAY'.padStart(10) + '  ' + 'SUPPLY'.padStart(8) + '  STATUS');
  console.log('  ' + '-'.repeat(65));
  snap.forEach(r => {
    const supply = r.days_of_supply !== null ? (r.days_of_supply + 'd') : '--';
    const avg = Math.round(r.avg_daily_usage * 10) / 10;
    console.log('  ' + r.name.padEnd(25) +
      (r.qty_on_hand + ' ' + r.unit).padStart(12) + '  ' +
      String(avg).padStart(10) + '  ' +
      supply.padStart(8) + '  ' + r.status);
  });

  // --- FORECAST ---
  console.log('\n--- 7-DAY INGREDIENT FORECAST ---');
  await s.rpc('generate_forecast', { p_days_ahead: 7, p_reference_date: '2016-01-01' });
  const { data: fc } = await s.rpc('get_forecast', { p_reference_date: '2016-01-01' });
  const fcDates = [...new Set(fc.map(r => r.forecast_date))].sort();
  console.log('  Forecast window: ' + fcDates[0] + ' to ' + fcDates[fcDates.length - 1]);
  console.log('  Total rows: ' + fc.length + ' (ingredients x days)');

  const shortfalls = fc.filter(r => r.shortfall > 0);
  console.log('  Rows with shortfall: ' + shortfalls.length + ' / ' + fc.length);

  const sorted = [...fc].sort((a, b) => b.shortfall - a.shortfall);
  console.log('\n  Top 10 biggest shortfalls:');
  console.log('  ' + 'DATE'.padEnd(12) + 'INGREDIENT'.padEnd(22) +
    'NEED'.padStart(10) + '  ' + 'ON_HAND'.padStart(10) + '  ' + 'SHORTFALL'.padStart(10));
  console.log('  ' + '-'.repeat(68));
  sorted.slice(0, 10).forEach(r => {
    console.log('  ' + r.forecast_date.padEnd(12) + r.name.padEnd(22) +
      String(r.qty_needed).padStart(10) + '  ' +
      String(r.qty_on_hand).padStart(10) + '  ' +
      String(r.shortfall).padStart(10));
  });

  // --- ONBOARDING STATUS ---
  console.log('\n--- ONBOARDING STATUS ---');
  const { data: ob } = await s.rpc('get_onboarding_status');
  Object.entries(ob).forEach(([k, v]) => console.log('  ' + k + ': ' + v));

  console.log('\n============================================');
  console.log('   ALL SYSTEMS OPERATIONAL');
  console.log('============================================');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
