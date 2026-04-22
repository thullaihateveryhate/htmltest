import { buildCorsHeaders } from "./cors.ts";
import { MonitoringError } from "./types.ts";

export function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders({
      "Content-Type": "application/json",
    }),
  });
}

export function errorResponse(error: MonitoringError): Response {
  return jsonResponse({
    ok: false,
    code: error.code,
    message: error.expose ? error.message : "Monitoring event could not be recorded.",
  }, error.status);
}
