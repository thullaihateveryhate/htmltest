/**
 * Shared Supabase client and test helpers.
 *
 * ISOLATION STRATEGY:
 * All test data uses a "__test__" prefix in name fields and
 * '9999-' year dates so it never collides with real data.
 * cleanTestData() only removes rows matching these markers.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Test data markers
const TEST_PREFIX = '__test__';
const TEST_DATE_RANGE_START = '9999-01-01';
const TEST_DATE_RANGE_END = '9999-12-31';

/**
 * Clean up ONLY test data. Never touches real/production rows.
 * Uses the __test__ prefix and 9999-* dates as markers.
 */
async function cleanTestData() {
  // Delete txns for test ingredients (by joining on name prefix)
  const { data: testIngs } = await supabase
    .from('ingredients')
    .select('id')
    .like('name', `${TEST_PREFIX}%`);
  const testIngIds = (testIngs || []).map(i => i.id);

  if (testIngIds.length > 0) {
    await supabase.from('inventory_txns').delete().in('ingredient_id', testIngIds);
    await supabase.from('inventory_on_hand').delete().in('ingredient_id', testIngIds);
  }

  // Delete test sales (by date range)
  await supabase.from('sales_line_items').delete().gte('business_date', TEST_DATE_RANGE_START);

  // Delete test BOM entries (by test menu items)
  const { data: testItems } = await supabase
    .from('menu_items')
    .select('id')
    .like('name', `${TEST_PREFIX}%`);
  const testItemIds = (testItems || []).map(i => i.id);

  if (testItemIds.length > 0) {
    await supabase.from('bom').delete().in('menu_item_id', testItemIds);
    await supabase.from('sales_line_items').delete().in('menu_item_id', testItemIds);
  }

  // Delete test ingredients and menu items
  if (testIngIds.length > 0) {
    await supabase.from('bom').delete().in('ingredient_id', testIngIds);
    await supabase.from('ingredients').delete().in('id', testIngIds);
  }
  if (testItemIds.length > 0) {
    await supabase.from('menu_items').delete().in('id', testItemIds);
  }
}

/**
 * Save current onboarding state so we can restore it after tests.
 */
let _savedOnboardingState = null;

async function saveOnboardingState() {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'onboarding')
    .single();
  _savedOnboardingState = data ? data.value : null;
}

async function restoreOnboardingState() {
  if (_savedOnboardingState) {
    await supabase.from('app_config').update({
      value: _savedOnboardingState,
      updated_at: new Date().toISOString()
    }).eq('key', 'onboarding');
  }
}

/**
 * Insert a test menu item (prefixed) and return its id.
 */
async function insertMenuItem(name, category = 'Test') {
  const { data, error } = await supabase
    .from('menu_items')
    .insert({ name: `${TEST_PREFIX}${name}`, category })
    .select('id')
    .single();
  if (error) throw new Error(`insertMenuItem: ${error.message}`);
  return data.id;
}

/**
 * Insert a test ingredient (prefixed) and return its id.
 */
async function insertIngredient(name, unit = 'lb', reorderPoint = 5, leadTimeDays = 2, unitCost = 1.00) {
  const { data, error } = await supabase
    .from('ingredients')
    .insert({
      name: `${TEST_PREFIX}${name}`,
      unit,
      reorder_point: reorderPoint,
      lead_time_days: leadTimeDays,
      unit_cost: unitCost
    })
    .select('id')
    .single();
  if (error) throw new Error(`insertIngredient: ${error.message}`);
  return data.id;
}

/**
 * Insert a BOM entry (recipe link).
 */
async function insertBom(menuItemId, ingredientId, qtyPerItem) {
  const { error } = await supabase
    .from('bom')
    .insert({ menu_item_id: menuItemId, ingredient_id: ingredientId, qty_per_item: qtyPerItem });
  if (error) throw new Error(`insertBom: ${error.message}`);
}

/**
 * Set inventory on hand for an ingredient.
 */
async function setInventory(ingredientId, qty) {
  const { error } = await supabase
    .from('inventory_on_hand')
    .upsert({ ingredient_id: ingredientId, qty_on_hand: qty, updated_at: new Date().toISOString() });
  if (error) throw new Error(`setInventory: ${error.message}`);
}

/**
 * Get current inventory on hand for an ingredient.
 */
async function getInventory(ingredientId) {
  const { data, error } = await supabase
    .from('inventory_on_hand')
    .select('qty_on_hand')
    .eq('ingredient_id', ingredientId)
    .single();
  if (error) return null;
  return parseFloat(data.qty_on_hand);
}

/**
 * Get inventory txns for an ingredient.
 */
async function getTxns(ingredientId, txnType = null) {
  let q = supabase.from('inventory_txns').select('*').eq('ingredient_id', ingredientId);
  if (txnType) q = q.eq('txn_type', txnType);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw new Error(`getTxns: ${error.message}`);
  return data;
}

/**
 * Count test sales rows only (by date range 9999-*).
 */
async function countTestSales() {
  const { count, error } = await supabase
    .from('sales_line_items')
    .select('*', { count: 'exact', head: true })
    .gte('business_date', TEST_DATE_RANGE_START);
  if (error) throw new Error(`countTestSales: ${error.message}`);
  return count;
}

/**
 * Insert a test sales row directly.
 */
async function insertSale(menuItemId, businessDate, qty, netSales) {
  const { error } = await supabase.from('sales_line_items').insert({
    business_date: businessDate,
    menu_item_id: menuItemId,
    qty,
    net_sales: netSales,
    source: 'test'
  });
  if (error) throw new Error(`insertSale: ${error.message}`);
}

module.exports = {
  supabase,
  TEST_PREFIX,
  TEST_DATE_RANGE_START,
  cleanTestData,
  saveOnboardingState,
  restoreOnboardingState,
  insertMenuItem,
  insertIngredient,
  insertBom,
  setInventory,
  getInventory,
  getTxns,
  countTestSales,
  insertSale,
};
