import { AppError, JsonObject, ToolContext, isPlainObject } from "../types.ts";

export interface IngredientIdentity {
  id: string;
  name: string;
  unit: string | null;
}

export async function loadIngredientIdentity(
  context: ToolContext,
  ingredientId: string,
): Promise<IngredientIdentity> {
  const raw = await context.supabase.select("ingredients", {
    select: "id,name,unit",
    filters: {
      id: `eq.${ingredientId}`,
    },
    limit: 1,
  });

  if (!Array.isArray(raw) || raw.length === 0 || !isPlainObject(raw[0])) {
    throw new AppError("ingredient_not_found", "ingredient not found", 404);
  }

  const row = raw[0] as JsonObject;
  if (typeof row.id !== "string" || typeof row.name !== "string") {
    throw new AppError(
      "unexpected_tool_result",
      "Ingredient details could not be loaded.",
      502,
      false,
    );
  }

  return {
    id: row.id,
    name: row.name,
    unit: typeof row.unit === "string" ? row.unit : null,
  };
}
