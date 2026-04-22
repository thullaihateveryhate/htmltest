import { AppError, JsonObject, JsonValue, ToolError, ToolExecutionResult, isPlainObject } from "../types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const MULTISPACE_RE = /\s+/g;

export function normalizeShortText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARS_RE, " ")
    .replace(MULTISPACE_RE, " ")
    .trim();
}

export function expectObjectArgs(args: unknown): Record<string, unknown> {
  if (!isPlainObject(args)) {
    throw new AppError("invalid_tool_args", "Tool arguments must be a JSON object.", 400);
  }

  return args;
}

export function expectNoExtraArgs(args: unknown): Record<string, unknown> {
  const objectArgs = expectObjectArgs(args);
  if (Object.keys(objectArgs).length > 0) {
    throw new AppError("invalid_tool_args", "This tool does not accept arguments.", 400);
  }
  return objectArgs;
}

export function requireStringArg(
  args: Record<string, unknown>,
  key: string,
  label = key,
  maxLength = 120,
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new AppError("invalid_tool_args", `${label} must be a string.`, 400);
  }

  const trimmed = normalizeShortText(value);
  if (!trimmed) {
    throw new AppError("invalid_tool_args", `${label} is required.`, 400);
  }

  if (trimmed.length > maxLength) {
    throw new AppError("invalid_tool_args", `${label} is too long.`, 400);
  }

  return trimmed;
}

export function optionalStringArg(
  args: Record<string, unknown>,
  key: string,
  label = key,
  maxLength = 240,
): string | null {
  const value = args[key];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  return requireStringArg(args, key, label, maxLength);
}

export function optionalDateArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AppError("invalid_tool_args", `${key} must be a date string in YYYY-MM-DD format.`, 400);
  }

  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) {
    throw new AppError("invalid_tool_args", `${key} must be a date string in YYYY-MM-DD format.`, 400);
  }

  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw new AppError("invalid_tool_args", `${key} must be a valid calendar date.`, 400);
  }

  return trimmed;
}

export function requireUuidArg(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = requireStringArg(args, key, key, 64);

  if (!UUID_RE.test(value)) {
    throw new AppError("invalid_tool_args", `${key} must be a valid UUID.`, 400);
  }

  return value;
}

export function requireNumberArg(
  args: Record<string, unknown>,
  key: string,
  options: {
    label?: string;
    min?: number;
    max?: number;
    allowZero?: boolean;
  } = {},
): number {
  const label = options.label || key;
  const value = numericOrNull(args[key]);

  if (value === null) {
    throw new AppError("invalid_tool_args", `${label} must be a number.`, 400);
  }

  if (options.allowZero === false && value <= 0) {
    throw new AppError("invalid_tool_args", `${label} must be greater than 0.`, 400);
  }

  if (options.min !== undefined && value < options.min) {
    throw new AppError("invalid_tool_args", `${label} must be at least ${options.min}.`, 400);
  }

  if (options.max !== undefined && value > options.max) {
    throw new AppError("invalid_tool_args", `${label} must be ${options.max} or less.`, 400);
  }

  return value;
}

export function ilikeContains(term: string): string {
  const normalized = normalizeShortText(term)
    .replace(/[%_*]/g, " ")
    .replace(MULTISPACE_RE, " ")
    .trim();

  if (!normalized) {
    throw new AppError(
      "invalid_tool_args",
      "Search term must contain at least one non-wildcard character.",
      400,
    );
  }

  return `ilike.*${normalized}*`;
}

export function ok(tool: string, data: JsonValue): ToolExecutionResult {
  return {
    ok: true,
    tool,
    data,
  };
}

export function fail(tool: string, error: ToolError): ToolExecutionResult {
  return {
    ok: false,
    tool,
    error,
  };
}

export function asToolError(error: unknown): ToolError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.expose ? error.message : "Tool execution failed.",
    };
  }

  return {
    code: "tool_execution_failed",
    message: "Tool execution failed.",
  };
}

export function ensureObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is JsonObject => isPlainObject(item));
}

export function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
