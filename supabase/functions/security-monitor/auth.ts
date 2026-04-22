import { MonitoringAuthContext } from "./types.ts";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

export function extractAuthContext(request: Request): MonitoringAuthContext {
  const header = request.headers.get("Authorization") ?? request.headers.get("authorization");
  if (!header) {
    return {
      bearerToken: null,
      hasAuth: false,
      authState: "anonymous",
      userId: null,
    };
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      bearerToken: null,
      hasAuth: false,
      authState: "invalid_header",
      userId: null,
    };
  }

  const bearerToken = match[1].trim();
  const claims = decodeJwtPayload(bearerToken);
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  return {
    bearerToken,
    hasAuth: Boolean(userId),
    authState: userId ? "token_present" : "invalid_header",
    userId,
  };
}
