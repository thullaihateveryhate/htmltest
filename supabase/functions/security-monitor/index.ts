import { buildRequestId, persistMonitoringEvent } from "../_shared/monitoring.ts";
import { extractAuthContext } from "./auth.ts";
import { getEnv } from "./env.ts";
import { errorResponse, jsonResponse, optionsResponse } from "./responses.ts";
import { getClientEventSeverity, parseAndValidateRequest } from "./validation.ts";
import { MonitoringEnv, MonitoringError } from "./types.ts";

type SecurityMonitorDeps = {
  getEnv?: typeof getEnv;
  extractAuthContext?: typeof extractAuthContext;
  parseAndValidateRequest?: typeof parseAndValidateRequest;
  persistMonitoringEvent?: typeof persistMonitoringEvent;
};

export function createSecurityMonitorHandler(deps: SecurityMonitorDeps = {}) {
  const resolveEnv = deps.getEnv ?? getEnv;
  const resolveAuth = deps.extractAuthContext ?? extractAuthContext;
  const resolveRequest = deps.parseAndValidateRequest ?? parseAndValidateRequest;
  const writeEvent = deps.persistMonitoringEvent ?? persistMonitoringEvent;

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return optionsResponse();
    }

    if (request.method !== "POST") {
      return errorResponse(new MonitoringError("method_not_allowed", "Method not allowed.", 405));
    }

    const auth = resolveAuth(request);
    if (!auth.hasAuth || !auth.userId) {
      return errorResponse(new MonitoringError("auth_required", "Sign in to record monitoring events.", 403));
    }

    try {
      const env = resolveEnv() as MonitoringEnv;
      const payload = await resolveRequest(request);
      const requestId = payload.requestId || buildRequestId("monitor");

      await writeEvent(env, {
        eventType: payload.eventType,
        severity: getClientEventSeverity(payload.eventType),
        source: payload.source,
        route: payload.route,
        flow: payload.flow,
        requestId,
        actorUserId: auth.userId,
        clientToken: payload.clientToken,
        metadata: {
          ...payload.metadata,
          auth_state: auth.authState,
        },
      });

      return jsonResponse({
        ok: true,
        request_id: requestId,
      });
    } catch (error) {
      const appError = error instanceof MonitoringError
        ? error
        : new MonitoringError("monitoring_failed", "Monitoring event could not be recorded.", 500, false);

      console.error("[security-monitor] request failed", {
        code: appError.code,
        status: appError.status,
        message: appError.message,
      });

      return errorResponse(appError);
    }
  };
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(createSecurityMonitorHandler());
}
