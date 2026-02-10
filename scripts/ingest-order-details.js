/**
 * Ingests the Toast OrderDetails CSV into daily_orders table.
 * Run: node scripts/ingest-order-details.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CSV_PATH = path.join(__dirname, '..', 'Test data', 'Toast_OrderDetails_DAILY_INJECT_latestDay.csv');

function parseDate(str) {
  if (!str) return null;
  // MM/DD/YYYY HH:MM:SS -> ISO
  const [datePart, timePart] = str.split(' ');
  const [mm, dd, yyyy] = datePart.split('/');
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${timePart}`;
}

function extractBusinessDate(str) {
  if (!str) return null;
  const [datePart] = str.split(' ');
  const [mm, dd, yyyy] = datePart.split('/');
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function main() {
  console.log('Reading CSV:', CSV_PATH);
  const csv = fs.readFileSync(CSV_PATH, 'utf-8');
  const { data: rows } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  console.log('Parsed', rows.length, 'order rows');

  const mapped = rows
    .filter(r => r['Voided'] !== 'True')
    .map(r => ({
      business_date: extractBusinessDate(r['Opened']),
      order_id: r['Order Id'],
      opened_at: parseDate(r['Opened']),
      closed_at: parseDate(r['Closed']),
      num_guests: parseInt(r['# of Guests']) || 0,
      server_name: r['Server'] || null,
      dining_area: r['Dining Area'] || null,
      service_period: r['Service'] || null,
      dining_option: r['Dining Options'] || null,
      order_source: r['Order Source'] || null,
      discount_amount: parseFloat(r['Discount Amount']) || 0,
      subtotal: parseFloat(r['Amount']) || 0,
      tax: parseFloat(r['Tax']) || 0,
      tip: parseFloat(r['Tip']) || 0,
      gratuity: parseFloat(r['Gratuity']) || 0,
      total: parseFloat(r['Total']) || 0,
      voided: false
    }));

  console.log('Ingesting', mapped.length, 'orders...');
  const { data, error } = await supabase.rpc('ingest_daily_orders', { p_rows: mapped });
  if (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
  console.log('Result:', JSON.stringify(data));

  // Run analytics
  console.log('\nFetching analytics for the ingested date...');
  const { data: analytics } = await supabase.rpc('get_daily_analytics');
  if (analytics.status === 'success') {
    console.log('Date:', analytics.business_date);
    console.log('Orders:', analytics.total_orders);
    console.log('Revenue: $' + analytics.total_revenue);
    console.log('Avg order: $' + analytics.avg_order_value);
    console.log('Guests:', analytics.total_guests);
    console.log('Tips: $' + analytics.total_tips);
    console.log('\nBy service period:');
    analytics.by_service_period.forEach(s =>
      console.log('  ' + s.period + ': ' + s.orders + ' orders, $' + s.revenue));
    console.log('\nBy dining option:');
    analytics.by_dining_option.forEach(d =>
      console.log('  ' + d.option + ': ' + d.orders + ' orders, $' + d.revenue));
    console.log('\nBy server:');
    analytics.by_server.forEach(s =>
      console.log('  ' + s.server + ': ' + s.orders + ' orders, $' + s.revenue + ', tips: $' + s.tips));
  }

  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
