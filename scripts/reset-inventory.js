require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('=== Resetting Ingredient Inventory ===\n');

  // Get current inventory snapshot to understand daily usage
  console.log('1. Getting current inventory state...');
  const { data: snapshot, error: snapError } = await supabase.rpc('get_inventory_snapshot');

  if (snapError) {
    console.error('Error getting snapshot:', snapError);
    process.exit(1);
  }

  console.log(`   Found ${snapshot.length} ingredients\n`);

  // Strategy: Set inventory based on avg daily usage
  // - Critical (3 items): 0.5-1.5 days of supply
  // - Reorder Soon (5 items): 2-4 days of supply
  // - OK (rest): 7-14 days of supply

  const critical = [];
  const reorderSoon = [];
  const ok = [];

  // Categorize ingredients
  snapshot.forEach((ing, idx) => {
    if (idx < 3) critical.push(ing);
    else if (idx < 8) reorderSoon.push(ing);
    else ok.push(ing);
  });

  console.log('2. Setting inventory levels:\n');

  // Process critical items (0.5-1.5 days supply)
  console.log('   Critical items (0.5-1.5 days supply):');
  for (const ing of critical) {
    const targetDays = 0.5 + Math.random(); // 0.5 to 1.5 days
    const targetQty = Math.max(10, Math.ceil(ing.avg_daily_usage * targetDays));
    const currentQty = ing.qty_on_hand || 0;
    const receiveQty = Math.max(0, targetQty - currentQty);

    if (receiveQty > 0) {
      const { error } = await supabase.rpc('receive_inventory', {
        p_ingredient_id: ing.ingredient_id,
        p_qty: receiveQty,
        p_note: 'Initial stock - critical level'
      });

      if (error) {
        console.error(`     Error receiving ${ing.name}:`, error);
      } else {
        console.log(`     ✓ ${ing.name}: received ${receiveQty.toFixed(2)} ${ing.unit} (target: ${targetQty.toFixed(2)})`);
      }
    }
  }

  // Process reorder soon items (2-4 days supply)
  console.log('\n   Reorder Soon items (2-4 days supply):');
  for (const ing of reorderSoon) {
    const targetDays = 2 + Math.random() * 2; // 2 to 4 days
    const targetQty = Math.max(20, Math.ceil(ing.avg_daily_usage * targetDays));
    const currentQty = ing.qty_on_hand || 0;
    const receiveQty = Math.max(0, targetQty - currentQty);

    if (receiveQty > 0) {
      const { error } = await supabase.rpc('receive_inventory', {
        p_ingredient_id: ing.ingredient_id,
        p_qty: receiveQty,
        p_note: 'Initial stock - reorder soon'
      });

      if (error) {
        console.error(`     Error receiving ${ing.name}:`, error);
      } else {
        console.log(`     ✓ ${ing.name}: received ${receiveQty.toFixed(2)} ${ing.unit} (target: ${targetQty.toFixed(2)})`);
      }
    }
  }

  // Process ok items (7-14 days supply)
  console.log('\n   OK items (7-14 days supply):');
  for (const ing of ok) {
    const targetDays = 7 + Math.random() * 7; // 7 to 14 days
    const targetQty = Math.max(50, Math.ceil(ing.avg_daily_usage * targetDays));
    const currentQty = ing.qty_on_hand || 0;
    const receiveQty = Math.max(0, targetQty - currentQty);

    if (receiveQty > 0) {
      const { error } = await supabase.rpc('receive_inventory', {
        p_ingredient_id: ing.ingredient_id,
        p_qty: receiveQty,
        p_note: 'Initial stock - good level'
      });

      if (error) {
        console.error(`     Error receiving ${ing.name}:`, error);
      } else {
        console.log(`     ✓ ${ing.name}: received ${receiveQty.toFixed(2)} ${ing.unit} (target: ${targetQty.toFixed(2)})`);
      }
    }
  }

  // Get updated snapshot
  console.log('\n3. Verifying new inventory levels...\n');
  const { data: newSnapshot } = await supabase.rpc('get_inventory_snapshot');

  console.log('   Status Summary:');
  const statusCount = {
    critical: 0,
    reorder_soon: 0,
    ok: 0,
    unknown: 0
  };

  newSnapshot.forEach(ing => {
    statusCount[ing.status] = (statusCount[ing.status] || 0) + 1;
  });

  console.log(`   - Critical: ${statusCount.critical}`);
  console.log(`   - Reorder Soon: ${statusCount.reorder_soon}`);
  console.log(`   - OK: ${statusCount.ok}`);
  console.log(`   - Unknown: ${statusCount.unknown}`);

  console.log('\n   Sample inventory (first 10):');
  newSnapshot.slice(0, 10).forEach(ing => {
    const status = ing.status === 'critical' ? '🔴' :
                   ing.status === 'reorder_soon' ? '🟡' : '🟢';
    console.log(`   ${status} ${ing.name}: ${ing.qty_on_hand.toFixed(2)} ${ing.unit}, ${ing.days_of_supply.toFixed(1)} days supply`);
  });

  console.log('\n=== Done! Inventory reset successfully ===');
}

main();
