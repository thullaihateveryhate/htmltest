const assert = require("node:assert/strict");

const {
  TEST_PREFIX,
  cleanTestData,
  getInventory,
  insertIngredient,
  insertMenuItem,
  insertSale,
  setInventory,
  supabase,
} = require("../tests/helpers/supabase.js");

const {
  buildDashboardForecastData,
  buildRecentSalesDays,
  getCountVariancePercent,
  parseInventoryCountNote,
  summarizeCountMetrics,
} = require("../Frontend/js/database-helpers.js");

async function run(name, fn) {
  try {
    await cleanTestData();
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
    return false;
  }
}

async function querySingle(table, queryBuilder) {
  const { data, error } = await queryBuilder(supabase.from(table));
  if (error) {
    throw error;
  }
  return data;
}

(async () => {
  let passed = 0;
  let failed = 0;

  if (await run("receive_inventory persists a delivery and the receipt can be read back", async () => {
    const ingredientId = await insertIngredient("Req4 Flour", "lb", 10, 2, 0.5);
    await setInventory(ingredientId, 10);

    const { data, error } = await supabase.rpc("receive_inventory", {
      p_ingredient_id: ingredientId,
      p_qty: 5,
      p_note: "Requirement 4 delivery",
    });

    assert.equal(error, null);
    assert.equal(data.status, "success");
    assert.equal(await getInventory(ingredientId), 15);

    const rows = await querySingle("inventory_txns", (query) => query
      .select("qty_delta, note, ingredients(name, unit)")
      .eq("ingredient_id", ingredientId)
      .eq("txn_type", "RECEIVE")
      .order("created_at", { ascending: false })
      .limit(1));

    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].qty_delta), 5);
    assert.equal(rows[0].note, "Requirement 4 delivery");
    assert.equal(rows[0].ingredients.name, `${TEST_PREFIX}Req4 Flour`);
  })) passed += 1; else failed += 1;

  if (await run("ingest_daily_sales stores rows that buildRecentSalesDays can display from persisted data", async () => {
    const { data, error } = await supabase.rpc("ingest_daily_sales", {
      p_rows: [
        {
          business_date: "9999-06-01",
          menu_item_name: `${TEST_PREFIX}Req4 Margherita`,
          category: "Test",
          qty: 2,
          net_sales: 24,
          source: "test",
        },
        {
          business_date: "9999-06-01",
          menu_item_name: `${TEST_PREFIX}Req4 Pepperoni`,
          category: "Test",
          qty: 1,
          net_sales: 14,
          source: "test",
        },
        {
          business_date: "9999-06-02",
          menu_item_name: `${TEST_PREFIX}Req4 Margherita`,
          category: "Test",
          qty: 4,
          net_sales: 48,
          source: "test",
        },
      ],
    });

    assert.equal(error, null);
    assert.equal(data.status, "success");
    assert.equal(data.rows_processed, 3);

    const salesRows = await querySingle("sales_line_items", (query) => query
      .select("business_date, qty, net_sales, menu_item_id")
      .gte("business_date", "9999-06-01")
      .lte("business_date", "9999-06-02"));

    const recentDays = buildRecentSalesDays(salesRows, { limit: 10 });
    assert.equal(recentDays.length, 2);
    assert.deepEqual(recentDays[0], {
      date: "9999-06-02",
      qty: 4,
      sales: 48,
      itemCount: 1,
    });
    assert.deepEqual(recentDays[1], {
      date: "9999-06-01",
      qty: 3,
      sales: 38,
      itemCount: 2,
    });
  })) passed += 1; else failed += 1;

  if (await run("count_inventory note parsing and summary metrics match the real RPC note format", async () => {
    const ingredientId = await insertIngredient("Req4 Mozzarella", "oz", 20, 2, 0.25);
    await setInventory(ingredientId, 40);

    const { data, error } = await supabase.rpc("count_inventory", {
      p_ingredient_id: ingredientId,
      p_actual_qty: 35.5,
    });

    assert.equal(error, null);
    assert.equal(data.status, "success");

    const rows = await querySingle("inventory_txns", (query) => query
      .select("qty_delta, note, ingredients(name)")
      .eq("ingredient_id", ingredientId)
      .eq("txn_type", "COUNT")
      .order("created_at", { ascending: false })
      .limit(1));

    assert.equal(rows.length, 1);
    const parsed = parseInventoryCountNote(rows[0].note);
    assert.ok(parsed);
    assert.equal(parsed.previousQty, 40);
    assert.equal(parsed.actualQty, 35.5);
    assert.equal(getCountVariancePercent(parsed.previousQty, Number(rows[0].qty_delta)), 11.25);

    const metrics = summarizeCountMetrics(rows);
    assert.equal(metrics.totalCounts, 1);
    assert.equal(metrics.accuracyRate, 0);
    assert.equal(metrics.avgDiscrepancy, 11.3);
    assert.equal(metrics.needsAttention, 1);
  })) passed += 1; else failed += 1;

  if (await run("dashboard forecast helper aligns persisted forecast_items and sales_line_items into the live UI contract", async () => {
    const menuItemId = await insertMenuItem("Req4 Forecast Pizza", "Test");

    for (let offset = 0; offset < 42; offset += 1) {
      const date = new Date("9999-06-14T00:00:00Z");
      date.setUTCDate(date.getUTCDate() - offset);
      const businessDate = date.toISOString().slice(0, 10);
      await insertSale(menuItemId, businessDate, 10, 120);
    }

    const { data: forecastRun, error: forecastError } = await supabase.rpc("generate_forecast", {
      p_days_ahead: 8,
      p_reference_date: "9999-06-15",
    });

    assert.equal(forecastError, null);
    assert.equal(forecastRun.status, "success");

    const forecastRows = await querySingle("forecast_items", (query) => query
      .select("forecast_date, menu_item_id, qty, menu_items(name, category)")
      .eq("menu_item_id", menuItemId)
      .gte("forecast_date", "9999-06-16")
      .lte("forecast_date", "9999-06-22"));

    const salesRows = await querySingle("sales_line_items", (query) => query
      .select("business_date, menu_item_id, qty, net_sales, menu_items(name, category)")
      .eq("menu_item_id", menuItemId)
      .gte("business_date", "9999-05-04")
      .lt("business_date", "9999-06-15"));

    const dashboardForecast = buildDashboardForecastData({
      referenceDate: "9999-06-15",
      forecastRows,
      salesRows,
    });

    assert.equal(dashboardForecast.source, "forecast_items");
    assert.equal(dashboardForecast.menu_items.length, 1);
    assert.equal(dashboardForecast.daily_revenue.length, 7);
    assert.equal(dashboardForecast.menu_items[0].name, `${TEST_PREFIX}Req4 Forecast Pizza`);
    assert.equal(dashboardForecast.menu_items[0].price, 12);
    assert.equal(dashboardForecast.menu_items[0].avg_daily_sales, 10);
    assert.equal(dashboardForecast.menu_items[0].forecast_tomorrow, 10);
    assert.equal(dashboardForecast.daily_revenue[0].revenue, 120);
  })) passed += 1; else failed += 1;

  await cleanTestData();

  console.log(`\nDatabase tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
