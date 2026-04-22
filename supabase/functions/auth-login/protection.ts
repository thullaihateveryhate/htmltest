import { GuardScopeDescriptor, GuardState, GuardSummary, HandlerResponseBody, LoginChallenge, LoginFlow, ScopeType } from "./types.ts";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;
const MAX_FAILURE_LOCK_SECONDS = 15 * 60;
const LOCKOUT_STEPS_SECONDS = [30, 60, 300, 900];

type FlowConfig = {
  challengeThreshold: number | null;
  lockThreshold: number;
  lockoutStepsSeconds: number[];
};

function getFlowConfig(flow: LoginFlow): FlowConfig {
  if (flow === "kiosk_login") {
    return {
      challengeThreshold: null,
      lockThreshold: 3,
      lockoutStepsSeconds: LOCKOUT_STEPS_SECONDS,
    };
  }

  return {
    challengeThreshold: 3,
    lockThreshold: 5,
    lockoutStepsSeconds: LOCKOUT_STEPS_SECONDS,
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    fromUtf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(normalized + padding);
}

function randomNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function randomIntInclusive(min: number, max: number): number {
  const range = max - min + 1;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return min + (buffer[0] % range);
}

function getChallengeOperator(): "+" | "-" {
  return randomIntInclusive(0, 1) === 0 ? "+" : "-";
}

function computeChallengeAnswer(left: number, right: number, operator: "+" | "-"): number {
  return operator === "+" ? left + right : left - right;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromUtf8(value));
  return toHex(new Uint8Array(digest));
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, fromUtf8(value));
  return toHex(new Uint8Array(signature));
}

export function extractIpAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
  if (!forwarded) {
    return null;
  }

  const first = forwarded.split(",")[0]?.trim();
  return first || null;
}

export async function buildScopeDescriptors(
  flow: LoginFlow,
  identifierHash: string,
  deviceHash: string,
  ipHash: string | null,
): Promise<GuardScopeDescriptor[]> {
  const descriptors: Array<{ scopeType: ScopeType; seed: string }> = [
    { scopeType: "identifier", seed: `${flow}|identifier|${identifierHash}` },
    { scopeType: "device", seed: `${flow}|device|${deviceHash}` },
    { scopeType: "identifier_device", seed: `${flow}|identifier_device|${identifierHash}|${deviceHash}` },
  ];

  if (ipHash) {
    descriptors.push({ scopeType: "ip", seed: `${flow}|ip|${ipHash}` });
  }

  const scopeDescriptors: GuardScopeDescriptor[] = [];
  for (const descriptor of descriptors) {
    scopeDescriptors.push({
      scopeKey: await sha256Hex(descriptor.seed),
      flow,
      scopeType: descriptor.scopeType,
    });
  }

  return scopeDescriptors;
}

function normalizeGuardState(raw: GuardState, nowMs: number): GuardState {
  if (!raw.last_failed_at) {
    return raw;
  }

  const failedAtMs = Date.parse(raw.last_failed_at);
  if (Number.isNaN(failedAtMs)) {
    return {
      ...raw,
      failed_attempts: 0,
      challenge_required: false,
      lock_until: null,
      last_failed_at: null,
    };
  }

  if (nowMs - failedAtMs > ATTEMPT_WINDOW_MS) {
    return {
      ...raw,
      failed_attempts: 0,
      challenge_required: false,
      lock_until: null,
      last_failed_at: null,
    };
  }

  return raw;
}

export function summarizeGuardStates(flow: LoginFlow, states: GuardState[], now: Date): GuardSummary {
  const nowMs = now.getTime();
  const config = getFlowConfig(flow);
  let failedAttempts = 0;
  let challengeRequired = false;
  let retryAfterMs = 0;
  let lockedUntil: string | null = null;

  for (const raw of states) {
    const state = normalizeGuardState(raw, nowMs);
    failedAttempts = Math.max(failedAttempts, state.failed_attempts || 0);
    challengeRequired = challengeRequired || Boolean(state.challenge_required);

    if (state.lock_until) {
      const lockMs = Date.parse(state.lock_until);
      if (!Number.isNaN(lockMs) && lockMs > nowMs) {
        const remaining = lockMs - nowMs;
        if (remaining > retryAfterMs) {
          retryAfterMs = remaining;
          lockedUntil = state.lock_until;
        }
      }
    }
  }

  if (config.challengeThreshold !== null && failedAttempts >= config.challengeThreshold) {
    challengeRequired = true;
  }

  return {
    failedAttempts,
    challengeRequired,
    retryAfterMs,
    lockedUntil,
  };
}

export function computeLockoutMs(flow: LoginFlow, failedAttempts: number): number {
  const { lockThreshold, lockoutStepsSeconds } = getFlowConfig(flow);
  if (failedAttempts < lockThreshold) {
    return 0;
  }

  const overflow = failedAttempts - lockThreshold;
  const step = Math.min(overflow, lockoutStepsSeconds.length - 1);
  const seconds = lockoutStepsSeconds[step] || MAX_FAILURE_LOCK_SECONDS;
  return Math.min(seconds, MAX_FAILURE_LOCK_SECONDS) * 1000;
}

export function buildFailureStates(
  flow: LoginFlow,
  descriptors: GuardScopeDescriptor[],
  currentStates: GuardState[],
  now: Date,
): GuardState[] {
  const stateMap = new Map(currentStates.map((state) => [state.scope_key, normalizeGuardState(state, now.getTime())]));
  const config = getFlowConfig(flow);

  return descriptors.map((descriptor) => {
    const existing = stateMap.get(descriptor.scopeKey);
    const failedAttempts = (existing?.failed_attempts || 0) + 1;
    const lockMs = computeLockoutMs(flow, failedAttempts);

    return {
      scope_key: descriptor.scopeKey,
      flow: descriptor.flow,
      scope_type: descriptor.scopeType,
      failed_attempts: failedAttempts,
      challenge_required: config.challengeThreshold !== null && failedAttempts >= config.challengeThreshold,
      lock_until: lockMs > 0 ? new Date(now.getTime() + lockMs).toISOString() : null,
      last_failed_at: now.toISOString(),
      last_success_at: existing?.last_success_at || null,
      updated_at: now.toISOString(),
      created_at: existing?.created_at,
    };
  });
}

export function buildSuccessResetStates(
  descriptors: GuardScopeDescriptor[],
  currentStates: GuardState[],
  now: Date,
): GuardState[] {
  const stateMap = new Map(currentStates.map((state) => [state.scope_key, state]));

  return descriptors.map((descriptor) => {
    const existing = stateMap.get(descriptor.scopeKey);
    return {
      scope_key: descriptor.scopeKey,
      flow: descriptor.flow,
      scope_type: descriptor.scopeType,
      failed_attempts: 0,
      challenge_required: false,
      lock_until: null,
      last_failed_at: existing?.last_failed_at || null,
      last_success_at: now.toISOString(),
      updated_at: now.toISOString(),
      created_at: existing?.created_at,
    };
  });
}

type ChallengePayload = {
  flow: LoginFlow;
  identifier_hash: string;
  device_hash: string;
  nonce: string;
  left: number;
  right: number;
  operator: "+" | "-";
  answer_hash: string;
  expires_at: string;
};

export async function createChallenge(
  secret: string,
  flow: LoginFlow,
  identifierHash: string,
  deviceHash: string,
  now: Date,
): Promise<LoginChallenge> {
  const operator = getChallengeOperator();
  const left = randomIntInclusive(operator === "+" ? 2 : 10, 12);
  const right = randomIntInclusive(2, operator === "+" ? 9 : left - 1);
  const nonce = randomNonce();
  const answer = computeChallengeAnswer(left, right, operator);
  const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

  const payload: ChallengePayload = {
    flow,
    identifier_hash: identifierHash,
    device_hash: deviceHash,
    nonce,
    left,
    right,
    operator,
    answer_hash: await sha256Hex(`${answer}|${nonce}`),
    expires_at: expiresAt,
  };

  const serialized = JSON.stringify(payload);
  const tokenPayload = base64UrlEncode(serialized);
  const signature = await hmacHex(secret, tokenPayload);

  return {
    prompt: `What is ${left} ${operator} ${right}?`,
    token: `${tokenPayload}.${signature}`,
    expires_at: expiresAt,
  };
}

export async function verifyChallenge(
  secret: string,
  flow: LoginFlow,
  identifierHash: string,
  deviceHash: string,
  token: string | undefined,
  answer: string | undefined,
  now: Date,
): Promise<boolean> {
  if (!token || !answer) {
    return false;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = await hmacHex(secret, encodedPayload);
  if (signature !== expectedSignature) {
    return false;
  }

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as ChallengePayload;
  } catch {
    return false;
  }

  if (payload.flow !== flow || payload.identifier_hash !== identifierHash || payload.device_hash !== deviceHash) {
    return false;
  }

  const expiresAtMs = Date.parse(payload.expires_at);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return false;
  }

  const normalizedAnswer = String(answer).trim();
  const answerHash = await sha256Hex(`${normalizedAnswer}|${payload.nonce}`);
  return answerHash === payload.answer_hash;
}

export function buildFailureResponse(
  code: string,
  message: string,
  retryAfterMs = 0,
  challenge?: LoginChallenge,
): HandlerResponseBody {
  return {
    ok: false,
    code,
    message,
    retry_after_ms: retryAfterMs > 0 ? retryAfterMs : undefined,
    challenge,
  };
}
