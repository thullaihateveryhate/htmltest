/**
 * Module 4 — Inventory Ops Tests
 *
 * ISOLATION: All test data uses __test__ prefix and 9999-* dates.
 */

const {
  supabase, cleanTestData,
  insertIngredient, setInventory, getInventory, getTxns,
} = require('./helpers/supabase');

jest.setTimeout(30000);

// ============================================================
// receive_inventory
// ============================================================
describe('receive_inventory', () => {
  let ingId;

  beforeEach(async () => {
    await cleanTestData();
    ingId = await insertIngredient('Flour', 'lb', 10, 2, 0.50);
    await setInventory(ingId, 50);
  });

  afterAll(async () => { await cleanTestData(); });

  test('adds qty to inventory and creates RECEIVE txn', async () => {
    const { data, error } = await supabase.rpc('receive_inventory', {
      p_ingredient_id: ingId,
      p_qty: 25,
      p_note: 'Weekly delivery from Sysco'
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.new_qty_on_hand)).toBe(75);

    expect(await getInventory(ingId)).toBe(75);

    const txns = await getTxns(ingId, 'RECEIVE');
    expect(txns).toHaveLength(1);
    expect(parseFloat(txns[0].qty_delta)).toBe(25);
    expect(txns[0].note).toBe('Weekly delivery from Sysco');
  });

  test('creates inventory_on_hand row if none exists', async () => {
    const newIng = await insertIngredient('New Spice', 'oz', 2, 1, 5.00);

    const { data, error } = await supabase.rpc('receive_inventory', {
      p_ingredient_id: newIng,
      p_qty: 10,
      p_note: 'First stock'
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.new_qty_on_hand)).toBe(10);
    expect(await getInventory(newIng)).toBe(10);
  });

  test('rejects zero qty', async () => {
    const { data, error } = await supabase.rpc('receive_inventory', {
      p_ingredient_id: ingId,
      p_qty: 0,
      p_note: 'bad'
    });

    expect(data.status).toBe('error');
  });

  test('rejects negative qty', async () => {
    const { data, error } = await supabase.rpc('receive_inventory', {
      p_ingredient_id: ingId,
      p_qty: -5,
      p_note: 'bad'
    });

    expect(data.status).toBe('error');
  });

  test('note is optional (null allowed)', async () => {
    const { data, error } = await supabase.rpc('receive_inventory', {
      p_ingredient_id: ingId,
      p_qty: 10,
      p_note: null
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.new_qty_on_hand)).toBe(60);
  });

  test('multiple receives accumulate correctly', async () => {
    await supabase.rpc('receive_inventory', { p_ingredient_id: ingId, p_qty: 10, p_note: 'delivery 1' });
    await supabase.rpc('receive_inventory', { p_ingredient_id: ingId, p_qty: 15, p_note: 'delivery 2' });
    await supabase.rpc('receive_inventory', { p_ingredient_id: ingId, p_qty: 5, p_note: 'delivery 3' });

    expect(await getInventory(ingId)).toBe(80); // 50 + 10 + 15 + 5

    const txns = await getTxns(ingId, 'RECEIVE');
    expect(txns).toHaveLength(3);
  });
});

// ============================================================
// count_inventory
// ============================================================
describe('count_inventory', () => {
  let ingId;

  beforeEach(async () => {
    await cleanTestData();
    ingId = await insertIngredient('Cheese', 'oz', 20, 3, 0.25);
    await setInventory(ingId, 100);
  });

  afterAll(async () => { await cleanTestData(); });

  test('adjusts inventory DOWN when actual < on_hand', async () => {
    const { data, error } = await supabase.rpc('count_inventory', {
      p_ingredient_id: ingId,
      p_actual_qty: 85
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.delta)).toBe(-15);
    expect(parseFloat(data.new_qty_on_hand)).toBe(85);

    expect(await getInventory(ingId)).toBe(85);

    const txns = await getTxns(ingId, 'COUNT');
    expect(txns).toHaveLength(1);
    expect(parseFloat(txns[0].qty_delta)).toBe(-15);
  });

  test('adjusts inventory UP when actual > on_hand', async () => {
    const { data, error } = await supabase.rpc('count_inventory', {
      p_ingredient_id: ingId,
      p_actual_qty: 120
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.delta)).toBe(20);
    expect(parseFloat(data.new_qty_on_hand)).toBe(120);
    expect(await getInventory(ingId)).toBe(120);
  });

  test('no-op when actual equals on_hand (delta=0 still recorded)', async () => {
    const { data, error } = await supabase.rpc('count_inventory', {
      p_ingredient_id: ingId,
      p_actual_qty: 100
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.delta)).toBe(0);
    expect(await getInventory(ingId)).toBe(100);
  });

  test('creates inventory_on_hand row if none exists', async () => {
    const newIng = await insertIngredient('New Item', 'each', 5, 1, 1.00);

    const { data, error } = await supabase.rpc('count_inventory', {
      p_ingredient_id: newIng,
      p_actual_qty: 42
    });

    expect(error).toBeNull();
    expect(data.status).toBe('success');
    expect(parseFloat(data.new_qty_on_hand)).toBe(42);
    expect(await getInventory(newIng)).toBe(42);
  });

  test('rejects negative actual_qty', async () => {
    const { data, error } = await supabase.rpc('count_inventory', {
      p_ingredient_id: ingId,
      p_actual_qty: -5
    });

    expect(data.status).toBe('error');
  });

  test('count + receive in sequence produce correct result', async () => {
    await supabase.rpc('count_inventory', { p_ingredient_id: ingId, p_actual_qty: 80 });
    expect(await getInventory(ingId)).toBe(80);

    await supabase.rpc('receive_inventory', { p_ingredient_id: ingId, p_qty: 30, p_note: 'restock' });
    expect(await getInventory(ingId)).toBe(110);

    await supabase.rpc('count_inventory', { p_ingredient_id: ingId, p_actual_qty: 105 });
    expect(await getInventory(ingId)).toBe(105);

    const countTxns = await getTxns(ingId, 'COUNT');
    expect(countTxns).toHaveLength(2);
    const receiveTxns = await getTxns(ingId, 'RECEIVE');
    expect(receiveTxns).toHaveLength(1);
  });
});
