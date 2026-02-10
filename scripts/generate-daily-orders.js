/**
 * Generate synthetic daily_orders from sales_line_items.
 * Groups line items into realistic "orders" per date with
 * servers, dining options, service periods, tips, etc.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SERVERS = ['Jay', 'Mia', 'Leo', 'Sofia', 'Carlos', 'Emma', 'Noah', 'Ava'];
const DINING_AREAS = ['Bar', 'Front', 'Patio', 'Back', null];
const DINING_OPTIONS = ['Dine In', 'Dine In', 'Dine In', 'Takeout', 'Delivery'];
const SERVICE_PERIODS = ['Lunch', 'Lunch', 'Dinner', 'Dinner', 'Dinner', 'Late Night'];
const ORDER_SOURCES = ['In store', 'In store', 'In store', 'Online'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return min + Math.random() * (max - min); }

async function main() {
  console.log('=== Generating Synthetic daily_orders ===\n');

  // 1. Get all distinct dates by scanning in chunks
  console.log('1. Fetching all distinct dates from sales_line_items...');
  let allDates = [];
  let lastDate = '1900-01-01';
  while (true) {
    const { data, error } = await supabase
      .from('sales_line_items')
      .select('business_date')
      .gt('business_date', lastDate)
      .order('business_date')
      .limit(1);
    if (error) { console.error(error); return; }
    if (!data || data.length === 0) break;
    allDates.push(data[0].business_date);
    lastDate = data[0].business_date;
  }
  console.log(`   Found ${allDates.length} distinct dates (${allDates[0]} to ${allDates[allDates.length - 1]})\n`);

  // 2. For each date, get sales totals and generate orders
  console.log('2. Generating orders per date...\n');

  let globalOrderId = 30000;
  let allOrders = [];

  for (const date of allDates) {
    // Get sales for this date
    const { data: sales } = await supabase
      .from('sales_line_items')
      .select('net_sales, qty')
      .eq('business_date', date);

    if (!sales || sales.length === 0) continue;

    // Total revenue for the day
    const dayRevenue = sales.reduce((sum, r) => sum + (r.net_sales || 0), 0);
    const totalItems = sales.reduce((sum, r) => sum + (r.qty || 0), 0);

    // Generate ~40-80 orders per day (realistic for a pizza place)
    const numOrders = Math.max(30, Math.min(80, Math.round(totalItems / 2.5)));
    const avgOrderValue = dayRevenue / numOrders;

    for (let i = 0; i < numOrders; i++) {
      const orderId = String(globalOrderId++);
      const servicePeriod = pick(SERVICE_PERIODS);
      const diningOption = pick(DINING_OPTIONS);

      // Generate time based on service period
      let hour;
      if (servicePeriod === 'Lunch') hour = 11 + Math.floor(Math.random() * 3); // 11-13
      else if (servicePeriod === 'Dinner') hour = 17 + Math.floor(Math.random() * 4); // 17-20
      else hour = 21 + Math.floor(Math.random() * 2); // 21-22

      const minute = Math.floor(Math.random() * 60);
      const durationMins = 8 + Math.floor(Math.random() * 25); // 8-32 min

      const opened = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+00:00`;
      const closedDate = new Date(opened);
      closedDate.setMinutes(closedDate.getMinutes() + durationMins);
      const closed = closedDate.toISOString();

      // Randomize subtotal around the average
      const subtotal = Math.round(rand(avgOrderValue * 0.4, avgOrderValue * 1.8) * 100) / 100;
      const discount = Math.random() < 0.15 ? Math.round(subtotal * rand(0.05, 0.15) * 100) / 100 : 0;
      const netSubtotal = Math.round((subtotal - discount) * 100) / 100;
      const tax = Math.round(netSubtotal * 0.08 * 100) / 100;
      const tip = diningOption === 'Dine In'
        ? Math.round(netSubtotal * rand(0.10, 0.22) * 100) / 100
        : (Math.random() < 0.3 ? Math.round(netSubtotal * rand(0.05, 0.15) * 100) / 100 : 0);
      const total = Math.round((netSubtotal + tax + tip) * 100) / 100;
      const numGuests = diningOption === 'Dine In' ? 1 + Math.floor(Math.random() * 5) : 1;

      allOrders.push({
        business_date: date,
        order_id: orderId,
        opened_at: opened,
        closed_at: closed,
        num_guests: numGuests,
        server_name: pick(SERVERS),
        dining_area: diningOption === 'Dine In' ? pick(DINING_AREAS.filter(Boolean)) : null,
        service_period: servicePeriod,
        dining_option: diningOption,
        order_source: diningOption === 'Delivery' ? 'Online' : pick(ORDER_SOURCES),
        discount_amount: discount,
        subtotal: netSubtotal,
        tax: tax,
        tip: tip,
        gratuity: 0,
        total: total,
        voided: false
      });
    }
  }

  console.log(`   Generated ${allOrders.length} orders across ${allDates.length} dates\n`);

  // 3. Clear existing daily_orders (except we keep the structure)
  console.log('3. Clearing existing daily_orders...');
  const { error: delErr, count: delCount } = await supabase
    .from('daily_orders')
    .delete({ count: 'exact' })
    .gte('id', '00000000-0000-0000-0000-000000000000');
  console.log(`   Deleted ${delCount} existing rows\n`);

  // 4. Insert in batches
  console.log('4. Inserting orders...');
  let inserted = 0;
  for (let i = 0; i < allOrders.length; i += 500) {
    const batch = allOrders.slice(i, i + 500);
    const { error } = await supabase.from('daily_orders').insert(batch);
    if (error) {
      console.error(`   Batch error at ${i}:`, error.message);
      continue;
    }
    inserted += batch.length;
    process.stdout.write(`   Inserted ${inserted}/${allOrders.length}\r`);
  }
  console.log(`\n   Done! Inserted ${inserted} orders\n`);

  // 5. Verify
  console.log('5. Verifying...');
  const { count } = await supabase.from('daily_orders').select('*', { count: 'exact', head: true });
  const { data: minD } = await supabase.from('daily_orders').select('business_date').order('business_date').limit(1);
  const { data: maxD } = await supabase.from('daily_orders').select('business_date').order('business_date', { ascending: false }).limit(1);
  console.log(`   Total rows: ${count}`);
  console.log(`   Date range: ${minD[0].business_date} to ${maxD[0].business_date}`);
  console.log('\n=== DONE ===');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
