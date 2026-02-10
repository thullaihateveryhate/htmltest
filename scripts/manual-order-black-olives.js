// Place an order that consumes Black Olives via register_order
// Steps: lookup ingredient, create a temporary menu item, create BOM link, call register_order
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

  // 2) Create a unique menu item and BOM (2 oz olives per item)
  const menuName = `__apiOliveItem_${Date.now()}`;
  const { data: menu, error: menuErr } = await supabase
    .from('menu_items')
    .insert({ name: menuName, category: 'API Test', active: true })
    .select('id')
    .single();
  if (menuErr) throw new Error(`Menu insert failed: ${menuErr.message}`);

  const { error: bomErr } = await supabase
    .from('bom')
    .insert({ menu_item_id: menu.id, ingredient_id: ing.id, qty_per_item: 2 }); // 2 oz per item
  if (bomErr) throw new Error(`BOM insert failed: ${bomErr.message}`);

  // 3) Get starting qty
  const { data: startOH } = await supabase
    .from('inventory_on_hand')
    .select('qty_on_hand')
    .eq('ingredient_id', ing.id)
    .maybeSingle();
  const startQty = startOH ? parseFloat(startOH.qty_on_hand) : 0;

  // 4) Place order via register_order (3 items => 6 oz consume)
  const orderId = `__olive_order_${Date.now()}`;
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
      subtotal: 30,
      total: 30,
      items: [
        { menu_item_name: menuName, qty: 3, price: 10 }
      ]
    }
  });
  if (regErr) throw new Error(`register_order error: ${regErr.message}`);
  if (regData?.status === 'error') throw new Error(`register_order: ${regData.message}`);

  // 5) Check ending qty
  const { data: endOH } = await supabase
    .from('inventory_on_hand')
    .select('qty_on_hand')
    .eq('ingredient_id', ing.id)
    .maybeSingle();
  const endQty = endOH ? parseFloat(endOH.qty_on_hand) : null;

  console.log('Order placed:', orderId);
  console.log('Menu item:', menuName, '(BOM: 2 oz Black Olives per item)');
  console.log('register_order response:', regData);
  console.log('Black Olives qty on hand:', { before: startQty, after: endQty, delta: endQty - startQty });
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
