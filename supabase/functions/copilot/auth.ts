import { AuthContext } from "./types.ts";

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
    const decoded = atob(normalized);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function extractAuthContext(request: Request): AuthContext {
  const header = request.headers.get("Authorization") ?? request.headers.get("authorization");

  if (!header) {
    return {
      bearerToken: null,
      hasAuth: false,
      authState: "anonymous",
      userId: null,
      claims: null,
    };
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      bearerToken: null,
      hasAuth: false,
      authState: "invalid_header",
      userId: null,
      claims: null,
    };
  }

  const bearerToken = match[1].trim();
  const claims = decodeJwtPayload(bearerToken);
  const sub = typeof claims?.sub === "string" ? claims.sub : null;

  return {
    bearerToken,
    hasAuth: true,
    authState: "token_present",
    userId: sub,
    claims,
  };
}
