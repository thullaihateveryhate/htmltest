/**
 * Seed realistic ingredients and BOM for Tony's Pizza menu.
 *
 * Creates ~25 ingredients and links all 91 menu items
 * with realistic quantities based on pizza size.
 *
 * After seeding, reverses all existing daily closes and
 * re-runs bulk close so consumption/inventory reflect the BOM.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// Ingredients
// ============================================================
const INGREDIENTS = [
  // Base
  { name: 'Pizza Dough', unit: 'oz', reorder_point: 200, lead_time_days: 1, unit_cost: 0.12 },
  { name: 'Tomato Sauce', unit: 'oz', reorder_point: 150, lead_time_days: 2, unit_cost: 0.08 },
  { name: 'Mozzarella Cheese', unit: 'oz', reorder_point: 150, lead_time_days: 2, unit_cost: 0.22 },
  { name: 'Olive Oil', unit: 'oz', reorder_point: 40, lead_time_days: 3, unit_cost: 0.15 },

  // Meats
  { name: 'Pepperoni', unit: 'oz', reorder_point: 80, lead_time_days: 2, unit_cost: 0.35 },
  { name: 'Italian Sausage', unit: 'oz', reorder_point: 60, lead_time_days: 2, unit_cost: 0.40 },
  { name: 'Grilled Chicken', unit: 'oz', reorder_point: 80, lead_time_days: 1, unit_cost: 0.45 },
  { name: 'Ham', unit: 'oz', reorder_point: 40, lead_time_days: 2, unit_cost: 0.38 },
  { name: 'Prosciutto', unit: 'oz', reorder_point: 30, lead_time_days: 3, unit_cost: 0.75 },
  { name: 'Capocollo', unit: 'oz', reorder_point: 30, lead_time_days: 3, unit_cost: 0.65 },
  { name: 'Soppressata', unit: 'oz', reorder_point: 25, lead_time_days: 3, unit_cost: 0.70 },
  { name: 'Salami', unit: 'oz', reorder_point: 40, lead_time_days: 2, unit_cost: 0.50 },
  { name: 'Barbecue Chicken', unit: 'oz', reorder_point: 50, lead_time_days: 1, unit_cost: 0.48 },

  // Veggies
  { name: 'Mushrooms', unit: 'oz', reorder_point: 40, lead_time_days: 1, unit_cost: 0.18 },
  { name: 'Bell Peppers', unit: 'oz', reorder_point: 40, lead_time_days: 1, unit_cost: 0.12 },
  { name: 'Red Onions', unit: 'oz', reorder_point: 30, lead_time_days: 2, unit_cost: 0.08 },
  { name: 'Black Olives', unit: 'oz', reorder_point: 25, lead_time_days: 3, unit_cost: 0.25 },
  { name: 'Spinach', unit: 'oz', reorder_point: 30, lead_time_days: 1, unit_cost: 0.20 },
  { name: 'Arugula', unit: 'oz', reorder_point: 20, lead_time_days: 1, unit_cost: 0.30 },
  { name: 'Tomatoes', unit: 'oz', reorder_point: 40, lead_time_days: 1, unit_cost: 0.10 },
  { name: 'Jalapeños', unit: 'oz', reorder_point: 15, lead_time_days: 2, unit_cost: 0.12 },
  { name: 'Pineapple', unit: 'oz', reorder_point: 20, lead_time_days: 2, unit_cost: 0.15 },
  { name: 'Artichoke Hearts', unit: 'oz', reorder_point: 15, lead_time_days: 3, unit_cost: 0.35 },

  // Cheese varieties
  { name: 'Parmesan Cheese', unit: 'oz', reorder_point: 30, lead_time_days: 3, unit_cost: 0.45 },
  { name: 'Feta Cheese', unit: 'oz', reorder_point: 25, lead_time_days: 2, unit_cost: 0.40 },
  { name: 'Ricotta Cheese', unit: 'oz', reorder_point: 20, lead_time_days: 2, unit_cost: 0.30 },
  { name: 'Brie Cheese', unit: 'oz', reorder_point: 10, lead_time_days: 3, unit_cost: 0.80 },

  // Sauces/specialty
  { name: 'Pesto Sauce', unit: 'oz', reorder_point: 20, lead_time_days: 2, unit_cost: 0.35 },
  { name: 'Alfredo Sauce', unit: 'oz', reorder_point: 20, lead_time_days: 2, unit_cost: 0.30 },
  { name: 'BBQ Sauce', unit: 'oz', reorder_point: 20, lead_time_days: 2, unit_cost: 0.15 },
  { name: 'Thai Peanut Sauce', unit: 'oz', reorder_point: 10, lead_time_days: 3, unit_cost: 0.40 },
  { name: 'Calabrese Peppers', unit: 'oz', reorder_point: 15, lead_time_days: 3, unit_cost: 0.30 },
];

// ============================================================
// Size multipliers (S=1x, M=1.5x, L=2x, XL=2.5x, XXL=3x)
// ============================================================
const SIZE_MULT = { S: 1, M: 1.5, L: 2, XL: 2.5, XXL: 3 };

function getSize(name) {
  const match = name.match(/\((S|M|L|XL|XXL)\)$/);
  return match ? match[1] : 'M';
}

function getBaseName(name) {
  return name.replace(/\s*\((S|M|L|XL|XXL)\)$/, '');
}

// ============================================================
// Recipes: base pizza name -> list of { ingredient, base_oz }
// base_oz is for a Small; multiplied by size factor.
// ============================================================
// Every pizza gets: dough, olive oil
// Most get: tomato sauce, mozzarella (exceptions noted)
const BASE = [
  { ing: 'Pizza Dough', oz: 8 },
  { ing: 'Olive Oil', oz: 0.5 },
];

const TOMATO_MOZZ = [
  { ing: 'Tomato Sauce', oz: 3 },
  { ing: 'Mozzarella Cheese', oz: 4 },
];

const RECIPES = {
  'The Barbecue Chicken Pizza': [
    ...BASE, { ing: 'BBQ Sauce', oz: 3 }, { ing: 'Mozzarella Cheese', oz: 4 },
    { ing: 'Barbecue Chicken', oz: 3 }, { ing: 'Red Onions', oz: 1 },
  ],
  'The Big Meat Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Pepperoni', oz: 2 }, { ing: 'Italian Sausage', oz: 2 },
    { ing: 'Ham', oz: 1.5 }, { ing: 'Salami', oz: 1.5 },
  ],
  'The Brie Carre Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Brie Cheese', oz: 2 }, { ing: 'Prosciutto', oz: 1.5 },
    { ing: 'Arugula', oz: 0.5 },
  ],
  'The Calabrese Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Calabrese Peppers', oz: 2 }, { ing: 'Italian Sausage', oz: 2 },
    { ing: 'Red Onions', oz: 1 },
  ],
  'The California Chicken Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Grilled Chicken', oz: 3 }, { ing: 'Tomatoes', oz: 1.5 },
    { ing: 'Arugula', oz: 0.5 },
  ],
  'The Chicken Alfredo Pizza': [
    ...BASE, { ing: 'Alfredo Sauce', oz: 3 }, { ing: 'Mozzarella Cheese', oz: 4 },
    { ing: 'Grilled Chicken', oz: 3 }, { ing: 'Mushrooms', oz: 1 },
    { ing: 'Parmesan Cheese', oz: 1 },
  ],
  'The Chicken Pesto Pizza': [
    ...BASE, { ing: 'Pesto Sauce', oz: 3 }, { ing: 'Mozzarella Cheese', oz: 4 },
    { ing: 'Grilled Chicken', oz: 3 }, { ing: 'Tomatoes', oz: 1 },
  ],
  'The Classic Deluxe Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Pepperoni', oz: 1.5 }, { ing: 'Italian Sausage', oz: 1.5 },
    { ing: 'Mushrooms', oz: 1 }, { ing: 'Bell Peppers', oz: 1 },
    { ing: 'Red Onions', oz: 0.5 },
  ],
  'The Five Cheese Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Parmesan Cheese', oz: 1.5 }, { ing: 'Feta Cheese', oz: 1 },
    { ing: 'Ricotta Cheese', oz: 1 },
  ],
  'The Four Cheese Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Parmesan Cheese', oz: 1.5 }, { ing: 'Ricotta Cheese', oz: 1 },
  ],
  'The Greek Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Feta Cheese', oz: 2 }, { ing: 'Black Olives', oz: 1 },
    { ing: 'Red Onions', oz: 1 }, { ing: 'Tomatoes', oz: 1 },
  ],
  'The Green Garden Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Spinach', oz: 1.5 }, { ing: 'Mushrooms', oz: 1 },
    { ing: 'Bell Peppers', oz: 1 }, { ing: 'Tomatoes', oz: 1 },
  ],
  'The Hawaiian Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Ham', oz: 2.5 }, { ing: 'Pineapple', oz: 2 },
  ],
  'The Italian Capocollo Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Capocollo', oz: 2.5 }, { ing: 'Red Onions', oz: 0.5 },
    { ing: 'Parmesan Cheese', oz: 0.5 },
  ],
  'The Italian Supreme Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Pepperoni', oz: 1.5 }, { ing: 'Italian Sausage', oz: 1.5 },
    { ing: 'Bell Peppers', oz: 1 }, { ing: 'Black Olives', oz: 1 },
    { ing: 'Red Onions', oz: 0.5 },
  ],
  'The Italian Vegetables Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Mushrooms', oz: 1 }, { ing: 'Bell Peppers', oz: 1 },
    { ing: 'Artichoke Hearts', oz: 1 }, { ing: 'Tomatoes', oz: 1 },
    { ing: 'Black Olives', oz: 1 },
  ],
  'The Mediterranean Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Feta Cheese', oz: 1.5 }, { ing: 'Black Olives', oz: 1 },
    { ing: 'Red Onions', oz: 1 }, { ing: 'Artichoke Hearts', oz: 1 },
    { ing: 'Spinach', oz: 0.5 },
  ],
  'The Mexicana Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Jalapeños', oz: 1 }, { ing: 'Bell Peppers', oz: 1 },
    { ing: 'Red Onions', oz: 1 }, { ing: 'Tomatoes', oz: 1 },
  ],
  'The Napolitana Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Black Olives', oz: 1.5 }, { ing: 'Tomatoes', oz: 1.5 },
    { ing: 'Parmesan Cheese', oz: 0.5 },
  ],
  'The Pepper Salami Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Salami', oz: 2.5 }, { ing: 'Calabrese Peppers', oz: 1.5 },
  ],
  'The Pepperoni Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Pepperoni', oz: 3 },
  ],
  'The Pepperoni, Mushroom, and Peppers Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Pepperoni', oz: 2 }, { ing: 'Mushrooms', oz: 1.5 },
    { ing: 'Bell Peppers', oz: 1.5 },
  ],
  'The Prosciutto and Arugula Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Prosciutto', oz: 2 }, { ing: 'Arugula', oz: 1 },
    { ing: 'Parmesan Cheese', oz: 0.5 },
  ],
  'The Sicilian Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Italian Sausage', oz: 2 }, { ing: 'Pepperoni', oz: 1 },
    { ing: 'Red Onions', oz: 1 }, { ing: 'Bell Peppers', oz: 1 },
  ],
  'The Soppressata Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Soppressata', oz: 2.5 }, { ing: 'Red Onions', oz: 0.5 },
  ],
  'The Southwest Chicken Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Grilled Chicken', oz: 3 }, { ing: 'Jalapeños', oz: 1 },
    { ing: 'Red Onions', oz: 1 }, { ing: 'Bell Peppers', oz: 1 },
  ],
  'The Spicy Italian Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Italian Sausage', oz: 2 }, { ing: 'Pepperoni', oz: 1.5 },
    { ing: 'Calabrese Peppers', oz: 1.5 }, { ing: 'Jalapeños', oz: 0.5 },
  ],
  'The Spinach and Feta Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Spinach', oz: 2 }, { ing: 'Feta Cheese', oz: 2 },
    { ing: 'Red Onions', oz: 0.5 },
  ],
  'The Spinach Pesto Pizza': [
    ...BASE, { ing: 'Pesto Sauce', oz: 3 }, { ing: 'Mozzarella Cheese', oz: 4 },
    { ing: 'Spinach', oz: 2 }, { ing: 'Tomatoes', oz: 1 },
    { ing: 'Parmesan Cheese', oz: 0.5 },
  ],
  'The Spinach Supreme Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Spinach', oz: 2 }, { ing: 'Mushrooms', oz: 1 },
    { ing: 'Red Onions', oz: 0.5 }, { ing: 'Black Olives', oz: 0.5 },
    { ing: 'Feta Cheese', oz: 1 },
  ],
  'The Thai Chicken Pizza': [
    ...BASE, { ing: 'Thai Peanut Sauce', oz: 3 }, { ing: 'Mozzarella Cheese', oz: 4 },
    { ing: 'Grilled Chicken', oz: 3 }, { ing: 'Red Onions', oz: 0.5 },
    { ing: 'Bell Peppers', oz: 0.5 },
  ],
  'The Vegetables + Vegetables Pizza': [
    ...BASE, ...TOMATO_MOZZ,
    { ing: 'Mushrooms', oz: 1 }, { ing: 'Bell Peppers', oz: 1 },
    { ing: 'Red Onions', oz: 1 }, { ing: 'Tomatoes', oz: 1 },
    { ing: 'Spinach', oz: 0.5 }, { ing: 'Black Olives', oz: 0.5 },
  ],
};

async function main() {
  console.log('=== Seeding Ingredients + BOM for Tony\'s Pizza ===\n');

  // 1. Clean old seed data (keep the Cheeseburger test ingredient)
  console.log('1. Cleaning old ingredients/BOM...');
  await supabase.from('bom').delete().neq('menu_item_id', '00000000-0000-0000-0000-000000000000');
  // Delete old ingredients except the seed Cheeseburger one
  await supabase.from('inventory_txns').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('inventory_on_hand').delete().neq('ingredient_id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('ingredients').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('   Done\n');

  // 2. Insert ingredients
  console.log('2. Inserting ingredients...');
  const ingMap = {};
  for (const ing of INGREDIENTS) {
    const { data, error } = await supabase.from('ingredients')
      .insert(ing).select('id, name').single();
    if (error) { console.error('   ERROR inserting', ing.name, error.message); continue; }
    ingMap[data.name] = data.id;
  }
  console.log(`   ${Object.keys(ingMap).length} ingredients created\n`);

  // Set initial inventory (generous starting stock)
  console.log('3. Setting initial inventory...');
  for (const [name, id] of Object.entries(ingMap)) {
    const ing = INGREDIENTS.find(i => i.name === name);
    const startQty = ing.reorder_point * 10; // 10x reorder point
    await supabase.from('inventory_on_hand').upsert({
      ingredient_id: id, qty_on_hand: startQty, updated_at: new Date().toISOString()
    });
  }
  console.log(`   ${Object.keys(ingMap).length} inventory rows set\n`);

  // 3. Fetch menu items
  const { data: menuItems } = await supabase.from('menu_items').select('id, name');
  console.log(`4. Linking ${menuItems.length} menu items to ingredients...`);

  let bomCount = 0;
  let skipped = [];

  for (const item of menuItems) {
    const baseName = getBaseName(item.name);
    const size = getSize(item.name);
    const mult = SIZE_MULT[size] || 1;

    const recipe = RECIPES[baseName];
    if (!recipe) {
      skipped.push(baseName);
      continue;
    }

    for (const { ing, oz } of recipe) {
      const ingId = ingMap[ing];
      if (!ingId) { console.error('   Missing ingredient:', ing); continue; }

      const qty = Math.round(oz * mult * 100) / 100;
      const { error } = await supabase.from('bom').insert({
        menu_item_id: item.id,
        ingredient_id: ingId,
        qty_per_item: qty
      });
      if (error) { console.error('   BOM error:', item.name, ing, error.message); continue; }
      bomCount++;
    }
  }

  console.log(`   ${bomCount} BOM entries created`);
  if (skipped.length > 0) {
    const unique = [...new Set(skipped)];
    console.log(`   Skipped (no recipe): ${unique.join(', ')}`);
  }

  // 4. Re-run bulk close to compute consumption
  console.log('\n5. Running bulk close (recomputing all consumption)...');
  const { data: closeData, error: closeErr } = await supabase.rpc('run_bulk_close');
  if (closeErr) {
    console.error('   ERROR:', closeErr.message);
  } else {
    console.log(`   ${closeData.dates_processed} dates processed, ${closeData.total_consume_txns} consume txns`);
  }

  // 5. Generate forecast
  console.log('\n6. Generating 7-day forecast...');
  const { data: fcData } = await supabase.rpc('generate_forecast', {
    p_days_ahead: 7,
    p_reference_date: '2016-01-01'
  });
  console.log(`   ${fcData.item_forecasts} item forecasts, ${fcData.ingredient_forecasts} ingredient forecasts`);

  // 6. Snapshot
  console.log('\n7. Inventory snapshot (top 10 by urgency):');
  const { data: snap } = await supabase.rpc('get_inventory_snapshot');
  if (snap && snap.length > 0) {
    snap.slice(0, 10).forEach(r => {
      console.log(`   ${r.name}: ${r.qty_on_hand} ${r.unit} | avg/day: ${r.avg_daily_usage} | supply: ${r.days_of_supply} days | ${r.status}`);
    });
  }

  // 7. Forecast check
  console.log('\n8. Forecast (first 10 rows):');
  const { data: fc } = await supabase.rpc('get_forecast', { p_reference_date: '2016-01-01' });
  if (fc && fc.length > 0) {
    fc.slice(0, 10).forEach(r => {
      console.log(`   ${r.forecast_date} | ${r.name}: need ${r.qty_needed} ${r.unit} | on_hand: ${r.qty_on_hand} | shortfall: ${r.shortfall}`);
    });
  }

  console.log('\n=== DONE ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
