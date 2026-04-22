import { ToolHandler, isPlainObject } from "../types.ts";
import { expectObjectArgs, ilikeContains, ok, requireStringArg } from "./common.ts";

const TOOL_NAME = "search_ingredient";
const SEARCH_LIMIT = 5;

export const searchIngredientTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Search ingredients by name to find matching ingredient IDs. Use this before ingredient-specific questions when only a name is known.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ingredient_name: {
          type: "string",
          description: "Ingredient name or partial name.",
        },
      },
      required: ["ingredient_name"],
    },
  },

  async execute(args, context) {
    const objectArgs = expectObjectArgs(args);
    const ingredient_name = requireStringArg(objectArgs, "ingredient_name", "ingredient_name", 100);

    const raw = await context.supabase.select("ingredients", {
      select: "id,name,unit",
      filters: {
        name: ilikeContains(ingredient_name),
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
        unit: typeof row.unit === "string" ? row.unit : null,
      }));

    return ok(TOOL_NAME, {
      query: ingredient_name,
      count: results.length,
      results,
    });
  },
};
