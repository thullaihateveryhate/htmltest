import { logWriteAudit } from "./audit.ts";
import { toolHandlerMap } from "./tool-registry.ts";
import { createPendingAction, verifyPendingAction } from "./pending-actions.ts";
import { asToolError } from "./tools/common.ts";
import {
  AppError,
  AuthContext,
  CopilotRequest,
  CopilotResult,
  ExecutedActionData,
  OpenAIRuntimeEnv,
  PendingActionInput,
  ToolCall,
  ToolContext,
  ToolExecutionEnvelope,
  ToolExecutionResult,
} from "./types.ts";
import { createSupabaseGateway } from "./supabase.ts";

function parseToolArguments(call: ToolCall): unknown {
  if (!call.argumentsJson || !call.argumentsJson.trim()) {
    return {};
  }

  return JSON.parse(call.argumentsJson);
}

function unsupportedToolResult(name: string): ToolExecutionResult {
  return {
    ok: false,
    tool: name,
    error: {
      code: "unsupported_tool",
      message: `Tool ${name} is not supported by this server path.`,
    },
  };
}

function confirmationRequiredResult(
  name: string,
  pendingAction: NonNullable<ToolExecutionEnvelope["pendingAction"]>,
): ToolExecutionResult {
  return {
    ok: true,
    tool: name,
    data: {
      status: "confirmation_required",
      summary: pendingAction.summary,
      pending_action: pendingAction,
    },
  };
}

function createToolContext(
  env: OpenAIRuntimeEnv,
  request: CopilotRequest,
  auth: AuthContext,
): ToolContext {
  return {
    auth,
    request,
    supabase: createSupabaseGateway(env, auth),
  };
}

export async function executeToolCall(
  call: ToolCall,
  env: OpenAIRuntimeEnv,
  request: CopilotRequest,
  auth: AuthContext,
): Promise<ToolExecutionEnvelope> {
  const handler = toolHandlerMap.get(call.name);
  if (!handler) {
    return {
      callId: call.callId,
      name: call.name,
      result: unsupportedToolResult(call.name),
    };
  }

  const context = createToolContext(env, request, auth);

  try {
    const parsedArgs = parseToolArguments(call);

    if (handler.access === "write") {
      if (!handler.preparePendingAction) {
        throw new AppError(
          "tool_configuration_error",
          `Tool ${call.name} is missing pending-action preparation.`,
          500,
          false,
        );
      }

      const proposal = await handler.preparePendingAction(parsedArgs, context);
      const pendingAction = await createPendingAction(proposal, env, auth);

      return {
        callId: call.callId,
        name: call.name,
        pendingAction,
        result: confirmationRequiredResult(call.name, pendingAction),
      };
    }

    const result = await handler.execute(parsedArgs, context);
    return {
      callId: call.callId,
      name: call.name,
      result,
    };
  } catch (error) {
    if (handler.access === "write") {
      const appError = error instanceof AppError
        ? error
        : new AppError("pending_action_issue_failed", "Pending action could not be prepared.", 500, false);

      logWriteAudit("pending_action_issue_rejected", auth, {
        tool_name: call.name,
        code: appError.code,
      });
    }

    console.error("[copilot] tool execution failed", {
      tool: call.name,
      callId: call.callId,
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      callId: call.callId,
      name: call.name,
      result: {
        ok: false,
        tool: call.name,
        error: asToolError(error),
      },
    };
  }
}

export async function executeConfirmedPendingAction(
  pendingActionInput: PendingActionInput,
  env: OpenAIRuntimeEnv,
  request: CopilotRequest,
  auth: AuthContext,
): Promise<CopilotResult<ExecutedActionData>> {
  const pendingAction = await verifyPendingAction(pendingActionInput, env, auth);
  const handler = toolHandlerMap.get(pendingAction.tool_name);

  if (!handler || handler.access !== "write") {
    logWriteAudit("pending_action_rejected", auth, {
      tool_name: pendingAction.tool_name,
      code: "unsupported_pending_action",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      "unsupported_pending_action",
      "This confirmed action is not enabled in Copilot.",
      400,
    );
  }

  const context = createToolContext(env, request, auth);
  let result: ToolExecutionResult;

  try {
    result = await handler.execute(pendingAction.arguments, context);
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError("action_execution_failed", "The requested action could not be completed.", 500, false);

    logWriteAudit("confirmed_write_failed", auth, {
      tool_name: pendingAction.tool_name,
      code: appError.code,
      nonce: pendingAction.nonce,
    });

    throw appError;
  }

  if (!result.ok) {
    logWriteAudit("confirmed_write_failed", auth, {
      tool_name: pendingAction.tool_name,
      code: result.error?.code || "action_execution_failed",
      nonce: pendingAction.nonce,
    });
    throw new AppError(
      result.error?.code || "action_execution_failed",
      result.error?.message || "The requested action could not be completed.",
      400,
    );
  }

  const reply = handler.formatSuccessReply
    ? handler.formatSuccessReply(result, context)
    : `Done — completed ${pendingAction.summary}.`;

  logWriteAudit("confirmed_write_succeeded", auth, {
    tool_name: pendingAction.tool_name,
    nonce: pendingAction.nonce,
  });

  return {
    reply,
    data: {
      executed_action: {
        tool_name: pendingAction.tool_name,
        summary: pendingAction.summary,
        result: result.data ?? null,
      },
    },
    model: env.model,
  };
}
