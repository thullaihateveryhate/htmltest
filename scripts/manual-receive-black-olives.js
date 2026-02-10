// Add inventory to Black Olives via receive_inventory RPC
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // Find Black Olives ingredient
  const { data: ing, error: ingErr } = await supabase
    .from('ingredients')
    .select('id, name, unit')
    .ilike('name', 'Black Olives')
    .maybeSingle();

  if (ingErr) throw new Error(`Lookup failed: ${ingErr.message}`);
  if (!ing) throw new Error('Ingredient "Black Olives" not found');

  const qty = 5; // adjust as needed
  const note = 'manual receive test (black olives)';

  const { data, error } = await supabase.rpc('receive_inventory', {
    p_ingredient_id: ing.id,
    p_qty: qty,
    p_note: note,
  });

  if (error) throw new Error(`receive_inventory error: ${error.message}`);
  if (data?.status === 'error') throw new Error(`receive_inventory: ${data.message}`);

  console.log('Black Olives receive succeeded');
  console.log({ ingredient: ing.name, unit: ing.unit, qty_received: qty, response: data });
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
