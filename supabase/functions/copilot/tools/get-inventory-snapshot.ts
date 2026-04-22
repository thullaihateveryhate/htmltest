import { ToolHandler, isPlainObject } from "../types.ts";
import { ensureObjectArray, expectNoExtraArgs, numericOrNull, ok } from "./common.ts";

const TOOL_NAME = "get_inventory_snapshot";

export const getInventorySnapshotTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Get the current inventory snapshot for ingredients, including quantity on hand, average usage, days of supply, and stock status.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },

  async execute(args, context) {
    expectNoExtraArgs(args);

    const raw = await context.supabase.rpc(TOOL_NAME, {});
    const rows = ensureObjectArray(raw).map((row) => ({
      ingredient_id: typeof row.ingredient_id === "string" ? row.ingredient_id : null,
      name: typeof row.name === "string" ? row.name : null,
      unit: typeof row.unit === "string" ? row.unit : null,
      reorder_point: numericOrNull(row.reorder_point),
      lead_time_days: numericOrNull(row.lead_time_days),
      unit_cost: numericOrNull(row.unit_cost),
      qty_on_hand: numericOrNull(row.qty_on_hand),
      avg_daily_usage: numericOrNull(row.avg_daily_usage),
      days_of_supply: numericOrNull(row.days_of_supply),
      days_to_reorder: numericOrNull(row.days_to_reorder),
      status: typeof row.status === "string" ? row.status : "unknown",
    }));

    return ok(TOOL_NAME, {
      count: rows.length,
      items: rows,
    });
  },
};
