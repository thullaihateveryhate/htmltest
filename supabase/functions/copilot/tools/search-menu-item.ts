import { ToolHandler, isPlainObject } from "../types.ts";
import { expectObjectArgs, ilikeContains, ok, requireStringArg } from "./common.ts";

const TOOL_NAME = "search_menu_item";
const SEARCH_LIMIT = 5;

export const searchMenuItemTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Search menu items by name to find matching menu item IDs. Use this before BOM lookups when only the item name is known.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        item_name: {
          type: "string",
          description: "Menu item name or partial name.",
        },
      },
      required: ["item_name"],
    },
  },

  async execute(args, context) {
    const objectArgs = expectObjectArgs(args);
    const item_name = requireStringArg(objectArgs, "item_name", "item_name", 100);

    const raw = await context.supabase.select("menu_items", {
      select: "id,name,category,active",
      filters: {
        name: ilikeContains(item_name),
      },
      order: "name.asc",
      limit: SEARCH_LIMIT,
    });

    const objectRows = Array.isArray(raw)
      ? raw.filter(isPlainObject) as Array<Record<string, unknown>>
      : [];

    const results = objectRows.map((row) => ({
        id: typeof row.id === "string" ? row.id : null,
        name: typeof row.name === "string" ? row.name : null,
        category: typeof row.category === "string" ? row.category : null,
        active: typeof row.active === "boolean" ? row.active : null,
      }));

    return ok(TOOL_NAME, {
      query: item_name,
      count: results.length,
      results,
    });
  },
};
