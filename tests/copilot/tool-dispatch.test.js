const { AppError } = require("../../supabase/functions/copilot/types.ts");
const { executeToolCall } = require("../../supabase/functions/copilot/tool-dispatch.ts");
const {
  chatToolDefinitions,
  readOnlyToolDefinitions,
  toolHandlerMap,
} = require("../../supabase/functions/copilot/tool-registry.ts");
const { createAuth, createRuntimeEnv } = require("./helpers.js");

const TEST_UUID = "11111111-1111-4111-8111-111111111111";
const MENU_UUID = "22222222-2222-4222-8222-222222222222";

function createToolContext(overrides = {}) {
  return {
    auth: createAuth(),
    request: {
      mode: "chat",
      message: "test",
      context: undefined,
    },
    supabase: {
      authMode: "user",
      rpc: jest.fn(async () => null),
      select: jest.fn(async () => []),
      ...(overrides.supabase || {}),
    },
  };
}

async function expectInvalidArgs(toolName, args) {
  const handler = toolHandlerMap.get(toolName);
  const context = createToolContext();

  await expect(handler.execute(args, context)).rejects.toMatchObject({
    code: "invalid_tool_args",
  });
}

describe("copilot tool registry and dispatch", () => {
  test("registers all expected read-only analytics and lookup tools", () => {
    const readToolNames = new Set(readOnlyToolDefinitions.map((tool) => tool.name));
    const chatToolNames = new Set(chatToolDefinitions.map((tool) => tool.name));

    [
      "get_inventory_snapshot",
      "get_forecast",
      "get_daily_analytics",
      "get_bom_for_item",
      "search_ingredient",
      "search_menu_item",
      "get_revenue_trend",
      "get_top_selling_items",
      "predict_revenue",
    ].forEach((toolName) => {
      expect(readToolNames.has(toolName)).toBe(true);
      expect(chatToolNames.has(toolName)).toBe(true);
      expect(toolHandlerMap.has(toolName)).toBe(true);
    });
  });

  test("fails cleanly for unsupported tool names", async () => {
    const result = await executeToolCall(
      {
        callId: "call_unsupported",
        name: "unsupported_tool",
        argumentsJson: "{}",
      },
      createRuntimeEnv(),
      { mode: "chat", message: "hello" },
      createAuth(),
    );

    expect(result.result.ok).toBe(false);
    expect(result.result.error.code).toBe("unsupported_tool");
  });

  test("get_inventory_snapshot returns normalized rows", async () => {
    const handler = toolHandlerMap.get("get_inventory_snapshot");
    const context = createToolContext({
      supabase: {
        rpc: jest.fn(async () => [
          {
            ingredient_id: TEST_UUID,
            name: "Mozzarella",
            unit: "lb",
            reorder_point: "8",
            lead_time_days: "2",
            unit_cost: "3.5",
            qty_on_hand: "12",
            avg_daily_usage: "2.25",
            days_of_supply: "5.33",
            days_to_reorder: "1.2",
            status: "reorder_soon",
          },
        ]),
      },
    });

    const result = await handler.execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.items[0]).toMatchObject({
      ingredient_id: TEST_UUID,
      name: "Mozzarella",
      qty_on_hand: 12,
      status: "reorder_soon",
    });
  });

  test("get_forecast returns normalized forecast rows", async () => {
    const handler = toolHandlerMap.get("get_forecast");
    const context = createToolContext({
      supabase: {
        rpc: jest.fn(async () => [
          {
            forecast_date: "2026-04-10",
            ingredient_id: TEST_UUID,
            name: "Mozzarella",
            unit: "lb",
            qty_needed: "9",
            qty_on_hand: "4",
            shortfall: "5",
          },
        ]),
      },
    });

    const result = await handler.execute({ p_reference_date: "2026-04-10" }, context);
    expect(result.ok).toBe(true);
    expect(result.data.forecast[0]).toMatchObject({
      forecast_date: "2026-04-10",
      shortfall: 5,
    });
  });

  test("get_daily_analytics returns wrapped analytics", async () => {
    const handler = toolHandlerMap.get("get_daily_analytics");
    const context = createToolContext({
      supabase: {
        rpc: jest.fn(async () => ({
          status: "success",
          total_orders: 4,
          total_revenue: 220,
        })),
      },
    });

    const result = await handler.execute({ p_business_date: "2026-04-09" }, context);
    expect(result.ok).toBe(true);
    expect(result.data.analytics).toMatchObject({
      status: "success",
      total_orders: 4,
      total_revenue: 220,
    });
  });

  test("get_bom_for_item returns normalized BOM data", async () => {
    const handler = toolHandlerMap.get("get_bom_for_item");
    const context = createToolContext({
      supabase: {
        rpc: jest.fn(async () => ({
          status: "success",
          menu_item_id: MENU_UUID,
          menu_item_name: "Pepperoni Pizza",
          total_cost: "7.5",
          ingredients: [
            {
              ingredient_id: TEST_UUID,
              ingredient_name: "Mozzarella",
              unit: "lb",
              qty_per_item: "1.5",
              unit_cost: "3",
              cost_per_item: "4.5",
            },
          ],
        })),
      },
    });

    const result = await handler.execute({ p_menu_item_id: MENU_UUID }, context);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      menu_item_id: MENU_UUID,
      ingredient_count: 1,
      total_cost: 7.5,
    });
  });

  test("search_ingredient returns normalized matches", async () => {
    const handler = toolHandlerMap.get("search_ingredient");
    const context = createToolContext({
      supabase: {
        select: jest.fn(async () => [
          { id: TEST_UUID, name: "Mozzarella", unit: "lb" },
        ]),
      },
    });

    const result = await handler.execute({ ingredient_name: "moz" }, context);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      query: "moz",
      count: 1,
    });
    expect(result.data.results[0]).toMatchObject({
      id: TEST_UUID,
      name: "Mozzarella",
    });
  });

  test("search_menu_item returns normalized matches", async () => {
    const handler = toolHandlerMap.get("search_menu_item");
    const context = createToolContext({
      supabase: {
        select: jest.fn(async () => [
          { id: MENU_UUID, name: "Pepperoni Pizza", category: "Pizza", active: true },
        ]),
      },
    });

    const result = await handler.execute({ item_name: "pep" }, context);
    expect(result.ok).toBe(true);
    expect(result.data.results[0]).toMatchObject({
      id: MENU_UUID,
      active: true,
    });
  });

  test("get_revenue_trend uses direct daily_orders aggregation", async () => {
    const handler = toolHandlerMap.get("get_revenue_trend");
    const select = jest
      .fn()
      .mockResolvedValueOnce([{ business_date: "2026-04-09" }])
      .mockResolvedValueOnce([
        { business_date: "2026-04-08", subtotal: 100, tip: 10, discount_amount: 5, num_guests: 4 },
        { business_date: "2026-04-08", subtotal: 50, tip: 5, discount_amount: 0, num_guests: 2 },
        { business_date: "2026-04-09", subtotal: 80, tip: 8, discount_amount: 0, num_guests: 3 },
      ]);
    const context = createToolContext({ supabase: { select } });

    const result = await handler.execute({ days: 7 }, context);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      source: "daily_orders",
      method: "direct_daily_orders_aggregation",
      count: 2,
    });
    expect(result.data.rows[0]).toMatchObject({
      business_date: "2026-04-08",
      orders: 2,
      revenue: 150,
    });
    expect(result.data.summary.total_revenue).toBe(230);
  });

  test("get_top_selling_items aggregates sales_line_items correctly", async () => {
    const handler = toolHandlerMap.get("get_top_selling_items");
    const select = jest
      .fn()
      .mockResolvedValueOnce([{ business_date: "2026-04-09" }])
      .mockResolvedValueOnce([
        {
          business_date: "2026-04-08",
          menu_item_id: MENU_UUID,
          qty: 10,
          net_sales: 180,
          menu_items: { name: "Pepperoni Pizza", category: "Pizza" },
        },
        {
          business_date: "2026-04-09",
          menu_item_id: MENU_UUID,
          qty: 6,
          net_sales: 108,
          menu_items: { name: "Pepperoni Pizza", category: "Pizza" },
        },
        {
          business_date: "2026-04-09",
          menu_item_id: "33333333-3333-4333-8333-333333333333",
          qty: 4,
          net_sales: 72,
          menu_items: { name: "Margherita Pizza", category: "Pizza" },
        },
      ]);
    const context = createToolContext({ supabase: { select } });

    const result = await handler.execute({ days: 7, limit: 2 }, context);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      source: "sales_line_items",
      data_grain: "daily_item_aggregate",
      count: 2,
      limit: 2,
    });
    expect(result.data.items[0]).toMatchObject({
      menu_item_id: MENU_UUID,
      item_name: "Pepperoni Pizza",
      qty_sold: 16,
      revenue: 288,
      active_days: 2,
    });
  });

  test("predict_revenue is explicit about a simple trend method", async () => {
    const handler = toolHandlerMap.get("predict_revenue");
    const select = jest
      .fn()
      .mockResolvedValueOnce([{ business_date: "2026-04-09" }])
      .mockResolvedValueOnce([
        { business_date: "2026-04-07", subtotal: 100, tip: 10, discount_amount: 0, num_guests: 4 },
        { business_date: "2026-04-08", subtotal: 120, tip: 12, discount_amount: 0, num_guests: 5 },
        { business_date: "2026-04-09", subtotal: 140, tip: 14, discount_amount: 0, num_guests: 6 },
      ]);
    const context = createToolContext({ supabase: { select } });

    const result = await handler.execute({ lookback_days: 7, forecast_days: 2 }, context);
    expect(result.ok).toBe(true);
    expect(result.data.method).toBe("simple_linear_trend");
    expect(result.data.prediction).toMatchObject({
      method: "simple_linear_trend",
      data_points: 3,
    });
  });

  test("predict_revenue handles sparse data with average_only", async () => {
    const handler = toolHandlerMap.get("predict_revenue");
    const select = jest
      .fn()
      .mockResolvedValueOnce([{ business_date: "2026-04-09" }])
      .mockResolvedValueOnce([
        { business_date: "2026-04-08", subtotal: 100, tip: 10, discount_amount: 0, num_guests: 4 },
        { business_date: "2026-04-09", subtotal: 120, tip: 12, discount_amount: 0, num_guests: 5 },
      ]);
    const context = createToolContext({ supabase: { select } });

    const result = await handler.execute({ lookback_days: 7, forecast_days: 1 }, context);
    expect(result.ok).toBe(true);
    expect(result.data.prediction.method).toBe("average_only");
  });

  test("rejects malformed arguments for all supported read tools", async () => {
    await expectInvalidArgs("get_inventory_snapshot", { extra: true });
    await expectInvalidArgs("get_forecast", { p_reference_date: "not-a-date" });
    await expectInvalidArgs("get_daily_analytics", { p_business_date: "not-a-date" });
    await expectInvalidArgs("get_bom_for_item", { p_menu_item_id: "not-a-uuid" });
    await expectInvalidArgs("search_ingredient", { ingredient_name: "" });
    await expectInvalidArgs("search_menu_item", { item_name: "" });
    await expectInvalidArgs("get_revenue_trend", { days: 999 });
    await expectInvalidArgs("get_top_selling_items", { limit: 0 });
    await expectInvalidArgs("predict_revenue", { forecast_days: 0 });
  });
});
