/**
 * Tests for register_order RPC (Module 9: Live Order Registration API)
 *
 * Covers:
 * - Single order with multiple items
 * - Auto-creates unknown menu items
 * - Inventory decrements correctly via BOM
 * - Idempotent on duplicate order_id
 * - Handles items not in BOM (no consumption, no error)
 *
 * ISOLATION: Uses __test__ prefix and 9999-* dates.
 */

const {
  supabase, TEST_PREFIX, cleanTestData,
  insertMenuItem, insertIngredient, insertBom,
  setInventory, getInventory, getTxns,
} = require('./helpers/supabase');

jest.setTimeout(30000);

const TEST_ORDER_PREFIX = '__test_reg_';

/** Clean up test orders created by register_order */
async function cleanTestOrders() {
  await supabase.from('daily_orders').delete().like('order_id', `${TEST_ORDER_PREFIX}%`);
}

/** Clean up auto-created menu items (register_order creates items WITHOUT the __test__ prefix) */
async function cleanAutoCreatedItems(names) {
  for (const name of names) {
    const { data: items } = await supabase
      .from('menu_items')
      .select('id')
      .eq('name', name);
    const ids = (items || []).map(i => i.id);
    if (ids.length > 0) {
      await supabase.from('sales_line_items').delete().in('menu_item_id', ids);
      await supabase.from('bom').delete().in('menu_item_id', ids);
      await supabase.from('menu_items').delete().in('id', ids);
    }
  }
}

// Track auto-created item names for cleanup
const autoCreatedNames = [];

beforeEach(async () => {
  await cleanTestOrders();
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestOrders();
  await cleanTestData();
  if (autoCreatedNames.length > 0) {
    await cleanAutoCreatedItems(autoCreatedNames);
  }
  // Also clean up sales for test dates
  await supabase.from('sales_line_items').delete().gte('business_date', '9999-01-01');
});

// ============================================================
// 1. Single order with multiple items
// ============================================================
describe('register_order — basic', () => {
  test('registers a single order with multiple items', async () => {
    // Pre-create menu items so they're found by name
    const pizzaId = await insertMenuItem('RegPizza', 'Classic');
    const saladId = await insertMenuItem('RegSalad', 'Sides');

    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}001`,
        business_date: '9999-03-01',
        opened_at: '9999-03-01T18:30:00Z',
        closed_at: '9999-03-01T19:15:00Z',
        num_guests: 4,
        server_name: 'Alice',
        dining_option: 'Dine In',
        service_period: 'Dinner',
        subtotal: 45.50,
        tax: 3.18,
        tip: 9.00,
        total: 57.68,
        items: [
          { menu_item_name: `${TEST_PREFIX}RegPizza`, qty: 2, price: 15.00 },
          { menu_item_name: `${TEST_PREFIX}RegSalad`, qty: 1, price: 8.50 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.order_id).toBe(`${TEST_ORDER_PREFIX}001`);
    expect(data.items_processed).toBe(2);

    // Verify order was inserted into daily_orders
    const { data: orders } = await supabase
      .from('daily_orders')
      .select('*')
      .eq('order_id', `${TEST_ORDER_PREFIX}001`);

    expect(orders).toHaveLength(1);
    expect(orders[0].num_guests).toBe(4);
    expect(orders[0].server_name).toBe('Alice');
    expect(orders[0].dining_option).toBe('Dine In');
    expect(parseFloat(orders[0].subtotal)).toBe(45.50);

    // Verify sales_line_items were created/updated
    const { data: salesPizza } = await supabase
      .from('sales_line_items')
      .select('qty, net_sales')
      .eq('menu_item_id', pizzaId)
      .eq('business_date', '9999-03-01');

    expect(salesPizza).toHaveLength(1);
    expect(parseFloat(salesPizza[0].qty)).toBe(2);
    expect(parseFloat(salesPizza[0].net_sales)).toBe(15.00);

    const { data: salesSalad } = await supabase
      .from('sales_line_items')
      .select('qty, net_sales')
      .eq('menu_item_id', saladId)
      .eq('business_date', '9999-03-01');

    expect(salesSalad).toHaveLength(1);
    expect(parseFloat(salesSalad[0].qty)).toBe(1);
    expect(parseFloat(salesSalad[0].net_sales)).toBe(8.50);
  });

  test('returns error when order_id is missing', async () => {
    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        business_date: '9999-03-01',
        items: [{ menu_item_name: `${TEST_PREFIX}RegPizza`, qty: 1, price: 10 }]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('error');
    expect(data.message).toMatch(/order_id/);
  });

  test('returns error when items array is empty', async () => {
    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}empty`,
        business_date: '9999-03-01',
        items: []
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('error');
    expect(data.message).toMatch(/items/);
  });
});

// ============================================================
// 2. Auto-creates unknown menu items
// ============================================================
describe('register_order — auto-create menu items', () => {
  test('auto-creates menu items that do not exist', async () => {
    const uniqueName = `${TEST_PREFIX}AutoBurger_${Date.now()}`;
    autoCreatedNames.push(uniqueName);

    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}auto1`,
        business_date: '9999-03-02',
        subtotal: 12.00,
        total: 12.00,
        items: [
          { menu_item_name: uniqueName, qty: 1, price: 12.00 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.menu_items_created).toBe(1);

    // Verify the menu item was created
    const { data: items } = await supabase
      .from('menu_items')
      .select('id, name, category')
      .eq('name', uniqueName);

    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('Uncategorized');
  });
});

// ============================================================
// 3. Inventory decrements correctly via BOM
// ============================================================
describe('register_order — inventory consumption', () => {
  let menuItemId, flourId, cheeseId;

  beforeEach(async () => {
    // Create menu item, ingredients, and BOM
    menuItemId = await insertMenuItem('BOMPizza', 'Test');
    flourId = await insertIngredient('RegFlour', 'lb', 10, 2, 0.50);
    cheeseId = await insertIngredient('RegCheese', 'oz', 20, 3, 0.25);

    // BOM: 1 BOMPizza = 0.5 lb Flour + 4 oz Cheese
    await insertBom(menuItemId, flourId, 0.5);
    await insertBom(menuItemId, cheeseId, 4);

    // Stock: 100 lb Flour, 200 oz Cheese
    await setInventory(flourId, 100);
    await setInventory(cheeseId, 200);
  });

  test('decrements inventory based on BOM when order is placed', async () => {
    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}inv1`,
        business_date: '9999-03-03',
        subtotal: 30.00,
        total: 30.00,
        items: [
          { menu_item_name: `${TEST_PREFIX}BOMPizza`, qty: 3, price: 10.00 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.ingredients_consumed).toBe(2); // flour + cheese

    // Flour: 100 - 3*0.5 = 98.5
    expect(await getInventory(flourId)).toBe(98.5);

    // Cheese: 200 - 3*4 = 188
    expect(await getInventory(cheeseId)).toBe(188);

    // Verify CONSUME transactions were created
    const flourTxns = await getTxns(flourId, 'CONSUME');
    expect(flourTxns).toHaveLength(1);
    expect(parseFloat(flourTxns[0].qty_delta)).toBe(-1.5); // 3 * 0.5

    const cheeseTxns = await getTxns(cheeseId, 'CONSUME');
    expect(cheeseTxns).toHaveLength(1);
    expect(parseFloat(cheeseTxns[0].qty_delta)).toBe(-12); // 3 * 4
  });

  test('multiple items in one order consume correctly', async () => {
    // Create second menu item that also uses flour
    const pastaId = await insertMenuItem('BOMPasta', 'Test');
    await insertBom(pastaId, flourId, 0.3); // 0.3 lb flour per pasta

    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}inv2`,
        business_date: '9999-03-04',
        subtotal: 25.00,
        total: 25.00,
        items: [
          { menu_item_name: `${TEST_PREFIX}BOMPizza`, qty: 2, price: 10.00 },
          { menu_item_name: `${TEST_PREFIX}BOMPasta`, qty: 5, price: 5.00 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.items_processed).toBe(2);

    // Flour: 100 - (2*0.5 + 5*0.3) = 100 - 1 - 1.5 = 97.5
    expect(await getInventory(flourId)).toBe(97.5);

    // Cheese: 200 - 2*4 = 192 (pasta doesn't use cheese)
    expect(await getInventory(cheeseId)).toBe(192);
  });
});

// ============================================================
// 4. Idempotent on duplicate order_id
// ============================================================
describe('register_order — idempotency', () => {
  let menuItemId, flourId;

  beforeEach(async () => {
    menuItemId = await insertMenuItem('IdempPizza', 'Test');
    flourId = await insertIngredient('IdempFlour', 'lb', 10, 2, 0.50);
    await insertBom(menuItemId, flourId, 0.5);
    await setInventory(flourId, 100);
  });

  test('duplicate order_id returns duplicate status and does NOT re-consume', async () => {
    // First call
    const { data: first } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}dup1`,
        business_date: '9999-03-05',
        num_guests: 2,
        subtotal: 20.00,
        total: 20.00,
        items: [
          { menu_item_name: `${TEST_PREFIX}IdempPizza`, qty: 4, price: 5.00 }
        ]
      }
    });

    expect(first.status).toBe('success');
    // Flour: 100 - 4*0.5 = 98
    expect(await getInventory(flourId)).toBe(98);

    // Second call — same order_id
    const { data: second, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}dup1`,
        business_date: '9999-03-05',
        num_guests: 5, // updated metadata
        subtotal: 25.00,
        total: 25.00,
        items: [
          { menu_item_name: `${TEST_PREFIX}IdempPizza`, qty: 4, price: 5.00 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(second.status).toBe('duplicate');

    // Inventory should NOT have changed (no re-consumption)
    expect(await getInventory(flourId)).toBe(98);

    // But metadata should be updated
    const { data: orders } = await supabase
      .from('daily_orders')
      .select('num_guests, subtotal')
      .eq('order_id', `${TEST_ORDER_PREFIX}dup1`);

    expect(orders).toHaveLength(1);
    expect(orders[0].num_guests).toBe(5);
    expect(parseFloat(orders[0].subtotal)).toBe(25.00);

    // Only 1 set of CONSUME txns should exist
    const txns = await getTxns(flourId, 'CONSUME');
    expect(txns).toHaveLength(1);
  });
});

// ============================================================
// 5. Handles items not in BOM (no consumption, no error)
// ============================================================
describe('register_order — items without BOM', () => {
  test('items without BOM entries produce no consumption and no error', async () => {
    // Create a menu item with NO BOM
    await insertMenuItem('NoBOMSalad', 'Sides');

    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}nobom1`,
        business_date: '9999-03-06',
        subtotal: 8.50,
        total: 8.50,
        items: [
          { menu_item_name: `${TEST_PREFIX}NoBOMSalad`, qty: 2, price: 4.25 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.items_processed).toBe(1);
    expect(data.ingredients_consumed).toBe(0);

    // Verify the order was still created
    const { data: orders } = await supabase
      .from('daily_orders')
      .select('order_id')
      .eq('order_id', `${TEST_ORDER_PREFIX}nobom1`);

    expect(orders).toHaveLength(1);

    // Verify sales line item was still created
    const { data: menuItem } = await supabase
      .from('menu_items')
      .select('id')
      .eq('name', `${TEST_PREFIX}NoBOMSalad`)
      .single();

    const { data: sales } = await supabase
      .from('sales_line_items')
      .select('qty')
      .eq('menu_item_id', menuItem.id)
      .eq('business_date', '9999-03-06');

    expect(sales).toHaveLength(1);
    expect(parseFloat(sales[0].qty)).toBe(2);
  });

  test('mix of BOM and non-BOM items works correctly', async () => {
    // Item with BOM
    const pizzaId = await insertMenuItem('MixPizza', 'Classic');
    const flourId = await insertIngredient('MixFlour', 'lb', 10, 2, 0.50);
    await insertBom(pizzaId, flourId, 0.5);
    await setInventory(flourId, 50);

    // Item without BOM
    await insertMenuItem('MixDrink', 'Beverages');

    const { data, error } = await supabase.rpc('register_order', {
      p_order_raw: {
        order_id: `${TEST_ORDER_PREFIX}mix1`,
        business_date: '9999-03-07',
        subtotal: 18.00,
        total: 18.00,
        items: [
          { menu_item_name: `${TEST_PREFIX}MixPizza`, qty: 2, price: 10.00 },
          { menu_item_name: `${TEST_PREFIX}MixDrink`, qty: 1, price: 3.00 }
        ]
      }
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(data.items_processed).toBe(2);
    expect(data.ingredients_consumed).toBe(1); // only flour from pizza

    // Flour: 50 - 2*0.5 = 49
    expect(await getInventory(flourId)).toBe(49);
  });
});
