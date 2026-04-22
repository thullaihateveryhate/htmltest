import { AppError, JsonObject, ToolHandler, ToolExecutionResult, isPlainObject } from "../types.ts";
import { loadIngredientIdentity } from "./inventory-write-common.ts";
import { expectObjectArgs, numericOrNull, ok, requireNumberArg, requireUuidArg } from "./common.ts";

const TOOL_NAME = "count_inventory";
const MAX_QTY = 1_000_000;

function validateCountArgs(args: unknown): JsonObject {
  const objectArgs = expectObjectArgs(args);
  const p_ingredient_id = requireUuidArg(objectArgs, "p_ingredient_id");
  const p_actual_qty = requireNumberArg(objectArgs, "p_actual_qty", {
    label: "p_actual_qty",
    min: 0,
    max: MAX_QTY,
  });

  return {
    p_ingredient_id,
    p_actual_qty,
  };
}

function normalizeCountResult(raw: unknown, fallbackIngredientId: string): ToolExecutionResult {
  if (!isPlainObject(raw)) {
    throw new AppError(
      "unexpected_tool_result",
      "Inventory count could not be recorded.",
      502,
      false,
    );
  }

  if (raw.status === "error") {
    const message = typeof raw.message === "string" ? raw.message : "Inventory count failed.";
    const status = message === "ingredient not found" ? 404 : 400;
    throw new AppError("inventory_count_failed", message, status);
  }

  return ok(TOOL_NAME, {
    status: typeof raw.status === "string" ? raw.status : "success",
    ingredient_id: typeof raw.ingredient_id === "string" ? raw.ingredient_id : fallbackIngredientId,
    previous_qty: numericOrNull(raw.previous_qty),
    actual_qty: numericOrNull(raw.actual_qty),
    delta: numericOrNull(raw.delta),
    new_qty_on_hand: numericOrNull(raw.new_qty_on_hand),
  });
}

export const countInventoryTool: ToolHandler = {
  name: TOOL_NAME,
  access: "write",
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Prepare a physical inventory count update for a specific ingredient UUID. This creates a confirmation-required action and does not execute immediately.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        p_ingredient_id: {
          type: "string",
          description: "Ingredient UUID. Use search_ingredient first if you only know the ingredient name.",
        },
        p_actual_qty: {
          type: "number",
          description: "The actual counted quantity in the ingredient's stored unit. Must be 0 or greater.",
        },
      },
      required: ["p_ingredient_id", "p_actual_qty"],
    },
  },

  async preparePendingAction(args, context) {
    const validatedArgs = validateCountArgs(args);
    const ingredient = await loadIngredientIdentity(context, validatedArgs.p_ingredient_id as string);
    const qty = validatedArgs.p_actual_qty as number;
    const unitSuffix = ingredient.unit ? ` ${ingredient.unit}` : "";

    return {
      tool_name: TOOL_NAME,
      arguments: validatedArgs,
      summary: `Set the count for ${ingredient.name} to ${qty}${unitSuffix}`,
    };
  },

  async execute(args, context) {
    const validatedArgs = validateCountArgs(args);
    const raw = await context.supabase.rpc(TOOL_NAME, {
      p_ingredient_id: validatedArgs.p_ingredient_id,
      p_actual_qty: validatedArgs.p_actual_qty,
    });

    return normalizeCountResult(raw, validatedArgs.p_ingredient_id as string);
  },

  formatSuccessReply(result) {
    const data = isPlainObject(result.data) ? result.data : {};
    const previous = data.previous_qty ?? null;
    const actual = data.actual_qty ?? null;

    return previous !== null && actual !== null
      ? `Done — recorded the inventory count. On-hand changed from ${previous} to ${actual}.`
      : `Done — recorded the inventory count.`;
  },
};
