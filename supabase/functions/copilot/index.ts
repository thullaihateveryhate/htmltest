import { extractAuthContext } from "./auth.ts";
import { getEnv } from "./env.ts";
import { generateChatResponse, generatePricingInsights } from "./openai.ts";
import { asAppError, errorResponse, optionsResponse, successResponse } from "./responses.ts";
import { executeConfirmedPendingAction, executeToolCall } from "./tool-dispatch.ts";
import { chatToolDefinitions } from "./tool-registry.ts";
import { AppError } from "./types.ts";
import { parseAndValidateRequest } from "./validation.ts";

type CopilotHandlerDeps = {
  getEnv?: typeof getEnv;
  extractAuthContext?: typeof extractAuthContext;
  generateChatResponse?: typeof generateChatResponse;
  generatePricingInsights?: typeof generatePricingInsights;
  executeConfirmedPendingAction?: typeof executeConfirmedPendingAction;
  executeToolCall?: typeof executeToolCall;
};

export function createCopilotHandler(deps: CopilotHandlerDeps = {}) {
  const resolveEnv = deps.getEnv ?? getEnv;
  const resolveAuth = deps.extractAuthContext ?? extractAuthContext;
  const resolveGenerateChat = deps.generateChatResponse ?? generateChatResponse;
  const resolveGeneratePricing = deps.generatePricingInsights ?? generatePricingInsights;
  const resolveExecuteConfirmed = deps.executeConfirmedPendingAction ?? executeConfirmedPendingAction;
  const resolveExecuteToolCall = deps.executeToolCall ?? executeToolCall;

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return optionsResponse();
    }

    if (request.method !== "POST") {
      return errorResponse(
        new AppError("method_not_allowed", "Method not allowed.", 405),
      );
    }

    const auth = resolveAuth(request);

    try {
      const payload = await parseAndValidateRequest(request);
      const env = resolveEnv();

      console.log("[copilot] request received", {
        mode: payload.mode,
        authState: auth.authState,
        hasContext: Boolean(payload.context),
        confirm: payload.confirm ?? false,
      });

      const result = payload.mode === "pricing_insights"
        ? await resolveGeneratePricing(env, payload, auth)
        : payload.confirm === true && payload.pending_action
        ? await resolveExecuteConfirmed(payload.pending_action, env, payload, auth)
        : await resolveGenerateChat(env, payload, auth, {
          definitions: chatToolDefinitions,
          execute: (call, toolRequest, authContext) => resolveExecuteToolCall(call, env, toolRequest, authContext),
        });

      return successResponse(payload.mode, result.reply, result.model, result.data);
    } catch (error) {
      const appError = asAppError(error);

      console.error("[copilot] request failed", {
        code: appError.code,
        status: appError.status,
        message: appError.message,
      });

      return errorResponse(appError);
    }
  };
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(createCopilotHandler());
}
