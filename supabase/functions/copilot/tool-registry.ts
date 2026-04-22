import { OpenAIFunctionToolDefinition, ToolHandler } from "./types.ts";
import { countInventoryTool } from "./tools/count-inventory.ts";
import { getBomForItemTool } from "./tools/get-bom-for-item.ts";
import { getDailyAnalyticsTool } from "./tools/get-daily-analytics.ts";
import { getForecastTool } from "./tools/get-forecast.ts";
import { getInventorySnapshotTool } from "./tools/get-inventory-snapshot.ts";
import { getRevenueTrendTool } from "./tools/get-revenue-trend.ts";
import { getTopSellingItemsTool } from "./tools/get-top-selling-items.ts";
import { predictRevenueTool } from "./tools/predict-revenue.ts";
import { receiveInventoryTool } from "./tools/receive-inventory.ts";
import { searchIngredientTool } from "./tools/search-ingredient.ts";
import { searchMenuItemTool } from "./tools/search-menu-item.ts";

const readHandlers: ToolHandler[] = [
  getInventorySnapshotTool,
  getForecastTool,
  getDailyAnalyticsTool,
  getRevenueTrendTool,
  getTopSellingItemsTool,
  predictRevenueTool,
  getBomForItemTool,
  searchIngredientTool,
  searchMenuItemTool,
];

const writeHandlers: ToolHandler[] = [
  receiveInventoryTool,
  countInventoryTool,
];

const handlers: ToolHandler[] = [
  ...readHandlers,
  ...writeHandlers,
];

export const readOnlyToolDefinitions: OpenAIFunctionToolDefinition[] = readHandlers.map((handler) => handler.definition);
export const writeToolDefinitions: OpenAIFunctionToolDefinition[] = writeHandlers.map((handler) => handler.definition);
export const chatToolDefinitions: OpenAIFunctionToolDefinition[] = handlers.map((handler) => handler.definition);

export const toolHandlerMap = new Map<string, ToolHandler>(
  handlers.map((handler) => [handler.name, handler]),
);
