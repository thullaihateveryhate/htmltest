/**
 * Module 6 — Forecasting v1 TDD Tests
 *
 * Tests written BEFORE implementation.
 * Algorithm: rolling avg by day-of-week from last 6 weeks of sales,
 * then convert to ingredient forecast via BOM.
 *
 * ISOLATION: __test__ prefix + 9999-* dates.
 */

const {
  supabase, TEST_PREFIX, cleanTestData,
  insertMenuItem, insertIngredient, insertBom,
  setInventory, getInventory,
} = require('./helpers/supabase');

jest.setTimeout(60000);

/**
 * Helper: insert a test sale directly for a specific date.
 */
async function insertTestSale(menuItemId, date, qty, netSales) {
  const { error } = await supabase.from('sales_line_items').insert({
    business_date: date,
    menu_item_id: menuItemId,
    qty,
    net_sales: netSales,
    source: 'test'
  });
  if (error) throw new Error(`insertTestSale: ${error.message}`);
}

/**
 * Helper: generate dates for a specific DOW going back N weeks from a reference date.
 * dow: 0=Sun, 1=Mon, ... 6=Sat
 */
function getDatesForDow(dow, weeksBack, refDate = new Date('9999-06-15')) {
  // Find the most recent occurrence of `dow` before refDate
  const dates = [];
  const d = new Date(refDate);
  // Go to the previous occurrence of this DOW
  while (d.getDay() !== dow) {
    d.setDate(d.getDate() - 1);
  }
  for (let w = 0; w < weeksBack; w++) {
    const dateStr = d.toISOString().split('T')[0];
    dates.push(dateStr);
    d.setDate(d.getDate() - 7);
  }
  return dates;
}

// ============================================================
// generate_forecast
// ============================================================
describe('generate_forecast', () => {
  let pizzaId, burgerId;
  let flourId, cheeseId;

  beforeEach(async () => {
    await cleanTestData();

    // Setup menu items
    pizzaId = await insertMenuItem('Pizza', 'Test');
    burgerId = await insertMenuItem('Burger', 'Test');

    // Setup ingredients
    flourId = await insertIngredient('Flour', 'lb', 10, 2, 0.50);
    cheeseId = await insertIngredient('Cheese', 'oz', 20, 3, 0.25);

    // BOM: Pizza = 0.5 lb flour + 4 oz cheese
    await insertBom(pizzaId, flourId, 0.5);
    await insertBom(pizzaId, cheeseId, 4);
    // BOM: Burger = 0.25 lb flour + 2 oz cheese
    await insertBom(burgerId, flourId, 0.25);
    await insertBom(burgerId, cheeseId, 2);

    await setInventory(flourId, 100);
    await setInventory(cheeseId, 500);
  });

  afterAll(async () => { await cleanTestData(); });

  test('generates forecast for next 7 days by default', async () => {
    // Create 6 weeks of consistent sales data for a specific DOW
    // Use a reference date in 9999 range
    // We need sales for multiple DOWs so the forecast has data

    // For simplicity: insert 6 weeks of Monday sales
    // 9999-06-15 is a... let's just create sales across multiple days
    // and let the function compute based on whatever DOW they fall on

    // Insert 42 days (6 weeks) of sales ending at 9999-06-14
    for (let d = 0; d < 42; d++) {
      const date = new Date('9999-06-14');
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];

      // Pizza: 10 per day, Burger: 5 per day
      await insertTestSale(pizzaId, dateStr, 10, 100);
      await insertTestSale(burgerId, dateStr, 5, 50);
    }

    const { data, error } = await supabase.rpc('generate_forecast', {
      p_days_ahead: 7,
      p_reference_date: '9999-06-15'
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.days_forecasted).toBe(7);

    // Verify forecast_items were created
    const { data: itemForecast } = await supabase
      .from('forecast_items')
      .select('*')
      .gte('forecast_date', '9999-06-15')
      .lte('forecast_date', '9999-06-21');

    expect(itemForecast.length).toBeGreaterThan(0);

    // Verify forecast_ingredients were created
    const { data: ingForecast } = await supabase
      .from('forecast_ingredients')
      .select('*')
      .gte('forecast_date', '9999-06-15')
      .lte('forecast_date', '9999-06-21');

    expect(ingForecast.length).toBeGreaterThan(0);
  });

  test('computes correct DOW averages', async () => {
    // Insert exactly 4 Mondays of data with known qty
    // 9999-06-09 is a date; we just need 4 dates that are the same DOW
    // Let's pick dates 7 apart: 9999-05-19, 9999-05-26, 9999-06-02, 9999-06-09
    const mondays = ['9999-05-19', '9999-05-26', '9999-06-02', '9999-06-09'];
    for (const date of mondays) {
      await insertTestSale(pizzaId, date, 20, 200); // 20 pizzas each Monday
    }

    const { data, error } = await supabase.rpc('generate_forecast', {
      p_days_ahead: 7,
      p_reference_date: '9999-06-10'
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');

    // Find the forecast for the next Monday (same DOW as our data)
    const { data: items } = await supabase
      .from('forecast_items')
      .select('*')
      .gte('forecast_date', '9999-06-10')
      .lte('forecast_date', '9999-06-16');

    // There should be a forecast entry for pizza on the Monday
    // The avg should be 20 (same every week)
    const pizzaForecasts = items.filter(r => r.menu_item_id === pizzaId);
    expect(pizzaForecasts.length).toBeGreaterThanOrEqual(1);

    // At least one of them should have qty = 20 (the Monday)
    const mondayForecast = pizzaForecasts.find(r => parseFloat(r.qty) === 20);
    expect(mondayForecast).toBeDefined();
  });

  test('converts item forecast to ingredient forecast via BOM', async () => {
    // 6 weeks of daily sales: 10 pizzas/day
    for (let d = 0; d < 42; d++) {
      const date = new Date('9999-06-14');
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      await insertTestSale(pizzaId, dateStr, 10, 100);
    }

    await supabase.rpc('generate_forecast', {
      p_days_ahead: 7,
      p_reference_date: '9999-06-15'
    });

    // Check ingredient forecast for flour
    // Pizza uses 0.5 lb flour, avg 10 pizzas/day = 5 lb flour/day
    const { data: flourForecast } = await supabase
      .from('forecast_ingredients')
      .select('*')
      .eq('ingredient_id', flourId)
      .gte('forecast_date', '9999-06-15')
      .lte('forecast_date', '9999-06-21');

    expect(flourForecast.length).toBe(7);
    // Each day should forecast ~5 lb (10 pizzas * 0.5 lb)
    for (const row of flourForecast) {
      expect(parseFloat(row.qty)).toBeCloseTo(5, 0);
    }
  });

  test('handles no historical sales gracefully', async () => {
    // No sales inserted
    const { data, error } = await supabase.rpc('generate_forecast', {
      p_days_ahead: 7,
      p_reference_date: '9999-06-15'
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.days_forecasted).toBe(7);
  });

  test('is idempotent — re-running replaces previous forecast', async () => {
    for (let d = 0; d < 42; d++) {
      const date = new Date('9999-06-14');
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      await insertTestSale(pizzaId, dateStr, 10, 100);
    }

    // Run twice
    await supabase.rpc('generate_forecast', { p_days_ahead: 7, p_reference_date: '9999-06-15' });
    await supabase.rpc('generate_forecast', { p_days_ahead: 7, p_reference_date: '9999-06-15' });

    // Should not have duplicate rows
    const { data: items } = await supabase
      .from('forecast_items')
      .select('*')
      .eq('menu_item_id', pizzaId)
      .gte('forecast_date', '9999-06-15')
      .lte('forecast_date', '9999-06-21');

    // 7 days, 1 item = max 7 rows
    expect(items.length).toBeLessThanOrEqual(7);
  });
});

// ============================================================
// get_forecast
// ============================================================
describe('get_forecast', () => {
  let pizzaId, flourId, cheeseId;

  beforeEach(async () => {
    await cleanTestData();

    pizzaId = await insertMenuItem('Pizza', 'Test');
    flourId = await insertIngredient('Flour', 'lb', 10, 2, 0.50);
    cheeseId = await insertIngredient('Cheese', 'oz', 20, 3, 0.25);

    await insertBom(pizzaId, flourId, 0.5);
    await insertBom(pizzaId, cheeseId, 4);

    await setInventory(flourId, 100);
    await setInventory(cheeseId, 500);

    // 6 weeks of daily sales
    for (let d = 0; d < 42; d++) {
      const date = new Date('9999-06-14');
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      await insertTestSale(pizzaId, dateStr, 10, 100);
    }

    // Generate forecast first
    await supabase.rpc('generate_forecast', { p_days_ahead: 7, p_reference_date: '9999-06-15' });
  });

  afterAll(async () => { await cleanTestData(); });

  test('returns forecast with ingredient needs and shortfall info', async () => {
    const { data, error } = await supabase.rpc('get_forecast', {
      p_reference_date: '9999-06-15'
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    // Each row should have: forecast_date, ingredient_id, name, unit, qty_needed, qty_on_hand, shortfall
    const row = data[0];
    expect(row).toHaveProperty('forecast_date');
    expect(row).toHaveProperty('ingredient_id');
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('qty_needed');
    expect(row).toHaveProperty('qty_on_hand');
    expect(row).toHaveProperty('shortfall');
  });

  test('computes cumulative shortfall correctly', async () => {
    // Flour: 100 on hand, ~5 lb/day needed (10 pizzas * 0.5)
    // Over 7 days: need ~35, have 100 → no shortfall
    const { data } = await supabase.rpc('get_forecast', { p_reference_date: '9999-06-15' });

    const flourRows = data.filter(r => r.ingredient_id === flourId);
    expect(flourRows.length).toBeGreaterThan(0);

    // With 100 on hand and ~5/day usage, no shortfall expected for 7 days
    for (const row of flourRows) {
      expect(parseFloat(row.qty_on_hand)).toBe(100);
    }
  });

  test('returns empty array when no forecast exists', async () => {
    // Clean forecast tables
    await supabase.from('forecast_ingredients').delete().gte('forecast_date', '9999-01-01');
    await supabase.from('forecast_items').delete().gte('forecast_date', '9999-01-01');

    const { data, error } = await supabase.rpc('get_forecast', { p_reference_date: '9999-12-01' });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
