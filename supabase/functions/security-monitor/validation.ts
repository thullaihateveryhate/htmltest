import { ClientMonitoringEventType, MonitoringClientSource, MonitoringError, ValidatedMonitoringRequest } from "./types.ts";

const VALID_EVENT_TYPES = new Map<ClientMonitoringEventType, { source: MonitoringClientSource; severity: "info" | "warning" }>([
  ["csv_upload_attempted", { source: "frontend", severity: "info" }],
  ["csv_upload_completed", { source: "frontend", severity: "info" }],
  ["csv_validation_failure", { source: "frontend", severity: "warning" }],
  ["inventory_receive_action", { source: "frontend", severity: "info" }],
  ["inventory_receive_rejected", { source: "frontend", severity: "warning" }],
  ["inventory_count_submission", { source: "frontend", severity: "info" }],
  ["inventory_count_rejected", { source: "frontend", severity: "warning" }],
  ["suspicious_input_detected", { source: "frontend", severity: "warning" }],
]);

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE_RE = /\s+/g;

function normalizeText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new MonitoringError("invalid_request", "Expected a string field.", 400);
  }

  let normalized = typeof value.normalize === "function" ? value.normalize("NFKC") : value;
  normalized = normalized
    .replace(CONTROL_CHARS_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength).trim()
    : normalized;
}

function requireObjectBody(value: unknown): Record<string, unknown> {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new MonitoringError("invalid_request", "Request body must be a JSON object.", 400);
  }

  return value as Record<string, unknown>;
}

function validateMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (Object.prototype.toString.call(value) !== "[object Object]") {
    throw new MonitoringError("invalid_request", "metadata must be an object when provided.", 400);
  }

  return value as Record<string, unknown>;
}

export function getClientEventSeverity(eventType: ClientMonitoringEventType): "info" | "warning" {
  const rule = VALID_EVENT_TYPES.get(eventType);
  return rule?.severity ?? "info";
}

export async function parseAndValidateRequest(request: Request): Promise<ValidatedMonitoringRequest> {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    throw new MonitoringError("invalid_request", "Request body must be valid JSON.", 400);
  }

  const body = requireObjectBody(parsedBody);
  const rawEventType = normalizeText(body.event_type, 80);
  if (!rawEventType || !VALID_EVENT_TYPES.has(rawEventType as ClientMonitoringEventType)) {
    throw new MonitoringError("invalid_request", "Unsupported monitoring event type.", 400);
  }

  const eventType = rawEventType as ClientMonitoringEventType;
  const expectedSource = VALID_EVENT_TYPES.get(eventType)?.source || "frontend";
  const rawSource = normalizeText(body.source, 40);
  const source = (rawSource || expectedSource) as MonitoringClientSource;
  if (source !== expectedSource) {
    throw new MonitoringError("invalid_request", "Unsupported monitoring source.", 400);
  }

  return {
    eventType,
    source,
    route: normalizeText(body.route, 120),
    flow: normalizeText(body.flow, 80),
    requestId: normalizeText(body.request_id, 120),
    clientToken: normalizeText(body.client_token, 120),
    metadata: validateMetadata(body.metadata),
  };
}
