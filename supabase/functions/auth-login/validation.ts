import { AuthLoginError, LoginFlow, ValidatedLoginRequest } from "./types.ts";

const VALID_FLOWS = new Set<LoginFlow>(["web_login", "kiosk_login"]);
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE_RE = /\s+/g;
const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARS_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

function requireObjectBody(value: unknown): Record<string, unknown> {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new AuthLoginError("invalid_request", "Request body must be a JSON object.", 400);
  }

  return value as Record<string, unknown>;
}

function requireClientToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthLoginError("invalid_request", "client_token must be a string.", 400);
  }

  const normalized = normalizeText(value);
  if (!normalized || normalized.length < 16 || normalized.length > 128) {
    throw new AuthLoginError("invalid_request", "client_token is invalid.", 400);
  }

  return normalized;
}

function optionalChallengeField(value: unknown, key: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AuthLoginError("invalid_request", `${key} must be a string when provided.`, 400);
  }

  const normalized = normalizeText(value);
  if (!normalized || normalized.length > maxLength) {
    throw new AuthLoginError("invalid_request", `${key} is invalid.`, 400);
  }

  return normalized;
}

function requireEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthLoginError("invalid_request", "email must be a string.", 400);
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!SIMPLE_EMAIL_RE.test(normalized) || normalized.length > 320) {
    throw new AuthLoginError("invalid_request", "email is invalid.", 400);
  }

  return normalized;
}

function requirePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthLoginError("invalid_request", "password must be a string.", 400);
  }

  if (!value || value.length > 128) {
    throw new AuthLoginError("invalid_request", "password is invalid.", 400);
  }

  return value;
}

export async function parseAndValidateRequest(request: Request): Promise<ValidatedLoginRequest> {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    throw new AuthLoginError("invalid_request", "Request body must be valid JSON.", 400);
  }

  const body = requireObjectBody(parsedBody);
  const rawFlow = body.flow;

  if (typeof rawFlow !== "string" || !VALID_FLOWS.has(rawFlow as LoginFlow)) {
    throw new AuthLoginError("invalid_request", "flow must be one of: web_login, kiosk_login.", 400);
  }

  const flow = rawFlow as LoginFlow;
  const client_token = requireClientToken(body.client_token);
  const challenge_token = optionalChallengeField(body.challenge_token, "challenge_token", 600);
  const challenge_answer = optionalChallengeField(body.challenge_answer, "challenge_answer", 32);

  if (flow === "web_login") {
    return {
      flow,
      email: requireEmail(body.email),
      password: requirePassword(body.password),
      client_token,
      challenge_token,
      challenge_answer,
    };
  }

  return {
    flow,
    email: null,
    password: null,
    client_token,
    challenge_token,
    challenge_answer,
  };
}
