import { AppError, JsonObject, ToolHandler, ToolExecutionResult, isPlainObject } from "../types.ts";
import { loadIngredientIdentity } from "./inventory-write-common.ts";
import { expectObjectArgs, numericOrNull, ok, optionalStringArg, requireNumberArg, requireUuidArg } from "./common.ts";

const TOOL_NAME = "receive_inventory";
const MAX_QTY = 1_000_000;

function validateReceiveArgs(args: unknown): JsonObject {
  const objectArgs = expectObjectArgs(args);
  const p_ingredient_id = requireUuidArg(objectArgs, "p_ingredient_id");
  const p_qty = requireNumberArg(objectArgs, "p_qty", {
    label: "p_qty",
    allowZero: false,
    max: MAX_QTY,
  });
  const p_note = optionalStringArg(objectArgs, "p_note", "p_note", 240);

  return {
    p_ingredient_id,
    p_qty,
    p_note,
  };
}

function normalizeReceiveResult(raw: unknown, fallbackIngredientId: string): ToolExecutionResult {
  if (!isPlainObject(raw)) {
    throw new AppError(
      "unexpected_tool_result",
      "Inventory receipt could not be recorded.",
      502,
      false,
    );
  }

  if (raw.status === "error") {
    const message = typeof raw.message === "string" ? raw.message : "Inventory receipt failed.";
    const status = message === "ingredient not found" ? 404 : 400;
    throw new AppError("inventory_receive_failed", message, status);
  }

  return ok(TOOL_NAME, {
    status: typeof raw.status === "string" ? raw.status : "success",
    ingredient_id: typeof raw.ingredient_id === "string" ? raw.ingredient_id : fallbackIngredientId,
    qty_received: numericOrNull(raw.qty_received),
    new_qty_on_hand: numericOrNull(raw.new_qty_on_hand),
  });
}

export const receiveInventoryTool: ToolHandler = {
  name: TOOL_NAME,
  access: "write",
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Prepare an inventory receipt for a specific ingredient UUID. This creates a confirmation-required action and does not execute immediately.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        p_ingredient_id: {
          type: "string",
          description: "Ingredient UUID. Use search_ingredient first if you only know the ingredient name.",
        },
        p_qty: {
          type: "number",
          description: "Quantity received in the ingredient's stored unit. Must be greater than 0.",
        },
        p_note: {
          type: "string",
          description: "Optional receipt note, such as vendor name or invoice reference.",
        },
      },
      required: ["p_ingredient_id", "p_qty"],
    },
  },

  async preparePendingAction(args, context) {
    const validatedArgs = validateReceiveArgs(args);
    const ingredient = await loadIngredientIdentity(context, validatedArgs.p_ingredient_id as string);
    const qty = validatedArgs.p_qty as number;
    const note = typeof validatedArgs.p_note === "string" && validatedArgs.p_note.trim()
      ? validatedArgs.p_note.trim()
      : null;
    const unitSuffix = ingredient.unit ? ` ${ingredient.unit}` : "";

    return {
      tool_name: TOOL_NAME,
      arguments: validatedArgs,
      summary: note
        ? `Receive ${qty}${unitSuffix} of ${ingredient.name} (${note})`
        : `Receive ${qty}${unitSuffix} of ${ingredient.name}`,
    };
  },

  async execute(args, context) {
    const validatedArgs = validateReceiveArgs(args);
    const raw = await context.supabase.rpc(TOOL_NAME, {
      p_ingredient_id: validatedArgs.p_ingredient_id,
      p_qty: validatedArgs.p_qty,
      p_note: validatedArgs.p_note,
    });

    return normalizeReceiveResult(raw, validatedArgs.p_ingredient_id as string);
  },

  formatSuccessReply(result, context) {
    const data = isPlainObject(result.data) ? result.data : {};
    const qty = data.qty_received ?? null;
    const onHand = data.new_qty_on_hand ?? null;

    return qty !== null && onHand !== null
      ? `Done — recorded the inventory receipt. The new on-hand quantity is ${onHand}.`
      : `Done — recorded the inventory receipt.`;
  },
};
