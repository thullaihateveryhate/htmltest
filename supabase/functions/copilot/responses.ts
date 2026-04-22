import { buildCorsHeaders } from "./cors.ts";
import {
  AppError,
  CopilotErrorResponse,
  CopilotMode,
  CopilotSuccessResponse,
  JsonValue,
} from "./types.ts";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    }),
  });
}

export function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}

export function successResponse<TData extends JsonValue | undefined = JsonValue | undefined>(
  mode: CopilotMode,
  reply: string,
  model: string,
  data?: TData,
): Response {
  const payload: CopilotSuccessResponse<TData> = {
    ok: true,
    mode,
    reply,
    meta: {
      provider: "openai",
      model,
    },
  };

  if (data !== undefined) {
    payload.data = data;
  }

  return jsonResponse(payload, 200);
}

export function errorResponse(error: AppError): Response {
  const payload: CopilotErrorResponse = {
    ok: false,
    error: {
      code: error.code,
      message: error.expose ? error.message : "Internal server error.",
    },
  };

  const extraHeaders = error.status === 405 ? { "Allow": "POST, OPTIONS" } : undefined;
  return jsonResponse(payload, error.status, extraHeaders);
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError("internal_error", "Internal server error.", 500, false);
}
