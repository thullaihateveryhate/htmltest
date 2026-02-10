// Manual one-off order placement via register_order RPC
// Uses .env (SUPABASE_URL, SUPABASE_SERVICE_KEY)
require('dotenv').config();

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

// Use built-in fetch (Node 18+). If unavailable, install node-fetch.
const fetchFn = global.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

async function main() {
  const orderId = `__manual_${Date.now()}`;
  const payload = {
    p_order_raw: {
      order_id: orderId,
      business_date: new Date().toISOString().slice(0, 10),
      opened_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      num_guests: 2,
      server_name: 'API Tester',
      dining_option: 'Dine In',
      service_period: 'Lunch',
      subtotal: 20,
      tax: 1.6,
      tip: 3,
      total: 24.6,
      items: [
        { menu_item_name: '__testManualPizza', qty: 2, price: 10 }
      ]
    }
  };

  const res = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/register_order`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json();
  console.log('Request order_id:', orderId);
  console.log('HTTP', res.status, res.statusText);
  console.log('Response:', body);

  if (!res.ok || body.status === 'error') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error placing order:', err);
  process.exit(1);
});
