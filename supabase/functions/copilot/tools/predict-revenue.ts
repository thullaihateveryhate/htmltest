import { ToolHandler } from "../types.ts";
import { ok } from "./common.ts";
import {
  DEFAULT_PREDICTION_FORECAST_DAYS,
  DEFAULT_PREDICTION_LOOKBACK_DAYS,
  MAX_ANALYTICS_DAYS,
  MAX_PREDICTION_DAYS,
  RevenueTrendRow,
  loadRevenueTrendDataset,
  optionalBoundedIntegerArg,
  requireAnalyticsArgs,
} from "./analytics-common.ts";

const TOOL_NAME = "predict_revenue";

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeLinearTrend(values: number[]): { slope: number; intercept: number } | null {
  if (values.length < 3) {
    return null;
  }

  const xs = values.map((_, index) => index);
  const meanX = average(xs);
  const meanY = average(values);

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const xDelta = xs[index] - meanX;
    numerator += xDelta * (values[index] - meanY);
    denominator += xDelta * xDelta;
  }

  if (denominator === 0) {
    return null;
  }

  const slope = numerator / denominator;
  const intercept = meanY - (slope * meanX);
  return { slope, intercept };
}

function buildPrediction(rows: RevenueTrendRow[], forecastDays: number) {
  if (rows.length === 0) {
    return {
      status: "no_data" as const,
      method: "none",
      data_points: 0,
      predicted_daily_revenue: null,
      predicted_window_revenue: null,
      average_daily_revenue: null,
      last_observed_daily_revenue: null,
      trend_per_day: null,
      notes: [
        "No usable non-voided daily_orders revenue data was available for prediction.",
      ],
    };
  }

  const revenues = rows.map((row) => row.revenue);
  const averageDailyRevenue = average(revenues);
  const lastObserved = revenues[revenues.length - 1] ?? null;
  const trend = computeLinearTrend(revenues);

  const method = trend ? "simple_linear_trend" : "average_only";
  const predictedDailyRevenue = trend
    ? Math.max(0, trend.intercept + (trend.slope * ((revenues.length - 1) + forecastDays)))
    : Math.max(0, averageDailyRevenue);
  const predictedWindowRevenue = predictedDailyRevenue * forecastDays;

  const notes = [
    "This is a lightweight directional estimate based on historical daily_orders subtotal revenue, not a trained ML forecast.",
    trend
      ? "The estimate uses a simple linear trend over recent daily revenue."
      : "The estimate uses a recent average because there were too few daily points for a stable trend line.",
  ];

  return {
    status: "success" as const,
    method,
    data_points: rows.length,
    predicted_daily_revenue: Number(predictedDailyRevenue.toFixed(2)),
    predicted_window_revenue: Number(predictedWindowRevenue.toFixed(2)),
    average_daily_revenue: Number(averageDailyRevenue.toFixed(2)),
    last_observed_daily_revenue: lastObserved === null ? null : Number(lastObserved.toFixed(2)),
    trend_per_day: trend ? Number(trend.slope.toFixed(2)) : null,
    notes,
  };
}

export const predictRevenueTool: ToolHandler = {
  name: TOOL_NAME,
  definition: {
    type: "function",
    name: TOOL_NAME,
    description:
      "Estimate near-term revenue using recent daily_orders revenue history. This is a simple directional forecast, not a trained machine learning model.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        lookback_days: {
          type: "integer",
          description: `Recent business days to inspect, between 1 and ${MAX_ANALYTICS_DAYS}. Defaults to ${DEFAULT_PREDICTION_LOOKBACK_DAYS}.`,
        },
        forecast_days: {
          type: "integer",
          description: `Number of days ahead to estimate, between 1 and ${MAX_PREDICTION_DAYS}. Defaults to ${DEFAULT_PREDICTION_FORECAST_DAYS}.`,
        },
      },
      required: [],
    },
  },

  async execute(args, context) {
    const objectArgs = requireAnalyticsArgs(args);
    const lookbackDays = optionalBoundedIntegerArg(objectArgs, "lookback_days", {
      label: "lookback_days",
      min: 1,
      max: MAX_ANALYTICS_DAYS,
      defaultValue: DEFAULT_PREDICTION_LOOKBACK_DAYS,
    });
    const forecastDays = optionalBoundedIntegerArg(objectArgs, "forecast_days", {
      label: "forecast_days",
      min: 1,
      max: MAX_PREDICTION_DAYS,
      defaultValue: DEFAULT_PREDICTION_FORECAST_DAYS,
    });

    const dataset = await loadRevenueTrendDataset(context, lookbackDays);
    const prediction = buildPrediction(dataset.rows, forecastDays);

    return ok(TOOL_NAME, {
      status: prediction.status,
      source: "daily_orders",
      window: {
        start_date: dataset.start_date,
        end_date: dataset.end_date,
        lookback_days: lookbackDays,
        forecast_days: forecastDays,
      },
      method: prediction.method,
      prediction,
      rows: dataset.rows,
    });
  },
};
