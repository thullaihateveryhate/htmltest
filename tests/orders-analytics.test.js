/**
 * Tests for daily_orders ingestion and analytics RPCs
 * ingest_daily_orders, get_daily_analytics, get_revenue_trend
 */

const { supabase, cleanTestData } = require('./helpers/supabase');

// Use unique test order IDs to avoid collision with real data
const TEST_ORDER_PREFIX = '__test_order_';

async function cleanTestOrders() {
  await supabase.from('daily_orders').delete().like('order_id', TEST_ORDER_PREFIX + '%');
}

beforeEach(async () => { await cleanTestOrders(); });
afterAll(async () => { await cleanTestOrders(); });

describe('ingest_daily_orders', () => {
  test('ingests order rows', async () => {
    const { data } = await supabase.rpc('ingest_daily_orders', {
      p_rows: [
        {
          business_date: '9999-01-01',
          order_id: TEST_ORDER_PREFIX + '001',
          num_guests: 3,
          server_name: 'TestServer',
          service_period: 'Lunch',
          dining_option: 'Dine In',
          order_source: 'In store',
          subtotal: 45.50,
          tax: 3.64,
          tip: 6.82,
          total: 55.96,
          voided: false
        },
        {
          business_date: '9999-01-01',
          order_id: TEST_ORDER_PREFIX + '002',
          num_guests: 1,
          service_period: 'Dinner',
          dining_option: 'Takeout',
          subtotal: 22.00,
          tax: 1.76,
          tip: 0,
          total: 23.76,
          voided: false
        }
      ]
    });
    expect(data.status).toBe('success');
    expect(data.rows_processed).toBe(2);
  });

  test('handles empty array', async () => {
    const { data } = await supabase.rpc('ingest_daily_orders', { p_rows: [] });
    expect(data.status).toBe('success');
    expect(data.rows_processed).toBe(0);
  });

  test('upserts on re-upload (same order_id)', async () => {
    await supabase.rpc('ingest_daily_orders', {
      p_rows: [{
        business_date: '9999-01-01',
        order_id: TEST_ORDER_PREFIX + '003',
        subtotal: 30.00, total: 30.00
      }]
    });
    // Re-upload with different amount
    const { data } = await supabase.rpc('ingest_daily_orders', {
      p_rows: [{
        business_date: '9999-01-01',
        order_id: TEST_ORDER_PREFIX + '003',
        subtotal: 50.00, total: 50.00
      }]
    });
    expect(data.status).toBe('success');

    // Verify only 1 row, with updated amount
    const { data: rows } = await supabase.from('daily_orders')
      .select('subtotal').eq('order_id', TEST_ORDER_PREFIX + '003');
    expect(rows.length).toBe(1);
    expect(rows[0].subtotal).toBe(50.00);
  });
});

describe('get_daily_analytics', () => {
  beforeEach(async () => {
    await cleanTestOrders();
    // Seed 3 orders
    await supabase.rpc('ingest_daily_orders', {
      p_rows: [
        {
          business_date: '9999-06-15',
          order_id: TEST_ORDER_PREFIX + 'a1',
          opened_at: '9999-06-15T12:00:00',
          num_guests: 2,
          server_name: 'Alice',
          service_period: 'Lunch',
          dining_option: 'Dine In',
          order_source: 'In store',
          subtotal: 40, tax: 3.2, tip: 6, total: 49.2
        },
        {
          business_date: '9999-06-15',
          order_id: TEST_ORDER_PREFIX + 'a2',
          opened_at: '9999-06-15T18:30:00',
          num_guests: 4,
          server_name: 'Alice',
          service_period: 'Dinner',
          dining_option: 'Dine In',
          order_source: 'In store',
          subtotal: 80, tax: 6.4, tip: 12, total: 98.4
        },
        {
          business_date: '9999-06-15',
          order_id: TEST_ORDER_PREFIX + 'a3',
          opened_at: '9999-06-15T19:00:00',
          num_guests: 1,
          service_period: 'Dinner',
          dining_option: 'Takeout',
          order_source: 'Online',
          subtotal: 25, tax: 2, tip: 0, total: 27
        }
      ]
    });
  });

  test('returns analytics for specific date', async () => {
    const { data } = await supabase.rpc('get_daily_analytics', {
      p_business_date: '9999-06-15'
    });
    expect(data.status).toBe('success');
    expect(data.total_orders).toBe(3);
    expect(data.total_revenue).toBe(145);
    expect(data.total_guests).toBe(7);
    expect(data.total_tips).toBe(18);
  });

  test('returns service period breakdown', async () => {
    const { data } = await supabase.rpc('get_daily_analytics', {
      p_business_date: '9999-06-15'
    });
    expect(data.by_service_period.length).toBe(2);
    const dinner = data.by_service_period.find(s => s.period === 'Dinner');
    expect(dinner.orders).toBe(2);
    expect(dinner.revenue).toBe(105);
  });

  test('returns dining option breakdown', async () => {
    const { data } = await supabase.rpc('get_daily_analytics', {
      p_business_date: '9999-06-15'
    });
    const dineIn = data.by_dining_option.find(d => d.option === 'Dine In');
    expect(dineIn.orders).toBe(2);
    const takeout = data.by_dining_option.find(d => d.option === 'Takeout');
    expect(takeout.orders).toBe(1);
  });

  test('returns server breakdown', async () => {
    const { data } = await supabase.rpc('get_daily_analytics', {
      p_business_date: '9999-06-15'
    });
    const alice = data.by_server.find(s => s.server === 'Alice');
    expect(alice.orders).toBe(2);
    expect(alice.tips).toBe(18);
  });

  test('returns no_data for empty date', async () => {
    const { data } = await supabase.rpc('get_daily_analytics', {
      p_business_date: '9999-12-31'
    });
    expect(data.status).toBe('no_data');
  });
});

describe('get_revenue_trend', () => {
  test('returns revenue trend data', async () => {
    // Seed orders across 2 dates
    await supabase.rpc('ingest_daily_orders', {
      p_rows: [
        { business_date: '9999-01-01', order_id: TEST_ORDER_PREFIX + 't1', subtotal: 100, total: 100 },
        { business_date: '9999-01-01', order_id: TEST_ORDER_PREFIX + 't2', subtotal: 50, total: 50 },
        { business_date: '9999-01-02', order_id: TEST_ORDER_PREFIX + 't3', subtotal: 75, total: 75 }
      ]
    });

    const { data } = await supabase.rpc('get_revenue_trend', { p_days: 30 });
    expect(Array.isArray(data)).toBe(true);
    // Should have at least our 2 test dates (may also have real data)
    const testDates = data.filter(d =>
      d.business_date === '9999-01-01' || d.business_date === '9999-01-02'
    );
    expect(testDates.length).toBe(2);

    const day1 = testDates.find(d => d.business_date === '9999-01-01');
    expect(day1.orders).toBe(2);
    expect(day1.revenue).toBe(150);
  });

  test('returns empty array when no data', async () => {
    // Clean all test orders and check - this just tests the function doesn't crash
    const { data, error } = await supabase.rpc('get_revenue_trend', { p_days: 1 });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
