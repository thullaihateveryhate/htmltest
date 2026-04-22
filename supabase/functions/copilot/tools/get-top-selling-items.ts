import { ToolHandler } from "../types.ts";
import { ensureObjectArray, numericOrNull, ok } from "./common.ts";
import {
  DEFAULT_TOP_SELLING_DAYS,
  DEFAULT_TOP_SELLING_LIMIT,
  MAX_ANALYTICS_DAYS,
  MAX_TOP_SELLING_LIMIT,
  getEmbeddedObject,
  getLatestReasonableBusinessDate,
  optionalBoundedIntegerArg,
  requireAnalyticsArgs,
  shiftDateString,
} from "./analytics-common.ts";

const TOOL_NAME = "get_top_selling_items";

export const getTopSellingItemsTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Get the top-selling menu items over a recent window using sales_line_items, which stores daily aggregated menu item sales.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days: {
          type: "integer",
          description: `Number of recent business days to analyze, between 1 and ${MAX_ANALYTICS_DAYS}. Defaults to ${DEFAULT_TOP_SELLING_DAYS}.`,
        },
        limit: {
          type: "integer",
          description: `Maximum number of items to return, between 1 and ${MAX_TOP_SELLING_LIMIT}. Defaults to ${DEFAULT_TOP_SELLING_LIMIT}.`,
        },
      },
      required: [],
    },
  },

  async execute(args, context) {
    const objectArgs = requireAnalyticsArgs(args);
    const days = optionalBoundedIntegerArg(objectArgs, "days", {
      label: "days",
      min: 1,
      max: MAX_ANALYTICS_DAYS,
      defaultValue: DEFAULT_TOP_SELLING_DAYS,
    });
    const limit = optionalBoundedIntegerArg(objectArgs, "limit", {
      label: "limit",
      min: 1,
      max: MAX_TOP_SELLING_LIMIT,
      defaultValue: DEFAULT_TOP_SELLING_LIMIT,
    });

    const endDate = await getLatestReasonableBusinessDate(context, "sales_line_items");
    if (!endDate) {
      return ok(TOOL_NAME, {
        status: "no_data",
        source: "sales_line_items",
        data_grain: "daily_item_aggregate",
        window: {
          start_date: null,
          end_date: null,
          days_requested: days,
        },
        count: 0,
        items: [],
      });
    }

    const startDate = shiftDateString(endDate, -(days - 1));
    const raw = await context.supabase.select("sales_line_items", {
      select: "business_date,menu_item_id,qty,net_sales,menu_items(name,category)",
      filters: {
        business_date: [`gte.${startDate}`, `lte.${endDate}`],
      },
      order: "business_date.asc",
    });

    const rows = ensureObjectArray(raw);
    const itemMap = new Map<string, {
      menu_item_id: string;
      item_name: string | null;
      category: string | null;
      qty_sold: number;
      revenue: number;
      business_dates: Set<string>;
    }>();

    for (const row of rows) {
      const menuItemId = typeof row.menu_item_id === "string" ? row.menu_item_id : null;
      if (!menuItemId) {
        continue;
      }

      const embeddedItem = getEmbeddedObject(row, "menu_items");
      const current = itemMap.get(menuItemId) || {
        menu_item_id: menuItemId,
        item_name: embeddedItem && typeof embeddedItem.name === "string" ? embeddedItem.name : null,
        category: embeddedItem && typeof embeddedItem.category === "string" ? embeddedItem.category : null,
        qty_sold: 0,
        revenue: 0,
        business_dates: new Set<string>(),
      };

      current.qty_sold += numericOrNull(row.qty) || 0;
      current.revenue += numericOrNull(row.net_sales) || 0;
      if (typeof row.business_date === "string") {
        current.business_dates.add(row.business_date);
      }

      itemMap.set(menuItemId, current);
    }

    const items = Array.from(itemMap.values())
      .sort((left, right) => {
        if (right.qty_sold !== left.qty_sold) {
          return right.qty_sold - left.qty_sold;
        }
        return right.revenue - left.revenue;
      })
      .slice(0, limit)
      .map((item, index) => ({
        rank: index + 1,
        menu_item_id: item.menu_item_id,
        item_name: item.item_name,
        category: item.category,
        qty_sold: Number(item.qty_sold.toFixed(2)),
        revenue: Number(item.revenue.toFixed(2)),
        active_days: item.business_dates.size,
      }));

    return ok(TOOL_NAME, {
      status: items.length > 0 ? "success" : "no_data",
      source: "sales_line_items",
      data_grain: "daily_item_aggregate",
      window: {
        start_date: startDate,
        end_date: endDate,
        days_requested: days,
      },
      count: items.length,
      limit,
      items,
    });
  },
};
