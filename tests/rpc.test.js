/**
 * Backend RPC Integration Tests
 *
 * ISOLATION: All test data uses __test__ prefix and 9999-* dates.
 * Production data is never touched.
 */

const {
  supabase, TEST_PREFIX, cleanTestData,
  saveOnboardingState, restoreOnboardingState,
  insertMenuItem, insertIngredient, insertBom,
  setInventory, getInventory, getTxns, countTestSales, insertSale,
} = require('./helpers/supabase');

jest.setTimeout(30000);

// ============================================================
// 1. ingest_daily_sales
// ============================================================
describe('ingest_daily_sales', () => {
  beforeEach(async () => { await cleanTestData(); });
  afterAll(async () => { await cleanTestData(); });

  test('ingests rows and auto-creates menu items', async () => {
    const { data, error } = await supabase.rpc('ingest_daily_sales', {
      p_rows: [
        { business_date: '9999-06-01', menu_item_name: `${TEST_PREFIX}Margherita (M)`, category: 'Classic', qty: 5, net_sales: 75.00, source: 'toast' },
        { business_date: '9999-06-01', menu_item_name: `${TEST_PREFIX}Pepperoni (L)`, category: 'Classic', qty: 3, net_sales: 60.00, source: 'toast' },
      ]
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.rows_processed).toBe(2);
    expect(data.menu_items_created).toBe(2);

    const count = await countTestSales();
    expect(count).toBe(2);
  });

  test('re-upload same date+item REPLACES (does not double-count)', async () => {
    const rows = [
      { business_date: '9999-06-01', menu_item_name: `${TEST_PREFIX}Margherita (M)`, category: 'Classic', qty: 5, net_sales: 75.00, source: 'toast' },
    ];

    await supabase.rpc('ingest_daily_sales', { p_rows: rows });

    const updated = [{ ...rows[0], qty: 10, net_sales: 150.00 }];
    const { data, error } = await supabase.rpc('ingest_daily_sales', { p_rows: updated });

    expect(error).toBeNull();
    expect(data.menu_items_created).toBe(0);

    // Get the test menu item id
    const { data: item } = await supabase.from('menu_items')
      .select('id').eq('name', `${TEST_PREFIX}Margherita (M)`).single();

    const { data: salesRows } = await supabase
      .from('sales_line_items')
      .select('qty, net_sales')
      .eq('menu_item_id', item.id)
      .eq('business_date', '9999-06-01');

    expect(salesRows).toHaveLength(1);
    expect(parseFloat(salesRows[0].qty)).toBe(10);
    expect(parseFloat(salesRows[0].net_sales)).toBe(150.00);
  });

  test('handles empty array gracefully', async () => {
    const { data, error } = await supabase.rpc('ingest_daily_sales', { p_rows: [] });
    expect(error).toBeNull();
    expect(data.rows_processed).toBe(0);
  });

  test('multiple dates in one call', async () => {
    const { data, error } = await supabase.rpc('ingest_daily_sales', {
      p_rows: [
        { business_date: '9999-06-01', menu_item_name: `${TEST_PREFIX}Margherita (M)`, category: 'Classic', qty: 5, net_sales: 75, source: 'toast' },
        { business_date: '9999-06-02', menu_item_name: `${TEST_PREFIX}Margherita (M)`, category: 'Classic', qty: 3, net_sales: 45, source: 'toast' },
        { business_date: '9999-06-02', menu_item_name: `${TEST_PREFIX}Pepperoni (L)`, category: 'Classic', qty: 7, net_sales: 140, source: 'toast' },
      ]
    });

    expect(error).toBeNull();
    expect(data.rows_processed).toBe(3);
    expect(data.menu_items_created).toBe(2);
    expect(await countTestSales()).toBe(3);
  });
});

// ============================================================
// 2. run_daily_close
// ============================================================
describe('run_daily_close', () => {
  let ingredientA, ingredientB, menuItem;

  beforeEach(async () => {
    await cleanTestData();

    menuItem = await insertMenuItem('Test Pizza', 'Test');
    ingredientA = await insertIngredient('Flour', 'lb', 10, 2, 0.50);
    ingredientB = await insertIngredient('Cheese', 'oz', 20, 3, 0.25);

    await insertBom(menuItem, ingredientA, 0.5);
    await insertBom(menuItem, ingredientB, 4);

    await setInventory(ingredientA, 100);
    await setInventory(ingredientB, 200);

    await insertSale(menuItem, '9999-06-01', 10, 150.00);
  });

  afterAll(async () => { await cleanTestData(); });

  test('computes correct ingredient usage and updates inventory', async () => {
    const { data, error } = await supabase.rpc('run_daily_close', { p_business_date: '9999-06-01' });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.consume_txns_created).toBe(2);

    expect(await getInventory(ingredientA)).toBe(95);  // 100 - 10*0.5
    expect(await getInventory(ingredientB)).toBe(160);  // 200 - 10*4

    const flourTxns = await getTxns(ingredientA, 'CONSUME');
    expect(flourTxns).toHaveLength(1);
    expect(parseFloat(flourTxns[0].qty_delta)).toBe(-5);
    expect(flourTxns[0].business_date).toBe('9999-06-01');

    const cheeseTxns = await getTxns(ingredientB, 'CONSUME');
    expect(cheeseTxns).toHaveLength(1);
    expect(parseFloat(cheeseTxns[0].qty_delta)).toBe(-40);
  });

  test('is idempotent — second run returns skipped', async () => {
    await supabase.rpc('run_daily_close', { p_business_date: '9999-06-01' });
    const { data, error } = await supabase.rpc('run_daily_close', { p_business_date: '9999-06-01' });

    expect(error).toBeNull();
    expect(data.status).toBe('skipped');
    expect(await getInventory(ingredientA)).toBe(95);
  });

  test('returns no_data for date with no sales', async () => {
    const { data, error } = await supabase.rpc('run_daily_close', { p_business_date: '9999-12-31' });
    expect(error).toBeNull();
    expect(data.status).toBe('no_data');
  });

  test('handles menu items without BOM entries (no crash)', async () => {
    const noBomItem = await insertMenuItem('Side Salad', 'Side');
    await insertSale(noBomItem, '9999-07-01', 5, 25.00);

    const { data, error } = await supabase.rpc('run_daily_close', { p_business_date: '9999-07-01' });
    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.consume_txns_created).toBe(0);
  });
});

// ============================================================
// 3. reverse_daily_close
// ============================================================
describe('reverse_daily_close', () => {
  let ingredientA, menuItem;

  beforeEach(async () => {
    await cleanTestData();

    menuItem = await insertMenuItem('Test Pizza', 'Test');
    ingredientA = await insertIngredient('Flour', 'lb', 10, 2, 0.50);
    await insertBom(menuItem, ingredientA, 0.5);
    await setInventory(ingredientA, 100);
    await insertSale(menuItem, '9999-06-01', 10, 150.00);
    await supabase.rpc('run_daily_close', { p_business_date: '9999-06-01' });
  });

  afterAll(async () => { await cleanTestData(); });

  test('restores inventory and removes CONSUME txns', async () => {
    expect(await getInventory(ingredientA)).toBe(95);

    const { data, error } = await supabase.rpc('reverse_daily_close', { p_business_date: '9999-06-01' });
    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.txns_reversed).toBe(1);

    expect(await getInventory(ingredientA)).toBe(100);
    const txns = await getTxns(ingredientA, 'CONSUME');
    expect(txns).toHaveLength(0);
  });

  test('can re-close after reversal', async () => {
    await supabase.rpc('reverse_daily_close', { p_business_date: '9999-06-01' });
    expect(await getInventory(ingredientA)).toBe(100);

    const { data } = await supabase.rpc('run_daily_close', { p_business_date: '9999-06-01' });
    expect(data.status).toBe('success');
    expect(await getInventory(ingredientA)).toBe(95);
  });

  test('reversing a date with no close is a no-op', async () => {
    const { data, error } = await supabase.rpc('reverse_daily_close', { p_business_date: '9999-12-31' });
    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.txns_reversed).toBe(0);
  });
});

// ============================================================
// 4. Onboarding flow
// ============================================================
describe('onboarding', () => {
  beforeAll(async () => { await saveOnboardingState(); });
  beforeEach(async () => {
    await cleanTestData();
    // Reset onboarding to false
    await supabase.from('app_config').update({
      value: {
        setup_complete: false,
        history_uploaded: false,
        history_start_date: null,
        history_end_date: null,
        history_rows_ingested: 0,
        bulk_close_complete: false,
        completed_at: null
      }
    }).eq('key', 'onboarding');
  });
  afterAll(async () => {
    await cleanTestData();
    await restoreOnboardingState();
  });

  test('get_onboarding_status returns not complete initially', async () => {
    const { data, error } = await supabase.rpc('get_onboarding_status');
    expect(error).toBeNull();
    expect(data.setup_complete).toBe(false);
    expect(data.history_uploaded).toBe(false);
  });

  test('full onboarding flow: ingest → complete → bulk close → status', async () => {
    const item = await insertMenuItem('Margherita', 'Classic');
    const ing = await insertIngredient('Dough', 'lb', 5, 1, 0.40);
    await insertBom(item, ing, 0.3);
    await setInventory(ing, 50);

    await supabase.rpc('ingest_daily_sales', {
      p_rows: [
        { business_date: '9999-06-01', menu_item_name: `${TEST_PREFIX}Margherita`, category: 'Classic', qty: 10, net_sales: 100, source: 'test' },
        { business_date: '9999-06-02', menu_item_name: `${TEST_PREFIX}Margherita`, category: 'Classic', qty: 8, net_sales: 80, source: 'test' },
        { business_date: '9999-06-03', menu_item_name: `${TEST_PREFIX}Margherita`, category: 'Classic', qty: 12, net_sales: 120, source: 'test' },
      ]
    });

    const { data: onboard } = await supabase.rpc('complete_onboarding_ingest');
    expect(onboard.status).toBe('success');

    const { data: close } = await supabase.rpc('run_bulk_close');
    expect(close.status).toBe('success');
    expect(close.dates_processed).toBeGreaterThanOrEqual(3);

    // Inventory: 50 - (10+8+12)*0.3 = 50 - 9 = 41
    expect(await getInventory(ing)).toBe(41);

    const { data: status } = await supabase.rpc('get_onboarding_status');
    expect(status.setup_complete).toBe(true);
    expect(status.bulk_close_complete).toBe(true);
  });

  test('run_bulk_close skips already-closed dates', async () => {
    const item = await insertMenuItem('Margherita', 'Classic');
    const ing = await insertIngredient('Dough', 'lb', 5, 1, 0.40);
    await insertBom(item, ing, 0.3);
    await setInventory(ing, 50);

    await supabase.rpc('ingest_daily_sales', {
      p_rows: [
        { business_date: '9999-06-01', menu_item_name: `${TEST_PREFIX}Margherita`, category: 'Classic', qty: 10, net_sales: 100, source: 'test' },
      ]
    });

    await supabase.rpc('run_daily_close', { p_business_date: '9999-06-01' });
    expect(await getInventory(ing)).toBe(47);

    const { data } = await supabase.rpc('run_bulk_close');
    // Should not reprocess 9999-06-01
    expect(await getInventory(ing)).toBe(47);
  });
});

// ============================================================
// 5. get_inventory_snapshot
// ============================================================
describe('get_inventory_snapshot', () => {
  beforeEach(async () => { await cleanTestData(); });
  afterAll(async () => { await cleanTestData(); });

  test('returns ingredients with correct fields and status', async () => {
    const ing = await insertIngredient('Tomato Sauce', 'oz', 10, 2, 0.15);
    await setInventory(ing, 50);

    const { data, error } = await supabase.rpc('get_inventory_snapshot');
    expect(error).toBeNull();

    const row = data.find(r => r.ingredient_id === ing);
    expect(row).toBeDefined();
    expect(row.name).toBe(`${TEST_PREFIX}Tomato Sauce`);
    expect(row.unit).toBe('oz');
    expect(parseFloat(row.qty_on_hand)).toBe(50);
    expect(parseFloat(row.reorder_point)).toBe(10);
    expect(parseFloat(row.avg_daily_usage)).toBe(0);
    expect(row.status).toBe('unknown');
  });

  test('computes avg_daily_usage and status from CONSUME txns', async () => {
    const item = await insertMenuItem('Test Pizza', 'Test');
    const ing = await insertIngredient('Flour', 'lb', 5, 2, 0.50);
    await insertBom(item, ing, 1);
    await setInventory(ing, 100);

    // Create 7 days of sales + close them
    const rows = [];
    for (let d = 1; d <= 7; d++) {
      const dd = String(d).padStart(2, '0');
      rows.push({ business_date: `9999-02-${dd}`, menu_item_name: `${TEST_PREFIX}Test Pizza`, category: 'Test', qty: 10, net_sales: 100, source: 'test' });
    }
    await supabase.rpc('ingest_daily_sales', { p_rows: rows });
    await supabase.rpc('run_bulk_close');

    expect(await getInventory(ing)).toBe(30); // 100 - 7*10

    const { data } = await supabase.rpc('get_inventory_snapshot');
    const row = data.find(r => r.ingredient_id === ing);
    expect(row).toBeDefined();
    expect(parseFloat(row.qty_on_hand)).toBe(30);
    expect(parseFloat(row.avg_daily_usage)).toBe(10);
    expect(parseFloat(row.days_of_supply)).toBe(3);
  });
});
