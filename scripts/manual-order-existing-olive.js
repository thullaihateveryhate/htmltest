// Place an order against an existing menu item that uses Black Olives
// Uses .env SUPABASE_URL + SUPABASE_SERVICE_KEY
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // 1) Find Black Olives ingredient
  const { data: ing, error: ingErr } = await supabase
    .from('ingredients')
    .select('id, name, unit')
    .ilike('name', 'Black Olives')
    .maybeSingle();
  if (ingErr) throw new Error(`Ingredient lookup failed: ${ingErr.message}`);
  if (!ing) throw new Error('Ingredient "Black Olives" not found');

  // 2) Find an existing menu item that uses this ingredient (via BOM)
  const { data: bomRows, error: bomErr } = await supabase
    .from('bom')
    .select('menu_items(id, name, category), qty_per_item')
    .eq('ingredient_id', ing.id)
    .limit(1);
  if (bomErr) throw new Error(`BOM lookup failed: ${bomErr.message}`);
  if (!bomRows || bomRows.length === 0) throw new Error('No menu item found that uses Black Olives');

  const menu = bomRows[0].menu_items;
  const qtyPerItem = parseFloat(bomRows[0].qty_per_item) || 0;

  // 3) Capture starting on-hand
  const { data: startOH } = await supabase
    .from('inventory_on_hand')
    .select('qty_on_hand')
    .eq('ingredient_id', ing.id)
    .maybeSingle();
  const startQty = startOH ? parseFloat(startOH.qty_on_hand) : 0;

  // 4) Place the order via register_order for qty 2 (will consume 2 * qtyPerItem)
  const orderId = `__olive_real_${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const { data: regData, error: regErr } = await supabase.rpc('register_order', {
    p_order_raw: {
      order_id: orderId,
      business_date: today,
      opened_at: `${today}T12:00:00Z`,
      closed_at: `${today}T12:05:00Z`,
      num_guests: 2,
      server_name: 'API Tester',
      dining_option: 'Dine In',
      service_period: 'Lunch',
      subtotal: 25,
      total: 25,
      items: [
        { menu_item_name: menu.name, qty: 2, price: 12.5 }
      ]
    }
  });
  if (regErr) throw new Error(`register_order error: ${regErr.message}`);
  if (regData?.status === 'error') throw new Error(`register_order: ${regData.message}`);

  // 5) Capture ending on-hand
  const { data: endOH } = await supabase
    .from('inventory_on_hand')
    .select('qty_on_hand')
    .eq('ingredient_id', ing.id)
    .maybeSingle();
  const endQty = endOH ? parseFloat(endOH.qty_on_hand) : null;

  console.log('Order placed:', orderId);
  console.log('Menu item:', menu.name, `(BOM Black Olives: ${qtyPerItem} ${ing.unit} per item)`);
  console.log('register_order response:', regData);
  console.log('Black Olives qty on hand:', { before: startQty, after: endQty, delta: endQty - startQty });
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
