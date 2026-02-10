/**
 * Tests for Module 7 — Admin CRUD RPCs
 * upsert_menu_item, deactivate_menu_item, upsert_ingredient,
 * upsert_bom_entry, delete_bom_entry, get_bom_for_item
 */

const {
  supabase, cleanTestData, TEST_PREFIX
} = require('./helpers/supabase');

beforeEach(async () => { await cleanTestData(); });
afterAll(async () => { await cleanTestData(); });

describe('upsert_menu_item', () => {
  test('creates a new menu item', async () => {
    const { data } = await supabase.rpc('upsert_menu_item', {
      p_name: TEST_PREFIX + 'Admin Pizza',
      p_category: 'Test'
    });
    expect(data.status).toBe('success');
    expect(data.action).toBe('created');
    expect(data.id).toBeTruthy();
    expect(data.name).toBe(TEST_PREFIX + 'Admin Pizza');
  });

  test('rejects empty name', async () => {
    const { data } = await supabase.rpc('upsert_menu_item', {
      p_name: '', p_category: 'Test'
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('name is required');
  });

  test('rejects duplicate name', async () => {
    await supabase.rpc('upsert_menu_item', {
      p_name: TEST_PREFIX + 'Dup Pizza', p_category: 'Test'
    });
    const { data } = await supabase.rpc('upsert_menu_item', {
      p_name: TEST_PREFIX + 'Dup Pizza', p_category: 'Test'
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('already exists');
  });

  test('updates existing menu item', async () => {
    const { data: created } = await supabase.rpc('upsert_menu_item', {
      p_name: TEST_PREFIX + 'Old Name', p_category: 'Test'
    });
    const { data: updated } = await supabase.rpc('upsert_menu_item', {
      p_id: created.id,
      p_name: TEST_PREFIX + 'New Name',
      p_category: 'Updated'
    });
    expect(updated.status).toBe('success');
    expect(updated.action).toBe('updated');
    expect(updated.name).toBe(TEST_PREFIX + 'New Name');
  });

  test('returns error for nonexistent id', async () => {
    const { data } = await supabase.rpc('upsert_menu_item', {
      p_id: '00000000-0000-0000-0000-000000000000',
      p_name: TEST_PREFIX + 'Ghost'
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('not found');
  });
});

describe('deactivate_menu_item', () => {
  test('deactivates an existing item', async () => {
    const { data: created } = await supabase.rpc('upsert_menu_item', {
      p_name: TEST_PREFIX + 'Active Pizza', p_category: 'Test'
    });
    const { data } = await supabase.rpc('deactivate_menu_item', {
      p_id: created.id
    });
    expect(data.status).toBe('success');
    expect(data.active).toBe(false);
  });

  test('returns error for nonexistent id', async () => {
    const { data } = await supabase.rpc('deactivate_menu_item', {
      p_id: '00000000-0000-0000-0000-000000000000'
    });
    expect(data.status).toBe('error');
  });
});

describe('upsert_ingredient', () => {
  test('creates a new ingredient', async () => {
    const { data } = await supabase.rpc('upsert_ingredient', {
      p_name: TEST_PREFIX + 'Test Flour',
      p_unit: 'oz',
      p_reorder_point: 50,
      p_lead_time_days: 2,
      p_unit_cost: 0.10
    });
    expect(data.status).toBe('success');
    expect(data.action).toBe('created');
    expect(data.id).toBeTruthy();
  });

  test('rejects empty name', async () => {
    const { data } = await supabase.rpc('upsert_ingredient', { p_name: '' });
    expect(data.status).toBe('error');
    expect(data.message).toContain('name is required');
  });

  test('rejects negative reorder_point', async () => {
    const { data } = await supabase.rpc('upsert_ingredient', {
      p_name: TEST_PREFIX + 'Bad Ing', p_reorder_point: -5
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('reorder_point');
  });

  test('rejects negative unit_cost', async () => {
    const { data } = await supabase.rpc('upsert_ingredient', {
      p_name: TEST_PREFIX + 'Bad Ing2', p_unit_cost: -1
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('unit_cost');
  });

  test('updates existing ingredient', async () => {
    const { data: created } = await supabase.rpc('upsert_ingredient', {
      p_name: TEST_PREFIX + 'Old Ing'
    });
    const { data: updated } = await supabase.rpc('upsert_ingredient', {
      p_id: created.id,
      p_name: TEST_PREFIX + 'New Ing',
      p_reorder_point: 100
    });
    expect(updated.status).toBe('success');
    expect(updated.action).toBe('updated');
  });

  test('rejects duplicate name', async () => {
    await supabase.rpc('upsert_ingredient', { p_name: TEST_PREFIX + 'Dup Ing' });
    const { data } = await supabase.rpc('upsert_ingredient', { p_name: TEST_PREFIX + 'Dup Ing' });
    expect(data.status).toBe('error');
    expect(data.message).toContain('already exists');
  });
});

describe('BOM CRUD', () => {
  let menuItemId, ingredientId;

  beforeEach(async () => {
    await cleanTestData();
    const { data: mi } = await supabase.rpc('upsert_menu_item', {
      p_name: TEST_PREFIX + 'BOM Pizza', p_category: 'Test'
    });
    menuItemId = mi.id;
    const { data: ing } = await supabase.rpc('upsert_ingredient', {
      p_name: TEST_PREFIX + 'BOM Cheese'
    });
    ingredientId = ing.id;
  });

  test('upsert_bom_entry creates entry', async () => {
    const { data } = await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId,
      p_qty_per_item: 4.5
    });
    expect(data.status).toBe('success');
    expect(data.qty_per_item).toBe(4.5);
  });

  test('upsert_bom_entry updates qty on re-call', async () => {
    await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId,
      p_qty_per_item: 4.5
    });
    const { data } = await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId,
      p_qty_per_item: 6.0
    });
    expect(data.status).toBe('success');
    expect(data.qty_per_item).toBe(6.0);
  });

  test('rejects qty <= 0', async () => {
    const { data } = await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId,
      p_qty_per_item: 0
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('qty_per_item');
  });

  test('rejects nonexistent menu item', async () => {
    const { data } = await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: '00000000-0000-0000-0000-000000000000',
      p_ingredient_id: ingredientId,
      p_qty_per_item: 1
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('menu item not found');
  });

  test('delete_bom_entry removes entry', async () => {
    await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId,
      p_qty_per_item: 4.5
    });
    const { data } = await supabase.rpc('delete_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId
    });
    expect(data.status).toBe('success');
    expect(data.deleted).toBe(true);
  });

  test('delete_bom_entry returns error if not found', async () => {
    const { data } = await supabase.rpc('delete_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId
    });
    expect(data.status).toBe('error');
    expect(data.message).toContain('not found');
  });

  test('get_bom_for_item returns ingredients with costs', async () => {
    await supabase.rpc('upsert_bom_entry', {
      p_menu_item_id: menuItemId,
      p_ingredient_id: ingredientId,
      p_qty_per_item: 4.5
    });
    const { data } = await supabase.rpc('get_bom_for_item', {
      p_menu_item_id: menuItemId
    });
    expect(data.status).toBe('success');
    expect(data.ingredients.length).toBe(1);
    expect(data.ingredients[0].ingredient_name).toBe(TEST_PREFIX + 'BOM Cheese');
    expect(data.ingredients[0].qty_per_item).toBe(4.5);
  });
});
