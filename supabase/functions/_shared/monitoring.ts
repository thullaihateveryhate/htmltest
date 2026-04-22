type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type MonitoringEnv = {
  supabaseUrl?: string | null;
  supabaseServiceRoleKey?: string | null;
};

export type MonitoringSeverity = "info" | "warning" | "error" | "critical";

export type MonitoringEventInput = {
  eventType: string;
  severity: MonitoringSeverity;
  source: string;
  route?: string | null;
  flow?: string | null;
  requestId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  identifier?: string | null;
  clientToken?: string | null;
  eventAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

type PersistedMonitoringEvent = {
  event_at: string;
  event_type: string;
  severity: MonitoringSeverity;
  source: string;
  route: string | null;
  flow: string | null;
  request_id: string | null;
  actor_user_id: string | null;
  ip_hash: string | null;
  identifier_hash: string | null;
  client_token_hash: string | null;
  metadata: JsonValue;
};

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE_RE = /\s+/g;
const SECRET_KEY_RE = /(pass(word)?|secret|token|authorization|cookie|session|api[-_]?key|refresh[-_]?token|access[-_]?token)/i;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 40;
const MAX_METADATA_ARRAY = 20;

function normalizeText(value: unknown, maxLength = 240): string {
  const stringValue = value === null || value === undefined ? "" : String(value);
  let normalized = typeof stringValue.normalize === "function" ? stringValue.normalize("NFKC") : stringValue;
  normalized = normalized
    .replace(CONTROL_CHARS_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();

  if (normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength).trim();
  }

  return normalized;
}

function shouldRedactKey(key: string | null | undefined): boolean {
  return typeof key === "string" && SECRET_KEY_RE.test(key);
}

function sanitizeMetadataValue(value: unknown, key: string | null = null, depth = 0): JsonValue {
  if (shouldRedactKey(key)) {
    return "[REDACTED]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return normalizeText(value, 280);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (depth >= MAX_METADATA_DEPTH) {
    return normalizeText(value, 120);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY)
      .map((entry) => sanitizeMetadataValue(entry, key, depth + 1));
  }

  if (Object.prototype.toString.call(value) === "[object Object]") {
    const out: Record<string, JsonValue> = {};
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_METADATA_KEYS)
      .forEach(([childKey, childValue]) => {
        out[normalizeText(childKey, 80)] = sanitizeMetadataValue(childValue, childKey, depth + 1);
      });
    return out;
  }

  return normalizeText(value, 120);
}

function normalizeEventTimestamp(value: string | Date | null | undefined): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function buildServiceHeaders(serviceRoleKey: string): Headers {
  return new Headers({
    "apikey": serviceRoleKey,
    "Authorization": `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashIfPresent(value: string | null | undefined): Promise<string | null> {
  const normalized = normalizeText(value, 320);
  if (!normalized) {
    return null;
  }

  return await sha256Hex(normalized);
}

export function buildRequestId(prefix = "monitor"): string {
  const safePrefix = normalizeText(prefix, 24).toLowerCase() || "monitor";
  return `${safePrefix}-${crypto.randomUUID()}`;
}

export async function buildPersistedMonitoringEvent(
  input: MonitoringEventInput,
): Promise<PersistedMonitoringEvent> {
  return {
    event_at: normalizeEventTimestamp(input.eventAt),
    event_type: normalizeText(input.eventType, 80) || "unknown_event",
    severity: input.severity,
    source: normalizeText(input.source, 64) || "unknown_source",
    route: normalizeText(input.route, 120) || null,
    flow: normalizeText(input.flow, 80) || null,
    request_id: normalizeText(input.requestId, 120) || null,
    actor_user_id: normalizeText(input.actorUserId, 120) || null,
    ip_hash: await hashIfPresent(input.ipAddress),
    identifier_hash: await hashIfPresent(input.identifier),
    client_token_hash: await hashIfPresent(input.clientToken),
    metadata: sanitizeMetadataValue(input.metadata || {}),
  };
}

export async function persistMonitoringEvent(
  env: MonitoringEnv,
  input: MonitoringEventInput,
): Promise<PersistedMonitoringEvent> {
  const row = await buildPersistedMonitoringEvent(input);

  console.info("[stockd-monitoring]", row);

  const supabaseUrl = normalizeText(env.supabaseUrl, 240);
  const serviceRoleKey = normalizeText(env.supabaseServiceRoleKey, 240);

  if (!supabaseUrl || !serviceRoleKey) {
    return row;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/monitoring_events`, {
      method: "POST",
      headers: buildServiceHeaders(serviceRoleKey),
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[stockd-monitoring] persist failed", {
        status: response.status,
        body: normalizeText(text, 400),
        event_type: row.event_type,
        request_id: row.request_id,
      });
    }
  } catch (error) {
    console.error("[stockd-monitoring] transport failed", {
      event_type: row.event_type,
      request_id: row.request_id,
      error: normalizeText(error instanceof Error ? error.message : error, 280),
    });
  }

  return row;
}
