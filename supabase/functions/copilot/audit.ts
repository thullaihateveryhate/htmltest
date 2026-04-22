import { AuthContext } from "./types.ts";

type AuditDetails = Record<string, unknown>;

function noncePrefix(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.slice(0, 8);
}

export function logWriteAudit(
  event: string,
  auth: AuthContext,
  details: AuditDetails = {},
): void {
  const payload: AuditDetails = {
    event,
    at: new Date().toISOString(),
    auth_state: auth.authState,
    user_id: auth.userId ?? null,
    ...details,
  };

  if ("nonce" in payload) {
    payload.nonce_prefix = noncePrefix(payload.nonce);
    delete payload.nonce;
  }

  console.info("[copilot][audit]", payload);
}
