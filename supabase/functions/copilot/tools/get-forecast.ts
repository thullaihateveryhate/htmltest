import { ToolHandler } from "../types.ts";
import { ensureObjectArray, expectObjectArgs, numericOrNull, ok, optionalDateArg } from "./common.ts";

const TOOL_NAME = "get_forecast";

export const getForecastTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Get the ingredient forecast for the next 7 days. The forecast returns ingredient-level rows, not dashboard menu or revenue projections.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        p_reference_date: {
          type: "string",
          description: "Optional start date in YYYY-MM-DD format. Defaults to the current date on the server.",
        },
      },
      required: [],
    },
  },

  async execute(args, context) {
    const objectArgs = expectObjectArgs(args);
    const p_reference_date = optionalDateArg(objectArgs, "p_reference_date");

    const rpcArgs = p_reference_date ? { p_reference_date } : {};
    const raw = await context.supabase.rpc(TOOL_NAME, rpcArgs);
    const rows = ensureObjectArray(raw).map((row) => ({
      forecast_date: typeof row.forecast_date === "string" ? row.forecast_date : null,
      ingredient_id: typeof row.ingredient_id === "string" ? row.ingredient_id : null,
      name: typeof row.name === "string" ? row.name : null,
      unit: typeof row.unit === "string" ? row.unit : null,
      qty_needed: numericOrNull(row.qty_needed),
      qty_on_hand: numericOrNull(row.qty_on_hand),
      shortfall: numericOrNull(row.shortfall),
    }));

    return ok(TOOL_NAME, {
      reference_date: p_reference_date || null,
      count: rows.length,
      forecast: rows,
    });
  },
};
