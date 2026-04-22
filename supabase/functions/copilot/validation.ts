import {
  AppError,
  CopilotRequest,
  CopilotMode,
  PendingActionInput,
  isPlainObject,
  JsonObject,
} from "./types.ts";

const VALID_MODES = new Set<CopilotMode>(["chat", "pricing_insights"]);
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_CHARS = 20000;
const MAX_CONTEXT_DEPTH = 8;
const CONTROL_MESSAGE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const MULTISPACE_RE = /\s+/g;

function normalizeMessageText(value: string): string {
  return value.normalize("NFKC").replace(CONTROL_MESSAGE_RE, "").trim();
}

function normalizeShortText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_MESSAGE_RE, " ")
    .replace(MULTISPACE_RE, " ")
    .trim();
}

function assertJsonSafe(value: unknown, depth = 0): void {
  if (depth > MAX_CONTEXT_DEPTH) {
    throw new AppError(
      "context_too_deep",
      "context is too deeply nested.",
      400,
    );
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonSafe(item, depth + 1));
    return;
  }

  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => assertJsonSafe(item, depth + 1));
    return;
  }

  throw new AppError(
    "invalid_context",
    "context must contain only JSON-safe values.",
    400,
  );
}

function validateContext(context: unknown): JsonObject {
  if (!isPlainObject(context)) {
    throw new AppError(
      "invalid_context",
      "context must be a JSON object when provided.",
      400,
    );
  }

  assertJsonSafe(context);

  let serialized = "";
  try {
    serialized = JSON.stringify(context);
  } catch {
    throw new AppError(
      "invalid_context",
      "context could not be serialized.",
      400,
    );
  }

  if (serialized.length > MAX_CONTEXT_CHARS) {
    throw new AppError(
      "context_too_large",
      "context is too large for this endpoint.",
      400,
    );
  }

  return context as JsonObject;
}

function validateOptionalShortString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AppError("invalid_pending_action", `${fieldName} must be a string when provided.`, 400);
  }

  const trimmed = normalizeShortText(value);
  if (!trimmed) {
    throw new AppError("invalid_pending_action", `${fieldName} cannot be empty.`, 400);
  }

  if (trimmed.length > maxLength) {
    throw new AppError("invalid_pending_action", `${fieldName} is too long.`, 400);
  }

  return trimmed;
}

function validatePendingAction(value: unknown): PendingActionInput {
  if (!isPlainObject(value)) {
    throw new AppError(
      "invalid_pending_action",
      "pending_action must be a JSON object when provided.",
      400,
    );
  }

  const tool_name = validateOptionalShortString(value.tool_name, "pending_action.tool_name", 120);
  if (!tool_name) {
    throw new AppError(
      "invalid_pending_action",
      "pending_action.tool_name is required.",
      400,
    );
  }

  if (!("arguments" in value)) {
    throw new AppError(
      "invalid_pending_action",
      "pending_action.arguments is required.",
      400,
    );
  }

  return {
    tool_name,
    arguments: validateContext(value.arguments),
    summary: validateOptionalShortString(value.summary, "pending_action.summary", 240),
    issued_at: validateOptionalShortString(value.issued_at, "pending_action.issued_at", 64),
    expires_at: validateOptionalShortString(value.expires_at, "pending_action.expires_at", 64),
    nonce: validateOptionalShortString(value.nonce, "pending_action.nonce", 120),
    signature: validateOptionalShortString(value.signature, "pending_action.signature", 256),
  };
}

export async function parseAndValidateRequest(request: Request): Promise<CopilotRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("invalid_json", "Request body must be valid JSON.", 400);
  }

  if (!isPlainObject(body)) {
    throw new AppError("invalid_body", "Request body must be a JSON object.", 400);
  }

  const mode = body.mode;
  if (typeof mode !== "string" || !VALID_MODES.has(mode as CopilotMode)) {
    throw new AppError(
      "invalid_mode",
      "mode must be one of: chat, pricing_insights.",
      400,
    );
  }

  const message = body.message;
  if (typeof message !== "string") {
    throw new AppError("invalid_message", "message must be a string.", 400);
  }

  const trimmedMessage = normalizeMessageText(message);
  if (!trimmedMessage) {
    throw new AppError("empty_message", "message is required.", 400);
  }

  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(
      "message_too_long",
      `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      400,
    );
  }

  if (body.confirm !== undefined && typeof body.confirm !== "boolean") {
    throw new AppError("invalid_confirm", "confirm must be a boolean when provided.", 400);
  }

  const confirm = body.confirm === undefined ? undefined : body.confirm;
  const pending_action = body.pending_action === undefined
    ? undefined
    : validatePendingAction(body.pending_action);

  if (confirm === true && mode !== "chat") {
    throw new AppError(
      "invalid_confirm_mode",
      "confirm is only supported for chat mode.",
      400,
    );
  }

  if (confirm === true && !pending_action) {
    throw new AppError(
      "missing_pending_action",
      "pending_action is required when confirm is true.",
      400,
    );
  }

  if (confirm !== true && pending_action !== undefined) {
    throw new AppError(
      "unexpected_pending_action",
      "pending_action is only allowed when confirm is true.",
      400,
    );
  }

  return {
    mode: mode as CopilotMode,
    message: trimmedMessage,
    context: body.context === undefined ? undefined : validateContext(body.context),
    confirm,
    pending_action,
  };
}
