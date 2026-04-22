import { getEnv } from "./env.ts";
import { attemptPasswordGrant } from "./provider.ts";
import { buildRequestId, persistMonitoringEvent } from "../_shared/monitoring.ts";
import {
  buildFailureResponse,
  buildFailureStates,
  buildScopeDescriptors,
  buildSuccessResetStates,
  createChallenge,
  extractIpAddress,
  sha256Hex,
  summarizeGuardStates,
  verifyChallenge,
} from "./protection.ts";
import { errorResponse, jsonResponse, optionsResponse } from "./responses.ts";
import { fetchGuardStates, upsertGuardStates } from "./store.ts";
import { AuthLoginEnv, AuthLoginError, GuardState, LoginFlow, ValidatedLoginRequest } from "./types.ts";
import { parseAndValidateRequest } from "./validation.ts";

type AuthLoginDeps = {
  getEnv?: typeof getEnv;
  parseAndValidateRequest?: typeof parseAndValidateRequest;
  fetchGuardStates?: typeof fetchGuardStates;
  upsertGuardStates?: typeof upsertGuardStates;
  attemptPasswordGrant?: typeof attemptPasswordGrant;
  now?: () => Date;
};

function genericInvalidLoginMessage(flow: LoginFlow): string {
  return flow === "kiosk_login"
    ? "Kiosk sign-in failed. Please retry in a moment."
    : "Unable to sign in. Check your credentials and try again.";
}

function genericLockoutMessage(flow: LoginFlow): string {
  return flow === "kiosk_login"
    ? "Kiosk sign-in is temporarily paused after repeated failures. Please wait and retry."
    : "Too many sign-in attempts. Please wait before trying again.";
}

function genericChallengeMessage(): string {
  return "Too many failed attempts. Complete the verification check to continue.";
}

async function logAuthMonitoringEvent(
  env: AuthLoginEnv,
  details: {
    eventType: string;
    severity: "info" | "warning" | "error" | "critical";
    flow: LoginFlow | null;
    requestId: string;
    email?: string | null;
    clientToken?: string | null;
    ipAddress?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await persistMonitoringEvent({
    supabaseUrl: env.supabaseUrl,
    supabaseServiceRoleKey: env.supabaseServiceRoleKey,
  }, {
    eventType: details.eventType,
    severity: details.severity,
    source: "auth_edge",
    route: "/functions/v1/auth-login",
    flow: details.flow,
    requestId: details.requestId,
    identifier: details.email,
    clientToken: details.clientToken,
    ipAddress: details.ipAddress,
    metadata: details.metadata,
  });
}

async function resolveCredentials(
  env: AuthLoginEnv,
  request: ValidatedLoginRequest,
): Promise<{ email: string; password: string }> {
  if (request.flow === "kiosk_login") {
    if (!env.kioskDemoEmail || !env.kioskDemoPassword) {
      throw new AuthLoginError(
        "missing_kiosk_demo_env",
        "Server configuration is missing kiosk credentials.",
        500,
        false,
      );
    }

    return {
      email: env.kioskDemoEmail,
      password: env.kioskDemoPassword,
    };
  }

  if (!request.email || !request.password) {
    throw new AuthLoginError("invalid_request", "email and password are required.", 400);
  }

  return {
    email: request.email,
    password: request.password,
  };
}

export function createAuthLoginHandler(deps: AuthLoginDeps = {}) {
  const resolveEnv = deps.getEnv ?? getEnv;
  const resolveRequest = deps.parseAndValidateRequest ?? parseAndValidateRequest;
  const loadGuardStates = deps.fetchGuardStates ?? fetchGuardStates;
  const saveGuardStates = deps.upsertGuardStates ?? upsertGuardStates;
  const passwordGrant = deps.attemptPasswordGrant ?? attemptPasswordGrant;
  const now = deps.now ?? (() => new Date());

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return optionsResponse();
    }

    if (request.method !== "POST") {
      return errorResponse(new AuthLoginError("method_not_allowed", "Method not allowed.", 405));
    }

    try {
      const env = resolveEnv();
      const requestId = buildRequestId("auth");
      const payload = await resolveRequest(request);
      const currentTime = now();
      const { email, password } = await resolveCredentials(env, payload);
      const ipAddress = extractIpAddress(request);
      if (payload.flow === "kiosk_login") {
        await logAuthMonitoringEvent(env, {
          eventType: "kiosk_login_attempt",
          severity: "info",
          flow: payload.flow,
          requestId,
          email,
          clientToken: payload.client_token,
          ipAddress,
          metadata: {
            auth_state: "attempt_started",
          },
        });
      }
      const identifierHash = await sha256Hex(`${payload.flow}|${email}`);
      const deviceHash = await sha256Hex(payload.client_token);
      const ipHash = ipAddress ? await sha256Hex(ipAddress) : null;
      const scopeDescriptors = await buildScopeDescriptors(payload.flow, identifierHash, deviceHash, ipHash);
      const currentStates = await loadGuardStates(env, scopeDescriptors.map((descriptor) => descriptor.scopeKey));
      const summary = summarizeGuardStates(payload.flow, currentStates, currentTime);

      if (summary.retryAfterMs > 0) {
        await logAuthMonitoringEvent(env, {
          eventType: "bruteforce_lockout_triggered",
          severity: "warning",
          flow: payload.flow,
          requestId,
          email,
          clientToken: payload.client_token,
          ipAddress,
          metadata: {
            reason: "existing_lockout",
            failed_attempts: summary.failedAttempts,
            retry_after_ms: summary.retryAfterMs,
          },
        });
        return jsonResponse(
          buildFailureResponse(
            "too_many_attempts",
            genericLockoutMessage(payload.flow),
            summary.retryAfterMs,
          ),
        );
      }

      if (summary.challengeRequired) {
        const challengeVerified = await verifyChallenge(
          env.challengeSecret,
          payload.flow,
          identifierHash,
          deviceHash,
          payload.challenge_token,
          payload.challenge_answer,
          currentTime,
        );

        if (!challengeVerified) {
          const shouldIncrementFailure = Boolean(payload.challenge_token || payload.challenge_answer);
          let nextStates = currentStates;
          let nextSummary = summary;

          if (shouldIncrementFailure) {
            nextStates = buildFailureStates(payload.flow, scopeDescriptors, currentStates, currentTime);
            await saveGuardStates(env, nextStates);
            nextSummary = summarizeGuardStates(payload.flow, nextStates, currentTime);
          }

          const challenge = payload.flow === "web_login"
            ? await createChallenge(env.challengeSecret, payload.flow, identifierHash, deviceHash, currentTime)
            : undefined;

          if (nextSummary.retryAfterMs > 0) {
            await logAuthMonitoringEvent(env, {
              eventType: "bruteforce_lockout_triggered",
              severity: "warning",
              flow: payload.flow,
              requestId,
              email,
              clientToken: payload.client_token,
              ipAddress,
              metadata: {
                reason: "challenge_failure",
                failed_attempts: nextSummary.failedAttempts,
                retry_after_ms: nextSummary.retryAfterMs,
              },
            });
          } else {
            await logAuthMonitoringEvent(env, {
              eventType: "bruteforce_challenge_triggered",
              severity: "warning",
              flow: payload.flow,
              requestId,
              email,
              clientToken: payload.client_token,
              ipAddress,
              metadata: {
                reason: shouldIncrementFailure ? "challenge_validation_failed" : "challenge_required",
                failed_attempts: nextSummary.failedAttempts,
                challenge_present: Boolean(payload.challenge_token || payload.challenge_answer),
              },
            });
          }

          return jsonResponse(
            buildFailureResponse(
              nextSummary.retryAfterMs > 0 ? "too_many_attempts" : "challenge_required",
              nextSummary.retryAfterMs > 0 ? genericLockoutMessage(payload.flow) : genericChallengeMessage(),
              nextSummary.retryAfterMs,
              challenge,
            ),
          );
        }
      }

      const authResult = await passwordGrant(env, email, password);
      if (!authResult.ok || !authResult.session) {
        const failedStates = buildFailureStates(payload.flow, scopeDescriptors, currentStates, currentTime);
        await saveGuardStates(env, failedStates);
        const failedSummary = summarizeGuardStates(payload.flow, failedStates, currentTime);
        const challenge = failedSummary.challengeRequired && payload.flow === "web_login"
          ? await createChallenge(env.challengeSecret, payload.flow, identifierHash, deviceHash, currentTime)
          : undefined;

        await logAuthMonitoringEvent(env, {
          eventType: failedSummary.retryAfterMs > 0 ? "bruteforce_lockout_triggered" : (failedSummary.challengeRequired ? "bruteforce_challenge_triggered" : "login_failure"),
          severity: failedSummary.retryAfterMs > 0 ? "warning" : "warning",
          flow: payload.flow,
          requestId,
          email,
          clientToken: payload.client_token,
          ipAddress,
          metadata: {
            failed_attempts: failedSummary.failedAttempts,
            retry_after_ms: failedSummary.retryAfterMs,
            challenge_required: failedSummary.challengeRequired,
          },
        });

        return jsonResponse(
          buildFailureResponse(
            failedSummary.retryAfterMs > 0 ? "too_many_attempts" : (failedSummary.challengeRequired ? "challenge_required" : "invalid_credentials"),
            failedSummary.retryAfterMs > 0
              ? genericLockoutMessage(payload.flow)
              : failedSummary.challengeRequired
              ? genericChallengeMessage()
              : genericInvalidLoginMessage(payload.flow),
            failedSummary.retryAfterMs,
            challenge,
          ),
        );
      }

      const resetStates: GuardState[] = buildSuccessResetStates(scopeDescriptors, currentStates, currentTime);
      await saveGuardStates(env, resetStates);

      await logAuthMonitoringEvent(env, {
        eventType: "login_success",
        severity: "info",
        flow: payload.flow,
        requestId,
        email,
        clientToken: payload.client_token,
        ipAddress,
        metadata: {
          challenge_required_before_success: summary.challengeRequired,
          failed_attempts_before_success: summary.failedAttempts,
        },
      });

      return jsonResponse({
        ok: true,
        code: "signed_in",
        message: "Signed in successfully.",
        session: authResult.session,
      });
    } catch (error) {
      const appError = error instanceof AuthLoginError
        ? error
        : new AuthLoginError("auth_login_failed", "Protected sign-in failed.", 500, false);

      try {
        const env = resolveEnv();
        await logAuthMonitoringEvent(env, {
          eventType: appError.code === "invalid_request" ? "auth_request_rejected" : "auth_login_error",
          severity: appError.status >= 500 ? "error" : "warning",
          flow: null,
          requestId: buildRequestId("auth"),
          ipAddress: extractIpAddress(request),
          metadata: {
            code: appError.code,
            status: appError.status,
          },
        });
      } catch (_monitoringError) {
      }

      console.error("[auth-login] request failed", {
        code: appError.code,
        status: appError.status,
        message: appError.message,
      });

      return errorResponse(appError);
    }
  };
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(createAuthLoginHandler());
}
