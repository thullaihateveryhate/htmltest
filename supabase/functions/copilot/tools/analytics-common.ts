import { AppError, JsonObject, ToolContext, isPlainObject } from "../types.ts";
import { ensureObjectArray, expectObjectArgs, numericOrNull, requireNumberArg } from "./common.ts";

export interface RevenueTrendRow extends JsonObject {
  business_date: string;
  orders: number;
  revenue: number;
  avg_order_value: number | null;
  guests: number;
  tips: number;
  discounts: number;
}

export interface RevenueTrendDataset extends JsonObject {
  status: "success" | "no_data";
  start_date: string | null;
  end_date: string | null;
  days_requested: number;
  rows: RevenueTrendRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_REVENUE_TREND_DAYS = 30;
export const DEFAULT_TOP_SELLING_DAYS = 30;
export const DEFAULT_TOP_SELLING_LIMIT = 5;
export const DEFAULT_PREDICTION_LOOKBACK_DAYS = 14;
export const DEFAULT_PREDICTION_FORECAST_DAYS = 1;
export const MAX_ANALYTICS_DAYS = 90;
export const MAX_TOP_SELLING_LIMIT = 20;
export const MAX_PREDICTION_DAYS = 7;
const MAX_REASONABLE_FUTURE_DAYS = 30;

export function requireAnalyticsArgs(args: unknown): Record<string, unknown> {
  return expectObjectArgs(args);
}

export function optionalBoundedIntegerArg(
  args: Record<string, unknown>,
  key: string,
  options: {
    label?: string;
    min: number;
    max: number;
    defaultValue: number;
  },
): number {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return options.defaultValue;
  }

  const parsed = requireNumberArg(args, key, {
    label: options.label || key,
    min: options.min,
    max: options.max,
    allowZero: false,
  });

  if (!Number.isInteger(parsed)) {
    throw new AppError("invalid_tool_args", `${options.label || key} must be a whole number.`, 400);
  }

  return parsed;
}

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) {
    return null;
  }

  const trimmed = value.trim();
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    return null;
  }

  return date;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function shiftDateString(dateString: string, days: number): string {
  const parsed = parseDateOnly(dateString);
  if (!parsed) {
    throw new AppError("invalid_tool_state", "A valid business date was required to build the analytics window.", 500, false);
  }

  return toDateString(addDays(parsed, days));
}

function maxReasonableBusinessDate(): string {
  return toDateString(addDays(new Date(), MAX_REASONABLE_FUTURE_DAYS));
}

function normalizeEmbeddedRow(value: unknown): Record<string, unknown> | null {
  if (isPlainObject(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const firstObject = value.find((item) => isPlainObject(item));
    return firstObject || null;
  }

  return null;
}

export function getEmbeddedObject(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return normalizeEmbeddedRow(row[key]);
}

export async function getLatestReasonableBusinessDate(
  context: ToolContext,
  tableName: string,
  extraFilters: Record<string, string | string[]> = {},
): Promise<string | null> {
  const raw = await context.supabase.select(tableName, {
    select: "business_date",
    filters: {
      ...extraFilters,
      business_date: `lte.${maxReasonableBusinessDate()}`,
    },
    order: "business_date.desc",
    limit: 1,
  });

  const rows = ensureObjectArray(raw);
  const date = rows[0]?.business_date;

  return parseDateOnly(date) ? (date as string) : null;
}

export async function loadRevenueTrendDataset(
  context: ToolContext,
  days: number,
): Promise<RevenueTrendDataset> {
  const endDate = await getLatestReasonableBusinessDate(context, "daily_orders", {
    voided: "eq.false",
  });

  if (!endDate) {
    return {
      status: "no_data",
      start_date: null,
      end_date: null,
      days_requested: days,
      rows: [],
    };
  }

  const startDate = shiftDateString(endDate, -(days - 1));
  const raw = await context.supabase.select("daily_orders", {
    select: "business_date,subtotal,tip,discount_amount,num_guests",
    filters: {
      business_date: [`gte.${startDate}`, `lte.${endDate}`],
      voided: "eq.false",
    },
    order: "business_date.asc",
  });

  const rows = ensureObjectArray(raw);
  const byDate = new Map<string, {
    business_date: string;
    orders: number;
    revenue: number;
    guests: number;
    tips: number;
    discounts: number;
  }>();

  for (const row of rows) {
    const businessDate = typeof row.business_date === "string" && parseDateOnly(row.business_date)
      ? row.business_date
      : null;
    if (!businessDate) {
      continue;
    }

    const current = byDate.get(businessDate) || {
      business_date: businessDate,
      orders: 0,
      revenue: 0,
      guests: 0,
      tips: 0,
      discounts: 0,
    };

    current.orders += 1;
    current.revenue += numericOrNull(row.subtotal) || 0;
    current.guests += numericOrNull(row.num_guests) || 0;
    current.tips += numericOrNull(row.tip) || 0;
    current.discounts += numericOrNull(row.discount_amount) || 0;

    byDate.set(businessDate, current);
  }

  const trendRows: RevenueTrendRow[] = Array.from(byDate.values())
    .sort((left, right) => left.business_date.localeCompare(right.business_date))
    .map((row) => ({
      business_date: row.business_date,
      orders: row.orders,
      revenue: Number(row.revenue.toFixed(2)),
      avg_order_value: row.orders > 0 ? Number((row.revenue / row.orders).toFixed(2)) : null,
      guests: row.guests,
      tips: Number(row.tips.toFixed(2)),
      discounts: Number(row.discounts.toFixed(2)),
    }));

  return {
    status: trendRows.length > 0 ? "success" : "no_data",
    start_date: startDate,
    end_date: endDate,
    days_requested: days,
    rows: trendRows,
  };
}
