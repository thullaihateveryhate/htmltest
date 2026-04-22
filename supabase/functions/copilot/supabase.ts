import { AppError, AuthContext, OpenAIRuntimeEnv, SupabaseGateway, SupabaseQueryOptions } from "./types.ts";

type PostgrestErrorPayload = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

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

export function createSupabaseGateway(
  env: OpenAIRuntimeEnv,
  auth: AuthContext,
): SupabaseGateway {
  return {
    authMode: auth.hasAuth ? "user" : "anonymous",

    async rpc<T extends import("./types.ts").JsonValue = import("./types.ts").JsonValue>(
      functionName: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
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
        throw mapSupabaseError(response, parsed as PostgrestErrorPayload | null, auth);
      }

      return (parsed ?? null) as T;
    },

    async select<T extends import("./types.ts").JsonValue = import("./types.ts").JsonValue>(
      tableName: string,
      options: SupabaseQueryOptions,
    ): Promise<T> {
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
        throw mapSupabaseError(response, parsed as PostgrestErrorPayload | null, auth);
      }

      return (parsed ?? []) as T;
    },
  };
}
