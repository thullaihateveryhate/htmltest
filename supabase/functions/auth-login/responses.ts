import { buildCorsHeaders } from "./cors.ts";
import { AuthLoginError, HandlerResponseBody } from "./types.ts";

export function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}

export function jsonResponse(body: HandlerResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders({
      "Content-Type": "application/json",
    }),
  });
}

export function errorResponse(error: AuthLoginError): Response {
  return jsonResponse({
    ok: false,
    code: error.code,
    message: error.expose ? error.message : "Protected sign-in is unavailable right now.",
  }, error.status);
}
