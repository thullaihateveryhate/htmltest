import {
  AppError,
  AuthContext,
  OpenAIRuntimeEnv,
  PendingActionData,
  PendingActionInput,
  PendingActionProposal,
} from "./types.ts";
import { logWriteAudit } from "./audit.ts";

const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{32,}$/;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): ArrayBuffer {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function canonicalize(payload: Record<string, unknown>): string {
  return JSON.stringify(stableValue(payload));
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signActionPayload(secret: string, payload: Record<string, unknown>): Promise<string> {
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalize(payload)),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function verifyActionSignature(
  secret: string,
  payload: Record<string, unknown>,
  signature: string,
): Promise<boolean> {
  const key = await importSigningKey(secret);

  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      new TextEncoder().encode(canonicalize(payload)),
    );
  } catch {
    return false;
  }
}

function buildActorBinding(auth: AuthContext): string {
  if (auth.userId) {
    return `user:${auth.userId}`;
  }

  if (auth.bearerToken) {
    return `token:${auth.bearerToken}`;
  }

  return "anonymous";
}

function buildSignaturePayload(
  pendingAction: {
    tool_name: string;
    arguments: Record<string, unknown>;
    summary: string;
    issued_at: string;
    expires_at: string;
    nonce: string;
  },
  auth: AuthContext,
): Record<string, unknown> {
  return {
    tool_name: pendingAction.tool_name,
    arguments: pendingAction.arguments,
    summary: pendingAction.summary,
    issued_at: pendingAction.issued_at,
    expires_at: pendingAction.expires_at,
    nonce: pendingAction.nonce,
    actor: buildActorBinding(auth),
  };
}

function requireActionSecret(env: OpenAIRuntimeEnv, auth: AuthContext, event: string, details: Record<string, unknown>): string {
  if (env.actionSecret && env.actionSecret.trim()) {
    return env.actionSecret;
  }

  logWriteAudit(event, auth, {
    ...details,
    code: "missing_action_secret",
  });

  throw new AppError(
    "missing_action_secret",
    "Copilot inventory confirmations are not configured on the server right now.",
    503,
    true,
  );
}

export async function createPendingAction(
  proposal: PendingActionProposal,
  env: OpenAIRuntimeEnv,
  auth: AuthContext,
): Promise<PendingActionData> {
  if (!auth.hasAuth) {
    throw new AppError(
      "auth_required",
      "Sign in before preparing inventory changes through Copilot.",
      403,
    );
  }

  const secret = requireActionSecret(env, auth, "pending_action_issue_rejected", {
    tool_name: proposal.tool_name,
  });

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + PENDING_ACTION_TTL_MS);

  const basePayload = {
    tool_name: proposal.tool_name,
    arguments: proposal.arguments,
    summary: proposal.summary,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    nonce: crypto.randomUUID(),
  };

  const signature = await signActionPayload(
    secret,
    buildSignaturePayload(basePayload, auth),
  );

  const pendingAction = {
    ...basePayload,
    signature,
  };

  logWriteAudit("pending_action_issued", auth, {
    tool_name: proposal.tool_name,
    issued_at: pendingAction.issued_at,
    expires_at: pendingAction.expires_at,
    nonce: pendingAction.nonce,
  });

  return pendingAction;
}

export async function verifyPendingAction(
  pendingAction: PendingActionInput,
  env: OpenAIRuntimeEnv,
  auth: AuthContext,
): Promise<PendingActionData> {
  if (!auth.hasAuth) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "auth_required",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "auth_required",
      "Sign in before confirming inventory changes through Copilot.",
      403,
    );
  }

  const secret = requireActionSecret(env, auth, "pending_action_confirmation_rejected", {
    tool_name: pendingAction.tool_name,
    nonce: pendingAction.nonce,
  });

  if (
    !pendingAction.summary ||
    !pendingAction.issued_at ||
    !pendingAction.expires_at ||
    !pendingAction.nonce ||
    !pendingAction.signature
  ) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action",
      reason: "missing_metadata",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action",
      "pending_action is missing confirmation metadata.",
      400,
    );
  }

  if (!SIGNATURE_RE.test(pendingAction.signature)) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action_signature",
      reason: "malformed_signature",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action_signature",
      "pending_action signature is malformed.",
      400,
    );
  }

  const issuedAt = new Date(pendingAction.issued_at);
  const expiresAt = new Date(pendingAction.expires_at);

  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action_timestamps",
      reason: "unparseable_timestamps",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action_timestamps",
      "pending_action timestamps are invalid.",
      400,
    );
  }

  if (expiresAt.getTime() <= issuedAt.getTime()) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action_timestamps",
      reason: "expiry_not_after_issue",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action_timestamps",
      "pending_action expiry is invalid.",
      400,
    );
  }

  if (issuedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action_timestamps",
      reason: "issued_in_future",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action_timestamps",
      "pending_action timing is invalid.",
      400,
    );
  }

  if (expiresAt.getTime() - issuedAt.getTime() > PENDING_ACTION_TTL_MS + MAX_CLOCK_SKEW_MS) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action_timestamps",
      reason: "ttl_exceeded",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action_timestamps",
      "pending_action expiry exceeds the allowed confirmation window.",
      400,
    );
  }

  if (expiresAt.getTime() <= Date.now()) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "pending_action_expired",
      nonce: pendingAction.nonce,
      issued_at: pendingAction.issued_at,
      expires_at: pendingAction.expires_at,
    });
    throw new AppError(
      "pending_action_expired",
      "This confirmation request has expired. Please ask Copilot again.",
      409,
    );
  }

  const payload = {
    tool_name: pendingAction.tool_name,
    arguments: pendingAction.arguments,
    summary: pendingAction.summary,
    issued_at: pendingAction.issued_at,
    expires_at: pendingAction.expires_at,
    nonce: pendingAction.nonce,
  };

  const isValid = await verifyActionSignature(
    secret,
    buildSignaturePayload(payload, auth),
    pendingAction.signature,
  );

  if (!isValid) {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "invalid_pending_action_signature",
      reason: "signature_mismatch",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "invalid_pending_action_signature",
      "pending_action could not be verified.",
      400,
    );
  }

  logWriteAudit("pending_action_confirmed", auth, {
    tool_name: pendingAction.tool_name,
    issued_at: pendingAction.issued_at,
    expires_at: pendingAction.expires_at,
    confirmed_at: new Date().toISOString(),
    nonce: pendingAction.nonce,
  });

  return {
    ...payload,
    signature: pendingAction.signature,
  };
}
