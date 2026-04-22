import { ToolHandler } from "../types.ts";
import { ok } from "./common.ts";
import {
  DEFAULT_REVENUE_TREND_DAYS,
  MAX_ANALYTICS_DAYS,
  RevenueTrendRow,
  loadRevenueTrendDataset,
  optionalBoundedIntegerArg,
  requireAnalyticsArgs,
} from "./analytics-common.ts";

const TOOL_NAME = "get_revenue_trend";

function summarizeTrend(rows: RevenueTrendRow[]) {
  if (rows.length === 0) {
    return {
      direction: "flat",
      first_day_revenue: null,
      last_day_revenue: null,
      revenue_change: null,
      revenue_change_percent: null,
      average_daily_revenue: null,
      total_revenue: 0,
      total_orders: 0,
    };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
  const revenueChange = last.revenue - first.revenue;
  const revenueChangePercent = first.revenue > 0
    ? Number(((revenueChange / first.revenue) * 100).toFixed(2))
    : null;

  let direction: "up" | "down" | "flat" = "flat";
  if (Math.abs(revenueChange) >= 0.01) {
    direction = revenueChange > 0 ? "up" : "down";
  }

  return {
    direction,
    first_day_revenue: Number(first.revenue.toFixed(2)),
    last_day_revenue: Number(last.revenue.toFixed(2)),
    revenue_change: Number(revenueChange.toFixed(2)),
    revenue_change_percent: revenueChangePercent,
    average_daily_revenue: Number((totalRevenue / rows.length).toFixed(2)),
    total_revenue: Number(totalRevenue.toFixed(2)),
    total_orders: totalOrders,
  };
}

export const getRevenueTrendTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Get a recent daily revenue trend grounded in non-voided daily_orders data. Use this for recent revenue direction, average order value, and order volume trends.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days: {
          type: "integer",
          description: `Number of days to analyze, between 1 and ${MAX_ANALYTICS_DAYS}. Defaults to ${DEFAULT_REVENUE_TREND_DAYS}.`,
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
      defaultValue: DEFAULT_REVENUE_TREND_DAYS,
    });

    const dataset = await loadRevenueTrendDataset(context, days);
    const summary = summarizeTrend(dataset.rows);

    return ok(TOOL_NAME, {
      status: dataset.status,
      source: "daily_orders",
      method: "direct_daily_orders_aggregation",
      window: {
        start_date: dataset.start_date,
        end_date: dataset.end_date,
        days_requested: dataset.days_requested,
      },
      count: dataset.rows.length,
      summary,
      rows: dataset.rows,
    });
  },
};
