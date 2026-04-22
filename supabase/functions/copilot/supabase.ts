import { AppError, AuthContext, OpenAIRuntimeEnv, SupabaseGateway, SupabaseQueryOptions } from "./types.ts";
import { buildRequestId, persistMonitoringEvent } from "../_shared/monitoring.ts";

type PostgrestErrorPayload = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type SelectTableRule = {
  filterKeys: Set<string>;
  orderKeys: Set<string>;
  maxLimit: number;
};

const ALLOWED_RPC_FUNCTIONS = new Set([
  "count_inventory",
  "get_bom_for_item",
  "get_daily_analytics",
  "get_forecast",
  "get_inventory_snapshot",
  "receive_inventory",
]);

const SELECT_TABLE_RULES: Record<string, SelectTableRule> = {
  daily_orders: {
    filterKeys: new Set(["business_date", "voided"]),
    orderKeys: new Set(["business_date"]),
    maxLimit: 1000,
  },
  ingredients: {
    filterKeys: new Set(["id", "name"]),
    orderKeys: new Set(["name"]),
    maxLimit: 20,
  },
  menu_items: {
    filterKeys: new Set(["name"]),
    orderKeys: new Set(["name"]),
    maxLimit: 20,
  },
  sales_line_items: {
    filterKeys: new Set(["business_date"]),
    orderKeys: new Set(["business_date"]),
    maxLimit: 1000,
  },
};

const ORDER_CLAUSE_RE = /^([a-z_][a-z0-9_]*)(\.(asc|desc))?(\.nulls(first|last))?$/i;

function buildHeaders(env: OpenAIRuntimeEnv, auth: AuthContext, withJsonBody = false): Headers {
  const headers = new Headers({
    "apikey": env.supabaseAnonKey,
    "Authorization": `Bearer ${auth.bearerToken || env.supabaseAnonKey}`,
    "Accept": "application/json",
  });

  if (withJsonBody) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

function mapSupabaseError(
  response: Response,
  payload: PostgrestErrorPayload | null,
  auth: AuthContext,
): AppError {
  if (response.status === 401 || response.status === 403) {
    if (!auth.hasAuth) {
      return new AppError(
        "auth_required",
        "Sign in to access live Stockd data through Copilot.",
        403,
      );
    }

    return new AppError(
      "data_access_denied",
      "Your current session cannot access this Stockd data.",
      403,
    );
  }

  if (response.status === 404) {
    return new AppError(
      "supabase_not_found",
      "The requested data endpoint was not found.",
      502,
      false,
    );
  }

  const upstreamMessage = payload?.message?.trim();
  if (upstreamMessage) {
    return new AppError("supabase_error", upstreamMessage, 502);
  }

  return new AppError(
    "supabase_error",
    "Stockd data could not be loaded.",
    502,
    false,
  );
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildSelectUrl(env: OpenAIRuntimeEnv, tableName: string, options: SupabaseQueryOptions): string {
  const url = new URL(`${env.supabaseUrl}/rest/v1/${tableName}`);
  url.searchParams.set("select", options.select);

  if (options.order) {
    url.searchParams.set("order", options.order);
  }

  if (typeof options.limit === "number") {
    url.searchParams.set("limit", String(options.limit));
  }

  if (options.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          url.searchParams.append(key, entry);
        });
        return;
      }

      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

function requireAllowedRpc(functionName: string): void {
  if (!ALLOWED_RPC_FUNCTIONS.has(functionName)) {
    throw new AppError(
      "invalid_supabase_target",
      "The requested RPC is not permitted.",
      400,
    );
  }
}

function getSelectRule(tableName: string): SelectTableRule {
  const rule = SELECT_TABLE_RULES[tableName];
  if (!rule) {
    throw new AppError(
      "invalid_supabase_target",
      "The requested table is not permitted.",
      400,
    );
  }

  return rule;
}

function validateOrderClause(tableName: string, rule: SelectTableRule, order: string): void {
  const match = ORDER_CLAUSE_RE.exec(order.trim());
  if (!match || !rule.orderKeys.has(match[1])) {
    throw new AppError(
      "invalid_supabase_order",
      `Unsupported sort field requested for ${tableName}.`,
      400,
    );
  }
}

function validateFilters(tableName: string, rule: SelectTableRule, filters: Record<string, string | string[]>): void {
  Object.keys(filters).forEach((key) => {
    if (!rule.filterKeys.has(key)) {
      throw new AppError(
        "invalid_supabase_filter",
        `Unsupported filter requested for ${tableName}.`,
        400,
      );
    }
  });
}

export function createSupabaseGateway(
  env: OpenAIRuntimeEnv,
  auth: AuthContext,
): SupabaseGateway {
  const gatewayRequestId = buildRequestId("copilot");

  async function logCopilotMonitoringEvent(
    eventType: string,
    severity: "info" | "warning" | "error" | "critical",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await persistMonitoringEvent({
      supabaseUrl: env.supabaseUrl,
      supabaseServiceRoleKey: env.supabaseServiceRoleKey || null,
    }, {
      eventType,
      severity,
      source: "copilot_edge",
      route: "/functions/v1/copilot",
      flow: "copilot_data_access",
      requestId: gatewayRequestId,
      actorUserId: auth.userId,
      metadata: {
        auth_state: auth.authState,
        ...metadata,
      },
    });
  }

  return {
    authMode: auth.hasAuth ? "user" : "anonymous",

    async rpc<T extends import("./types.ts").JsonValue = import("./types.ts").JsonValue>(
      functionName: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      try {
        requireAllowedRpc(functionName);
      } catch (error) {
        if (error instanceof AppError) {
          await logCopilotMonitoringEvent("copilot_security_rejection", "warning", {
            target_type: "rpc",
            target: functionName,
            reason: error.code,
          });
        }
        throw error;
      }

      const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: buildHeaders(env, auth, true),
        body: JSON.stringify(args),
      });

      const parsed = await parseResponse(response);

      if (!response.ok) {
        console.error("[copilot] supabase rpc failed", {
          functionName,
          status: response.status,
          authState: auth.authState,
          payload: parsed,
        });
        const mappedError = mapSupabaseError(response, parsed as PostgrestErrorPayload | null, auth);
        if (mappedError.code === "auth_required" || mappedError.code === "data_access_denied") {
          await logCopilotMonitoringEvent("copilot_data_access_denied", "warning", {
            target_type: "rpc",
            target: functionName,
            status: response.status,
            reason: mappedError.code,
          });
        }
        throw mappedError;
      }

      return (parsed ?? null) as T;
    },

    async select<T extends import("./types.ts").JsonValue = import("./types.ts").JsonValue>(
      tableName: string,
      options: SupabaseQueryOptions,
    ): Promise<T> {
      let rule: SelectTableRule;
      try {
        rule = getSelectRule(tableName);

        if (options.order) {
          validateOrderClause(tableName, rule, options.order);
        }

        if (options.filters) {
          validateFilters(tableName, rule, options.filters);
        }

        if (typeof options.limit === "number") {
          if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > rule.maxLimit) {
            throw new AppError(
              "invalid_supabase_limit",
              `limit must be a whole number between 1 and ${rule.maxLimit} for ${tableName}.`,
              400,
            );
          }
        }
      } catch (error) {
        if (error instanceof AppError) {
          await logCopilotMonitoringEvent("copilot_security_rejection", "warning", {
            target_type: "select",
            target: tableName,
            reason: error.code,
            requested_order: options.order || null,
            requested_filter_keys: options.filters ? Object.keys(options.filters) : [],
            requested_limit: typeof options.limit === "number" ? options.limit : null,
          });
        }
        throw error;
      }

      const response = await fetch(buildSelectUrl(env, tableName, options), {
        method: "GET",
        headers: buildHeaders(env, auth),
      });

      const parsed = await parseResponse(response);

      if (!response.ok) {
        console.error("[copilot] supabase select failed", {
          tableName,
          status: response.status,
          authState: auth.authState,
          payload: parsed,
        });
        const mappedError = mapSupabaseError(response, parsed as PostgrestErrorPayload | null, auth);
        if (mappedError.code === "auth_required" || mappedError.code === "data_access_denied") {
          await logCopilotMonitoringEvent("copilot_data_access_denied", "warning", {
            target_type: "select",
            target: tableName,
            status: response.status,
            reason: mappedError.code,
          });
        }
        throw mappedError;
      }

      return (parsed ?? []) as T;
    },
  };
}
