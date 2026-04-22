import { AppError, ToolHandler, isPlainObject } from "../types.ts";
import { ensureObjectArray, expectObjectArgs, numericOrNull, ok, requireUuidArg } from "./common.ts";

const TOOL_NAME = "get_bom_for_item";

export const getBomForItemTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Get the bill of materials for a specific menu item by UUID. Use search_menu_item first if you only know the item name.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        p_menu_item_id: {
          type: "string",
          description: "The menu item UUID.",
        },
      },
      required: ["p_menu_item_id"],
    },
  },

  async execute(args, context) {
    const objectArgs = expectObjectArgs(args);
    const p_menu_item_id = requireUuidArg(objectArgs, "p_menu_item_id");

    const raw = await context.supabase.rpc(TOOL_NAME, { p_menu_item_id });
    if (!isPlainObject(raw)) {
      throw new AppError("unexpected_tool_result", "BOM data could not be loaded.", 502, false);
    }

    if (raw.status === "error") {
      throw new AppError(
        "bom_lookup_failed",
        typeof raw.message === "string" ? raw.message : "BOM lookup failed.",
        404,
      );
    }

    const ingredients = ensureObjectArray(raw.ingredients).map((row) => ({
      ingredient_id: typeof row.ingredient_id === "string" ? row.ingredient_id : null,
      ingredient_name: typeof row.ingredient_name === "string" ? row.ingredient_name : null,
      unit: typeof row.unit === "string" ? row.unit : null,
      qty_per_item: numericOrNull(row.qty_per_item),
      unit_cost: numericOrNull(row.unit_cost),
      cost_per_item: numericOrNull(row.cost_per_item),
    }));

    return ok(TOOL_NAME, {
      status: typeof raw.status === "string" ? raw.status : "success",
      menu_item_id: typeof raw.menu_item_id === "string" ? raw.menu_item_id : p_menu_item_id,
      menu_item_name: typeof raw.menu_item_name === "string" ? raw.menu_item_name : null,
      total_cost: numericOrNull(raw.total_cost),
      ingredient_count: ingredients.length,
      ingredients,
    });
  },
};
